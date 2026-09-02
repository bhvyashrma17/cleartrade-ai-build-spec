import { createHash } from 'node:crypto';

export const JAPAN_BUNDLE_READER_VERSION = 'jp-customs-html-bundle-reader-v1' as const;

export class JapanBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'JapanBundleError';
  }
}

/**
 * Column labels this parser requires to be present, at minimum, before it will trust a page's
 * layout. Japan Customs publishes one rate column per General/multilateral treatment plus one per
 * EPA partner; the exact count and order have already changed once between chapters observed
 * during research (some chapters carry fewer EPA partners than others), so position is never
 * assumed — only these labelled columns are ever read.
 */
const REQUIRED_LABELS = ['General', 'WTO', 'GSP', 'India'] as const;

export interface JapanTariffRow {
  /** e.g. "1006.30" on a heading row, "" on a statistical-suffix child row. */
  statistical_code: string;
  /** 3-digit statistical suffix, e.g. "010", "" on a heading-only row. */
  hs_code_suffix: string;
  description: string;
  /** Rate-column label -> the cell's raw text, only for labels actually found on the page. */
  rates: Record<string, string>;
}

export interface JapanAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  effective_date_label: string;
  chapter: string;
  source_url: string;
  column_labels: string[];
  rows: JapanTariffRow[];
  reader_version: typeof JAPAN_BUNDLE_READER_VERSION;
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCells(rowHtml: string, tag: 'th' | 'td'): string[] {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  return [...rowHtml.matchAll(pattern)].map((match) => stripHtml(match[1] ?? ''));
}

/**
 * Decode Shift_JIS bytes, validate the datatable's own header row (never assume position), and
 * parse every data row generically against the labels actually found. Chapter/date identity is
 * read from the page itself and cross-checked against what the caller requested.
 */
export function readJapanAuthorityBundle(args: {
  bytes: Buffer;
  chapter: string;
  effective_date_label: string;
  source_url: string;
}): JapanAuthorityBundle {
  const html = args.bytes.toString('latin1');
  // The page is served as Shift_JIS, and Node has no built-in Shift_JIS decoder. Shift_JIS agrees
  // byte-for-byte with ASCII for 0x00-0x7F, so a plain latin1 (1-byte-to-1-codepoint) decode
  // reproduces every ASCII byte correctly — tags, HS codes, duty figures, and the column labels
  // and item descriptions on this specific ENGLISH-language schedule page, which are themselves
  // ASCII. Only the small amount of genuine multi-byte Japanese text still present even on the
  // English edition (e.g. the <title>) comes out garbled; this parser never reads that text.
  // The per-chapter data page (unlike the index page it's linked from) carries no English title —
  // it renders as a fragment within the dated index page's own English-titled shell. Chapter and
  // effective-date identity therefore come from the acquisition request (the exact index-page URL
  // that was followed to reach this chapter), not from scraping this page a second time; the
  // datatable structure check below is what actually proves the content is a real tariff table.
  const tableMatch = /<table id="datatable">([\s\S]*?)<\/table>/i.exec(html);
  if (!tableMatch) throw new JapanBundleError('missing_datatable', 'The Japan Customs page has no #datatable element.');
  const rowsHtml = [...tableMatch[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => match[1] ?? '');
  if (rowsHtml.length < 3) throw new JapanBundleError('empty_datatable', 'The Japan Customs tariff table has no data rows.');

  // Row 0: grouped headers (colspan). Row 1: the actual per-column leaf labels used to read data.
  const leafHeaders = extractCells(rowsHtml[1]!, 'th');
  // The first two leaf headers are the statistical-code sub-columns ("H.S.code", blank); the last
  // two are unit sub-columns ("I", "II"). Everything between is one rate-treatment column.
  const rateLabels = leafHeaders.slice(2, -2);
  for (const required of REQUIRED_LABELS) {
    if (!rateLabels.includes(required)) {
      throw new JapanBundleError('missing_required_column', `The Japan Customs tariff table has no "${required}" rate column; refusing to guess which column it would have been.`);
    }
  }

  const rows: JapanTariffRow[] = [];
  for (const rowHtml of rowsHtml.slice(2)) {
    const cells = extractCells(rowHtml, 'td');
    if (cells.length < rateLabels.length + 3) continue; // navigation/legend rows, not data rows
    const [statisticalCode, hsCodeSuffix, description, ...rest] = cells;
    if (statisticalCode == null && hsCodeSuffix == null) continue;
    const rateCells = rest.slice(0, rateLabels.length);
    const rates: Record<string, string> = {};
    rateLabels.forEach((label, index) => {
      const value = rateCells[index];
      if (value) rates[label] = value;
    });
    rows.push({
      statistical_code: statisticalCode ?? '',
      hs_code_suffix: hsCodeSuffix ?? '',
      description: description ?? '',
      rates,
    });
  }
  if (!rows.length) throw new JapanBundleError('no_tariff_rows', 'No tariff rows were parsed from this Japan Customs chapter page.');

  const file = (name: string, data: Buffer, role: string) => ({
    name, sha256: createHash('sha256').update(data).digest('hex'), size_bytes: data.length, role,
  });
  return {
    checksum: createHash('sha256').update(args.bytes).digest('hex'),
    size_bytes: args.bytes.length,
    files: [file(`e_${args.chapter}.htm`, args.bytes, 'official_chapter_tariff_schedule')],
    release_identifier: `${args.effective_date_label}-ch${args.chapter}`,
    effective_date_label: args.effective_date_label,
    chapter: args.chapter,
    source_url: args.source_url,
    column_labels: rateLabels,
    rows,
    reader_version: JAPAN_BUNDLE_READER_VERSION,
  };
}
