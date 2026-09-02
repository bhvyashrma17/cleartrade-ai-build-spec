import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  parseDutyExpression,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { CanadaAuthorityBundle, CanadaTariffRow } from './canada-bundle';

export const CANADA_PARSER_VERSION = 'cbsa-customs-tariff-parser-v1' as const;
export const CANADA_PROVIDER = 'canada_cbsa_customs_tariff' as const;
export const CANADA_SOURCE_AUTHORITY = 'Canada Border Services Agency (CBSA)' as const;
export const CANADA_SOURCE_DATASET = 'CBSA Customs Tariff complete — Microsoft Access distribution' as const;

const PREFERENCE_COLUMNS = [
  'AUT', 'NZT', 'CCCT', 'LDCT', 'GPT', 'UST', 'MXT', 'CIAT', 'CT', 'CRT', 'IT', 'NT', 'SLT',
  'PT', 'COLT', 'JT', 'PAT', 'HNT', 'KRT', 'CEUT', 'CPTPT', 'UKT', 'UAT', 'CPUKT',
] as const;

function text(value: unknown) {
  return String(value ?? '').replace(/[\u000b\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function digits(value: unknown) {
  return text(value).replace(/\D/g, '');
}

function date(value: unknown): Date | null {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return null;
  return value;
}

/** CBSA-specific currency normalization while retaining the authority's exact expression. */
export function parseCanadaDuty(value: unknown): ParsedDuty {
  const expression = text(value);
  if (!expression) return parseDutyExpression(null);
  if (/^free$/i.test(expression)) {
    return {
      kind: 'ad_valorem', ad_valorem_rate_percent: 0,
      specific_amount: null, specific_currency: null, specific_unit: null,
      specific_unit_quantity: null, expression, note: null,
    };
  }

  // Only normalize a PURE specific duty. Threshold/plus/formula expressions stay verbatim and
  // are classified mixed/compound/unparsed by the shared parser.
  const cents = /^(\d+(?:[.,]\d+)?)\s*¢\s*\/?\s*([A-Za-z][A-Za-z0-9²³ ]*)$/i.exec(expression);
  if (cents) {
    const parsed = parseDutyExpression(`${Number(cents[1]!.replace(',', '.')) / 100} CAD / 1 ${cents[2]!.trim()}`);
    return { ...parsed, expression };
  }
  const dollars = /^\$\s*(\d+(?:[.,]\d+)?)\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*)?([A-Za-z][A-Za-z0-9²³ ]*)$/i.exec(expression);
  if (dollars) {
    const parsed = parseDutyExpression(`${dollars[1]} CAD / ${dollars[2] ?? 1} ${dollars[3]!.trim()}`);
    return { ...parsed, expression };
  }
  if (/\bplus\b/i.test(expression) && /%/.test(expression)) {
    const parsed = parseDutyExpression(expression.replace(/\bplus\b/i, '+'));
    return { ...parsed, expression };
  }
  return parseDutyExpression(expression);
}

function preferenceRates(row: CanadaTariffRow) {
  return PREFERENCE_COLUMNS.flatMap((programme) => {
    const expression = text(row[programme]);
    return expression ? [{ programme, expression, duty: parseCanadaDuty(expression) }] : [];
  });
}

function description(row: CanadaTariffRow) {
  return [row.DESC1, row.DESC2, row.DESC3].map(text).filter(Boolean).join(' ');
}

function quotaCondition(row: CanadaTariffRow) {
  const value = description(row);
  if (/within access commitment/i.test(value)) return 'WITHIN_ACCESS_COMMITMENT';
  if (/over access commitment/i.test(value)) return 'OVER_ACCESS_COMMITMENT';
  return null;
}

function effectiveRows(rows: readonly CanadaTariffRow[], at: Date) {
  return rows.filter((row) => {
    const from = date(row.EFF_DATE);
    return from == null || from.getTime() <= at.getTime();
  });
}

function buildCandidates(rows: readonly CanadaTariffRow[], hs6: string, at: Date) {
  const relevant = effectiveRows(rows, at).filter((row) => digits(row.TARIFF).startsWith(hs6));
  const tariffItems = relevant.filter((row) => digits(row.TARIFF).length === 8 && text(row.MFN));
  const candidates: Array<{ candidate: CandidateTariffLine; tariff_item: CanadaTariffRow; statistical_row: CanadaTariffRow }> = [];

  for (const tariffItem of tariffItems) {
    const itemCode = digits(tariffItem.TARIFF);
    const statistical = relevant.filter((row) => digits(row.TARIFF).length === 10 && digits(row.TARIFF).startsWith(itemCode));
    const leaves = statistical.length ? statistical : [tariffItem];
    for (const leaf of leaves) {
      const leafCode = digits(leaf.TARIFF);
      const ancestors = relevant
        .filter((row) => {
          const code = digits(row.TARIFF);
          return code.length > 8 && code.length < leafCode.length && leafCode.startsWith(code);
        })
        .map(description)
        .filter(Boolean);
      const quota = quotaCondition(tariffItem);
      const controls = [
        text(tariffItem.FOOTNOTE),
        text(leaf.FOOTNOTE),
        quota ? `TARIFF_QUOTA:${quota}` : '',
      ].filter(Boolean);
      candidates.push({
        tariff_item: tariffItem,
        statistical_row: leaf,
        candidate: {
          national_tariff_code: leafCode,
          description: description(leaf) || description(tariffItem),
          description_path: [description(tariffItem), ...ancestors].filter(Boolean),
          declarable: true,
          general_duty: parseCanadaDuty(tariffItem.MFN),
          control_codes: [...new Set(controls)],
          preference_area_ids: preferenceRates(tariffItem).map((rate) => rate.programme),
          effective_from: date(tariffItem.EFF_DATE),
          effective_to: null,
        },
      });
    }
  }
  return candidates;
}

export function buildCanadaMarketAccess(args: {
  bundle: CanadaAuthorityBundle;
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
  const built = buildCandidates(args.bundle.rows, hs6, args.at);
  const resolution = resolveNationalTariffLine(built.map((entry) => entry.candidate));
  const lines: MarketAccessLineRecord[] = [];

  for (const entry of built) {
    const code = entry.candidate.national_tariff_code;
    const tariffItemCode = digits(entry.tariff_item.TARIFF);
    const quota = quotaCondition(entry.tariff_item);
    const common = {
      national_tariff_code: code,
      description: entry.candidate.description,
      declarable: true,
      effective_from: entry.candidate.effective_from ?? null,
      effective_to: null,
      source_reference: `CBSA ${args.bundle.release_identifier} · tariff item ${tariffItemCode} · statistical line ${code}`,
    };
    lines.push({
      ...common,
      measure_kind: quota === 'WITHIN_ACCESS_COMMITMENT' ? 'tariff_quota' : 'third_country_duty',
      origin_geographic_area_id: 'MFN',
      origin_scope: 'programme',
      applies_to_origin_country: origin,
      duty: entry.candidate.general_duty,
      conditions: {
        tariff_item_code: tariffItemCode,
        inherited_by_statistical_line: code !== tariffItemCode,
        unit_of_measure: text(entry.statistical_row.UOM) || null,
        footnotes: entry.candidate.control_codes,
        quota_condition: quota,
        unconditional_rate: quota !== 'WITHIN_ACCESS_COMMITMENT',
      },
      raw_measure: {
        tariff_item: text(entry.tariff_item.TARIFF),
        statistical_line: text(entry.statistical_row.TARIFF),
        mfn: text(entry.tariff_item.MFN),
        effective_date: date(entry.tariff_item.EFF_DATE)?.toISOString() ?? null,
      },
    });
    for (const rate of preferenceRates(entry.tariff_item)) {
      lines.push({
        ...common,
        measure_kind: 'tariff_preference',
        origin_geographic_area_id: rate.programme,
        origin_scope: 'programme',
        applies_to_origin_country: null,
        duty: rate.duty,
        conditions: {
          programme: rate.programme,
          beneficiary_eligibility_required: true,
          not_asserted_for_india: true,
        },
        raw_measure: { programme: rate.programme, expression: rate.expression, tariff_item: text(entry.tariff_item.TARIFF) },
      });
    }
  }

  let indiaPreference = determineIndiaPreference({
    direct_india_measures: [],
    proven_group_measures: [],
    beneficiary_enumeration_is_complete: true,
    unresolved_program_symbols: [],
  });
  const treatment = args.bundle.india_treatment;
  if (!treatment.mfn || treatment.gpt || treatment.ldct || treatment.other_treatments.length) {
    // A future CBSA release may change India's treatment. Until a named scheme is safely joined
    // to the per-line column, do not guess which published rate applies.
    indiaPreference = {
      applicability: 'unknown',
      duty: null,
      geographic_area_id: null,
      basis: `CBSA's country table changed India's treatment (${treatment.source_row_text}); the release does not yet establish a safely joined India preference.`,
    };
  } else {
    indiaPreference = {
      ...indiaPreference,
      basis: `CBSA's complete List of Countries and Applicable Tariff Treatments records India as MFN=yes, GPT=no, LDCT=no, with no other tariff treatment. Preferential columns offered to other origins are therefore not India rates.`,
    };
  }

  const parserVersion = args.parser_version ?? CANADA_PARSER_VERSION;
  return {
    jurisdiction: 'CA',
    country_code: 'CA',
    hs6,
    hs_revision: `HS2022 / Canadian Customs Tariff ${args.bundle.release_identifier}`,
    provider: CANADA_PROVIDER,
    source_authority: CANADA_SOURCE_AUTHORITY,
    source_dataset: CANADA_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.tariff_url} + ${args.bundle.country_treatments_url} (authority bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'CA_CUSTOMS_TARIFF',
    parser_version: parserVersion,
    source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution,
    general_duty: resolution.resolved_line
      && !resolution.resolved_line.control_codes.includes('TARIFF_QUOTA:WITHIN_ACCESS_COMMITMENT')
      ? resolution.resolved_line.general_duty
      : null,
    india_preference: indiaPreference,
    lines,
    requirements: [],
    // The tariff schedule is not a complete SPS/TBT/licensing corpus.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: args.bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(),
      bundle_sha256: args.bundle.checksum,
      file_manifest: args.bundle.files,
      reader_version: args.bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      india_treatment: treatment,
      candidate_source_rows: built.map((entry) => ({
        tariff_item: text(entry.tariff_item.TARIFF),
        statistical_line: text(entry.statistical_row.TARIFF),
        mfn: text(entry.tariff_item.MFN),
        preferences: Object.fromEntries(preferenceRates(entry.tariff_item).map((rate) => [rate.programme, rate.expression])),
      })),
    },
  };
}
