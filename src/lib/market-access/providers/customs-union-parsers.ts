/**
 * D-028 — readers for the three customs-union tariffs whose members apply one common external
 * tariff: the EAEU Common Customs Tariff, the ECOWAS common external tariff (UEMOA edition) and
 * the EAC common external tariff with its yearly Gazette. Pure: extracted PDF text items (pdfjs
 * coordinates, `pdf-table-family.ts`) or the official HTML in, published lines out. Nothing here
 * decides what a member pays; `customs-union-sources.ts` assembles the lines and their exceptions.
 *
 * Each reader finds its columns from the page's own header row (the ECOWAS/UEMOA "DD" column, the
 * EAC "Rate" column) rather than fixed positions, ties every rate to the code row it sits in (a
 * description may wrap several lines, with the rate printed on any of them), and fails loudly when
 * a code row has no rate or two rows for one code disagree.
 */
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { PdfTablePage, PdfTextItem } from './pdf-table-family';

export class CustomsUnionParseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CustomsUnionParseError';
  }
}

/** One line as the union publishes it, before exceptions are applied. */
export interface UnionSourceLine {
  code: string;
  description: string;
  unit: string | null;
  /** The rate exactly as printed (after joining wrapped cell text). */
  raw_rate: string;
  /** Where in the source it was read: a PDF page, or the HTML row. */
  locator: string;
  /** Footnote marks printed beside the rate (EAEU "7С)"), which change or condition it. */
  notes?: readonly string[];
}

const clean = (value: string) => value.replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
const byReadingOrder = (a: PdfTextItem, b: PdfTextItem) => b.y - a.y || a.x - b.x;

function header(items: readonly PdfTextItem[], pattern: RegExp) {
  return items.filter((item) => pattern.test(clean(item.str))).sort((a, b) => b.y - a.y)[0];
}

/** Items in visual lines (y within `tolerance`), each line left to right, top to bottom. */
function visualText(items: readonly PdfTextItem[], tolerance = 4) {
  const lines: PdfTextItem[][] = [];
  for (const item of [...items].sort(byReadingOrder)) {
    const line = lines.find((candidate) => Math.abs(candidate[0]!.y - item.y) <= tolerance);
    if (line) line.push(item); else lines.push([item]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x).map((item) => clean(item.str)).join(' ')).join(' ').replace(/\s+/g, ' ').trim();
}

function addLine(lines: Map<string, UnionSourceLine>, line: UnionSourceLine, label: string) {
  const prior = lines.get(line.code);
  if (!prior) { lines.set(line.code, line); return; }
  if (clean(prior.raw_rate) !== clean(line.raw_rate)) throw new CustomsUnionParseError('conflicting_duplicate_line', `${label} prints ${line.code} twice with different rates (${prior.locator}: ${prior.raw_rate}; ${line.locator}: ${line.raw_rate}).`);
}

// --- ECOWAS common external tariff, UEMOA edition (TEC 2022 v4) ---------------------------------

const UEMOA_CODE = /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/;

/**
 * The UEMOA TEC prints, per ten-digit national line, the unit (US) and the duties DD (the common
 * external tariff), RS, PCS and PC (statistical, UEMOA and ECOWAS levies). Only DD is the tariff;
 * the levies are charged on top. Codes sit at the left margin (x < 130); a page without the
 * DD/RS/US header row is a notes page.
 */
