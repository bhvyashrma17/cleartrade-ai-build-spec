import { createHash } from 'node:crypto';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';

export const TAIWAN_BUNDLE_READER_VERSION = 'tw-customs-csv-reader-v1' as const;
export const TAIWAN_PARSER_VERSION = 'tw-customs-tariff-parser-v1' as const;
export const TAIWAN_PROVIDER = 'tw_customs_import_duty' as const;
export const TAIWAN_SOURCE_AUTHORITY = 'Customs Administration, Ministry of Finance (Taiwan)' as const;
export const TAIWAN_SOURCE_DATASET = 'Customs Import Duty Information (dataset 80871)' as const;

const REQUIRED_HEADERS = [
  '貨品分類號列', '中文貨名', '英文貨名', '第一欄稅率', '第二欄稅率', '第三欄稅率',
  '統計數量單位', '統計重量單位', '稽徵規定', '輸入規定', '輸出規定',
] as const;

export class TaiwanBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TaiwanBundleError';
  }
}

export interface TaiwanRateRow {
  commodity_code: string;
  description_zh: string;
  description_en: string;
  column_i_duty: string;
  column_ii_duty: string;
  column_iii_duty: string;
  quantity_unit: string;
  weight_unit: string;
  levy_rules: string;
  import_rules: string;
  export_rules: string;
}

export interface TaiwanAuthorityCsvBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  source_url: string;
  rows: TaiwanRateRow[];
  beneficiary_tokens: string[];
  reader_version: typeof TAIWAN_BUNDLE_READER_VERSION;
}

/** RFC 4180 reader: quoted commas, escaped quotes, and quoted newlines are all data. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      row.push(value); value = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(value); value = '';
      if (row.some((field) => field.length)) rows.push(row);
      row = [];
    } else value += ch;
  }
  if (quoted) throw new TaiwanBundleError('invalid_csv', 'The Taiwan CSV ends inside a quoted field.');
  if (value.length || row.length) { row.push(value); rows.push(row); }
  return rows;
}

export function readTaiwanAuthorityCsv(args: { bytes: Buffer; release_identifier: string; source_url: string }): TaiwanAuthorityCsvBundle {
  const matrix = parseCsv(args.bytes.toString('utf8'));
  if (matrix.length < 2) throw new TaiwanBundleError('empty_csv', 'The Taiwan release contains no tariff rows.');
  const header = matrix[0]!.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, '') : value).trim());
  if (header.length !== REQUIRED_HEADERS.length || REQUIRED_HEADERS.some((label, index) => header[index] !== label)) {
    throw new TaiwanBundleError('unexpected_header', `The Taiwan CSV header is not the documented 11-column dataset 80871 schema: ${header.join(' | ')}`);
  }
  const rows: TaiwanRateRow[] = [];
  const beneficiaryTokens = new Set<string>();
  for (const fields of matrix.slice(1)) {
    if (fields.length !== REQUIRED_HEADERS.length) throw new TaiwanBundleError('unexpected_column_count', `A Taiwan tariff row has ${fields.length} columns; expected 11.`);
    const values = fields.map((value) => value.trim());
    const code = values[0]!;
    if (!/^\d{11}$/.test(code)) throw new TaiwanBundleError('invalid_tariff_code', `Taiwan commodity code "${code}" is not the published 11-digit code including check digit.`);
    for (const match of values[4]!.matchAll(/\(([^)]+)\)/g)) {
      for (const token of match[1]!.split(',').map((value) => value.trim()).filter(Boolean)) beneficiaryTokens.add(token);
    }
    rows.push({
      commodity_code: code, description_zh: values[1]!, description_en: values[2]!,
      column_i_duty: values[3]!, column_ii_duty: values[4]!, column_iii_duty: values[5]!,
      quantity_unit: values[6]!, weight_unit: values[7]!, levy_rules: values[8]!,
      import_rules: values[9]!, export_rules: values[10]!,
    });
  }
  const checksum = createHash('sha256').update(args.bytes).digest('hex');
  return {
    checksum, size_bytes: args.bytes.length,
    files: [{ name: `taiwan-customs-${args.release_identifier}.csv`, sha256: checksum, size_bytes: args.bytes.length, role: 'official_import_duty_schedule' }],
    release_identifier: args.release_identifier, source_url: args.source_url, rows,
    beneficiary_tokens: [...beneficiaryTokens].sort(), reader_version: TAIWAN_BUNDLE_READER_VERSION,
  };
}

const empty = (kind: ParsedDuty['kind'], expression: string, note: string | null): ParsedDuty => ({
  kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
  specific_unit: null, specific_unit_quantity: null, expression, note,
});

/** Taiwan-specific expressions retain NT$, unit and alternative operators verbatim. */
export function parseTaiwanDuty(raw: string | null | undefined): ParsedDuty {
  const expression = (raw ?? '').trim();
  if (!expression) return empty('none', expression, 'The source published no duty expression.');
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(expression);
  if (percent) return { ...empty('ad_valorem', expression, null), ad_valorem_rate_percent: Number(percent[1]) };
  const specific = /^NT\$\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?\s*)?([A-Z][A-Z0-9]*)$/i.exec(expression);
  if (specific) return {
    ...empty('specific', expression, null), specific_amount: Number(specific[1]), specific_currency: 'TWD',
    specific_unit_quantity: specific[2] ? Number(specific[2].trim()) : 1, specific_unit: specific[3]!.toUpperCase(),
  };
  if (/\bwhichever is (?:higher|lower)\b/i.test(expression)) {
    return empty('mixed', expression, 'Alternative duty: the authority requires the stated higher/lower operator; no ad-valorem equivalent is calculated.');
  }
  if (/\band\b/i.test(expression) && /%/.test(expression) && /NT\$/i.test(expression)) {
    return empty('compound', expression, 'Compound duty: the published ad-valorem and specific components are retained without conversion.');
  }
  return empty('unparsed', expression, 'Duty expression is not in a recognised Taiwan Customs form and is retained verbatim.');
}

