import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const SINGAPORE_BUNDLE_READER_VERSION = 'sg-sso-customs-duties-bundle-reader-v1' as const;
export const SINGAPORE_TABLE_PARSER_VERSION = 'sg-sso-first-schedule-html-table-v1' as const;
export const SINGAPORE_QUALIFICATION_MINIMUM_ROWS = 8_000;

export class SingaporeBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SingaporeBundleError';
  }
}

export interface SingaporeTariffLine {
  code: string;
  description: string;
  unit: string;
  full_customs_duty: ParsedDuty;
  preferential_customs_duty: ParsedDuty;
  excise_duty: ParsedDuty;
  /** Joint SSO + Singapore Customs conclusion, never inferred from one blank cell. */
  non_dutiable: boolean;
  source_row: readonly string[];
}

interface SingaporeManifest {
  acquisition_version?: string;
  release_identifier?: string;
  consolidated_as_at?: string;
  consolidated_effective_version?: string;
  artifacts?: Array<{ name?: string; role?: string; url?: string; size_bytes?: number; sha256?: string }>;
  amendments?: Array<{ instrument?: string; effective_from?: string; url?: string }>;
  rights?: { electronic_platform_reproduction_permitted?: boolean; automated_extraction_window_sgt?: string; required_attribution?: string };
  scope?: { tariff_treatment_complete?: boolean; regulatory_coverage_complete?: boolean };
}

export interface SingaporeAuthorityBundle {
  checksum: string;
  canonical_tariff_checksum: string;
  size_bytes: number;
  release_identifier: string;
  consolidated_as_at: string;
  consolidated_effective_version: string;
  source_url: string;
  files: readonly { name: string; role: string; url: string; size_bytes: number; sha256: string }[];
  amendments: readonly { instrument: string; effective_from: string; url: string }[];
  lines: ReadonlyMap<string, SingaporeTariffLine>;
  reader_version: typeof SINGAPORE_BUNDLE_READER_VERSION;
  table_parser_version: typeof SINGAPORE_TABLE_PARSER_VERSION;
  attribution: string;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const stableText = (value: string) => value.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').replace(/\s+/g, ' ').trim();

function decodeCell(html: string) {
  return stableText(html
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—'));
}

function tableRows(html: string) {
  const rows: string[][] = [];
  for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    for (const row of table[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((match) => decodeCell(match[1]!));
      if (cells.length) rows.push(cells);
    }
  }
  return rows;
}

function parsedDuty(expression: string, fields: Partial<ParsedDuty>): ParsedDuty {
  return {
    kind: fields.kind ?? 'unparsed', ad_valorem_rate_percent: fields.ad_valorem_rate_percent ?? null,
    specific_amount: fields.specific_amount ?? null, specific_currency: fields.specific_currency ?? null,
    specific_unit: fields.specific_unit ?? null, specific_unit_quantity: fields.specific_unit_quantity ?? null,
    expression, note: fields.note ?? null,
  };
}

const number = (value: string) => Number(value.replaceAll(',', ''));
const unitName = (value: string) => stableText(value.replace(/^of\s+/i, '').replace(/\.$/, ''));

/** Parse one published SSO duty component. Blank remains absence, never a legal zero. */
export function parseSingaporeDutyCell(raw: string, scheduleUnit: string, component: 'full_customs' | 'preferential_customs' | 'excise'): ParsedDuty {
  const value = stableText(raw).replace(/^S\s*\$/i, '$').replace(/\s+%/g, '%');
  if (!value) return parsedDuty('', { kind: 'none', note: `The ${component} cell is blank; blank alone is not a legal zero.` });
  if (/^(?:FREE|NIL|0(?:\.0+)?\s*%)$/i.test(value)) return parsedDuty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: 0, note: 'The authority expressly publishes a zero/free rate.' });

