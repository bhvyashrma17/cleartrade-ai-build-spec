import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { PdfTablePage, PdfTextItem } from './pdf-table-family';
import { validateVietnamRemedyManifest, type VietnamTradeRemedyManifest } from './vietnam-remedies';

export const VIETNAM_BUNDLE_READER_VERSION = 'vn-congbao-bundle-reader-v1' as const;
export const VIETNAM_PARSER_VERSION = 'vn-decree26-2023-aifta122-2022-remedies-v1' as const;
/** Decree 26/2023 Annex II Section I: the complete AHTN 2022 eight-digit MFN schedule. */
export const VIETNAM_EXPECTED_SECTION_I_LINES = 11_414;
/** Decree 122/2022 AIFTA schedule: 11,414 base lines less 7 parents published only as 14 ten-digit sub-lines. */
export const VIETNAM_EXPECTED_AIFTA_ENTRIES = 11_421;
export const VIETNAM_BASE_FROM = '2023-07-15' as const;

export class VietnamBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'VietnamBundleError'; } }

/** A rate that replaces the base rate from `from` (inclusive) through `until` (inclusive, null = open). */
export interface VietnamRateVersion { from: string; until: string | null; expression: string; instrument: string }
export interface VietnamTariffLine {
  code: string; description: string; base_expression: string; versions: readonly VietnamRateVersion[];
  /** Condition published by an amending decree that must hold before the rate may be declared. */
  import_condition: string | null;
  out_of_quota_expression: string | null;
  used_vehicle_annex_iii: boolean;
}
export interface VietnamChapter98Line { code: string; description: string; corresponding_codes: readonly string[]; expression: string; instrument: string }
export interface VietnamAiftaLine { code: string; rates: readonly [string, string, string, string, string, string] }
export interface VietnamAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  files: readonly { name: string; role: string; size_bytes: number; sha256: string }[];
  schedule_lines: ReadonlyMap<string, VietnamTariffLine>;
  chapter98: readonly VietnamChapter98Line[];
  aifta: ReadonlyMap<string, VietnamAiftaLine>;
  remedies: VietnamTradeRemedyManifest;
  reader_version: typeof VIETNAM_BUNDLE_READER_VERSION; parser_version: typeof VIETNAM_PARSER_VERSION;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const plain = (code: string) => code.replace(/\./g, '');
const empty = (expression: string, fields: Partial<ParsedDuty> = {}): ParsedDuty => ({ kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note: null, ...fields });

/**
 * Vietnam's preferential (MFN) schedule publishes percentages only. Two conditional references appear
 * in the rate column instead of a number — "per guidance in point 1.1 of Chapter 98" (CKD vehicle kits)
 * and "per guidance in points b.5.3 and b.5.4 of point 2.2 of Chapter 98" — and both are non-declarable
 * references, never zero.
 */
