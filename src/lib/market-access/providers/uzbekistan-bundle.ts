import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { PdfTablePage } from './pdf-table-family';
import { UZBEKISTAN_TRADE_REMEDY_MANIFEST, validateUzbekistanRemedyManifest, type UzbekistanTradeRemedyManifest } from './uzbekistan-remedies';

export const UZBEKISTAN_BUNDLE_READER_VERSION = 'uz-lex-bundle-reader-v1' as const;
export const UZBEKISTAN_PARSER_VERSION = 'uz-pp3818-tariff-parser-v1' as const;
/** Ten-digit TN VED codes in PP-181 Annex 1 (the 2022 national nomenclature, unamended since 2025-06-01). */
export const UZBEKISTAN_EXPECTED_NOMENCLATURE_CODES = 13_138;
/** Data rows (header excluded) of PP-3818 Annex 1 as restated by PP-181 and amended by PP-58/2026. */
export const UZBEKISTAN_EXPECTED_RATE_ROWS = 1_489;
export const UZBEKISTAN_EXPECTED_RATE_PREFIXES = 1_852;
/** The PP-58 consolidated edition of PP-3818 Annex 1 took effect on official publication. */
export const UZBEKISTAN_BASE_FROM = '2026-02-16' as const;
/** Customs Code art. 300¹ (ZRU-1097 of 2025-11-27) entered into force on this date. */
export const UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM = '2026-02-28' as const;

export class UzbekistanBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'UzbekistanBundleError'; } }

export interface UzbekistanTemporaryRate { duty: ParsedDuty; declarable: boolean; until: string; footnote: string; condition: string | null }
export interface UzbekistanTariffLine {
  code: string; description: string; unit: string | null; declarable: boolean; duty: ParsedDuty;
  rate_prefix: string; rate_row_description: string; source: string; effective_from: string; effective_to: string | null;
  temporary: UzbekistanTemporaryRate | null;
}
export interface UzbekistanRateRow { codes: readonly string[]; description: string; expression: string; footnote: string }
export interface UzbekistanNomenclatureLine { code: string; description: string; unit: string | null; page: number }
export interface UzbekistanAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  files: readonly { name: string; role: string; size_bytes: number; sha256: string }[];
  schedule_lines: ReadonlyMap<string, UzbekistanTariffLine>;
  remedies: UzbekistanTradeRemedyManifest;
  reader_version: typeof UZBEKISTAN_BUNDLE_READER_VERSION; parser_version: typeof UZBEKISTAN_PARSER_VERSION;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const num = (value: string) => Number(value.replace(',', '.'));
const duty = (expression: string, fields: Partial<ParsedDuty>): ParsedDuty => ({ kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note: null, ...fields });

const MIXED_UNITS: Readonly<Record<string, string>> = { 'килограмми': 'kg', 'донаси': 'piece', 'литри': 'l', 'жуфти': 'pair', 'м2': 'm2' };

/**
 * PP-3818 Annex 1 publishes three rate shapes, all as percentages of customs value and/or US dollars
 * per unit: a bare percentage; "N, but not less than X USD per unit" (the greater of the two — a
 * mixed duty); and "A + B USD per cm³" (both — a compound engine-displacement duty for vehicles).
 * Trailing asterisks are footnote markers resolved separately, never part of the rate.
 */