function preferencePrograms(value: string): string[] {
  return [...value.matchAll(/\(([^)]+)\)/g)].flatMap((match) => match[1]!.split(',')).map((v) => v.trim()).filter(Boolean);
}

function preferenceMeasures(value: string) {
  return [...value.matchAll(/(NT\$\s*\d+(?:\.\d+)?\s*\/\s*(?:\d+(?:\.\d+)?\s*)?[A-Z][A-Z0-9]*|\d+(?:\.\d+)?\s*%)\s*\(([^)]+)\)/gi)]
    .map((match) => ({ expression: match[1]!.trim(), duty: parseTaiwanDuty(match[1]), tokens: match[2]!.split(',').map((value) => value.trim()).filter(Boolean) }));
}

export function buildTaiwanMarketAccess(args: {
  bundle: TaiwanAuthorityCsvBundle; release_id: string; release_reference_date: Date;
  retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string;
}): MarketAccessIngestResult {
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const rows = args.bundle.rows.filter((row) => row.commodity_code.startsWith(args.hs6));
  const candidates: CandidateTariffLine[] = rows.map((row) => ({
    national_tariff_code: row.commodity_code,
    description: row.description_en || row.description_zh,
    declarable: true,
    effective_from: args.release_reference_date,
    effective_to: null,
    general_duty: parseTaiwanDuty(row.column_i_duty),
    control_codes: [
      ...(row.levy_rules ? [`LEVY:${row.levy_rules}`] : []),
      ...(row.import_rules ? [`IMPORT:${row.import_rules}`] : []),
      ...(row.export_rules ? [`EXPORT:${row.export_rules}`] : []),
    ],
    preference_area_ids: preferencePrograms(row.column_ii_duty),
  }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  for (const row of rows) {
    const common = {
      national_tariff_code: row.commodity_code, description: row.description_en || row.description_zh, declarable: true,
      effective_from: args.release_reference_date, effective_to: null,
      source_reference: `${args.bundle.source_url} · code ${row.commodity_code}`,
    };
    lines.push({
      ...common, measure_kind: 'third_country_duty', origin_geographic_area_id: 'COLUMN_I', origin_scope: 'erga_omnes',
      applies_to_origin_country: origin, duty: parseTaiwanDuty(row.column_i_duty),
      conditions: { column_ii_verbatim: row.column_ii_duty, column_iii_verbatim: row.column_iii_duty, statistical_quantity_unit: row.quantity_unit || null, statistical_weight_unit: row.weight_unit || null, levy_rules: row.levy_rules || null, import_rules: row.import_rules || null, export_rules: row.export_rules || null },
      raw_measure: row,
    });
    for (const measure of preferenceMeasures(row.column_ii_duty)) {
      for (const token of measure.tokens) {
        lines.push({
          ...common, measure_kind: 'tariff_preference', origin_geographic_area_id: token,
          origin_scope: token === 'LDCs' ? 'group' : 'country', applies_to_origin_country: token === origin ? origin : null,
          duty: measure.duty,
          conditions: { Taiwan_column: 'II', beneficiary_token: token, beneficiary_eligibility_required: true, full_column_expression: row.column_ii_duty },
          raw_measure: { expression: measure.expression, beneficiary_token: token, full_column_expression: row.column_ii_duty },
        });
      }
    }
  }
  const resolvedRow = resolution.resolved_line ? rows.find((row) => row.commodity_code === resolution.resolved_line!.national_tariff_code) : undefined;
  const resolvedIndia = resolvedRow ? preferenceMeasures(resolvedRow.column_ii_duty).find((measure) => measure.tokens.includes('IN')) : undefined;
  const indiaPreference = origin !== 'IN'
    ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India.` }
    : resolution.resolved_line == null
      ? { applicability: 'unknown' as const, duty: null, geographic_area_id: null, basis: 'No single Taiwan tariff line was resolved, so preference applicability cannot be stated for an exact line.' }
      : determineIndiaPreference({
        direct_india_measures: resolvedIndia ? [{ geographic_area_id: 'IN', duty: resolvedIndia.duty, is_quota: false }] : [],
        proven_group_measures: [], beneficiary_enumeration_is_complete: true, unresolved_program_symbols: [],
      });
  const parserVersion = args.parser_version ?? TAIWAN_PARSER_VERSION;
  return {
    jurisdiction: 'TW', country_code: 'TW', hs6: args.hs6,
    hs_revision: `Taiwan Customs 11-digit commodity classification · release ${args.bundle.release_identifier}`,
    provider: TAIWAN_PROVIDER, source_authority: TAIWAN_SOURCE_AUTHORITY, source_dataset: TAIWAN_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (sha256 ${args.bundle.checksum}; attribution: ${TAIWAN_SOURCE_AUTHORITY}, ${args.release_reference_date.getUTCFullYear()}, ${TAIWAN_SOURCE_DATASET})`,
    national_code_system: 'TW_CUSTOMS_TARIFF', parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: resolution.resolved_line?.general_duty ?? null, india_preference: indiaPreference, lines, requirements: [],
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, release_identifier: args.bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(), bundle_sha256: args.bundle.checksum,
      reader_version: args.bundle.reader_version, parser_version: parserVersion, origin_country: origin,
      beneficiary_tokens: args.bundle.beneficiary_tokens, candidate_rows: rows,
    },
  };
}
