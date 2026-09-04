/**
 * Korea Customs Service tariff rows → canonical Market Access evidence.
 *
 * ## What is confirmed vs. retained-but-unresolved
 *
 * Every 관세율구분 (rate-type) code this parser has ever observed in a real KCS release resolves
 * against `korea-rate-programs.ts` — a registry built verbatim from Korea Customs Service's own
 * 관세법령정보포털 CLIP portal (see that file's header). `A` (기본세율) is the confirmed general
 * statutory rate; `C` (WTO협정세율) is the confirmed WTO-bound rate, kept distinct — the legal
 * interaction between the two (e.g. whichever binds lower) is not documented in this dataset and is
 * not assumed. `FIN1`-`FIN4` are the CONFIRMED Korea-India FTA/CEPA rate codes (CLIP's own label:
 * "한ㆍ인도 FTA협정세율"); `FCEPA1`-`FCEPA8`, despite the name, are CONFIRMED to be Korea-Central
 * America FTA, Panama's schedule ("한ㆍ중미 FTA협정세율_파나마") — NOT India, correcting this
 * parser's earlier (appropriately cautious, but now superseded) treatment of `FCEPA1` as an
 * unresolved India candidate. A code that appears in a future release but not in the registry is
 * still retained verbatim and flagged unresolved, never guessed from its letters.
 */
import { MarketAccessRuleType } from '@prisma/client';
import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { KoreaAuthorityBundle, KoreaRateRow } from './korea-bundle';
import {
  GENERAL_RATE_CODE,
  INDIA_FTA_RATE_CODES,
  resolveKoreaRateProgram,
  type KoreaRateProgram,
} from './korea-rate-programs';
import { resolveKoreaTariffUnit } from './korea-tariff-units';

export const KOREA_PARSER_VERSION = 'kcs-tariff-parser-v2' as const;
export const KOREA_PROVIDER = 'kr_kcs_customs_tariff' as const;
export const KOREA_SOURCE_AUTHORITY = 'Korea Customs Service (관세청)' as const;
export const KOREA_SOURCE_DATASET = '관세청_품목번호별 관세율표 (data.go.kr dataset 15051179)' as const;

/** Korean tariff duty amounts are denominated in KRW as a matter of Korean tariff law itself (the
 *  Customs Act's own rate tables are won-denominated) — confirmed independently of this dataset,
 *  which is why this is asserted for every compound row rather than left null like the unit is.
 *  The per-line QUANTITY UNIT (kg, piece, ...) is NOT published in this dataset (no unit column)
 *  and is NOT hardcoded — see parseKoreaDuty's note on rows where unit_amount is populated. */
const SPECIFIC_DUTY_CURRENCY = 'KRW' as const;

const EMPTY = (kind: ParsedDuty['kind'], expression: string, note: string | null = null): ParsedDuty => ({
  kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
  specific_unit: null, specific_unit_quantity: null, expression, note,
});