export function parseUzbekistanDuty(raw: string): { duty: ParsedDuty; footnote: string } {
  const text = clean(raw);
  const footnote = /(\*+)$/.exec(text)?.[1] ?? '';
  const expression = text.slice(0, text.length - footnote.length).trim();
  if (!expression) return { duty: duty(expression, { kind: 'none', note: 'The authority published a blank rate cell; blank is not zero.' }), footnote };
  const plain = /^(\d+(?:,\d+)?)$/.exec(expression);
  if (plain) return { duty: duty(`${num(plain[1]!)}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: num(plain[1]!) }), footnote };
  const mixed = /^(\d+(?:,\d+)?), лекин ҳар (?:бир )?(?:(1000) )?(\S+) учун (\d+(?:,\d+)?) АҚШ долларидан кам бўлмаган миқдорда$/.exec(expression);
  if (mixed && MIXED_UNITS[mixed[3]!]) {
    return { duty: duty(expression, { kind: 'mixed', ad_valorem_rate_percent: num(mixed[1]!), specific_amount: num(mixed[4]!), specific_currency: 'USD', specific_unit: MIXED_UNITS[mixed[3]!]!, specific_unit_quantity: mixed[2] ? 1000 : 1, note: `${num(mixed[1]!)}% of customs value, but not less than ${num(mixed[4]!)} USD per ${mixed[2] ? '1000 ' : ''}${MIXED_UNITS[mixed[3]!]}; the greater amount applies and requires the transaction value and quantity.` }), footnote };
  }
  const compound = /^(\d+(?:,\d+)?) \+ (\d+(?:,\d+)?) АҚШ доллари ҳар бир куб\. см\. учун$/.exec(expression);
  if (compound) {
    return { duty: duty(expression, { kind: 'compound', ad_valorem_rate_percent: num(compound[1]!), specific_amount: num(compound[2]!), specific_currency: 'USD', specific_unit: 'cm3', specific_unit_quantity: 1, note: `${num(compound[1]!)}% of customs value plus ${num(compound[2]!)} USD per cm³ of engine displacement; both components apply and require the vehicle's engine capacity.` }), footnote };
  }
  return { duty: duty(expression, { note: 'The published Uzbekistan rate expression did not match a recognised percentage, minimum-specific or engine-displacement form; it is retained verbatim rather than guessed.' }), footnote };
}

const stripTags = (value: string) => clean(value.replace(/<[^>]+>/g, ' '));
function cellText(cell: string) {
  const paragraphs = cell.match(/<p\b[\s\S]*?<\/p>/g) ?? [cell];
  return paragraphs.map(stripTags).filter(Boolean).join(' ');
}

/** Parses the single rate-grid table of lex.uz's consolidated PP-3818 page (code list | goods name | rate). */
export function parseUzbekistanRateGrid(html: string): UzbekistanRateRow[] {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/g) ?? [];
  const grid = tables.reduce((largest, table) => (table.length > largest.length ? table : largest), '');
  const rows = grid.match(/<tr\b[\s\S]*?<\/tr>/g) ?? [];
  if (!rows.length) throw new UzbekistanBundleError('grid_missing', 'lex.uz PP-3818 page no longer contains the Annex 1 rate grid.');
  const parsed: UzbekistanRateRow[] = [];
  for (const [index, row] of rows.entries()) {
    const cells = row.match(/<td\b[\s\S]*?<\/td>/g) ?? [];
    if (cells.length !== 3) throw new UzbekistanBundleError('grid_layout_changed', `PP-3818 Annex 1 row ${index} has ${cells.length} cells instead of 3.`);
    const [codesText, description, rate] = cells.map(cellText) as [string, string, string];
    if (index === 0) {
      if (!codesText.includes('ТИФ ТНнинг 2022 йилги таҳрири') || !rate.startsWith('Импорт божхона божи ставкаси')) throw new UzbekistanBundleError('grid_header_changed', 'PP-3818 Annex 1 header no longer names the 2022 TN VED edition and the import duty rate column.');
      continue;
    }
    const codes = codesText.split(/[,;]/).map(value => value.replace(/\s+/g, '')).filter(Boolean);
    if (!codes.length || codes.some(code => !/^\d{4}(?:\d{2}(?:\d{2,4})?)?$/.test(code))) throw new UzbekistanBundleError('grid_code_invalid', `PP-3818 Annex 1 row ${index} has an unrecognised code cell "${codesText}".`);
    const { footnote } = parseUzbekistanDuty(rate);
    parsed.push({ codes, description, expression: rate, footnote });
  }
  return parsed;
}

const UNIT_COLUMN_X = 500;
const CODE_COLUMN_MAX_X = 115;
/**
 * Reads the ten-digit national codes (with first-line description and supplementary unit) from
 * PP-181 Annex 1. Code-column entries sit at x≤115pt and are followed either by the hierarchy dashes
 * or by a description in the description column; the same digits quoted inside explanatory notes are
 * indented, followed immediately by prose, or written as a "code – code" range, and are excluded.
 */
