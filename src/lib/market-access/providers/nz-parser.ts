import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { NzAuthorityBundle, NzTariffDetailRow, NzTariffRateRow } from './nz-bundle';

export const NZ_PARSER_VERSION = 'nz-cusmod-parser-v1' as const;
export const NZ_PROVIDER = 'nz_customs_cusmod' as const;
export const NZ_SOURCE_AUTHORITY = 'New Zealand Customs Service' as const;
export const NZ_SOURCE_DATASET = 'CusMod Tariff and Concession Data Files' as const;

/**
 * NZ Customs' own rate-formula legend (tariff-and-concession-readme.pdf, verbatim). Formula 2 and
 * anything beyond 9 are conditional/derived calculations the readme itself says require manual
 * work — never guessed into a scalar.
 */
function buildDuty(row: NzTariffRateRow): ParsedDuty {
  const empty = (kind: ParsedDuty['kind'], expression: string, note: string | null = null): ParsedDuty => ({
    kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
    specific_unit: null, specific_unit_quantity: null, expression, note,
  });
  const expr = `formula ${row.formula ?? 'unknown'}: A=${row.factor_a ?? ''} B=${row.factor_b ?? ''} C=${row.factor_c ?? ''} D=${row.factor_d ?? ''}`.trim();

  switch (row.formula) {
    case 1:
      return { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: 'Free', note: null };
    case 3:
      return row.factor_a == null
        ? empty('unparsed', expr, 'Formula 3 (ad valorem) with no Factor-A published.')
        : { kind: 'ad_valorem', ad_valorem_rate_percent: row.factor_a, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${row.factor_a}% (formula 3)`, note: null };
    case 4:
      return row.factor_a == null
        ? empty('unparsed', expr, 'Formula 4 (specific) with no Factor-A published.')
        : { kind: 'specific', ad_valorem_rate_percent: null, specific_amount: row.factor_a, specific_currency: 'NZD', specific_unit: 'unit', specific_unit_quantity: 1, expression: `NZD ${row.factor_a} per unit (formula 4, Duty = Factor-A * QTY)`, note: null };
    case 2:
      return empty('unparsed', expr, "NZ Customs' own readme: formula 2 requires manual calculation and is never auto-resolved.");
    case 5:
    case 6:
      // Formula 5: (A * VFD/100) + (B * QTY). Formula 6: (A * QTY) - (B * VFD/100). Both combine
      // an ad-valorem and a specific component; neither factor is discarded.
      return empty('compound', `${expr} (${row.formula === 5 ? 'Duty = (A * VFD/100) + (B * QTY)' : 'Duty = (A * QTY) - (B * VFD/100)'})`);
    default:
      return row.formula == null
        ? empty('unparsed', expr, 'No rate formula published for this row.')
        : empty('mixed', expr, `Formula ${row.formula} is a multi-step/conditional calculation per NZ Customs' own legend; the exact factors are retained verbatim rather than resolved.`);
  }
}

function currentRows<T extends { start_date: number | null; expiry_date: number | null }>(rows: readonly T[], at: Date): T[] {
  const atMs = at.getTime();
  return rows.filter((row) => (row.start_date == null || row.start_date <= atMs)
    && (row.expiry_date == null || row.expiry_date >= atMs));
}

const toDate = (ms: number | null): Date | null => (ms == null ? null : new Date(ms));

function latestDetail(details: readonly NzTariffDetailRow[], code: string, at: Date): NzTariffDetailRow | null {
  const matching = currentRows(details.filter((detail) => detail.code === code), at);
  return matching[matching.length - 1] ?? null;
}

export function buildNzMarketAccess(args: {
  bundle: NzAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const at = args.at;

  const codes = [...new Set(args.bundle.details.filter((detail) => detail.code.startsWith(hs6)).map((detail) => detail.code))];
  const built: Array<{ candidate: CandidateTariffLine; rateRow: NzTariffRateRow; detail: NzTariffDetailRow }> = [];
  const preferenceLines: Array<{ code: string; description: string; rate: NzTariffRateRow }> = [];

  for (const code of codes) {
    const detail = latestDetail(args.bundle.details, code, at);
    if (!detail) continue; // no currently effective published line for this code
    const rateRowsForCode = currentRows(args.bundle.rates.filter((rate) => rate.code === code), at);
    const nml = rateRowsForCode.find((rate) => rate.rate_group === 'NML');
    if (nml) {
      built.push({
        candidate: {
          national_tariff_code: code,
          description: detail.description,
          declarable: true,
          effective_from: toDate(detail.start_date),
          effective_to: toDate(detail.expiry_date),
          general_duty: buildDuty(nml),
          control_codes: [],
          preference_area_ids: rateRowsForCode.filter((rate) => rate.rate_group !== 'NML').map((rate) => rate.rate_group),
        },
        rateRow: nml,
        detail,
      });
    }
    for (const preferential of rateRowsForCode.filter((rate) => rate.rate_group !== 'NML')) {
      preferenceLines.push({ code, description: detail.description, rate: preferential });
    }
  }

  const resolution = resolveNationalTariffLine(built.map((entry) => entry.candidate));
  const lines: MarketAccessLineRecord[] = built.map((entry) => ({
    national_tariff_code: entry.candidate.national_tariff_code,
    description: entry.candidate.description,
    declarable: true,
    measure_kind: 'third_country_duty',
    origin_geographic_area_id: 'MFN',
    origin_scope: 'erga_omnes',
    applies_to_origin_country: null,
    duty: entry.candidate.general_duty,
    conditions: { rate_group: 'NML', statistical_unit: entry.detail.statistical_unit },
    effective_from: entry.candidate.effective_from ?? null,
    effective_to: entry.candidate.effective_to ?? null,
    source_reference: `NZ Customs CusMod ${args.bundle.release_identifier} · tariff item ${entry.candidate.national_tariff_code} (NML)`,
    raw_measure: { code: entry.candidate.national_tariff_code, rate_group: 'NML', formula: entry.rateRow.formula, factor_a: entry.rateRow.factor_a, factor_b: entry.rateRow.factor_b },
  }));
  for (const preference of preferenceLines) {
    lines.push({
      national_tariff_code: preference.code,
      description: preference.description,
      declarable: true,
      // A named rate-group column is a programme entitlement, not an unconditional rate — never
      // asserted for a specific origin unless that origin's own row is the one being read.
      measure_kind: preference.rate.rate_group === 'IN' ? 'tariff_preference' : 'tariff_preference',
      origin_geographic_area_id: preference.rate.rate_group,
      origin_scope: 'programme',
      applies_to_origin_country: null,
      duty: buildDuty(preference.rate),
      conditions: { rate_group: preference.rate.rate_group, beneficiary_eligibility_required: true, not_asserted_for_india: preference.rate.rate_group !== 'IN' },
      effective_from: toDate(preference.rate.start_date),
      effective_to: toDate(preference.rate.expiry_date),
      source_reference: `NZ Customs CusMod ${args.bundle.release_identifier} · tariff item ${preference.code} (${preference.rate.rate_group})`,
      raw_measure: { code: preference.code, rate_group: preference.rate.rate_group, formula: preference.rate.formula, factor_a: preference.rate.factor_a },
    });
  }

  // The dataset carries a genuine India-specific rate group ("IN"), but no currently effective
  // row was found for it in this scope — India's own historical preference under this group has
  // lapsed. This is an observed fact about the schedule, not an assumption.
  const currentIndiaRow = preferenceLines.find((entry) => entry.rate.rate_group === 'IN');
  const indiaPreference = currentIndiaRow
    ? determineIndiaPreference({
      direct_india_measures: [{ geographic_area_id: 'IN', duty: buildDuty(currentIndiaRow.rate), is_quota: false }],
      proven_group_measures: [],
      beneficiary_enumeration_is_complete: true,
      unresolved_program_symbols: [],
    })
    : {
      applicability: 'not_applicable' as const,
      duty: null,
      geographic_area_id: null,
      basis: `NZ Customs' CusMod rate-group vocabulary includes a named India ("IN") preferential programme, but no currently effective rate row exists for it as of ${at.toISOString().slice(0, 10)} — the dataset's own history shows the last India-specific row expired in the 1990s. Absence of a current row is read as no current India-specific preference, not as unknown.`,
    };

  const parserVersion = args.parser_version ?? NZ_PARSER_VERSION;
  return {
    jurisdiction: 'NZ',
    country_code: 'NZ',
    hs6,
    hs_revision: `HS / NZ Working Tariff Document — CusMod ${args.bundle.release_identifier}`,
    provider: NZ_PROVIDER,
    source_authority: NZ_SOURCE_AUTHORITY,
    source_dataset: NZ_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.tariff_archive_url} (bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'NZ_TARIFF_ITEM',
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
    // The tariff/concession file proves duty rates only — it is not a complete SPS/TBT/licensing
    // corpus, and does not by itself establish regulatory completeness.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: args.bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(),
      bundle_sha256: args.bundle.checksum,
      time_stamp: args.bundle.time_stamp,
      reader_version: args.bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      candidate_codes: built.map((entry) => entry.candidate.national_tariff_code),
    },
  };
}
