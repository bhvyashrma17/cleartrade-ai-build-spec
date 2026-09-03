/**
 * Korea Customs Service tariff rows → canonical Market Access evidence.
 *
 * ## What is confirmed vs. retained-but-unresolved
 *
 * The dataset's own data.go.kr catalogue description confirms exactly two 관세율구분 (rate-type)
 * code meanings: `A` = 기본세율 (basic/statutory rate) and `C` = WTO 협정에 의한 양허관세 (WTO-
 * agreement-bound concession tariff). Everything else — every `F`-prefixed FTA/EPA code (including
 * `FIN1`, `FCEPA1` and `FID1`, all plausible-but-unconfirmed candidates for India-related
 * treatment), `R`, `U`, `E1`-`E3`, `T2` (observed on rice, Korea's well-known WTO-tariffication
 * line) and `P1` — is retained verbatim with its raw code, and its country/agreement identity is
 * never inferred from the letters. The dataset's own cited authority for the full code legend
 * (UNIPASS, `unipass.customs.go.kr/csp/index.do?tgMenuId=MYC_MNU_00000337`) is a JS-rendered page
 * this project's tooling cannot read, and no other primary KCS source resolved it either — see
 * docs/customs-atlas for the research trail. `A` is used as the general/third-country duty because
 * it is the one code confirmed to mean a general statutory rate; `C` and every other code are
 * carried as `tariff_preference`/`other` lines with their raw code as the area identifier, not
 * folded into the general duty.
 */
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { KoreaAuthorityBundle, KoreaRateRow } from './korea-bundle';

export const KOREA_PARSER_VERSION = 'kcs-tariff-parser-v1' as const;
export const KOREA_PROVIDER = 'kr_kcs_customs_tariff' as const;
export const KOREA_SOURCE_AUTHORITY = 'Korea Customs Service (관세청)' as const;
export const KOREA_SOURCE_DATASET = '관세청_품목번호별 관세율표 (data.go.kr dataset 15051179)' as const;

/** Confirmed from the dataset's own catalogue description: 기본세율, the general statutory rate. */
const GENERAL_RATE_TYPE = 'A';
/** Confirmed from the dataset's own catalogue description: WTO 협정에 의한 양허관세. Not folded
 *  into the general duty — the legal relationship between A and C (e.g. whichever binds lower) is
 *  not documented in this dataset and is not assumed here. */
const WTO_BOUND_RATE_TYPE = 'C';
/**
 * Plausible India-related candidates by naming pattern only — `FIN1`/`FID1` match the F+ISO2+1
 * convention every other confirmed bilateral FTA code follows (FUS1=US, FCA1=Canada, FVN1=Vietnam,
 * etc.), and `FCEPA1` matches the agreement TYPE Korea uses for both its India and Indonesia
 * economic-partnership agreements. None is confirmed, and a low-confidence secondary claim found
 * during research (asserting FCEPA1 = Panama, a partner with no CEPA-branded agreement with Korea)
 * was explicitly discounted rather than trusted. All three are passed to the shared India-
 * preference logic as UNRESOLVED symbols, never as a direct India measure.
 */
const INDIA_CANDIDATE_CODES = ['FIN1', 'FCEPA1', 'FID1'] as const;

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
 * `관세율` (rate_value) is treated as an ad-valorem percentage when it is the only populated
 * numeric field — the dataset names it "관세율" (tariff RATE) in contrast to "단위당세액" (per-
 * UNIT tax AMOUNT), and the one reference-price row observed for rice (T2, item 1006100000,
 * rate_value 513) matches Korea's independently well-known WTO-tariffication rice rate of 513% ad
 * valorem, which corroborates the reading rather than assumes it. When `단위당세액` is ALSO
 * populated, the row publishes more than a single scalar and is retained as `compound` with both
 * components verbatim — this dataset does not publish the currency or unit for 단위당세액, and
 * that is stated in the note rather than guessed.
 */