export function parseUzbekistanNomenclature(pages: readonly PdfTablePage[]): Map<string, UzbekistanNomenclatureLine> {
  const out = new Map<string, UzbekistanNomenclatureLine>();
  for (const page of pages) {
    const lines: { y: number; items: { str: string; x: number; y: number }[] }[] = [];
    for (const item of [...page.items].sort((a, b) => b.y - a.y || a.x - b.x)) {
      const line = lines.find(candidate => Math.abs(candidate.y - item.y) < 1.5);
      if (line) line.items.push(item); else lines.push({ y: item.y, items: [item] });
    }
    for (const line of lines) {
      const items = line.items.sort((a, b) => a.x - b.x), first = items[0]!;
      if (first.x > CODE_COLUMN_MAX_X) continue;
      let index = 0, digits = '';
      while (index < items.length && items[index]!.x < first.x + 75 && /^[+\d\s]+$/.test(items[index]!.str)) { digits += items[index]!.str.replace(/\D/g, ''); index += 1; }
      if (digits.length !== 10) continue;
      const next = items[index];
      if (next) {
        const dash = /^[–-](?:\s|$)/.test(next.str);
        if (!dash && next.x < first.x + 70) continue;
        const after = items[index + 1];
        if (dash && after && /^\d{4}\s?\d{2}\s?\d{3}\s?\d(?:\D|$)/.test(after.str)) continue;
      }
      const text = items.slice(index).filter(item => item.x < UNIT_COLUMN_X).map(item => item.str).join(' ');
      const unit = clean(items.slice(index).filter(item => item.x >= UNIT_COLUMN_X).map(item => item.str).join(' ')) || null;
      const description = clean(text.replace(/^(?:[–-]\s*)+/, ''));
      if (out.has(digits)) throw new UzbekistanBundleError('nomenclature_duplicate', `PP-181 Annex 1 lists TN VED code ${digits} twice (pages ${out.get(digits)!.page} and ${page.page_number}).`);
      out.set(digits, { code: digits, description, unit: unit === '–' || unit === '-' ? null : unit, page: page.page_number });
    }
  }
  return out;
}

/** Longest-prefix resolution: PP-3818 rows are headings "except the following", then narrower rows. */
export function resolveUzbekistanSchedule(args: { nomenclature: ReadonlyMap<string, UzbekistanNomenclatureLine>; grid: readonly UzbekistanRateRow[] }): UzbekistanTariffLine[] {
  const byPrefix = new Map<string, UzbekistanRateRow>();
  for (const row of args.grid) for (const code of row.codes) {
    if (byPrefix.has(code)) throw new UzbekistanBundleError('grid_conflict', `PP-3818 Annex 1 assigns code ${code} more than one rate; authority conflicts are non-declarable, never arbitrarily selected.`);
    byPrefix.set(code, row);
  }
  const codes = [...args.nomenclature.keys()].sort();
  for (const prefix of byPrefix.keys()) if (!codes.some(code => code.startsWith(prefix))) throw new UzbekistanBundleError('grid_orphan_code', `PP-3818 Annex 1 code ${prefix} matches no PP-181 national code.`);
  return codes.map(code => {
    const prefix = [10, 9, 8, 6, 4].map(length => code.slice(0, length)).find(candidate => byPrefix.has(candidate));
    if (!prefix) throw new UzbekistanBundleError('grid_gap', `TN VED code ${code} has no PP-3818 Annex 1 rate.`);
    const row = byPrefix.get(prefix)!, parsed = parseUzbekistanDuty(row.expression).duty, nomenclature = args.nomenclature.get(code)!;
    return {
      code, description: nomenclature.description, unit: nomenclature.unit, declarable: parsed.kind === 'ad_valorem' || parsed.kind === 'mixed' || parsed.kind === 'compound', duty: parsed,
      rate_prefix: prefix, rate_row_description: row.description, source: 'PP-3818 Annex 1 (PP-58/2026 consolidated edition), lex.uz', effective_from: UZBEKISTAN_BASE_FROM, effective_to: null,
      temporary: temporaryRate(code, row),
    };
  });
}