export function parseVietnamDuty(raw: string): ParsedDuty {
  const expression = clean(raw);
  if (!expression) return empty('', { kind: 'none', note: 'The authority published a blank rate cell; blank is not zero.' });
  const pct = /^(\d+(?:[.,]\d+)?)$/.exec(expression);
  if (pct) { const rate = Number(pct[1]!.replace(',', '.')); return empty(`${rate}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: rate }); }
  if (/^Theo hướng/.test(expression) && /Chương 98/.test(expression)) return empty(expression, { note: /b\.5\.3/.test(expression) ? 'The schedule refers the rate to Chapter 98 guidance points b.5.3/b.5.4 (automotive component programme); the applicable rate depends on programme conditions.' : 'The schedule refers the rate to Chapter 98 point 1.1 (CKD/incomplete vehicle kits); the applicable rate depends on kit classification.' });
  return empty(expression, { note: 'The published Vietnamese rate expression did not match a recognised form; it is retained verbatim rather than guessed.' });
}

type VietnamItem = PdfTextItem & { w: number };
interface Line { y: number; items: VietnamItem[] }
function lines(items: readonly VietnamItem[], tolerance = 1.5): Line[] {
  const out: Line[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = out.find(candidate => Math.abs(candidate.y - item.y) < tolerance);
    if (line) line.items.push(item); else out.push({ y: item.y, items: [item] });
  }
  for (const line of out) line.items.sort((a, b) => a.x - b.x);
  return out;
}
const width = (item: PdfTextItem & { w?: number }) => item.w ?? item.str.length * 5;
function join(items: readonly (PdfTextItem & { w?: number })[]) {
  let text = '', previous: (PdfTextItem & { w?: number }) | null = null;
  for (const item of items) { if (previous && item.x - (previous.x + width(previous)) > 1.2) text += ' '; text += item.str; previous = item; }
  return clean(text);
}

export interface VietnamPage extends PdfTablePage { items: VietnamItem[]; text: string }
const CODE8 = /^\d{4}\.\d{2}\.\d{2}$/;
const HEADER = /^(Thu|ế|su|ấ|t|\(%\)|Mã hàng|Mô t|ả|hàng hóa|Thuế suất|Mô tả hàng hóa)$/;
/** The rate-column header: split into glyph fragments ("Thu") in the 2023 Gazette, a single item ("Thuế suất") later. */
const rateHeader = (items: readonly VietnamItem[]) => items.filter(item => item.x > 400 && (item.str.trim() === 'Thu' || item.str.trim() === 'Thuế' || item.str.trim().startsWith('Thuế suất'))).sort((a, b) => b.y - a.y)[0];

/**
 * Reads the "Mã hàng | Mô tả hàng hóa | Thuế suất (%)" table used by Decree 26/2023 Annex II Section I
 * and by every amending decree. A code is vertically centred in its row while its rate may be top-aligned,
 * so rows never overlap but codes and rates need not share a y-coordinate; each page is therefore paired
 * in reading order and must yield exactly one rate cell per eight-digit code. Multi-line textual cells
 * are merged, split at each "Theo hướng" start, and a continuation at the top of a page is appended to the
 * previous page's last cell. National-note prose that runs through the rate column is never a rate.
 */
export function parseVietnamRateTable(pages: readonly VietnamPage[], options: { start: RegExp; stop: RegExp; label: string }) {
  const out = new Map<string, { expression: string; description: string; page: number }>();
  let active = false, previous: string | null = null;
  for (const page of pages) {
    if (!active && options.start.test(page.text)) active = true;
    if (!active) continue;
    if (options.stop.test(page.text)) break;
    const headers = page.items.filter(item => item.str.trim() === '(%)'), thu = rateHeader(page.items);
    if (!headers.length || !thu) continue;
    const rateX = thu.x - (thu.str.trim().startsWith('Thuế suất') ? 16 : 8), topY = Math.max(...headers.map(item => item.y)) + 26;
    const body = page.items.filter(item => item.y < topY && item.y < 770 && !(HEADER.test(item.str.trim()) && (item.x > rateX - 60 || item.x < 160)));
    const codes: { code: string; y: number; description: string }[] = [], rates: { y: number; text: string }[] = [];
    for (const line of lines(body)) {
      // A code is occasionally split across items ("3902.10" + ".40"); the code column is read as one string.
      const codeItems = line.items.filter(item => item.x < 130), codeText = codeItems.map(item => item.str.trim()).join('');
      const code = CODE8.test(codeText) ? codeText : null;
      const left = line.items.filter(item => item.x < rateX), right = line.items.filter(item => item.x >= rateX);
      if (code) codes.push({ code, y: line.y, description: join(left.filter(item => !codeItems.includes(item))) });
      if (!right.length) continue;
      const leftmost = line.items[0]!, prose = leftmost.x < 125 && !/^\d{2}\.\d{2}$|^\d{4}\.\d{2}(\.\d{2})?$/.test(leftmost.str.trim());
      const leftEdge = left.length ? Math.max(...left.map(item => item.x + width(item))) : 0;
      const rightText = join(right);
      // Justified descriptions can end within a few points of a textual rate cell; rate vocabulary is never prose.
      const rateVocabulary = /^(\d|Theo hướng|dẫn tại|tại khoản|tại điểm|khoản|Chương 98|b\.5\.)/.test(rightText);
      if (prose || (left.length && !rateVocabulary && Math.min(...right.map(item => item.x)) - leftEdge < 8)) continue;
      rates.push({ y: line.y, text: rightText });
    }
    const cells: { y: number; text: string; last?: number }[] = [];
    let buffer: { y: number; text: string; last: number } | null = null;
    for (const rate of rates.sort((a, b) => b.y - a.y)) {
      if (/^\d+(?:[.,]\d+)?$/.test(rate.text)) { if (buffer) { cells.push(buffer); buffer = null; } cells.push(rate); continue; }
      // Continuation lines of a textual cell never begin with a digit or "Theo"; a new textual cell always begins with "Theo".
      if (buffer && (buffer.last - rate.y < 26 || !/^(\d|Theo)/.test(rate.text))) { buffer.text += ` ${rate.text}`; buffer.last = rate.y; } else { if (buffer) cells.push(buffer); buffer = { y: rate.y, text: rate.text, last: rate.y }; }
    }
    if (buffer) cells.push(buffer);
    const split = cells.flatMap(cell => cell.text.split(/(?=Theo hướng)/).map(clean).filter(Boolean));
    if (split.length === codes.length + 1 && previous && !/^(\d|Theo)/.test(split[0]!)) { const entry = out.get(previous)!; entry.expression = clean(`${entry.expression} ${split.shift()}`); }
    if (split.length !== codes.length) throw new VietnamBundleError('rate_pairing_failed', `${options.label} page ${page.page_number} has ${codes.length} codes but ${split.length} rate cells${process.env.VN_DEBUG ? `: ${codes.map(c => c.code).join(',')} | ${split.join(' | ')}` : ''}.`);
    codes.sort((a, b) => b.y - a.y);
    for (const [index, code] of codes.entries()) {
      if (out.has(code.code)) throw new VietnamBundleError('duplicate_code', `${options.label} lists ${code.code} twice.`);
      out.set(code.code, { expression: split[index]!, description: code.description, page: page.page_number });
      previous = code.code;
    }
  }
  return out;
}

const AIFTA_PERIODS = ['30/12/2022', '31/12/2022', '31/12/2023', '31/12/2024', '01/01/2026', '01/01/2027'] as const;
/** The AIFTA periods in force-date order; index 4 covers 2026-01-01 through 2026-12-31. */
export const VIETNAM_AIFTA_PERIODS = [['2022-12-30', '2022-12-30'], ['2022-12-31', '2023-12-30'], ['2023-12-31', '2024-12-30'], ['2024-12-31', '2025-12-31'], ['2026-01-01', '2026-12-31'], ['2027-01-01', '2027-12-31']] as const;

/** Reads Decree 122/2022's six period columns by column centre; a parent line with ten-digit children carries no rates. */
export function parseVietnamAifta(pages: readonly VietnamPage[]) {
  const codeRe = /^(\d{4}\.\d{2}\.\d{2}(?:\.\d{2})?)(?:\s|$)/;
  const all = new Set<string>();
  for (const page of pages) for (const item of page.items) { const match = item.x < 110 ? codeRe.exec(item.str.trim()) : null; if (match) all.add(match[1]!); }
  const parents = new Set([...all].filter(code => code.length === 10 && [...all].some(other => other.length === 13 && other.startsWith(`${code}.`))));
  const out = new Map<string, VietnamAiftaLine>();
  for (const page of pages) {
    const heads = page.items.filter(item => (AIFTA_PERIODS as readonly string[]).includes(item.str.trim()));
    if (heads.length < 6) continue;
    const centres = AIFTA_PERIODS.map(label => { const head = heads.filter(item => item.str.trim() === label).sort((a, b) => b.y - a.y)[0]!; return head.x + head.w / 2; });
    const headerY = Math.min(...heads.map(item => item.y)) - 3;
    const body = page.items.filter(item => item.y < headerY && item.y > 40);
    const codes = body.flatMap(item => { const match = item.x < 110 ? codeRe.exec(item.str.trim()) : null; return match && !parents.has(match[1]!) ? [{ code: match[1]!, y: item.y }] : []; }).sort((a, b) => b.y - a.y);
    const rows = lines(body.filter(item => item.x > centres[0]! - 25 && /^[\d.,*]+$/.test(item.str.trim()))).map(line => {
      const cells: (string | null)[] = Array(6).fill(null);
      for (const item of line.items) { const cx = item.x + item.w / 2; let best = 0, distance = 1e9; centres.forEach((centre, index) => { const d = Math.abs(centre - cx); if (d < distance) { distance = d; best = index; } }); if (distance <= 14) cells[best] = item.str.trim(); }
      return cells;
    }).filter(cells => cells.some(cell => cell !== null));
    if (rows.length !== codes.length) throw new VietnamBundleError('aifta_pairing_failed', `Decree 122/2022 page ${page.page_number} has ${codes.length} codes but ${rows.length} rate rows.`);
    for (const [index, code] of codes.entries()) {
      const cells = rows[index]!;
      if (cells.some(cell => cell === null)) throw new VietnamBundleError('aifta_cell_missing', `Decree 122/2022 line ${code.code} is missing a period rate.`);
      const entry = { code: plain(code.code), rates: cells as unknown as VietnamAiftaLine['rates'] };
      const prior = out.get(entry.code);
      if (prior && JSON.stringify(prior.rates) !== JSON.stringify(entry.rates)) throw new VietnamBundleError('aifta_conflict', `Decree 122/2022 publishes conflicting rates for ${code.code}.`);
      out.set(entry.code, entry);
    }
  }
  return out;
}

/** Chapter 98 rows: one 98xx code, a vertical run of corresponding Section I codes, and one rate. */
export function parseVietnamChapter98(pages: readonly VietnamPage[], options: { start: RegExp; stop: RegExp; instrument: string }) {
  const out: VietnamChapter98Line[] = [];
  let active = false;
  for (const page of pages) {
    if (!active && options.start.test(page.text)) active = true;
    if (!active) continue;
    if (options.stop.test(page.text)) break;
    const thu = rateHeader(page.items);
    const correspondingHeader = page.items.find(item => item.str.trim().startsWith('Mã hàng') && item.x > 300);
    if (!thu || !correspondingHeader) continue;
    const top = Math.min(...page.items.filter(item => item.str.trim() === '(%)').map(item => item.y)) - 4;
    const body = page.items.filter(item => item.y < top && item.y < 770);
    const codes = body.filter(item => item.x < 130 && /^98\d{2}\.\d{2}\.\d{2}$/.test(item.str.trim())).sort((a, b) => b.y - a.y);
    const corresponding = body.filter(item => item.x > correspondingHeader.x - 20 && item.x < thu.x - 8 && CODE8.test(item.str.trim())).sort((a, b) => b.y - a.y);
    const rateItems = body.filter(item => item.x >= thu.x - 8 && /^\d+(?:[.,]\d+)?$/.test(item.str.trim())).sort((a, b) => b.y - a.y);
    // A row's corresponding-code list is vertically centred on its 98xx code, so each code belongs to the nearest 98xx row.
    const byCode = new Map(codes.map(code => [code, [] as string[]]));
    for (const item of corresponding) {
      const owner = codes.reduce<VietnamItem | null>((best, code) => (!best || Math.abs(code.y - item.y) < Math.abs(best.y - item.y) ? code : best), null);
      if (owner) byCode.get(owner)!.push(plain(item.str.trim()));
    }
    if (rateItems.length !== codes.length) throw new VietnamBundleError('ch98_pairing_failed', `${options.instrument} Chapter 98 page ${page.page_number} has ${codes.length} codes but ${rateItems.length} rates.`);
    codes.forEach((code, index) => out.push({ code: plain(code.str.trim()), description: '', corresponding_codes: byCode.get(code) ?? [], expression: rateItems[index]!.str.trim(), instrument: options.instrument }));
  }
  return out;
}

/** Annex IV out-of-quota rates: codes are printed as spaced groups ("0407 21 00"). */
export function parseVietnamOutOfQuota(pages: readonly VietnamPage[]) {
  const out = new Map<string, string>();
  let active = false;
  for (const page of pages) {
    if (!active && /Phụ lục IV/.test(page.text) && /NGOÀI HẠN NGẠCH/.test(page.text)) active = true;
    if (!active) continue;
    for (const line of lines(page.items)) {
      const text = join(line.items);
      const match = /^(\d{4})\s+(\d{2})\s+(\d{2})\b.*?\s(\d{2,3})$/.exec(text);
      if (match) out.set(`${match[1]}${match[2]}${match[3]}`, match[4]!);
    }
  }
  return out;
}

interface Normalized { schedule_lines: VietnamTariffLine[]; chapter98: VietnamChapter98Line[]; aifta: VietnamAiftaLine[]; remedies: VietnamTradeRemedyManifest }
export async function readVietnamAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<VietnamAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new VietnamBundleError('corrupt_archive', 'Vietnam authority bundle is not a readable ZIP.'); }
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name: string; role: string; size_bytes: number; sha256: string }>; rights_evidence?: Record<string, unknown>; scope?: Record<string, unknown> };
  try { manifest = JSON.parse(Buffer.from(await zip.file('acquisition.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new VietnamBundleError('invalid_manifest', 'Vietnam acquisition manifest is invalid JSON.'); }
  if (manifest.acquisition_version !== 'vn-congbao-public-acquisition-v1' || manifest.release_identifier !== args.release_identifier || manifest.rights_evidence?.law_article !== 'Vietnam Law on Intellectual Property article 15(2)' || manifest.scope?.tariff_treatment_complete !== true) {
    throw new VietnamBundleError('unexpected_acquisition', 'Vietnam manifest lacks the reviewed identity, rights or completeness controls.');
  }
  for (const entry of manifest.artifacts ?? []) {
    const bytes = Buffer.from(await zip.file(entry.name)?.async('nodebuffer') ?? []);
    if (bytes.length !== entry.size_bytes || hash(bytes) !== entry.sha256) throw new VietnamBundleError('artifact_hash_mismatch', `Vietnam artifact ${entry.name} failed its manifest hash.`);
  }
  let normalized: Normalized;
  try { normalized = JSON.parse(Buffer.from(await zip.file('normalized.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new VietnamBundleError('invalid_normalized', 'Vietnam normalized artifact is invalid JSON.'); }
  if (normalized.schedule_lines.length !== VIETNAM_EXPECTED_SECTION_I_LINES) throw new VietnamBundleError('incomplete_schedule', `Vietnam normalized schedule has ${normalized.schedule_lines.length} lines.`);
  if (normalized.aifta.length !== VIETNAM_EXPECTED_AIFTA_ENTRIES) throw new VietnamBundleError('incomplete_aifta', `Vietnam normalized AIFTA schedule has ${normalized.aifta.length} entries.`);
  const schedule = new Map(normalized.schedule_lines.map(line => [line.code, line]));
  if (schedule.size !== normalized.schedule_lines.length) throw new VietnamBundleError('invalid_schedule', 'Vietnam normalized schedule has duplicate codes.');
  validateVietnamRemedyManifest(normalized.remedies);
  return {
    checksum: hash(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier,
    source_url: 'https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-26-2023-nd-cp-39522.htm',
    files: (manifest.artifacts ?? []).map(x => ({ name: x.name, role: x.role, size_bytes: x.size_bytes, sha256: x.sha256 })),
    schedule_lines: schedule, chapter98: normalized.chapter98, aifta: new Map(normalized.aifta.map(line => [line.code, line])), remedies: normalized.remedies,
    reader_version: VIETNAM_BUNDLE_READER_VERSION, parser_version: VIETNAM_PARSER_VERSION,
  };
}