export function parseUemoaTecPages(pages: readonly PdfTablePage[]) {
  const lines = new Map<string, UnionSourceLine>();
  let dataPages = 0;
  for (const page of pages) {
    const codes = page.items.filter((item) => UEMOA_CODE.test(clean(item.str)) && item.x < 130).sort(byReadingOrder);
    if (!codes.length) continue;
    const dd = header(page.items, /^DD$/), rs = header(page.items, /^RS$/), us = header(page.items, /^US$/);
    if (!dd || !rs || !us) throw new CustomsUnionParseError('missing_header', `UEMOA TEC page ${page.page_number} has tariff codes but no DD/RS/US header row.`);
    dataPages += 1;
    const ddLeft = (us.x + dd.x) / 2, ddRight = (dd.x + rs.x) / 2, unitLeft = us.x - 15;
    codes.forEach((anchor, index) => {
      const top = anchor.y + 3, bottom = index + 1 < codes.length ? codes[index + 1]!.y + 1 : 0;
      const band = page.items.filter((item) => item.y <= top && item.y > bottom);
      const code = clean(anchor.str).replace(/\D/g, '');
      const values = [...new Set(band.filter((item) => item.x >= ddLeft && item.x < ddRight).map((item) => clean(item.str)).filter(Boolean))];
      if (values.length !== 1 || !/^\d{1,2}(?:,\d+)?$/.test(values[0]!)) throw new CustomsUnionParseError('missing_rate', `UEMOA TEC ${code} (page ${page.page_number}) has no single DD rate: ${JSON.stringify(values)}.`);
      const unit = clean(band.filter((item) => item.x >= unitLeft && item.x < ddLeft).sort(byReadingOrder).map((item) => item.str).join(' '));
      const description = clean(band.filter((item) => item.x > anchor.x + 60 && item.x < unitLeft).sort(byReadingOrder).map((item) => item.str).join(' '));
      addLine(lines, { code, description, unit: unit || null, raw_rate: values[0]!, locator: `p.${page.page_number}` }, 'The UEMOA TEC');
    });
  }
  if (!dataPages) throw new CustomsUnionParseError('missing_table', 'No UEMOA TEC tariff page was found.');
  return { lines: [...lines.values()], data_pages: dataPages };
}

// --- EAC common external tariff 2022 (Schedules 1 and 2) -----------------------------------------

const EAC_CODE = /^\d{4}\.\d{2}\.\d{2}$/;
interface EacLayout { code_x: number; rate_x: number; unit_x: number | null }

/**
 * Schedule 1 prints code, description, unit and rate (0/10/25/35%, a mixed rate, or "SI" for a
 * sensitive item whose rate is in Schedule 2); Schedule 2 prints code, description and rate. Odd
 * and even pages are offset, and a continuation page may omit the header row, so a page without
 * one uses the last headed page whose codes sit in the same place. Reading stops at the first
 * legal notice appended after the schedules.
 */
