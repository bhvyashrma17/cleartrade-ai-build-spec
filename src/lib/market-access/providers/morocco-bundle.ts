import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { PdfTablePage, PdfTextItem } from './pdf-table-family';
import { validateMoroccoRemedyManifest, type MoroccoTradeRemedyManifest } from './morocco-remedies';

export const MOROCCO_BUNDLE_READER_VERSION = 'ma-adii-bundle-reader-v1' as const;
export const MOROCCO_PARSER_VERSION = 'ma-tdi-chapters-lf2026-remedies-v1' as const;
/** The ADII publishes the import tariff (TDI) as 97 chapter PDFs of the HS 2022 edition, reissued in place as the Finance Law amends them. */
export const MOROCCO_EXPECTED_CHAPTERS = 97;
export const MOROCCO_BASE_FROM = '2026-01-01' as const;

export class MoroccoBundleError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = 'MoroccoBundleError'; } }

export type MoroccoItem = PdfTextItem & { w: number };
export interface MoroccoPage extends PdfTablePage { items: MoroccoItem[]; text: string }
export interface MoroccoScheduleRow { code: string; description: string; expression: string; footnote: string | null; unit: string | null; page: number; y: number; inferred_segment: boolean; conflicting_expressions: string[] | null; pairing: 'same_row' | 'wrapped' | 'centred' | 'uncertain' | 'none' }
/** A temporary replacement of the statutory rate (suspension or quotité change) between two dates, inclusive. */
export interface MoroccoRateVersion { from: string; until: string | null; expression: string; instrument: string; kind: 'suspension' | 'rate_change' | 'restoration' }
/** A duty-free allowance limited by a quota (heads) and a customs franchise request; the quota's availability is never known here. */
export interface MoroccoQuotaSuspension { from: string; until: string; quota: string; instrument: string; condition: string }
export interface MoroccoTariffLine {
  code: string; chapter: string; description: string; expression: string; footnote: string | null; footnote_text: string | null; unit: string | null;
  /** How the printed rate was attached to this line; only same-row, wrapped and centred pairings are declared. */
  pairing: MoroccoScheduleRow['pairing']; inferred_segment: boolean; conflicting_expressions: string[] | null;
  /** A line whose own description fixes its import season ("du 1er juin au 31 juillet"). */
  season: { from_month_day: string; until_month_day: string } | null;
  versions: readonly MoroccoRateVersion[]; quota_suspensions: readonly MoroccoQuotaSuspension[];
  /** A decree that covers only part of a line ("Ex 02.06"): the rate applies only to the named species. */
  partial_versions: readonly (MoroccoRateVersion & { scope: string })[];
}
export interface MoroccoAuthorityBundle {
  checksum: string; size_bytes: number; release_identifier: string; source_url: string;
  files: readonly { name: string; role: string; size_bytes: number; sha256: string }[];
  schedule_lines: ReadonlyMap<string, MoroccoTariffLine>;
  remedies: MoroccoTradeRemedyManifest;
  reader_version: typeof MOROCCO_BUNDLE_READER_VERSION; parser_version: typeof MOROCCO_PARSER_VERSION;
}

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
const base = (expression: string, fields: Partial<ParsedDuty> = {}): ParsedDuty => ({ kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note: null, ...fields });

/**
 * The TDI publishes one "Droit d'Importation" percentage per line. A footnote letter beside the rate
 * ("135 (f)") changes its meaning — in Chapter 10 it limits the rate to a value tranche and applies a
 * different duty above it — so a footnoted rate is retained verbatim and never declared as the plain
 * percentage. Blank is never zero.
 */