export function parseKoreaDuty(row: KoreaRateRow): ParsedDuty {
  const parts: string[] = [];
  if (row.rate_value !== null) parts.push(`${row.rate_value}% (관세율)`);
  if (row.unit_amount !== null) parts.push(`${row.unit_amount} (단위당세액, currency/unit not published)`);
  if (row.reference_price !== null) parts.push(`reference price ${row.reference_price} (기준가격, functional role not documented)`);
  const expression = parts.join(' + ') || '(no rate published)';

  if (row.rate_value === null && row.unit_amount === null) {
    return EMPTY('none', expression, 'This row publishes neither a 관세율 nor a 단위당세액 value.');
  }

  if (row.unit_amount !== null) {
    return EMPTY(
      'compound',
      expression,
      'Both 관세율 and 단위당세액 are published for this row. The dataset does not document the currency, unit, or combination rule (e.g. sum, or greater-of) for 단위당세액, so both components are retained verbatim rather than combined into a single figure.',
    );
  }

  // rate_value populated, unit_amount not: treated as a plain ad-valorem percentage (see function
  // doc). reference_price, if also present, is retained in the note but never treated as a duty.
  const note = row.reference_price !== null
    ? 'A reference price (기준가격) also accompanies this rate; its functional role (e.g. a TRQ-tier reference) is not documented in this dataset and is not used in computing the rate above.'
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
    indiaCandidateRows: Array<{ code: string; row: KoreaRateRow }>;
  }> = [];

  for (const item of items) {
    const rows = bundle.item_rates.get(item)!;
    const generalRows = effectiveRowsFor(bundle, item, GENERAL_RATE_TYPE, at);
    // More than one currently-effective `A` row for the same item would itself be an authority
    // ambiguity this reader has not observed; taking the first keeps behaviour defined rather than
    // silently picking the last, and is a real gap to revisit if it is ever actually seen.
    const generalRow = generalRows[0] ?? null;

    const indiaCandidateRows: Array<{ code: string; row: KoreaRateRow }> = [];
    for (const code of INDIA_CANDIDATE_CODES) {
      const effective = effectiveRowsFor(bundle, item, code, at);
      if (effective.length) indiaCandidateRows.push({ code, row: effective[0]! });
    }

    // Every OTHER currently-effective code beyond the general rate is this item's preferential/
    // programme coverage, recorded as raw authority codes — never as a claim about which country
    // or agreement each one names.
    const preferenceAreas = [...new Set(
      rows.filter((row) => row.rate_type_code !== GENERAL_RATE_TYPE && isEffective(row, at)).map((row) => row.rate_type_code),
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
          ? parseKoreaDuty(generalRow)
          : EMPTY('none', '', `KCS publishes no currently-effective ${GENERAL_RATE_TYPE} (기본세율) row for this item at the assessment date.`),
        control_codes: [],
        preference_area_ids: preferenceAreas,
      },
      generalRow,
      indiaCandidateRows,
    });
  }

  const resolution = resolveNationalTariffLine(built.map((entry) => entry.candidate));

  const lines: MarketAccessLineRecord[] = [];
  for (const entry of built) {
    const item = entry.candidate.national_tariff_code;
    if (entry.generalRow) {
      lines.push({
        national_tariff_code: item,
        description: entry.candidate.description,
        declarable: true,
        measure_kind: 'third_country_duty',
        origin_geographic_area_id: GENERAL_RATE_TYPE,
        origin_scope: 'erga_omnes',
        applies_to_origin_country: null,
        duty: entry.candidate.general_duty,
        conditions: { rate_type_code: GENERAL_RATE_TYPE, country_scope: entry.generalRow.country_scope, purpose_code: entry.generalRow.purpose_code },
        effective_from: entry.candidate.effective_from ?? null,
        effective_to: entry.candidate.effective_to ?? null,
        source_reference: `KCS 품목번호별 관세율표 ${bundle.release_identifier} · ${item} (${GENERAL_RATE_TYPE})`,
        raw_measure: { item, rate_type_code: GENERAL_RATE_TYPE, row: entry.generalRow },
      });
    }

    for (const row of bundle.item_rates.get(item) ?? []) {
      if (row.rate_type_code === GENERAL_RATE_TYPE || !isEffective(row, at)) continue;
      lines.push({
        national_tariff_code: item,
        description: entry.candidate.description,
        declarable: true,
        measure_kind: row.rate_type_code === WTO_BOUND_RATE_TYPE ? 'other' : 'tariff_preference',
        origin_geographic_area_id: row.rate_type_code,
        origin_scope: 'programme',
        // Never asserted for any code, confirmed or not: no code in this dataset has a confirmed
        // country/origin mapping, so this stays null rather than guessed from the code string.
        applies_to_origin_country: null,
        duty: parseKoreaDuty(row),
        conditions: { rate_type_code: row.rate_type_code, country_scope: row.country_scope, purpose_code: row.purpose_code, code_meaning_confirmed: row.rate_type_code === WTO_BOUND_RATE_TYPE },
        effective_from: parseYyyymmdd(row.effective_from),
        effective_to: parseYyyymmdd(row.effective_to),
        source_reference: `KCS 품목번호별 관세율표 ${bundle.release_identifier} · ${item} (${row.rate_type_code})`,
        raw_measure: { item, rate_type_code: row.rate_type_code, row },
      });
    }
  }

  const resolvedEntry = resolution.resolved_line
    ? built.find((entry) => entry.candidate.national_tariff_code === resolution.resolved_line!.national_tariff_code)
    : null;

  const indiaPreference = resolvedEntry
    ? determineIndiaPreference({
      direct_india_measures: [],
      proven_group_measures: [],
      beneficiary_enumeration_is_complete: false,
      unresolved_program_symbols: resolvedEntry.indiaCandidateRows.map((c) => c.code),
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
    requirements: [],
    // This dataset carries only duty-rate rows. KCS publishes import bans/permits/quotas as
    // separate resources this release does not carry, so nothing here proves regulatory coverage.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: bundle.release_identifier,
      bundle_checksum: bundle.checksum,
      reader_version: bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      candidate_items: built.map((entry) => entry.candidate.national_tariff_code),
      india_candidate_codes_considered: [...INDIA_CANDIDATE_CODES],
      distinct_rate_type_codes_in_release: [...bundle.distinct_rate_type_codes].sort(),
      canonical_sheet: bundle.canonical_sheet,
      canonical_sheet_row_count: bundle.canonical_sheet_row_count,
      cross_check_sheet: bundle.cross_check_sheet,
      cross_check_sheet_row_count: bundle.cross_check_sheet_row_count,
    },
  };
}
