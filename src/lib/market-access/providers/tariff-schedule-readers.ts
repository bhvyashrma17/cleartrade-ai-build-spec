/**
 * D-030 — readers for the national tariff schedules automated in cluster 1: the GCC unified
 * customs tariff as Dubai Customs publishes it, the UAE's CEPA schedule for Indian goods, China's
 * 2026 import tariff with its provisional-rate annex, and Brazil's CAMEX workbook (the Mercosur
 * common external tariff with Brazil's own rates and exception lists).
 *
 * Pure: extracted PDF text items (pdfjs coordinates, `pdf-table-family.ts`) or the workbook bytes
 * in, rows as published out. Nothing here decides what a market pays; `tariff-schedule-sources.ts`
 * assembles the lines. Each reader ties every value to the code row it belongs to and fails loudly
 * on a repeated code, a row without its values, or a layout it was not measured on.
 */
import type ExcelJS from 'exceljs';
import type { PdfTablePage, PdfTextItem } from './pdf-table-family';

export class TariffScheduleParseError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'TariffScheduleParseError';
  }
}

const clean = (value: string) => value.replace(/[     ]/g, ' ').replace(/\s+/g, ' ').trim();

interface VisualLine { y: number; items: PdfTextItem[] }

/** Items grouped into visual lines (y within `tolerance`), top to bottom, each left to right. */
export function visualLines(items: readonly PdfTextItem[], tolerance = 2.5): VisualLine[] {
  const lines: VisualLine[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - item.y) <= tolerance) last.items.push(item);
    else lines.push({ y: item.y, items: [item] });
  }
  for (const line of lines) line.items.sort((a, b) => a.x - b.x);
  return lines;
}

const within = (line: VisualLine, from: number, to: number) => line.items.filter((item) => item.x >= from && item.x < to);

/** A number the PDF prints as separate glyph runs ("1", "4" for 14) is joined back; other items stay apart. */
function joinNumberFragments(items: readonly PdfTextItem[]): PdfTextItem[] {
  const out: PdfTextItem[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && /^[\d.]+$/.test(clean(last.str)) && /^[\d.]+$/.test(clean(item.str)) && item.x - last.x < 12) out[out.length - 1] = { ...last, str: `${clean(last.str)}${clean(item.str)}` };
    else out.push(item);
  }
  return out;
}
const text = (items: readonly PdfTextItem[]) => clean(items.map((item) => item.str).join(' '));

// --- GCC unified customs tariff (Dubai Customs, 12-digit) ---------------------------------------

export interface GccTariffRow {
  /** Twelve digits, spaces removed. */
  code: string;
  description: string;
  unit: string | null;
  /** As printed: "5%", "0%", "100%", "PROHIBITED", "special goods"; empty if no rate is printed. */
  raw_rate: string;
  locator: string;
}

const GCC_CODE = /^\d{2}(?: \d{2}){5}$/;
const GCC_RATE = /^(?:\d+(?:\.\d+)?%?|PROHIBITED|special goods)$/i;

/**
 * The Dubai Customs "Integrated Customs Tariff" PDF (an Excel export, 1267 × 1791 points): the code
 * column at x ≈ 1021, English description from x ≈ 240, unit at x ≈ 140–210 and the duty at x < 120.
 * A duty printed beside a wrapped description sits up to a line above or below its code, so each
 * rate goes to the nearest code row on its page.
 */
export function parseGccIntegratedTariffPages(pages: readonly PdfTablePage[]): GccTariffRow[] {
  const rows = new Map<string, GccTariffRow>();
  for (const page of pages) {
    const lines = visualLines(page.items);
    const codeRows: { y: number; row: GccTariffRow }[] = [];
    for (const line of lines) {
      const code = within(line, 990, 1100).find((item) => GCC_CODE.test(clean(item.str)));
      if (!code) continue;
      const row: GccTariffRow = {
        code: clean(code.str).replace(/ /g, ''),
        description: text(within(line, 240, 620)),
        unit: text(within(line, 120, 240).filter((item) => /[A-Za-z]/.test(item.str))) || null,
        raw_rate: '',
        locator: `p.${page.page_number}`,
      };
      if (rows.has(row.code)) throw new TariffScheduleParseError('duplicate_code', `The GCC tariff prints ${row.code} twice (${rows.get(row.code)!.locator}, p.${page.page_number}).`);
      codeRows.push({ y: code.y, row });
    }
    const rates = page.items.filter((item) => item.x < 120 && GCC_RATE.test(clean(item.str)));
    for (const rate of rates) {
      let best: { y: number; row: GccTariffRow } | null = null;
      for (const candidate of codeRows) if (Math.abs(candidate.y - rate.y) <= 12 && (!best || Math.abs(candidate.y - rate.y) < Math.abs(best.y - rate.y))) best = candidate;
      if (!best) continue;
      if (best.row.raw_rate && clean(best.row.raw_rate) !== clean(rate.str)) throw new TariffScheduleParseError('conflicting_rate', `Two rates sit beside ${best.row.code} on p.${page.page_number}.`);
      best.row.raw_rate = clean(rate.str);
    }
    for (const { row } of codeRows) rows.set(row.code, row);
  }
  return [...rows.values()];
}