/**
 * The annex's footnotes: `*`, `****` and `*****` set temporary rates only "until 1 January 2026" and
 * are therefore spent before the consolidated edition's effective date; `**` and `***` remain live.
 * `***` is defined by exact code (finished jewellery). `**` names exact code 7106 92 000 0 but
 * restricts it to "ligatures used in the jewellery industry" — an end-use narrower than the code —
 * so that line is non-declarable while the temporary rate runs.
 */
function temporaryRate(code: string, row: UzbekistanRateRow): UzbekistanTemporaryRate | null {
  if (row.footnote === '**' && code === '7106920000') return { duty: duty('0% for ligatures used in the jewellery industry until 2027-10-01 inclusive; 5% otherwise', { note: 'PP-3818 Annex 1 footnote ** applies 0% only to ligatures used in the jewellery industry; the end use cannot be established from the tariff code alone.' }), declarable: false, until: '2027-10-01', footnote: '**', condition: 'ligatures used in the jewellery industry' };
  if (row.footnote === '***' && (code === '7113190000' || code === '7114190000')) return { duty: duty('10%', { kind: 'ad_valorem', ad_valorem_rate_percent: 10 }), declarable: true, until: '2027-01-01', footnote: '***', condition: null };
  return null;
}

interface Normalized { schedule_lines: UzbekistanTariffLine[]; remedies: UzbekistanTradeRemedyManifest }
export async function readUzbekistanAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<UzbekistanAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new UzbekistanBundleError('corrupt_archive', 'Uzbekistan authority bundle is not a readable ZIP.'); }
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name: string; role: string; size_bytes: number; sha256: string }>; rights_evidence?: Record<string, unknown>; scope?: Record<string, unknown> };
  try { manifest = JSON.parse(Buffer.from(await zip.file('acquisition.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new UzbekistanBundleError('invalid_manifest', 'Uzbekistan acquisition manifest is invalid JSON.'); }
  if (manifest.acquisition_version !== 'uz-lex-public-acquisition-v1' || manifest.release_identifier !== args.release_identifier || manifest.rights_evidence?.law_article !== 'Uzbekistan Law ZRU-42 on Copyright and Related Rights article 8' || manifest.scope?.executable_source !== 'legal_instruments') {
    throw new UzbekistanBundleError('unexpected_acquisition', 'Uzbekistan manifest lacks the reviewed identity, rights or legal-instrument source controls.');
  }
  for (const entry of manifest.artifacts ?? []) {
    const bytes = Buffer.from(await zip.file(entry.name)?.async('nodebuffer') ?? []);
    if (bytes.length !== entry.size_bytes || hash(bytes) !== entry.sha256) throw new UzbekistanBundleError('artifact_hash_mismatch', `Uzbekistan artifact ${entry.name} failed its manifest hash.`);
  }
  let normalized: Normalized;
  try { normalized = JSON.parse(Buffer.from(await zip.file('normalized.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new UzbekistanBundleError('invalid_normalized', 'Uzbekistan normalized artifact is invalid JSON.'); }
  if (normalized.schedule_lines.length !== UZBEKISTAN_EXPECTED_NOMENCLATURE_CODES) throw new UzbekistanBundleError('incomplete_schedule', `Uzbekistan normalized schedule has ${normalized.schedule_lines.length} codes.`);
  const schedule = new Map(normalized.schedule_lines.map(line => [line.code, line]));
  if (schedule.size !== normalized.schedule_lines.length) throw new UzbekistanBundleError('invalid_schedule', 'Uzbekistan normalized schedule has duplicate codes.');
  validateUzbekistanRemedyManifest(normalized.remedies);
  return {
    checksum: hash(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier,
    source_url: 'https://lex.uz/docs/3802363',
    files: (manifest.artifacts ?? []).map(x => ({ name: x.name, role: x.role, size_bytes: x.size_bytes, sha256: x.sha256 })),
    schedule_lines: schedule, remedies: normalized.remedies,
    reader_version: UZBEKISTAN_BUNDLE_READER_VERSION, parser_version: UZBEKISTAN_PARSER_VERSION,
  };
}
export const UZBEKISTAN_DEFAULT_REMEDIES = UZBEKISTAN_TRADE_REMEDY_MANIFEST;