export function parseEacCetPages(pages: readonly PdfTablePage[]) {
  const schedules = { 1: new Map<string, UnionSourceLine>(), 2: new Map<string, UnionSourceLine>() };
  const layouts: Array<EacLayout & { schedule: 1 | 2 }> = [];
  let schedule: 1 | 2 = 1;
  for (const page of pages) {
    const text = page.items.map((item) => item.str).join(' ');
    if (/SCHEDULE 2/.test(text) && /SENSITIVE ITEMS/.test(text)) schedule = 2;
    if (/Legal Notice No\. EAC\//.test(text) && schedules[1].size) break;
    const codeHead = header(page.items, /^H\.S\. Code \/$/), rateHead = header(page.items, /^Rate$/), unitHead = header(page.items, /^Unit of$/);
    let layout: EacLayout | undefined;
    let headerY = page.height;
    if (codeHead && rateHead && (schedule === 2 || unitHead)) {
      layout = { code_x: codeHead.x, rate_x: rateHead.x, unit_x: schedule === 1 ? unitHead!.x : null };
      layouts.push({ ...layout, schedule });
      headerY = codeHead.y - 5;
    } else {
      const loose = page.items.filter((item) => EAC_CODE.test(clean(item.str)) && item.x < 200);
      if (!loose.length) continue;
      layout = [...layouts].reverse().find((known) => known.schedule === schedule && loose.every((item) => Math.abs(item.x - known.code_x) < 6));
      if (!layout) throw new CustomsUnionParseError('missing_header', `EAC CET page ${page.page_number} has tariff codes but no header row and no earlier page with the same layout.`);
    }
    const codes = page.items.filter((item) => EAC_CODE.test(clean(item.str)) && Math.abs(item.x - layout!.code_x) < 12 && item.y < headerY).sort(byReadingOrder);
    if (!codes.length) continue;
    const headings = page.items.filter((item) => /^\d{2}\.\d{2}$/.test(clean(item.str)) && item.x < layout.code_x - 20 && item.y < headerY);
    const rateLeft = Math.max(layout.unit_x == null ? 0 : layout.unit_x + 22, layout.rate_x - 40);
    codes.forEach((anchor, index) => {
      const top = anchor.y + 3;
      const nextCode = index + 1 < codes.length ? codes[index + 1]!.y : 60;
      const nextHeading = Math.max(...headings.filter((item) => item.y < anchor.y - 1).map((item) => item.y), Number.NEGATIVE_INFINITY);
      const bottom = Math.max(nextCode, nextHeading) + 1;
      const band = page.items.filter((item) => item.y <= top && item.y > bottom).sort(byReadingOrder);
      const code = clean(anchor.str).replace(/\D/g, '');
      const rate = clean(band.filter((item) => item.x >= rateLeft).map((item) => item.str).join(' '));
      if (!rate) throw new CustomsUnionParseError('missing_rate', `EAC CET ${code} (page ${page.page_number}, schedule ${schedule}) has no rate.`);
      const unitLeft = layout!.unit_x == null ? rateLeft : layout!.unit_x - 12;
      const unit = layout!.unit_x == null ? '' : clean(band.filter((item) => item.x >= unitLeft && item.x < rateLeft).map((item) => item.str).join(' '));
      const description = clean(band.filter((item) => item.x > anchor.x + 40 && item.x < unitLeft).map((item) => item.str).join(' '));
      addLine(schedules[schedule], { code, description, unit: unit || null, raw_rate: rate, locator: `p.${page.page_number}` }, `EAC CET Schedule ${schedule}`);
    });
  }
  if (!schedules[1].size) throw new CustomsUnionParseError('missing_table', 'No EAC CET Schedule 1 page was found.');
  return { schedule_1: [...schedules[1].values()], schedule_2: [...schedules[2].values()] };
}

// --- EAC Gazette: the year's measures (Legal Notice "Approved measures on import duty rates") -----

export const EAC_PARTNER_STATES: Readonly<Record<string, string>> = Object.freeze({ Burundi: 'BI', Kenya: 'KE', Rwanda: 'RW', Tanzania: 'TZ', Uganda: 'UG', 'South Sudan': 'SS', Congo: 'CD', Somalia: 'SO' });

export interface EacGazetteMeasures {
  notice: string;
  /** CET rates amended for every partner state (the "amendment to duty rates" table). */
  amendments: { code: string; raw_rate: string; locator: string }[];
  /**
   * Lines named in a stay of application or a specified national rate, by partner state. An
   * empty `members` list means the table's rows name partner states individually and are applied
   * to all of them: the row-to-state attribution is not read.
   */
  stays: { code: string; members: readonly string[]; table: string; locator: string }[];
}

const ROMAN = /^TABLE ([IVX]+)\s*:/;

/**
 * Reads one Legal Notice of approved measures: every code under each table, the partner state a
 * table is for when its title names exactly one (the national stays), and the new rate of each
 * row of the amendment table — "Amend EAC CET duty rate from A to “B”" — tied to its row by the
 * row's serial number. Duty remission notices are not read: they are conditional on registered
 * manufacturers, not a rate an exporter's buyer pays.
 */
export function parseEacGazettePages(pages: readonly PdfTablePage[], notice: string): EacGazetteMeasures {
  const measures: EacGazetteMeasures = { notice, amendments: [], stays: [] };
  let inNotice = false;
  let table: { id: string; title: string; members: string[]; amendment: boolean } | null = null;
  const amendmentRows: { page: PdfTablePage; items: PdfTextItem[] }[] = [];
  for (const page of pages) {
    const ordered = [...page.items].sort(byReadingOrder);
    const pageAmendment: PdfTextItem[] = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const item = ordered[index]!;
      const text = clean(item.str);
      const legal = /Legal Notice No\. (EAC\/\d+\/\d{4})/.exec(text);
      if (legal) { inNotice = legal[1] === notice; table = null; continue; }
      if (!inNotice) continue;
      const roman = ROMAN.exec(text);
      if (roman) {
        // The title runs on to the column header row ("S/N").
        const titleItems: string[] = [text];
        for (let next = index + 1; next < ordered.length && !/^S\/N$/.test(clean(ordered[next]!.str)); next += 1) titleItems.push(clean(ordered[next]!.str));
        const title = titleItems.join(' ');
        const named = Object.entries(EAC_PARTNER_STATES).filter(([name]) => new RegExp(`\\b${name}\\b`, 'i').test(title)).map(([, code]) => code);
        table = { id: roman[1]!, title, members: named.length === 1 ? named : [], amendment: /AMENDMENT TO DUTY RATES/i.test(title) };
        continue;
      }
      if (!table) continue;
      if (table.amendment) { pageAmendment.push(item); continue; }
      for (const match of text.matchAll(/\b(\d{4}\.\d{2}\.\d{2})\b/g)) {
        measures.stays.push({ code: match[1]!.replace(/\D/g, ''), members: table.members, table: table.id, locator: `p.${page.page_number}` });
      }
    }
    // The running head and folio are not table rows.
    const body = pageAmendment.filter((item) => item.y < page.height - 60 && item.y > 40);
    if (body.length) amendmentRows.push({ page, items: body });
  }
  for (const { page, items } of amendmentRows) {
    const serials = items.filter((item) => /^\d{1,3}\.?$/.test(clean(item.str)) && item.x < 75).sort(byReadingOrder);
    serials.forEach((serial, index) => {
      const upper = index === 0 ? Number.POSITIVE_INFINITY : (serials[index - 1]!.y + serial.y) / 2;
      const lower = index + 1 < serials.length ? (serial.y + serials[index + 1]!.y) / 2 : Number.NEGATIVE_INFINITY;
      const row = items.filter((item) => item.y < upper && item.y >= lower);
      const codes = row.filter((item) => EAC_CODE.test(clean(item.str))).map((item) => clean(item.str).replace(/\D/g, ''));
      const decision = visualText(row.filter((item) => item.x > 300)).replace(/\bm 2\b/g, 'm2');
      const quoted = /[“"]([^”"]+)[”"]/.exec(decision);
      if (codes.length !== 1 || !quoted) throw new CustomsUnionParseError('unreadable_amendment', `EAC Gazette ${notice} amendment row ${clean(serial.str)} (page ${page.page_number}) has ${codes.length} codes and ${quoted ? 'a' : 'no'} quoted new rate: ${decision}`);
      measures.amendments.push({ code: codes[0]!, raw_rate: clean(quoted[1]!), locator: `p.${page.page_number} ${notice} amendment ${clean(serial.str).replace(/\.$/, '')}` });
    });
  }
  return measures;
}