// --- UAE schedule of tariff commitments under the India–UAE CEPA (Annex 2B) -------------------

export interface CepaScheduleRow {
  /** Eight digits (the schedule drops leading zeros; they are restored). */
  code: string;
  description: string;
  /** The UAE base rate as printed: a number, "Prohibited" or "Special goods". */
  base: string;
  /** Staging category: A, C, E, F, G, TR, "H Special goods". */
  category: string;
  /** Years 1 to 10 as printed: a number, "EXC", "Prohibited" or "Special goods". */
  years: string[];
  locator: string;
}

const CEPA_YEAR_COLUMNS = [391.6, 434.1, 476.5, 519.0, 561.5, 604.0, 646.5, 689.0, 731.5, 779.5] as const;

/** Annex 2B as published (842 × 595 landscape): Sl. No., product code, description, base rate, offer, Year 1–10. */
export function parseUaeCepaSchedulePages(pages: readonly PdfTablePage[]): CepaScheduleRow[] {
  const rows = new Map<string, CepaScheduleRow>();
  for (const page of pages) {
    const header = page.items.some((item) => clean(item.str) === 'Year 10') && page.items.some((item) => clean(item.str) === 'Offer');
    if (!header) continue;
    for (const line of visualLines(page.items, 2)) {
      const code = within(line, 62, 100).find((item) => /^\d{7,8}$/.test(clean(item.str)));
      if (!code) continue;
      const years = CEPA_YEAR_COLUMNS.map((x) => clean(line.items.filter((item) => Math.abs(item.x - x) < 18).map((item) => item.str).join(' ')));
      if (years.some((value) => !value)) throw new TariffScheduleParseError('missing_year', `The CEPA schedule row ${clean(code.str)} on p.${page.page_number} lacks a year's rate.`);
      const row: CepaScheduleRow = {
        code: clean(code.str).padStart(8, '0'), description: text(within(line, 100, 300)),
        base: text(within(line, 300, 345)), category: text(within(line, 345, 380)), years, locator: `p.${page.page_number}`,
      };
      if (!row.base || !row.category) throw new TariffScheduleParseError('missing_value', `The CEPA schedule row ${row.code} on p.${page.page_number} lacks its base rate or offer.`);
      if (rows.has(row.code)) throw new TariffScheduleParseError('duplicate_code', `The CEPA schedule prints ${row.code} twice.`);
      rows.set(row.code, row);
    }
  }
  return [...rows.values()];
}

// --- China: Customs Import and Export Tariff (2026) -------------------------------------------

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
const CN_CODE = /^(ex)?(\d{4}\.\d{4})$/;
const CN_RATE = new RegExp(`^(?:\\d+(?:\\.\\d+)?|[${CIRCLED}])$`);
const PROVISIONAL_MARK = /^[∆△]$/;

export interface ChinaTariffRow {
  code: string;
  /** "ex" printed before the code: the rate covers only the goods the description names. */
  ex: boolean;
  description: string;
  /** The most-favoured-nation rate: a number, or the footnote text when the cell holds a footnote. */
  mfn: string;
  /** Footnote attached beside a printed MFN number (a tariff-quota rate), if any. */
  mfn_note: string | null;
  /** The provisional rate printed after "△", or its footnote text. */
  provisional: string | null;
  /** The Asia-Pacific Trade Agreement rate (code AP) from the agreement column, or its footnote text. */
  apta: string | null;
  locator: string;
}

function chinaFootnotes(lines: readonly VisualLine[]) {
  const notes = new Map<string, string>();
  for (const line of lines) {
    const first = line.items[0];
    if (!first || first.x >= 100) continue;
    const mark = clean(first.str);
    if (mark.length !== 1 || !CIRCLED.includes(mark)) continue;
    notes.set(mark, text(line.items.slice(1)));
  }
  return notes;
}