  const adValorem = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (adValorem) return parsedDuty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: number(adValorem[1]!) });

  const specific = /^\$\s*(\d[\d,]*(?:\.\d+)?)\s*(?:per|\/\s*)(?:(\d+(?:\.\d+)?)\s*)?(.+)$/i.exec(value);
  if (specific) return parsedDuty(value, {
    kind: 'specific', specific_amount: number(specific[1]!), specific_currency: 'SGD',
    specific_unit_quantity: specific[2] ? number(specific[2]) : 1,
    specific_unit: unitName(specific[3] || scheduleUnit), note: null,
  });

  const percentage = /(\d+(?:\.\d+)?)%/.exec(value);
  const money = /\$\s*(\d[\d,]*(?:\.\d+)?)\s*(?:per|\/)\s*(?:(\d+(?:\.\d+)?)\s*)?([A-Za-z][A-Za-z ]*?)(?=\s*(?:,|\bor\b|\bplus\b|\band\b|$))/i.exec(value);
  if (percentage && money && /\b(?:plus|and)\b|\+/i.test(value)) return parsedDuty(value, {
    kind: 'compound', ad_valorem_rate_percent: number(percentage[1]!), specific_amount: number(money[1]!), specific_currency: 'SGD',
    specific_unit_quantity: money[2] ? number(money[2]) : 1, specific_unit: unitName(money[3]!),
    note: 'The published ad-valorem and specific components are added; no ad-valorem equivalent is invented.',
  });
  if (percentage && money && /\b(?:or|greater|higher|maximum|max)\b/i.test(value)) return parsedDuty(value, {
    kind: 'mixed', ad_valorem_rate_percent: number(percentage[1]!), specific_amount: number(money[1]!), specific_currency: 'SGD',
    specific_unit_quantity: money[2] ? number(money[2]) : 1, specific_unit: unitName(money[3]!),
    note: 'The greater published ad-valorem or specific amount applies; no ad-valorem equivalent is invented.',
  });
  return parsedDuty(value, { kind: 'unparsed', note: 'The SSO duty expression is outside the qualified parser forms.' });
}

/** Conservative categories from Singapore Customs. A blank inside them is not accepted as zero. */
function couldBeDutiable(code: string) {
  return /^(?:220[3-8]|24|8703|8711|2710|2711|3826)/.test(code);
}

function dataCells(cells: readonly string[]) {
  const codeIndex = cells.findIndex((cell) => /^\d{4}[.\s]?\d{2}[.\s]?\d{2}$/.test(cell.replace(/\s+/g, '')));
  if (codeIndex < 0 || cells.length < codeIndex + 6) return null;
  return {
    code: cells[codeIndex]!.replace(/\D/g, ''), description: cells[codeIndex + 1] ?? '', unit: cells[codeIndex + 2] ?? '',
    full: cells[codeIndex + 3] ?? '', preferential: cells[codeIndex + 4] ?? '', excise: cells[codeIndex + 5] ?? '',
  };
}

export function parseSingaporeScheduleHtml(html: string, options: { minimum_rows?: number } = {}) {
  const plain = decodeCell(html);
  if (!/Customs\s*\(Duties\)\s*Order/i.test(plain) || !/FIRST\s+SCHEDULE/i.test(plain)) {
    throw new SingaporeBundleError('wrong_instrument', 'The retained page is not the Customs (Duties) Order First Schedule.');
  }
  if (!/H\.?\s*S\.?\s*Code/i.test(plain) || !/Preferential/i.test(plain) || !/Excise\s+Duty/i.test(plain)) {
    throw new SingaporeBundleError('unexpected_first_schedule_layout', 'The SSO First Schedule tariff headings changed or are missing.');
  }
  const lines = new Map<string, SingaporeTariffLine>();
  for (const cells of tableRows(html)) {
    const row = dataCells(cells);
    if (!row) continue;
    const full = parseSingaporeDutyCell(row.full, row.unit, 'full_customs');
    const preferential = parseSingaporeDutyCell(row.preferential, row.unit, 'preferential_customs');
    const excise = parseSingaporeDutyCell(row.excise, row.unit, 'excise');
    if ([full, preferential, excise].some((duty) => duty.kind === 'unparsed')) {
      throw new SingaporeBundleError('unparsed_duty_expression', `SSO line ${row.code} contains an unparsed duty expression.`);
    }
    const allBlank = [full, preferential, excise].every((duty) => duty.kind === 'none');
    if (allBlank && couldBeDutiable(row.code)) {
      throw new SingaporeBundleError('ambiguous_blank_dutiable_line', `SSO line ${row.code} is within a Singapore Customs dutiable category but all duty cells are blank.`);
    }
    const line: SingaporeTariffLine = {
      code: row.code, description: stableText(row.description), unit: stableText(row.unit),
      full_customs_duty: full, preferential_customs_duty: preferential, excise_duty: excise,
      non_dutiable: allBlank, source_row: [...cells],
    };
    const prior = lines.get(line.code);
    if (prior && JSON.stringify(prior) !== JSON.stringify(line)) throw new SingaporeBundleError('conflicting_duplicate_line', `SSO line ${line.code} is duplicated with different treatment.`);
    lines.set(line.code, line);
  }
  const minimum = options.minimum_rows ?? SINGAPORE_QUALIFICATION_MINIMUM_ROWS;
  if (lines.size < minimum) throw new SingaporeBundleError('incomplete_first_schedule', `The SSO First Schedule parser found ${lines.size} tariff lines; at least ${minimum} are required.`);
  return lines;
}