/** `YYYYMMDD` → Date, or null if not a valid 8-digit date. */
function parseYyyymmdd(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) return null;
  const y = value.slice(0, 4), m = value.slice(4, 6), d = value.slice(6, 8);
  const date = new Date(`${y}-${m}-${d}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isEffective(row: KoreaRateRow, at: Date): boolean {
  const from = parseYyyymmdd(row.effective_from);
  const to = parseYyyymmdd(row.effective_to);
  if (from && from.getTime() > at.getTime()) return false;
  if (to && to.getTime() < at.getTime()) return false;
  return true;
}

/**
 * One KCS rate row → a canonical duty.
 *
 * `관세율` (rate_value) is ad valorem when unaccompanied by a unit amount — corroborated (not just
 * assumed) by the T2/1006100000 rice row (513%), matching Korea's independently well-known WTO-
 * tariffication rice rate. `단위당세액`, when also populated, makes the row a compound duty: KRW
 * currency is asserted (Korean tariff law is won-denominated), and the quantity UNIT is resolved
 * from `korea-tariff-units.ts` (built from dataset 15049722, KCS's own HS-line unit table) — for
 * the 105 of 108 real compound items where that table has exactly one candidate unit, the
 * resolution is unambiguous; for the 3 with two candidates (photographic film, recorded video),
 * it is resolved from the item's own official name but flagged at a distinct, lower confidence.
 * An item not in that table (a future release's new compound line this table hasn't been extended
 * to cover) is NOT guessed — the unit stays null with an explicit note, exactly the same discipline
 * this dataset's own gaps have always been held to. `기준가격` (T2's price-based special-safeguard
 * reference price) is NEVER computed into a duty: calculating the actual SSG surcharge requires
 * the shipment's own import price, which this dataset — a published schedule, not a transaction
 * record — cannot supply.
 */
export function parseKoreaDuty(item: string, row: KoreaRateRow): ParsedDuty {
  const unitResolution = row.unit_amount !== null ? resolveKoreaTariffUnit(item) : null;

  const parts: string[] = [];
  if (row.rate_value !== null) parts.push(`${row.rate_value}% (관세율)`);
  if (row.unit_amount !== null) {
    const unitPart = unitResolution?.resolved
      ? `${SPECIFIC_DUTY_CURRENCY} ${row.unit_amount} per ${unitResolution.unit.unit_label} (단위당세액)`
      : `${row.unit_amount} ${SPECIFIC_DUTY_CURRENCY} per unit (단위당세액, quantity unit not resolved for this item)`;
    parts.push(unitPart);
  }
  if (row.reference_price !== null) parts.push(`reference price ${row.reference_price} (기준가격 — price-based special safeguard trigger, Customs Act Enforcement Decree Art. 90)`);
  const expression = parts.join(' + ') || '(no rate published)';

  if (row.rate_value === null && row.unit_amount === null) {
    return EMPTY('none', expression, 'This row publishes neither a 관세율 nor a 단위당세액 value.');
  }

  if (row.unit_amount !== null) {
    const operatorNote = 'Korea\'s Customs Act Enforcement Rule (관세법 시행규칙) documents a "선택관세" (elective) mechanism for designated ad-valorem/specific goods — apply whichever of the two yields the HIGHER amount — distinct from a true "복합관세" (compound: both applied together, additive). The rows carrying this shape in the real release cluster in HS chapters 3/4/7/8 (fish, dairy/honey, vegetables, fruit), the classic Korean agricultural-protection compound-duty category where 선택관세 is the well-established pattern — but this has NOT been confirmed per HS line from a source naming the exact operator for each one, so no operator is asserted in the parsed value: both components are retained separately.';
    const unitNote = unitResolution?.resolved
      ? unitResolution.unit.confidence === 'unambiguous'
        ? `Quantity unit resolved to ${unitResolution.unit.unit_label} (${unitResolution.unit.unit_code}) from KCS dataset 15049722 — the only unit that dataset publishes for this item, so unambiguous.`
        : `Quantity unit resolved to ${unitResolution.unit.unit_label} (${unitResolution.unit.unit_code}) from the item's own official name in KCS dataset 15049722 ("${unitResolution.unit.official_item_name_ko}"); that dataset also publishes ${unitResolution.unit.alternative_candidate_unit} as a candidate for this item, not chosen here — see korea-tariff-units.ts for the reasoning.`
      : `Quantity unit NOT resolved: this item is not in the KCS dataset 15049722 extract this project retains. Not guessed.`;
    return {
      kind: 'compound',
      ad_valorem_rate_percent: null,
      specific_amount: row.unit_amount,
      specific_currency: SPECIFIC_DUTY_CURRENCY,
      specific_unit: unitResolution?.resolved ? unitResolution.unit.unit_code : null,
      specific_unit_quantity: unitResolution?.resolved ? 1 : null,
      expression,
      note: `${operatorNote} ${unitNote}`,
    };
  }

  // rate_value populated, unit_amount not: ad-valorem percentage. reference_price, if also
  // present, is retained in the note but never used to compute a duty (see function doc).
  const note = row.reference_price !== null
    ? 'A reference price (기준가격) also accompanies this rate. This is the trigger price for KCS\'s price-based agricultural special safeguard (특별긴급관세, Customs Act Enforcement Decree Art. 90): it is NOT itself a duty, and the safeguard surcharge cannot be computed without the shipment\'s actual import price, which this published schedule does not carry.'
    : null;
  return {
    kind: 'ad_valorem',
    ad_valorem_rate_percent: row.rate_value,
    specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression, note,
  };
}