// --- EAEU Common Customs Tariff (Council Decision No. 80, consolidated HTML) --------------------

const decodeHtml = (value: string) => clean(value
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
  .replace(/&quot;/gi, '"').replace(/&laquo;/gi, '«').replace(/&raquo;/gi, '»').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—')
  .replace(/&amp;/gi, '&'));

/**
 * Every row of the tariff tables whose first cell is a ten-digit code ("0910 99 330 0"): the
 * description, the unit and the import duty rate, which is a percentage of the customs value, an
 * amount in euro per unit, or both. A footnote mark printed with the rate ("10 7С)") is kept: the
 * note it points to sets a temporary or conditional rate that is not read here.
 */
export function parseEaeuCctHtml(html: string) {
  const lines = new Map<string, UnionSourceLine>();
  let row = 0;
  for (const match of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    row += 1;
    const cells = [...match[1]!.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decodeHtml(cell[1]!));
    if (cells.length < 4 || !/^\d{4} \d{2} \d{3} \d$/.test(cells[0]!)) continue;
    const code = cells[0]!.replace(/\D/g, '');
    let rate = cells[cells.length - 1]!;
    const notes = [...rate.matchAll(/(\d+)\s*[СCс]\s*\)/g)].map((note) => `${note[1]}С`);
    rate = clean(rate.replace(/\d+\s*[СCс]\s*\)\s*\)?/g, ''));
    addLine(lines, { code, description: cells[1]!, unit: cells[cells.length - 2] && cells[cells.length - 2] !== '–' ? cells[cells.length - 2]! : null, raw_rate: rate, locator: `row ${row}`, ...(notes.length ? { notes } : {}) }, 'The EAEU Common Customs Tariff');
  }
  if (!lines.size) throw new CustomsUnionParseError('missing_table', 'No EAEU tariff row was found.');
  return [...lines.values()];
}

// --- Rates -----------------------------------------------------------------------------------------

const toNumber = (value: string) => Number(value.replace(/\s+/g, '').replace(',', '.'));
function duty(expression: string, fields: Partial<ParsedDuty>): ParsedDuty {
  return {
    kind: fields.kind ?? 'unparsed', ad_valorem_rate_percent: fields.ad_valorem_rate_percent ?? null,
    specific_amount: fields.specific_amount ?? null, specific_currency: fields.specific_currency ?? null,
    specific_unit: fields.specific_unit ?? null, specific_unit_quantity: fields.specific_unit_quantity ?? null,
    expression, note: fields.note ?? null,
  };
}