export function serializeSingaporeLines(lines: ReadonlyMap<string, SingaporeTariffLine>) {
  return Buffer.from(JSON.stringify({ table_parser_version: SINGAPORE_TABLE_PARSER_VERSION, lines: [...lines.values()].sort((a, b) => a.code.localeCompare(b.code)) }), 'utf8');
}

const EXPECTED_ROLES: Readonly<Record<string, string>> = Object.freeze({
  'customs-duties-order-current.html': 'official_current_consolidated_first_schedule',
  's49-2026.html': 'official_amendment_provenance',
  's67-2026.html': 'official_tariff_amendment_provenance',
  'terms-of-use.html': 'official_reuse_and_automation_terms',
  'classification.html': 'singapore_customs_8_digit_classification_evidence',
  'dutiable-goods.html': 'singapore_customs_blank_and_duty_category_evidence',
  'normalized-lines.json': 'deterministic_canonical_tariff_artifact',
});

export async function readSingaporeAuthorityBundle(args: { bytes: Buffer; release_identifier: string; minimum_rows?: number }): Promise<SingaporeAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new SingaporeBundleError('corrupt_archive', 'The Singapore authority bundle is not a readable ZIP archive.'); }
  const names = Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  const expectedNames = [...Object.keys(EXPECTED_ROLES), 'acquisition.json'].sort();
  if (names.join('|') !== expectedNames.join('|')) throw new SingaporeBundleError('unexpected_manifest', `The Singapore bundle must contain exactly ${expectedNames.join(', ')}.`);
  const read = async (name: string) => Buffer.from(await zip.file(name)!.async('nodebuffer'));
  let manifest: SingaporeManifest;
  try { manifest = JSON.parse((await read('acquisition.json')).toString('utf8')); } catch { throw new SingaporeBundleError('invalid_manifest', 'The Singapore acquisition manifest is not valid JSON.'); }
  if (manifest.acquisition_version !== 'sg-sso-customs-duties-acquisition-v1' || manifest.release_identifier !== args.release_identifier) {
    throw new SingaporeBundleError('unexpected_acquisition', 'The Singapore manifest does not identify the expected acquisition and release.');
  }
  if (manifest.consolidated_effective_version !== '2026-02-12T17:00:00+08:00'
    || manifest.amendments?.map((item) => item.instrument).join('|') !== 'S 49/2026|S 67/2026') {
    throw new SingaporeBundleError('missing_currentness_provenance', 'The current consolidated version and its 2026 amendment chain were not retained.');
  }
  if (manifest.rights?.electronic_platform_reproduction_permitted !== true
    || manifest.rights.automated_extraction_window_sgt !== '03:00-07:00'
    || !manifest.rights.required_attribution?.includes('permission of the Attorney-General')) {
    throw new SingaporeBundleError('missing_reuse_evidence', 'The SSO reuse grant, extraction window or required attribution is absent.');
  }
  if (manifest.scope?.tariff_treatment_complete !== true || manifest.scope.regulatory_coverage_complete !== false) {
    throw new SingaporeBundleError('wrong_scope', 'The Singapore bundle must separate complete tariff treatment from incomplete regulatory coverage.');
  }
  const order = (await read('customs-duties-order-current.html')).toString('utf8');
  const terms = decodeCell((await read('terms-of-use.html')).toString('utf8'));
  const classification = decodeCell((await read('classification.html')).toString('utf8'));
  const dutiable = decodeCell((await read('dutiable-goods.html')).toString('utf8'));
  const s49 = decodeCell((await read('s49-2026.html')).toString('utf8'));
  const s67 = decodeCell((await read('s67-2026.html')).toString('utf8'));
  if (!/3\s*a\.?m\.?\s*to\s*7\s*a\.?m\.?/i.test(terms) || !/electronic material or platform/i.test(terms)) throw new SingaporeBundleError('changed_terms', 'The retained SSO terms no longer prove the reviewed reuse and automation conditions.');
  if (!/eight digits|8-digit/i.test(classification) || !/AHTN/i.test(classification)) throw new SingaporeBundleError('missing_classification_evidence', 'Singapore Customs 8-digit AHTN evidence is absent.');
  for (const category of ['liquor', 'tobacco', 'motor vehicle', 'petroleum']) if (!new RegExp(category, 'i').test(dutiable)) throw new SingaporeBundleError('missing_blank_semantics_evidence', `Singapore Customs evidence does not retain the ${category} dutiable category.`);
  if (!/S\s*49/i.test(s49) || !/1 February 2026/i.test(s49) || !/S\s*67/i.test(s67) || !/12 February 2026/i.test(s67) || !/\$535\.00 per\s*kgm/i.test(s67)) throw new SingaporeBundleError('changed_amendment_evidence', 'The reviewed S 49/2026 or S 67/2026 provenance changed.');
  const lines = parseSingaporeScheduleHtml(order, { minimum_rows: args.minimum_rows });
  const canonical = serializeSingaporeLines(lines);
  const retainedCanonical = await read('normalized-lines.json');
  if (!canonical.equals(retainedCanonical)) throw new SingaporeBundleError('non_deterministic_normalization', 'The retained canonical tariff artifact does not match deterministic replay of the raw SSO schedule.');
  const artifacts = manifest.artifacts ?? [];
  const files = [] as Array<{ name: string; role: string; url: string; size_bytes: number; sha256: string }>;
  for (const [name, role] of Object.entries(EXPECTED_ROLES)) {
    const bytes = await read(name); const entry = artifacts.find((item) => item.name === name);
    if (!entry || entry.role !== role || entry.size_bytes !== bytes.length || entry.sha256 !== sha256(bytes) || !entry.url) throw new SingaporeBundleError('artifact_integrity_failure', `Manifest integrity failed for ${name}.`);
    files.push({ name, role, url: entry.url, size_bytes: bytes.length, sha256: entry.sha256 });
  }
  const source = files.find((file) => file.name === 'customs-duties-order-current.html')!;
  return {
    checksum: sha256(args.bytes), canonical_tariff_checksum: sha256(canonical), size_bytes: args.bytes.length,
    release_identifier: args.release_identifier, consolidated_as_at: manifest.consolidated_as_at ?? '',
    consolidated_effective_version: manifest.consolidated_effective_version, source_url: source.url,
    files, amendments: (manifest.amendments ?? []) as Array<{ instrument: string; effective_from: string; url: string }>,
    lines, reader_version: SINGAPORE_BUNDLE_READER_VERSION, table_parser_version: SINGAPORE_TABLE_PARSER_VERSION,
    attribution: manifest.rights.required_attribution,
  };
}

export function readSingaporeAuthorityRelease(args: { bytes: Buffer; release_identifier: string; reader_version: string }) {
  if (args.reader_version !== SINGAPORE_BUNDLE_READER_VERSION) throw new SingaporeBundleError('unsupported_reader_version', `Unsupported Singapore reader version ${args.reader_version}.`);
  return readSingaporeAuthorityBundle(args);
}