const isFootnoteLine = (line: VisualLine) => {
  const first = line.items[0];
  return !!first && first.x < 100 && clean(first.str).length === 1 && CIRCLED.includes(clean(first.str));
};

/**
 * The tariff book (A4 portrait): 序号 x ≈ 44, 税则号列 x ≈ 62 (sometimes printed in two pieces), 货品名称
 * x ≈ 100–228, 最惠国税率 x ≈ 228–270 (right-aligned; a provisional rate follows "△"), 协定税率 x ≈ 270–466 (each
 * agreement rate opens a line at x < 292, followed by the agreements' Chinese short names and
 * English codes, wrapping onto the lines below), 特惠税率 x ≈ 466–508, 普通税率 x ≥ 508. A circled
 * number in a rate cell refers to the footnote of that number at the foot of the same page.
 */
export function parseChinaTariffPages(pages: readonly PdfTablePage[]): ChinaTariffRow[] {
  const rows = new Map<string, ChinaTariffRow>();
  for (const page of pages) {
    const lines = visualLines(page.items);
    if (!lines.some((line) => /税则号列/.test(text(line.items)))) continue;
    const notes = chinaFootnotes(lines);
    const resolve = (value: string, where: string) => {
      if (value.length === 1 && CIRCLED.includes(value)) {
        const note = notes.get(value);
        if (!note) throw new TariffScheduleParseError('missing_footnote', `${where} refers to footnote ${value}, which p.${page.page_number} does not print.`);
        return note;
      }
      return value;
    };
    let current: { row: ChinaTariffRow; agreement: { rate: string; codes: string[] }[] } | null = null;
    const finish = () => {
      if (!current) return;
      const apta = current.agreement.filter((entry) => entry.codes.includes('AP'));
      if (apta.length > 1) throw new TariffScheduleParseError('conflicting_apta', `${current.row.code} prints the AP rate twice.`);
      if (apta.length) current.row.apta = resolve(apta[0]!.rate, `${current.row.code}'s AP rate`);
      if (rows.has(current.row.code)) throw new TariffScheduleParseError('duplicate_code', `The tariff prints ${current.row.code} twice.`);
      rows.set(current.row.code, current.row);
      current = null;
    };
    for (const line of lines) {
      if (isFootnoteLine(line)) { finish(); continue; }
      const code = CN_CODE.exec(within(line, 58, 99).map((item) => clean(item.str)).join(''));
      if (code) {
        finish();
        const mfnItems = joinNumberFragments(within(line, 228, 270)).map((item) => clean(item.str)).filter(Boolean);
        const mark = mfnItems.findIndex((value) => PROVISIONAL_MARK.test(value));
        const base = mark === -1 ? mfnItems : mfnItems.slice(0, mark);
        const provisional = mark === -1 ? [] : mfnItems.slice(mark + 1);
        const where = `${code[2]} (p.${page.page_number})`;
        if (!base.length || base.length > 2 || provisional.length > 1 || (mark !== -1 && !provisional.length)) throw new TariffScheduleParseError('unreadable_mfn', `${where}: the MFN cell reads "${mfnItems.join(' ')}".`);
        const [mfnValue, mfnFootnote] = base;
        if (!CN_RATE.test(mfnValue!)) throw new TariffScheduleParseError('unreadable_mfn', `${where}: the MFN cell reads "${mfnItems.join(' ')}".`);
        if (mfnFootnote && !(mfnFootnote.length === 1 && CIRCLED.includes(mfnFootnote))) throw new TariffScheduleParseError('unreadable_mfn', `${where}: the MFN cell reads "${mfnItems.join(' ')}".`);
        current = {
          row: {
            code: code[2]!.replace('.', ''), ex: !!code[1], description: text(within(line, 99, 228)),
            mfn: resolve(mfnValue!, where), mfn_note: mfnFootnote ? resolve(mfnFootnote, where) : null,
            provisional: provisional.length ? resolve(provisional[0]!, where) : null, apta: null, locator: `p.${page.page_number}`,
          },
          agreement: [],
        };
      }
      if (!current) continue;
      const agreement = joinNumberFragments(within(line, 270, 466));
      if (!agreement.length) continue;
      const first = agreement[0]!;
      let rest = agreement;
      if (first.x < 292 && CN_RATE.test(clean(first.str))) { current.agreement.push({ rate: clean(first.str), codes: [] }); rest = agreement.slice(1); }
      const codes = rest.flatMap((item) => clean(item.str).match(/\b[A-Z]{2}\b/g) ?? []);
      if (codes.length && !current.agreement.length) throw new TariffScheduleParseError('agreement_without_rate', `${current.row.code} (p.${page.page_number}) lists agreements before any agreement rate.`);
      current.agreement[current.agreement.length - 1]?.codes.push(...codes);
    }
    finish();
  }
  return [...rows.values()];
}