function effectiveRowsFor(bundle: KoreaAuthorityBundle, item: string, code: string, at: Date): KoreaRateRow[] {
  return (bundle.item_rates.get(item) ?? []).filter((row) => row.rate_type_code === code && isEffective(row, at));
}

/** measure_kind per contract.ts's fixed vocabulary, derived from the registry's program_class —
 *  never from the raw symbol string. */
function measureKindFor(code: string, program: KoreaRateProgram | null): MarketAccessLineRecord['measure_kind'] {
  if (code === GENERAL_RATE_CODE) return 'third_country_duty';
  if (!program) return 'other';
  if (program.is_quota) return 'tariff_quota';
  if (program.program_class === 'trade_remedy' || program.program_class === 'special_safeguard') return 'additional_duty';
  if (program.is_preferential) return 'tariff_preference';
  return 'other';
}

function conditionsFor(row: KoreaRateRow, program: KoreaRateProgram | null) {
  return {
    rate_type_code: row.rate_type_code,
    country_scope: row.country_scope,
    purpose_code: row.purpose_code,
    // A non-null purpose_code marks this row as subject to 용도세율 (a conditional end-use rate
    // requiring prior approval and 사후관리 post-clearance monitoring for up to 3 years — Customs
    // Act Arts. 83/97-98). The dataset's own primary description states this field shares its code
    // values with 관세율구분 (`A`=기본세율-anchored, `C`=WTO협정세율-anchored) — confirmed which
    // BASE category the conditional rate is administered against, never treated as unconditional:
    // approval and post-entry monitoring remain real gates a schedule entry cannot certify.
    purpose_conditional: row.purpose_code !== null,
    purpose_code_anchor: row.purpose_code === 'A' ? 'basic_rate' : row.purpose_code === 'C' ? 'wto_bound_rate' : null,
    program_resolved: program !== null,
    program_class: program?.program_class ?? null,
    agreement: program?.agreement ?? null,
    partner: program?.partner ?? null,
    selection_number: program?.selection_number ?? null,
    is_quota: program?.is_quota ?? false,
    is_recommendation_conditional: program?.is_recommendation_conditional ?? false,
    recommendation_required: program?.recommendation_required ?? null,
    kcs_label_ko: program?.kcs_label_ko ?? null,
  };
}