const EAEU_UNITS: Readonly<Record<string, string>> = { кг: 'kg', л: 'litre', пару: 'pair', шт: 'item', 'м2': 'm2', 'м²': 'm2', 'см3': 'cm3', 'см³': 'cm3' };
function eaeuUnit(raw: string) {
  const unit = clean(raw).replace(/\s+объема двигателя$/, '').replace(/\s/g, '');
  return EAEU_UNITS[unit] ?? null;
}

/**
 * One published rate as a duty. Ad-valorem, specific (EUR in the EAEU, USD in the EAC) and "the
 * higher of" forms are read with every operand; anything else is kept verbatim as unparsed.
 */
export function parseUnionRate(raw: string, union: 'EAEU' | 'ECOWAS' | 'EAC'): ParsedDuty {
  const value = clean(raw).replace(/\s+%/g, '%');
  if (!value) return duty('', { kind: 'none', note: 'The rate cell is blank.' });
  if (union === 'ECOWAS') {
    return /^\d{1,2}(?:,\d+)?$/.test(value) ? duty(`${toNumber(value)}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: toNumber(value) }) : duty(value, { note: 'Not a published DD percentage.' });
  }
  if (union === 'EAEU') {
    if (/^\d+(?:,\d+)?$/.test(value)) return duty(`${toNumber(value)}%`, { kind: 'ad_valorem', ad_valorem_rate_percent: toNumber(value) });
    const specific = /^(\d+(?:,\d+)?) евро за (\d+) (.+)$/.exec(value);
    if (specific && eaeuUnit(specific[3]!)) return duty(value, { kind: 'specific', specific_amount: toNumber(specific[1]!), specific_currency: 'EUR', specific_unit: eaeuUnit(specific[3]!), specific_unit_quantity: Number(specific[2]) });
    const atLeast = /^(\d+(?:,\d+)?), но не менее (\d+(?:,\d+)?) евро за (\d+) (.+)$/.exec(value);
    if (atLeast && eaeuUnit(atLeast[4]!)) return duty(value, { kind: 'mixed', ad_valorem_rate_percent: toNumber(atLeast[1]!), specific_amount: toNumber(atLeast[2]!), specific_currency: 'EUR', specific_unit: eaeuUnit(atLeast[4]!), specific_unit_quantity: Number(atLeast[3]), note: 'The higher of the ad-valorem and the specific amount applies; no ad-valorem equivalent is invented.' });
    const plus = /^(\d+(?:,\d+)?) плюс (\d+(?:,\d+)?) евро за (\d+) (.+)$/.exec(value);
    if (plus && eaeuUnit(plus[4]!)) return duty(value, { kind: 'compound', ad_valorem_rate_percent: toNumber(plus[1]!), specific_amount: toNumber(plus[2]!), specific_currency: 'EUR', specific_unit: eaeuUnit(plus[4]!), specific_unit_quantity: Number(plus[3]), note: 'The ad-valorem and specific amounts are added; no ad-valorem equivalent is invented.' });
    return duty(value, { note: 'An EAEU rate form outside the qualified ones.' });
  }
  // EAC
  if (/^(?:Ex|Free|Exempt)$/i.test(value)) return duty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: 0, note: 'Published as exempt.' });
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
  if (percent) return duty(value, { kind: 'ad_valorem', ad_valorem_rate_percent: Number(percent[1]) });
  const higher = /^(\d+(?:\.\d+)?)% or (?:US\s?\$|USD|\$)\s*(\d+(?:\.\d+)?)\s*(?:\/|per)\s*(MT|KG|kg|liter|litre|m2|SQM|metre|pair|unit)\s*,?\s*whichever is higher$/i.exec(value);
  if (higher) {
    const units: Record<string, [string, number]> = { mt: ['kg', 1000], kg: ['kg', 1], liter: ['litre', 1], litre: ['litre', 1], m2: ['m2', 1], sqm: ['m2', 1], metre: ['metre', 1], pair: ['pair', 1], unit: ['item', 1] };
    const [unit, quantity] = units[higher[3]!.toLowerCase()]!;
    return duty(value, { kind: 'mixed', ad_valorem_rate_percent: Number(higher[1]), specific_amount: Number(higher[2]), specific_currency: 'USD', specific_unit: unit, specific_unit_quantity: quantity, note: 'The higher of the ad-valorem and the specific amount applies; no ad-valorem equivalent is invented.' });
  }
  return duty(value, { note: 'An EAC rate form outside the qualified ones.' });
}