export interface ChinaProvisionalEntry {
  code: string;
  ex: boolean;
  description: string;
  mfn: string;
  provisional: string;
  locator: string;
}

/** Annex 1 of the 2026 adjustment plan (进口商品暂定税率表): 序号, EX x ≈ 89, code x ≈ 127, name, MFN x ≈ 466, provisional x ≈ 525. */
export function parseChinaProvisionalAnnexPages(pages: readonly PdfTablePage[]): ChinaProvisionalEntry[] {
  const entries: ChinaProvisionalEntry[] = [];
  for (const page of pages) {
    for (const line of visualLines(page.items)) {
      const code = within(line, 115, 175).find((item) => /^\d{8}$/.test(clean(item.str)));
      if (!code) continue;
      entries.push({
        code: clean(code.str), ex: within(line, 80, 115).some((item) => clean(item.str).toLowerCase() === 'ex'),
        description: text(within(line, 175, 430)), mfn: text(within(line, 430, 495)), provisional: text(within(line, 495, 600)), locator: `p.${page.page_number}`,
      });
    }
  }
  return entries;
}

// --- Brazil: CAMEX workbook, Annexes I–X of Gecex Resolution 272/2021 -------------------------

export interface BrazilTecRow { code: string; description: string; raw: string }
export interface BrazilAppliedRow { code: string; description: string; tec_raw: string; applied_raw: string; basis: string | null }
export interface BrazilExceptionRow {
  annex: 'IV' | 'V' | 'VI' | 'VIII' | 'IX' | 'X';
  code: string;
  /** "-" when the entry covers the whole NCM; otherwise the ex-tarifário number. */
  ex: string;
  description: string;
  raw_rate: string;
  quota: string | null;
  quota_unit: string | null;
  from: string | null;
  to: string | null;
  act: string | null;
}
export interface BrazilCamexData {
  updated_through: string | null;
  tec: BrazilTecRow[];
  applied: BrazilAppliedRow[];
  exceptions: BrazilExceptionRow[];
}

const NCM = /^\d{4}\.\d{2}\.\d{2}$/;

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return clean(value.richText.map((part) => part.text).join(''));
    if ('result' in value) return cellText(value.result as ExcelJS.CellValue);
    if ('text' in value) return clean(String(value.text));
    return '';
  }
  return clean(String(value));
}

function isoDay(value: ExcelJS.CellValue): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const raw = cellText(value);
  if (!raw || raw === '-') return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  throw new TariffScheduleParseError('unreadable_date', `"${raw}" is not a date.`);
}

const EXCEPTION_SHEETS: readonly { prefix: string; annex: BrazilExceptionRow['annex'] }[] = [
  { prefix: 'Anexo IV', annex: 'IV' }, { prefix: 'Anexo V ', annex: 'V' }, { prefix: 'Anexo VI', annex: 'VI' },
  { prefix: 'Anexo VIII', annex: 'VIII' }, { prefix: 'Anexo IX', annex: 'IX' }, { prefix: 'Anexo X', annex: 'X' },
];

/**
 * The CAMEX workbook as published: each annex's header row names its columns (NCM, Nº Ex, Alíquota (%),
 * Quota, Unidade, Início/Término de vigência, Ato de inclusão), and columns are found by those names.
 */