export function parseMoroccoDuty(expression: string, footnoteText: string | null = null): ParsedDuty {
  const text = clean(expression);
  if (!text || text === '–' || text === '-') return base(text, { kind: 'none', note: 'The authority published no rate for this line; blank is not zero.' });
  const plain = /^(\d+(?:,\d+)?)$/.exec(text);
  if (plain) { const rate = Number(plain[1]!.replace(',', '.')); return base(`${rate}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: rate }); }
  const footnoted = /^(\d+(?:,\d+)?)\s*\(([a-z])\)$/.exec(text);
  if (footnoted) return base(text, { note: `The ${footnoted[1]}% rate carries TDI footnote (${footnoted[2]}): ${footnoteText ?? 'footnote text not located'}. The footnote conditions the rate, so it is not declared as a plain percentage.` });
  return base(text, { note: 'The published TDI rate did not match a recognised form; it is retained verbatim rather than guessed.' });
}

interface Row { y: number; items: MoroccoItem[] }
/** The row marker and code segments are often set a few points above the description baseline, so rows are anchored on their first item. */
function rows(items: readonly MoroccoItem[]): Row[] {
  const out: Row[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = out.at(-1);
    if (row && row.y - item.y < 5.5) row.items.push(item); else out.push({ y: item.y, items: [item] });
  }
  for (const row of out) row.items.sort((a, b) => a.x - b.x);
  return out;
}
function join(items: readonly MoroccoItem[]) {
  let text = '', previous: MoroccoItem | null = null;
  for (const item of items) { if (previous && item.x - (previous.x + previous.w) > 1.5) text += ' '; text += item.str; previous = item; }
  return clean(text);
}
const LEADER = /^[.…_]{3,}$/;
/** A subheading, occasionally printed with a stray dot ("70.09.10" for 7009.10). */
const HS6 = /^\d{2}\.?\d{2}\.\d{2}$/;
const SEASON = /du (1er|\d{1,2}) (\p{L}+) au (\d{1,2}) (\p{L}+)/iu;
const MONTHS: Readonly<Record<string, string>> = { janvier: '01', fevrier: '02', février: '02', mars: '03', avril: '04', mai: '05', juin: '06', juillet: '07', aout: '08', août: '08', septembre: '09', octobre: '10', novembre: '11', decembre: '12', décembre: '12' };

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]!; };
/** Splits an item into its whitespace-separated words, estimating each word's x from its character offset. */
function words(item: MoroccoItem) {
  const out: { text: string; x: number }[] = [], length = item.str.length || 1;
  for (const match of item.str.matchAll(/\S+/g)) out.push({ text: match[0], x: item.x + item.w * (match.index! / length) });
  return out;
}
const UNIT = /^(kg|KG|Kg|u|U|m|l|L|m2|m3|g|carat|\d+u|paire|mètre|mille|grosses|nombre|Kg sec 90 %|kg net|1000 ?g net)\b/i;
/** A rate is the first purely numeric run right of the description that a unit follows (a unit may itself start with a digit, e.g. "2u"). */
function rateStart(row: Row, minX: number) {
  const right = row.items.filter(item => item.x > minX);
  const start = right.findIndex(item => /^[\d,]+$/.test(item.str.trim()));
  if (start < 0) return null;
  let end = start;
  while (end + 1 < right.length && /^[\d,]+$/.test(right[end + 1]!.str.trim()) && right[end + 1]!.x - right[end]!.x < 9) end += 1;
  const unit = right[end + 1];
  return unit && UNIT.test(unit.str.trim()) ? right[start]!.x : null;
}
/**
 * Templates differ by chapter and odd/even pages mirror their margins, so the national-segment, suffix
 * and rate columns are learned on each page from rows that print them, relative to the subheading column.
 */
function learnColumns(pageRows: readonly Row[], hs: number) {
  const first: number[] = [], second: number[] = [], rate: number[] = [];
  for (const row of pageRows) {
    const pairs = row.items.filter(item => item.x > hs + 20 && item.x < hs + 110).flatMap(words).filter(word => /^\d{2}$/.test(word.text));
    if (pairs.length >= 2 && pairs[1]!.x - pairs[0]!.x > 10 && pairs[1]!.x - pairs[0]!.x < 45) { first.push(pairs[0]!.x - hs); second.push(pairs[1]!.x - hs); }
    const x = rateStart(row, hs + 250);
    if (x !== null) rate.push(x - hs);
  }
  return { d78: first.length ? median(first) : null, d910: second.length ? median(second) : null, rate: rate.length >= 2 ? median(rate) : null };
}

/** The rate column holds a percentage, sometimes set one glyph per item and sometimes followed by a footnote letter; the unit follows it. */
const RATE_CELL = /(?:^|\s)(\d{1,3}(?:,\d{1,2})?)(\s*\([a-z]\))?(?:\s+(\S.*))?$/;
/**
 * Reads one chapter. Columns are located from the page itself: the subheading column (dddd.dd) and the
 * "Droit" header. The national code is the subheading, the two-digit national segment and the
 * two-digit statistical suffix; a line exists where the suffix completes the code. A code may be
 * centred in a wrapped cell while its rate is aligned with the first or last line, so each page's
 * completed codes and rates are paired in reading order and must match one-to-one. A heading that
 * repeats a rate on the same row as its incomplete code is not a line.
 */
export function parseMoroccoChapter(pages: readonly MoroccoPage[], chapter: string, debug?: (page: number, line: string) => void) {
  const out: MoroccoScheduleRow[] = [], footnotes = new Map<string, string>();
  let hs6: string | null = null, d78: string | null = null;
  // Events carry a chapter-wide position so a rate printed at the top of a page can close the previous page's last line.
  const events: ({ kind: 'code'; code: string; description: string; y: number; row_y: number; page: number; inferred: boolean } | { kind: 'rate'; rate: string; unit: string | null; description: string; y: number; row_y: number; page: number })[] = [];
  // Pass 1: learn each page's columns (relative to its subheading column) from the rows it prints.
  const prepared = pages.map(original => {
    // Some cells are overprinted by a ghost copy a few points away; the copy is dropped.
    const kept: MoroccoItem[] = [];
    for (const item of original.items) if (!kept.some(prior => prior.str === item.str && Math.abs(prior.x - item.x) < 1.5 && Math.abs(prior.y - item.y) < 4)) kept.push(item);
    const page = { ...original, items: kept };
    const droit = page.items.find(item => item.str.trim() === 'Droit');
    const hsItems = page.items.filter(item => HS6.test(item.str.trim().split(/\s+/)[0]!) && item.x < page.width * 0.4);
    // The column header spans several lines; content starts just below its lowest item.
    const header = droit ? page.items.filter(item => item.y <= droit.y + 20 && item.y >= droit.y - 30 && /^(Droit|d.import|Unités?|Unité de|Quantité|Normalis|Compl|lémentaires|Codification|Désignation|Co ?dific)/i.test(item.str.trim())) : [];
    const top = header.length ? Math.min(...header.map(item => item.y)) - 1 : page.height - 40;
    // Only the page footer ("3 / Chap 17") is excluded; a code can be printed within a few points of the bottom margin.
    const pageRows = rows(page.items.filter(item => item.y < top && item.y > 8 && !/\/\s*Chap\b|^Chap\s*\d+\s*\/|^\d+\s*\/\s*$/i.test(item.str.trim())));
    const hsX = hsItems.length ? Math.min(...hsItems.map(item => item.x)) : null;
    const learned = hsX === null ? null : learnColumns(pageRows, hsX);
    return { page, droit, pageRows, hsX, learned };
  });
  // A page that prints too little to learn from borrows offsets from the nearest page with the same (mirrored) margins.
  const borrow = (index: number, key: 'd78' | 'd910' | 'rate') => {
    const order = prepared.map((_, candidate) => candidate).filter(candidate => candidate !== index && prepared[candidate]!.learned?.[key] != null)
      .sort((a, b) => Number((a - index) % 2 !== 0) - Number((b - index) % 2 !== 0) || Math.abs(a - index) - Math.abs(b - index));
    return order.length ? { offset: prepared[order[0]!]!.learned![key]!, hs: prepared[order[0]!]!.hsX! } : null;
  };
  // Pass 2: read every page.
  for (const [pageIndex, { page, droit, pageRows, hsX: ownHs, learned }] of prepared.entries()) {
    // Notes pages carry no column header, subheading or rate; a continuation page prints rates and borrows its columns.
    const tableRows = pageRows.filter(row => row.items.some(item => /^\d{2}$/.test(item.str.trim()) && item.x < page.width * 0.35) && rateStart(row, page.width * 0.5) !== null).length;
    if (!droit && ownHs === null && tableRows < 2) continue;
    // A continuation page without a subheading locates its code columns from rows printing both segments, then places the subheading column by the chapter's offset.
    const inferredHs = () => {
      const pairs = pageRows.map(row => row.items.filter(item => item.x < page.width * 0.35).flatMap(words).filter(word => /^\d{2}$/.test(word.text))).filter(found => found.length >= 2 && found[1]!.x - found[0]!.x > 10 && found[1]!.x - found[0]!.x < 45);
      const offset = borrow(pageIndex, 'd78');
      if (pairs.length && offset) return median(pairs.map(found => found[0]!.x)) - offset.offset;
      const source = prepared.filter((candidate, index) => candidate.hsX !== null && (index - pageIndex) % 2 === 0).sort((a, b) => Math.abs(prepared.indexOf(a) - pageIndex) - Math.abs(prepared.indexOf(b) - pageIndex))[0];
      return source?.hsX ?? null;
    };
    const hsX = ownHs ?? inferredHs();
    if (hsX === null) throw new MoroccoBundleError('column_detection_failed', `TDI chapter ${chapter} page ${page.page_number}: no subheading column could be established.`);
    const at = (key: 'd78' | 'd910' | 'rate') => { const own = learned?.[key]; if (own != null) return hsX + own; const other = borrow(pageIndex, key); return other ? hsX + other.offset : undefined; };
    const d78X = at('d78'), d910X = at('d910');
    // The printed rates locate the rate column better than a header centred above it.
    const droitX = at('rate') ?? droit?.x;
    if (d78X === undefined || d910X === undefined || droitX === undefined) throw new MoroccoBundleError('column_detection_failed', `TDI chapter ${chapter} page ${page.page_number}: code or rate columns could not be established.`);
    const hs = hsX;
    debug?.(page.page_number, `columns hs=${hs.toFixed(1)} d78=${d78X.toFixed(1)} d910=${d910X.toFixed(1)} droit=${droitX.toFixed(1)}`);
    const descStart = d910X + 10;
    for (const row of pageRows) {
      const codeItems = row.items.filter(item => item.x >= hs - 4 && item.x < descStart);
      // A code can be split into abutting items ("7" + "117.19"); they are merged before being read.
      const merged: MoroccoItem[] = [];
      for (const item of codeItems) { const last = merged.at(-1); if (last && item.x > last.x + 1 && item.x - (last.x + last.w) <= 1 && !/\s$/.test(last.str)) merged[merged.length - 1] = { ...last, str: last.str + item.str, w: item.x + item.w - last.x }; else merged.push(item); }
      // Code cells hold only digits and dots; a row with words in the code column is note prose.
      const allTokens = merged.flatMap(words), tokens = allTokens.some(token => /\p{L}/u.test(token.text)) ? [] : allTokens;
      const cell = RATE_CELL.exec(join(row.items.filter(item => item.x >= droitX - 16 && item.x < droitX + 75 && !LEADER.test(item.str.trim()))));
      const desc = join(row.items.filter(item => item.x >= descStart && item.x < droitX - 16 && !LEADER.test(item.str.trim())));
      const footnote = /^\(([a-z])\)\s+(.{12,})$/.exec(desc);
      if (footnote && !tokens.length) { footnotes.set(footnote[1]!, footnote[2]!); continue; }
      let rowHs: string | null = null, rowD78: string | null = null, rowD910: string | null = null;
      for (const [index, token] of tokens.entries()) {
        if (HS6.test(token.text) || (/^\d{6}$/.test(token.text) && Math.abs(token.x - hs) < 12)) { rowHs = token.text.replace(/\./g, ''); continue; }
        if (!/^\d{2}$/.test(token.text)) continue;
        // Within one item the order decides; across items the column decides.
        const afterHs = tokens.slice(0, index).some(prior => HS6.test(prior.text) || (/^\d{6}$/.test(prior.text) && Math.abs(prior.x - hs) < 12));
        if (afterHs) { if (!rowD78) rowD78 = token.text; else rowD910 = token.text; } else if (Math.abs(token.x - d78X) < Math.abs(token.x - d910X)) rowD78 = token.text; else rowD910 = token.text;
      }
      // The TDI occasionally misprints a national segment in the heading column, left of the subheading.
      const stray = row.items.find(item => /^\d{2}$/.test(item.str.trim()) && item.x >= hs - 40 && item.x < hs - 4);
      if (stray && !rowHs && !rowD78 && rowD910) rowD78 = stray.str.trim();
      if (rowHs) { hs6 = rowHs; d78 = rowD78; } else if (rowD78) d78 = rowD78;
      const rate = cell ? `${cell[1]}${cell[2] ? ` ${cell[2].trim()}` : ''}` : '', unitText = cell?.[3]?.split(/\s+/)[0] ?? null;
      debug?.(page.page_number, `${row.y.toFixed(1)} [${tokens.map(token => `${token.text}@${token.x.toFixed(0)}`).join(' ')}] d910=${rowD910 ?? ''} rate=${rate} unit=${unitText ?? ''} | ${desc.slice(0, 60)}`);
      // A marked line may print only its national segment; its statistical suffix is then read as 00 and flagged, never declared.
      const marker = row.items.some(item => /^\d$/.test(item.str.trim()) && item.x < hs - 12);
      let inferredSuffix = false;
      if (!rowD910 && rowD78 && marker && rate) { rowD910 = '00'; inferredSuffix = true; }
      if (rowD910) {
        if (!hs6) throw new MoroccoBundleError('code_assembly_failed', `TDI chapter ${chapter} page ${page.page_number}: a statistical suffix ${rowD910} has no subheading.`);
        // A subheading printed without its national segment ("8516.60" over suffix-only rows) is read as 00 and flagged; such a line is never declared.
        events.push({ kind: 'code', code: `${hs6}${d78 ?? '00'}${rowD910}`, description: desc, y: row.y - pageIndex * 1000, row_y: row.y, page: page.page_number, inferred: d78 === null || inferredSuffix });
      } else if (desc) { const last = events.findLast(event => event.kind === 'code'); if (last) last.description += ` ${desc}`; }
      if (rate && !(!rowD910 && (rowHs || rowD78) && !inferredSuffix)) events.push({ kind: 'rate', rate, unit: unitText, description: desc, y: row.y - pageIndex * 1000, row_y: row.y, page: page.page_number });
    }
  }
  // Each rate belongs to the code above it, unless it sits just above a code centred in its cell that prints no rate of its own.
  // A rate that neither can claim is a group heading repeating a rate (the TDI prints some in colour); it is recorded, never a line.
  const assigned = new Map<number, { rate: string; unit: string | null; pairing: 'same_row' | 'wrapped' | 'centred' }>(), headingRates: { page: number; y: number; rate: string; description: string; previous: number; next: number }[] = [];
  const sameRowRate = (codeIndex: number) => events[codeIndex + 1]?.kind === 'rate' && events[codeIndex + 1]!.y === events[codeIndex]!.y;
  for (const [index, event] of events.entries()) {
    if (event.kind !== 'rate') continue;
    const nextIndex = events.findIndex((candidate, position) => position > index && candidate.kind === 'code');
    const previousIndex = events.findLastIndex((candidate, position) => position < index && candidate.kind === 'code');
    const centred = nextIndex >= 0 && events[nextIndex]!.y !== event.y && event.y - events[nextIndex]!.y <= 9 && !sameRowRate(nextIndex) && (previousIndex < 0 || assigned.has(previousIndex));
    const owner = centred ? nextIndex : previousIndex >= 0 && !assigned.has(previousIndex) ? previousIndex : -1;
    if (owner < 0) { headingRates.push({ page: event.page, y: event.row_y, rate: event.rate, description: event.description, previous: previousIndex, next: nextIndex }); continue; }
    assigned.set(owner, { rate: event.rate, unit: event.unit, pairing: events[owner]!.y === event.y ? 'same_row' : centred ? 'centred' : 'wrapped' });
  }
    // A rate between two codes neither of which prints a rate on its own row could belong to either: both lines are flagged.
    const uncertain = new Set<number>();
    for (const [index, event] of events.entries()) {
      if (event.kind !== 'rate') continue;
      const previousIndex = events.findLastIndex((candidate, position) => position < index && candidate.kind === 'code');
      const nextIndex = events.findIndex((candidate, position) => position > index && candidate.kind === 'code');
      if (previousIndex < 0 || nextIndex < 0 || events[previousIndex]!.y === event.y || sameRowRate(nextIndex)) continue;
      const between = events.slice(previousIndex + 1, nextIndex).filter(candidate => candidate.kind === 'rate');
      if (between.length === 1 && Math.abs(event.y - events[nextIndex]!.y) < Math.abs(events[previousIndex]!.y - event.y) + 4) { uncertain.add(previousIndex); uncertain.add(nextIndex); }
    }
    // A heading that repeats a rate may equally be a displaced rate, so the lines either side of it are not declared either.
    for (const heading of headingRates) for (const neighbour of [heading.previous, heading.next]) if (neighbour >= 0) uncertain.add(neighbour);
    for (const [index, event] of events.entries()) {
      if (event.kind !== 'code') continue;
      const rate = assigned.get(index), footnote = rate ? /\(([a-z])\)$/.exec(rate.rate)?.[1] ?? null : null;
      out.push({ code: event.code, description: clean(event.description), expression: rate?.rate ?? '', footnote, unit: rate?.unit ?? null, page: event.page, y: event.row_y, inferred_segment: event.inferred, conflicting_expressions: null, pairing: uncertain.has(index) ? 'uncertain' : rate?.pairing ?? 'none' });
    }
  // The TDI occasionally prints a line twice. An identical repeat is merged and recorded; a repeat with another rate is an authority conflict.
  const unique = new Map<string, MoroccoScheduleRow>(), duplicates: string[] = [];
  for (const row of out) {
    if (!row.code.startsWith(chapter)) throw new MoroccoBundleError('chapter_mismatch', `TDI chapter ${chapter} lists ${row.code}.`);
    const prior = unique.get(row.code);
    if (!prior) { unique.set(row.code, row); continue; }
    duplicates.push(row.code);
    if (prior.expression !== row.expression) prior.conflicting_expressions = [...new Set([...(prior.conflicting_expressions ?? [prior.expression]), row.expression])];
  }
  if (!unique.size) {
    if (/R[ée]serv[ée]\s*pour\s*une\s*utilisation\s*future/i.test(pages.map(page => page.text).join(' '))) return { rows: [], footnotes, heading_rates: headingRates.map(({ previous: _p, next: _n, ...rest }) => rest), duplicates, reserved: true };
    throw new MoroccoBundleError('empty_chapter', `TDI chapter ${chapter} yielded no lines.`);
  }
  return { rows: [...unique.values()], footnotes, heading_rates: headingRates.map(({ previous: _p, next: _n, ...rest }) => rest), duplicates, reserved: false };
}

export function moroccoSeason(description: string) {
  const match = SEASON.exec(description);
  if (!match) return null;
  const month = (name: string) => MONTHS[name.toLowerCase()];
  const fromMonth = month(match[2]!), untilMonth = month(match[4]!);
  if (!fromMonth || !untilMonth) return null;
  return { from_month_day: `${fromMonth}-${(match[1] === '1er' ? '1' : match[1]!).padStart(2, '0')}`, until_month_day: `${untilMonth}-${match[3]!.padStart(2, '0')}` };
}

interface Normalized { schedule_lines: MoroccoTariffLine[]; remedies: MoroccoTradeRemedyManifest }
export async function readMoroccoAuthorityBundle(args: { bytes: Buffer; release_identifier: string }): Promise<MoroccoAuthorityBundle> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(args.bytes); } catch { throw new MoroccoBundleError('corrupt_archive', 'Morocco authority bundle is not a readable ZIP.'); }
  let manifest: { acquisition_version?: string; release_identifier?: string; artifacts?: Array<{ name: string; role: string; size_bytes: number; sha256: string }>; rights_evidence?: Record<string, unknown>; scope?: Record<string, unknown>; base_evidence?: Record<string, unknown> };
  try { manifest = JSON.parse(Buffer.from(await zip.file('acquisition.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new MoroccoBundleError('invalid_manifest', 'Morocco acquisition manifest is invalid JSON.'); }
  if (manifest.acquisition_version !== 'ma-adii-public-acquisition-v1' || manifest.release_identifier !== args.release_identifier || manifest.rights_evidence?.law_article !== 'Morocco Law No. 2-00 on Copyright and Related Rights article 8' || manifest.scope?.tariff_treatment_complete !== true || manifest.base_evidence?.chapters !== MOROCCO_EXPECTED_CHAPTERS) {
    throw new MoroccoBundleError('unexpected_acquisition', 'Morocco manifest lacks the reviewed identity, rights or completeness controls.');
  }
  for (const entry of manifest.artifacts ?? []) {
    const bytes = Buffer.from(await zip.file(entry.name)?.async('nodebuffer') ?? []);
    if (bytes.length !== entry.size_bytes || hash(bytes) !== entry.sha256) throw new MoroccoBundleError('artifact_hash_mismatch', `Morocco artifact ${entry.name} failed its manifest hash.`);
  }
  let normalized: Normalized;
  try { normalized = JSON.parse(Buffer.from(await zip.file('normalized.json')?.async('nodebuffer') ?? []).toString('utf8')); } catch { throw new MoroccoBundleError('invalid_normalized', 'Morocco normalized artifact is invalid JSON.'); }
  const schedule = new Map(normalized.schedule_lines.map(line => [line.code, line]));
  if (!schedule.size || schedule.size !== normalized.schedule_lines.length) throw new MoroccoBundleError('invalid_schedule', 'Morocco normalized schedule is empty or has duplicate codes.');
  // Chapter 77 is reserved in the Harmonized System and carries no line.
  if (new Set(normalized.schedule_lines.map(line => line.chapter)).size !== MOROCCO_EXPECTED_CHAPTERS - 1) throw new MoroccoBundleError('incomplete_schedule', 'Morocco normalized schedule does not cover every TDI chapter.');
  validateMoroccoRemedyManifest(normalized.remedies);
  return {
    checksum: hash(args.bytes), size_bytes: args.bytes.length, release_identifier: args.release_identifier, source_url: 'https://www.douane.gov.ma/tarif/tarif/init.jsf',
    files: (manifest.artifacts ?? []).map(x => ({ name: x.name, role: x.role, size_bytes: x.size_bytes, sha256: x.sha256 })),
    schedule_lines: schedule, remedies: normalized.remedies, reader_version: MOROCCO_BUNDLE_READER_VERSION, parser_version: MOROCCO_PARSER_VERSION,
  };
}