export function buildKoreaMarketAccess(args: {
  bundle: KoreaAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const { bundle } = args;
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const at = args.at;

  const items = [...bundle.item_rates.keys()].filter((code) => code.startsWith(hs6)).sort();

  const built: Array<{
    candidate: CandidateTariffLine;
    generalRow: KoreaRateRow | null;
    indiaRows: Array<{ code: string; row: KoreaRateRow }>;
  }> = [];

  for (const item of items) {
    const rows = bundle.item_rates.get(item)!;
    const generalRows = effectiveRowsFor(bundle, item, GENERAL_RATE_CODE, at);
    // More than one currently-effective `A` row for the same item would itself be an authority
    // ambiguity this reader has not observed; taking the first keeps behaviour defined rather than
    // silently picking the last, and is a real gap to revisit if it is ever actually seen.
    const generalRow = generalRows[0] ?? null;

    // India-origin duty applies only when the importer's origin is actually India — an origin
    // input other than IN never surfaces a Korea-India FTA measure, matching the discipline that a
    // preference is conditional on the shipment's real origin, not just on the schedule publishing
    // one. The India-preference DETERMINATION for a non-IN origin request still runs (India-CEPA
    // measures are irrelevant to it) and correctly resolves as not applicable to that origin.
    const indiaRows: Array<{ code: string; row: KoreaRateRow }> = origin === 'IN'
      ? INDIA_FTA_RATE_CODES.flatMap((code) => effectiveRowsFor(bundle, item, code, at).map((row) => ({ code, row })))
      : [];

    // Every OTHER currently-effective code beyond the general rate is this item's preferential/
    // programme coverage, recorded as raw authority codes — never as a claim about which country
    // or agreement each one names beyond what the registry itself confirms.
    const preferenceAreas = [...new Set(
      rows.filter((row) => row.rate_type_code !== GENERAL_RATE_CODE && isEffective(row, at)).map((row) => row.rate_type_code),
    )].sort();

    const anyRowForValidity = generalRow ?? rows[0]!;
    built.push({
      candidate: {
        national_tariff_code: item,
        description: `Korean tariff item ${item}`,
        declarable: true,
        effective_from: parseYyyymmdd(anyRowForValidity.effective_from),
        effective_to: parseYyyymmdd(anyRowForValidity.effective_to),
        general_duty: generalRow
          ? parseKoreaDuty(item, generalRow)
          : EMPTY('none', '', `KCS publishes no currently-effective ${GENERAL_RATE_CODE} (기본세율) row for this item at the assessment date.`),
        control_codes: [],
        preference_area_ids: preferenceAreas,
      },
      generalRow,
      indiaRows,
    });
  }

  const resolution = resolveNationalTariffLine(built.map((entry) => entry.candidate));

  const lines: MarketAccessLineRecord[] = [];
  const requirements: MarketAccessRequirementRecord[] = [];
  for (const entry of built) {
    const item = entry.candidate.national_tariff_code;
    if (entry.generalRow) {
      const program = resolveKoreaRateProgram(GENERAL_RATE_CODE);
      lines.push({
        national_tariff_code: item,
        description: entry.candidate.description,
        declarable: true,
        measure_kind: 'third_country_duty',
        origin_geographic_area_id: GENERAL_RATE_CODE,
        origin_scope: 'erga_omnes',
        applies_to_origin_country: null,
        duty: entry.candidate.general_duty,
        conditions: conditionsFor(entry.generalRow, program.resolved ? program.program : null),
        effective_from: entry.candidate.effective_from ?? null,
        effective_to: entry.candidate.effective_to ?? null,
        source_reference: `KCS 품목번호별 관세율표 ${bundle.release_identifier} · ${item} (${GENERAL_RATE_CODE})`,
        raw_measure: { item, rate_type_code: GENERAL_RATE_CODE, row: entry.generalRow },
      });
    }

    for (const row of bundle.item_rates.get(item) ?? []) {
      if (row.rate_type_code === GENERAL_RATE_CODE || !isEffective(row, at)) continue;
      const resolution2 = resolveKoreaRateProgram(row.rate_type_code);
      const program = resolution2.resolved ? resolution2.program : null;
      const isIndiaLine = origin === 'IN' && (INDIA_FTA_RATE_CODES as readonly string[]).includes(row.rate_type_code);
      lines.push({
        national_tariff_code: item,
        description: entry.candidate.description,
        declarable: true,
        measure_kind: measureKindFor(row.rate_type_code, program),
        origin_geographic_area_id: row.rate_type_code,
        origin_scope: 'programme',
        // Only asserted where the registry itself confirms the code names India, and only when the
        // request's own origin is India — never inferred from the code string alone.
        applies_to_origin_country: isIndiaLine ? 'IN' : null,
        duty: parseKoreaDuty(item, row),
        conditions: conditionsFor(row, program),
        effective_from: parseYyyymmdd(row.effective_from),
        effective_to: parseYyyymmdd(row.effective_to),
        source_reference: `KCS 품목번호별 관세율표 ${bundle.release_identifier} · ${item} (${row.rate_type_code})`,
        raw_measure: { item, rate_type_code: row.rate_type_code, row },
      });

      // A quota/recommendation-conditional programme is a real, documented conditionality — surface
      // it as a requirement record too (rule_type 'other': this project's requirement vocabulary
      // has no dedicated quota/recommendation type), so an operator sees the gate even where the
      // tariff-line evidence alone might be read as an unconditional rate.
      if (program?.is_quota || program?.recommendation_required) {
        requirements.push({
          rule_type: MarketAccessRuleType.material_non_tariff_requirement,
          requirement_code: row.rate_type_code,
          requirement_description: `${program.kcs_label_ko} — ${program.program_class === 'quota' || program.program_class === 'agricultural_concession' ? 'quota-tariff rate' : 'conditional rate'}${program.recommendation_required ? ', requires an import recommendation (추천) from the responsible authority' : ''}. Not an unconditional rate.`,
          requirement_obtainable: null,
          national_tariff_code: item,
          effective_from: parseYyyymmdd(row.effective_from),
          effective_to: parseYyyymmdd(row.effective_to),
          source_reference: `KCS 품목번호별 관세율표 ${bundle.release_identifier} · ${item} (${row.rate_type_code})`,
          raw: { rate_type_code: row.rate_type_code, program },
        });
      }
    }
  }

  const resolvedEntry = resolution.resolved_line
    ? built.find((entry) => entry.candidate.national_tariff_code === resolution.resolved_line!.national_tariff_code)
    : null;

  // India-India CEPA: FIN1-4 are CONFIRMED (korea-rate-programs.ts, sourced from CLIP) to be the
  // Korea-India FTA/CEPA rate. A published FIN-row is therefore a direct India measure — but
  // determineIndiaPreference's own rule still caps this at
  // potentially_applicable_requires_origin_proof, never confirmed_applicable: a schedule entry is
  // not proof that a given shipment actually qualifies under the agreement's rules of origin.
  const indiaPreference = origin !== 'IN'
    ? {
      applicability: 'not_applicable' as const,
      duty: null,
      geographic_area_id: null,
      basis: `The requested origin is ${origin}, not India — the Korea-India FTA/CEPA rate (FIN1-4) applies only to India-origin goods, so it is not a candidate treatment for this request regardless of what the schedule publishes.`,
    }
    : resolvedEntry
      ? determineIndiaPreference({
        direct_india_measures: resolvedEntry.indiaRows.map(({ row }) => ({
          geographic_area_id: row.rate_type_code,
          duty: parseKoreaDuty(resolvedEntry.candidate.national_tariff_code, row),
          is_quota: false,
        })),
        proven_group_measures: [],
        beneficiary_enumeration_is_complete: false,
        unresolved_program_symbols: [],
      })
      : {
        applicability: 'unknown' as const,
        duty: null,
        geographic_area_id: null,
        basis: 'No single Korean tariff item resolved for this HS6, so no line-specific India treatment can be stated.',
      };

  const parserVersion = args.parser_version ?? KOREA_PARSER_VERSION;
  return {
    jurisdiction: 'KR',
    country_code: 'KR',
    hs6,
    hs_revision: `HS / Korean tariff schedule — KCS ${bundle.release_identifier}`,
    provider: KOREA_PROVIDER,
    source_authority: KOREA_SOURCE_AUTHORITY,
    source_dataset: KOREA_SOURCE_DATASET,
    source_dataset_version: bundle.release_identifier,
    source_reference: `https://www.data.go.kr/data/15051179/fileData.do (workbook sheet ${bundle.canonical_sheet}, sha256 ${bundle.checksum})`,
    national_code_system: 'KR_TARIFF_ITEM',
    parser_version: parserVersion,
    source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution,
    general_duty: resolution.resolved_line ? resolution.resolved_line.general_duty : null,
    india_preference: indiaPreference,
    lines,
    requirements,
    // This dataset carries duty-rate rows (including quota-tariff and special-safeguard RATES).
    // KCS publishes import bans/permits as a wholly separate resource this release does not carry,
    // so nothing here proves complete regulatory coverage — the quota/recommendation requirement
    // records above are a byproduct of the tariff rows themselves, not a claim of full coverage.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: bundle.release_identifier,
      bundle_checksum: bundle.checksum,
      reader_version: bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      candidate_items: built.map((entry) => entry.candidate.national_tariff_code),
      india_fta_rate_codes: [...INDIA_FTA_RATE_CODES],
      distinct_rate_type_codes_in_release: [...bundle.distinct_rate_type_codes].sort(),
      canonical_sheet: bundle.canonical_sheet,
      canonical_sheet_row_count: bundle.canonical_sheet_row_count,
      // The 1.1-vs-2.12 superset/correction cross-check runs once at import time (see
      // korea-bundle.ts's verifyKoreaSnapshotSuperset and its own module doc for why), and its
      // result is recorded on the AuthorityRelease's own `validation` field rather than here —
      // this per-query evidence snapshot does not re-decode the earlier sheet.
    },
  };
}