export async function parseBrazilCamexWorkbook(bytes: Buffer): Promise<BrazilCamexData> {
  // Loaded here, not at module load: only the bundle build reads a workbook.
  const { default: Excel } = await import('exceljs');
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  const sheet = (prefix: string) => workbook.worksheets.find((candidate) => candidate.name.startsWith(prefix));
  const tecSheet = sheet('Anexo I ');
  const appliedSheet = sheet('Anexo II');
  if (!tecSheet || !appliedSheet) throw new TariffScheduleParseError('unexpected_workbook', 'The CAMEX workbook lacks Annex I (TEC) or Annex II.');

  const headerOf = (ws: ExcelJS.Worksheet) => {
    for (let index = 1; index <= Math.min(ws.rowCount, 30); index += 1) {
      const row = ws.getRow(index);
      const names = (row.values as ExcelJS.CellValue[]).map((value) => cellText(value).toLowerCase());
      if (names.includes('ncm')) return { index, names };
    }
    throw new TariffScheduleParseError('missing_header', `Sheet "${ws.name}" has no NCM header row.`);
  };
  const column = (names: string[], pattern: RegExp, sheetName: string, required = true) => {
    const found = names.findIndex((name) => pattern.test(name));
    if (found === -1 && required) throw new TariffScheduleParseError('missing_column', `Sheet "${sheetName}" has no column matching ${pattern}.`);
    return found;
  };

  let updatedThrough: string | null = null;
  const tec: BrazilTecRow[] = [];
  {
    const { index, names } = headerOf(tecSheet);
    const [code, description, rate] = [column(names, /^ncm$/, tecSheet.name), column(names, /^descri/, tecSheet.name), column(names, /^tec/, tecSheet.name)];
    for (let r = 1; r < index; r += 1) {
      const note = /Atualizado até (.+)$/i.exec(cellText(tecSheet.getRow(r).getCell(1).value));
      if (note) updatedThrough = clean(note[1]!);
    }
    tecSheet.eachRow((row, number) => {
      if (number <= index) return;
      const value = cellText(row.getCell(code).value);
      if (!NCM.test(value)) return;
      tec.push({ code: value.replace(/\./g, ''), description: cellText(row.getCell(description).value), raw: cellText(row.getCell(rate).value) });
    });
  }
  const applied: BrazilAppliedRow[] = [];
  {
    const { index, names } = headerOf(appliedSheet);
    const code = column(names, /^ncm$/, appliedSheet.name);
    const description = column(names, /^descri/, appliedSheet.name);
    const tecRate = column(names, /^tec/, appliedSheet.name);
    const appliedRate = column(names, /^al[ií]quota aplicada/, appliedSheet.name);
    const basis = column(names, /^fundamenta/, appliedSheet.name, false);
    appliedSheet.eachRow((row, number) => {
      if (number <= index) return;
      const value = cellText(row.getCell(code).value);
      if (!NCM.test(value)) return;
      applied.push({ code: value.replace(/\./g, ''), description: cellText(row.getCell(description).value), tec_raw: cellText(row.getCell(tecRate).value), applied_raw: cellText(row.getCell(appliedRate).value), basis: basis === -1 ? null : cellText(row.getCell(basis).value) || null });
    });
  }
  const exceptions: BrazilExceptionRow[] = [];
  for (const { prefix, annex } of EXCEPTION_SHEETS) {
    const ws = sheet(prefix);
    if (!ws) throw new TariffScheduleParseError('unexpected_workbook', `The CAMEX workbook lacks Annex ${annex}.`);
    const { index, names } = headerOf(ws);
    const code = column(names, /^ncm$/, ws.name);
    const ex = column(names, /^n[ºo°]\s*ex/, ws.name);
    const rate = column(names, /^al[ií]quota/, ws.name);
    const description = column(names, /^descri/, ws.name);
    const quota = column(names, /^quota/, ws.name, false);
    const unit = column(names, /^unidade/, ws.name, false);
    const from = column(names, /^in[ií]cio/, ws.name, false);
    const to = column(names, /^t[ée]rmino/, ws.name, false);
    const act = column(names, /^ato/, ws.name, false);
    ws.eachRow((row, number) => {
      if (number <= index) return;
      const value = cellText(row.getCell(code).value);
      if (!NCM.test(value)) return;
      const optional = (col: number) => { if (col === -1) return null; const v = cellText(row.getCell(col).value); return v && v !== '-' ? v : null; };
      exceptions.push({
        annex, code: value.replace(/\./g, ''), ex: cellText(row.getCell(ex).value) || '-', description: cellText(row.getCell(description).value),
        raw_rate: cellText(row.getCell(rate).value), quota: optional(quota), quota_unit: optional(unit),
        from: from === -1 ? null : isoDay(row.getCell(from).value), to: to === -1 ? null : isoDay(row.getCell(to).value), act: optional(act),
      });
    });
  }
  return { updated_through: updatedThrough, tec, applied, exceptions };
}
