/**
 * Reading the official EU TARIC monthly extraction bundle.
 *
 * The Commission publishes TARIC as a set of xlsx tables on the CIRCABC group "TARIC & Quota Data
 * and Information". Authorized ClearTrade staff download that bundle and upload the ORIGINAL zip
 * here; nothing in this file reaches out to the network, and nothing re-keys the data by hand.
 * That distinction matters for provenance: the resulting evidence is an authoritative public
 * source read by machine, not an operator's transcription.
 *
 * Two things this module refuses to do, both learned from the real files:
 *
 *   1. **Trust a header label.** In `Measure exclusions` the header reads
 *      `Excluded country code` over a column of country NAMES ("India"), while the ISO code
 *      ("IN") sits under `Excluded country`. Keying on header text there yields names and never
 *      matches a country. Every column is therefore read by verified position, and the header row
 *      is checked as a schema assertion rather than used as a lookup.
 *
 *   2. **Accept a path from the archive.** Entry names are flattened to their basename and matched
 *      against a fixed allow-list, so a crafted archive cannot traverse or smuggle extra files.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

/**
 * v2: streaming worksheet reader with cell interning. Output is byte-identical to v1 — verified
 * cell-for-cell across all 4.4M cells of the real September 2026 extraction, and end-to-end across
 * 48 destination x HS6 canonical results — but the implementation changed materially, so the
 * version moves. Memory behaviour is a property of the reader, and provenance should record which
 * reader produced a release rather than implying v1 and v2 are the same program.
 */
export const TARIC_BUNDLE_READER_VERSION = 'taric-bundle-reader-v2' as const;

/**
 * Files the parser actually joins. `Duties Import 01-99` carries the measures, which is why the
 * separate `TARIC measures.xlsx` some older extractions shipped is deliberately NOT required.
 */
export const REQUIRED_TARIC_FILES = [
  'Nomenclature EN.xlsx',
  'Declarable codes.xlsx',
  'Duties Import 01-99.xlsx',
  'Geographical areas composition.xlsx',
  'Measure conditions.xlsx',
  'Measure exclusions.xlsx',
  'Measure footnotes.xlsx',
  'Footnotes descriptions.xlsx',
  'Legal basis.xlsx',
] as const;

/** Present in the official bundle and stored for completeness, but not joined by the parser. */
export const OPTIONAL_TARIC_FILES = [
  'Additional codes descriptions.xlsx',
  'Box 44 codes of the SAD.xlsx',
  'CCT Exchange rates.xlsx',
  'Duties Export 01-99.xlsx',
  'Geographical areas description.xlsx',
  'Nomenclature DE.xlsx',
  'Nomenclature FR.xlsx',
  'Nomenclature footnotes.xlsx',
] as const;

const KNOWN_FILES = new Set<string>([...REQUIRED_TARIC_FILES, ...OPTIONAL_TARIC_FILES]);

/**
 * The header row each required file must present, by position.
 *
 * This is a schema assertion, not a lookup table: if the Commission changes a column order the
 * import must fail loudly here rather than silently parse the wrong column into a duty.
 */
const EXPECTED_HEADERS: Partial<Record<string, readonly string[]>> = {
  'Nomenclature EN.xlsx': ['Goods code', 'Start date', 'End date', 'Language', 'Hier. Pos.', 'Indent', 'Description', 'Descr. start date'],
  'Declarable codes.xlsx': ['Goods code', 'Start date', 'Decl. start date', 'IS_LEAF', 'End date'],
  'Duties Import 01-99.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'RED_IND', 'Origin', 'Measure type', 'Legal base', 'Duty', 'Origin code', 'Meas. type code'],
  'Geographical areas composition.xlsx': ['Country group', 'Start date', 'Language', 'Abbrev.', 'Country group descr.', 'Member country', 'Abbrev.', 'Description', 'Mbship start date', 'Mbship end date', 'End date'],
  'Measure exclusions.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin', 'Measure type', 'Excluded country code', 'Origin code', 'Meas. type code', 'Excluded country'],
  'Measure conditions.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin code', 'Meas. type code', 'Meas. cond', 'Sequence', 'Certificate', 'Cond. amount', 'Mon. unit', 'Meas. unit', 'Meas. unit qual', 'Meas. action'],
  'Measure footnotes.xlsx': ['Goods code', 'Add code', 'Order No.', 'Origin code', 'Start date', 'End date', 'Meas. type code', 'Origin', 'Measure type', 'Footnote'],
  'Legal basis.xlsx': ['Legal base', 'Off. Journal', 'Page', 'Publ. date'],
};

export class TaricBundleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'TaricBundleError';
    this.code = code;
  }
}

export interface TaricBundleFile {
  name: string;
  sha256: string;
  size_bytes: number;
  required: boolean;
}

export interface TaricBundle {
  /** SHA-256 of the uploaded archive itself — the release's byte identity. */
  bundle_sha256: string;
  bundle_size_bytes: number;
  files: TaricBundleFile[];
  reader_version: string;
  /** Row arrays keyed by file name, header row excluded. */
  sheet(name: string): string[][];
}

/** Cells are read as text: TARIC codes are zero-padded and must never become numbers. */
function cellText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return String(value);
}

/**
 * Parse the cells of ONE `<row>...</row>` fragment.
 *
 * Extracted from the former whole-document reader unchanged, because its exact behaviour is
 * load-bearing and was arrived at against the real bundle:
 *
 *  - A blank cell is written self-closing (`<c r="B2"/>`). The attribute class must exclude `/`
 *    and the self-closing form must be part of the SAME alternation, or `<c([^>]*)>` matches the
 *    self-closing tag and then scans to the next `</c>`, swallowing the cells in between and
 *    shifting every later column. That bug silently moved the measure start date out of position,
 *    which would have disabled effective-date filtering entirely.
 *  - The `r` attribute is the A1 reference; blank cells are omitted entirely, so the column index
 *    has to come from the reference or positions silently shift.
 */
function parseRowCells(rowInner: string, shared: readonly string[], intern: Map<string, string>): string[] {
  const cells: string[] = [];
  for (const cellMatch of rowInner.matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = cellMatch[1] ?? '';
    const body = cellMatch[2] ?? '';
    const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
    const index = ref ? columnIndex(ref) : cells.length;
    const type = /t="([^"]+)"/.exec(attrs)?.[1];
    const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
    let text: string;
    if (type === 's') text = shared[Number(raw)] ?? '';
    else if (type === 'inlineStr') {
      let inline = '';
      for (const m of body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) inline += m[1] ?? '';
      text = decodeXml(inline);
    } else text = decodeXml(raw);
    // Intern the cell.
    //
    // TARIC is columnar and overwhelmingly repetitive: the same dates ('01-01-2021'), origin
    // codes, measure-type codes and duty expressions recur across hundreds of thousands of rows.
    // Without interning, every occurrence is a distinct JavaScript string object, and the object
    // headers — not the characters — dominate what the decoded bundle retains. Measured on the
    // real September 2026 extraction: 4.4M cells retaining ~505MB post-GC, i.e. ~1.2KB per row for
    // rows of about ten short fields. Interning returns the canonical instance for an equal value,
    // so semantics are byte-identical while the object count collapses to the distinct-value count.
    const existing = intern.get(text);
    if (existing === undefined) intern.set(text, text);
    else text = existing;
    while (cells.length < index) cells.push('');
    cells[index] = text;
  }
  return cells;
}

/**
 * Stream one worksheet, emitting rows as they complete.
 *
 * Why streaming rather than `zip.file(sheet).async('string')`: profiling the real September 2026
 * extraction showed the dominant allocation was never the decoded rows. `Duties Import 01-99`'s
 * worksheet is 96.9MB of XML, which as a single JavaScript string is ~194MB (2 bytes/char), and
 * `matchAll` over it then allocates a match object and substrings for every one of its 1.75M
 * cells. That one transient — not the retained `string[][]`, which measured only ~99MB of heap for
 * all 469K rows across every sheet — is what drove peak RSS to 931MB on a 1GiB worker.
 *
 * So this holds only the tail of the current row rather than the document. Rows are emitted to a
 * callback, and the consumed prefix is released on every iteration.
 */
async function streamSheetRows(
  entry: JSZip.JSZipObject,
  shared: readonly string[],
  intern: Map<string, string>,
  onRow: (cells: string[]) => void,
): Promise<void> {
  const { StringDecoder } = await import('node:string_decoder');
  // A chunk boundary can fall inside a multi-byte character; StringDecoder holds the partial
  // sequence rather than emitting a replacement character mid-description.
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  // A cursor rather than re-slicing per row. Slicing the buffer after every row copies the whole
  // remainder each time, which on a worksheet with 146K rows generates enormous transient garbage
  // — the very thing this reader exists to avoid. The consumed prefix is dropped once, per chunk.
  let cursor = 0;

  const consume = (final: boolean) => {
    for (;;) {
      const start = buffer.indexOf('<row', cursor);
      if (start === -1) {
        // Nothing pending, but '<row' itself may straddle the boundary: keep a short tail.
        cursor = final ? buffer.length : Math.max(cursor, buffer.length - 8);
        break;
      }
      const tagEnd = buffer.indexOf('>', start);
      if (tagEnd === -1) { cursor = start; break; }
      // `<row r="5"/>` is a legitimately empty row and has no closing tag to look for.
      if (buffer[tagEnd - 1] === '/') {
        onRow([]);
        cursor = tagEnd + 1;
        continue;
      }
      const end = buffer.indexOf('</row>', tagEnd);
      if (end === -1) { cursor = start; break; }
      onRow(parseRowCells(buffer.slice(tagEnd + 1, end), shared, intern));
      cursor = end + 6;
    }
    // Compact once per chunk instead of once per row.
    if (cursor > 0) { buffer = buffer.slice(cursor); cursor = 0; }
  };

  await new Promise<void>((resolve, reject) => {
    const stream = entry.nodeStream('nodebuffer');
    stream.on('data', (chunk: Buffer) => {
      buffer += decoder.write(chunk);
      consume(false);
    });
    stream.on('error', reject);
    stream.on('end', () => {
      buffer += decoder.end();
      consume(true);
      resolve();
    });
  });
}

/**
 * Minimal xlsx reader, streaming.
 *
 * The bundle is plain SpreadsheetML with no formulas, so a full spreadsheet engine would be a
 * large dependency for a narrow job. This reads exactly what the extraction contains: inline and
 * shared strings, by column position, in row order — without materialising the worksheet document.
 */
async function readSheet(bytes: Buffer): Promise<string[][]> {
  const rows: string[][] = [];
  await streamSheet(bytes, (cells) => { rows.push(cells); });
  return rows;
}

/** Streams one workbook's rows to `onRow` without materialising its worksheet document. */
async function streamSheet(bytes: Buffer, onRow: (cells: string[]) => void): Promise<void> {
  const zip = await JSZip.loadAsync(bytes);

  // The September 2026 extraction writes every cell as `inlineStr` and ships no shared-string
  // table at all, but older extractions did, so the table is still honoured when present. It is
  // small relative to a worksheet and is read whole.
  const sharedFile = zip.file('xl/sharedStrings.xml');
  const shared: string[] = [];
  if (sharedFile) {
    const xml = await sharedFile.async('string');
    // <si> may hold one <t> or several inside <r> runs; concatenating the runs is the text.
    for (const si of xml.split('<si>').slice(1)) {
      const chunk = si.slice(0, si.indexOf('</si>'));
      let text = '';
      for (const m of chunk.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += m[1] ?? '';
      shared.push(decodeXml(text));
    }
  }

  const sheetName = Object.keys(zip.files).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new TaricBundleError('malformed_workbook', 'Workbook contains no worksheet.');
  // One intern table per worksheet: its keys are the sheet's distinct values, which is orders of
  // magnitude smaller than its cell count, and it is released with the sheet.
  await streamSheetRows(zip.file(sheetName)!, shared, new Map<string, string>(), onRow);
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * Validate and read an uploaded TARIC bundle.
 *
 * Rejects — rather than best-effort parses — a corrupt archive, a missing required table, a
 * duplicate entry, a path-bearing entry, an unknown file, or a header row that does not match the
 * documented schema.
 */
export async function readTaricBundle(bytes: Buffer, options: { parseSheets?: boolean } = {}): Promise<TaricBundle> {
  const bundleSha = createHash('sha256').update(bytes).digest('hex');
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new TaricBundleError('corrupt_archive', 'That file is not a readable ZIP archive.');
  }

  const seen = new Map<string, JSZip.JSZipObject>();
  for (const [entryName, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    // macOS resource forks travel with a zip made on a Mac and are not part of the distribution.
    if (entryName.startsWith('__MACOSX/') || entryName.split('/').pop()!.startsWith('._')) continue;
    const base = entryName.split('/').pop()!;
    // Path traversal and nesting are refused by construction: only the basename is ever used, and
    // only if it is one of the Commission's own file names.
    if (!KNOWN_FILES.has(base)) {
      throw new TaricBundleError('unexpected_file', `"${base}" is not part of the official TARIC extraction.`);
    }
    if (seen.has(base)) {
      throw new TaricBundleError('duplicate_file', `The archive contains "${base}" more than once.`);
    }
    seen.set(base, entry);
  }

  const missing = REQUIRED_TARIC_FILES.filter((name) => !seen.has(name));
  if (missing.length) {
    throw new TaricBundleError('missing_required_file', `The archive is missing required TARIC tables: ${missing.join(', ')}.`);
  }

  const files: TaricBundleFile[] = [];
  const sheets = new Map<string, string[][]>();
  for (const [name, entry] of [...seen].sort(([a], [b]) => a.localeCompare(b))) {
    const content = Buffer.from(await entry.async('uint8array'));
    files.push({
      name,
      sha256: createHash('sha256').update(content).digest('hex'),
      size_bytes: content.length,
      required: (REQUIRED_TARIC_FILES as readonly string[]).includes(name),
    });

    const expected = EXPECTED_HEADERS[name];
    if (!expected) continue;
    let rows: string[][];
    try {
      rows = await readSheet(content);
    } catch (error) {
      if (error instanceof TaricBundleError) throw error;
      throw new TaricBundleError('malformed_workbook', `"${name}" could not be read as an Excel workbook.`);
    }
    const header = (rows[0] ?? []).map((cell) => cellText(cell).trim());
    for (const [index, label] of expected.entries()) {
      if (header[index] !== label) {
        throw new TaricBundleError(
          'unexpected_schema',
          `"${name}" column ${index + 1} is "${header[index] ?? ''}" but the documented TARIC schema has "${label}". Refusing to parse rather than read the wrong column.`,
        );
      }
    }
    if (options.parseSheets !== false) sheets.set(name, rows.slice(1));
  }

  return {
    bundle_sha256: bundleSha,
    bundle_size_bytes: bytes.length,
    files,
    reader_version: TARIC_BUNDLE_READER_VERSION,
    sheet(name: string) {
      const rows = sheets.get(name);
      if (!rows) throw new TaricBundleError('sheet_not_parsed', `"${name}" was not parsed from this bundle.`);
      return rows;
    },
  };
}

/** `DD-MM-YYYY` → Date, or null. The extraction uses this format in every date column. */
export function taricDate(value: string | null | undefined): Date | null {
  const text = (value ?? '').trim();
  if (!text) return null;
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(text);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1])));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Is a TARIC validity window open at `at`?
 *
 * Load-bearing because the monthly extraction deliberately contains measures that start AFTER the
 * reference date (guide p.2). Without this a future duty would be published as today's rate.
 */
export function effectiveAt(start: string | null | undefined, end: string | null | undefined, at: Date): boolean {
  const from = taricDate(start);
  const to = taricDate(end);
  if (from && from.getTime() > at.getTime()) return false;
  if (to && to.getTime() < at.getTime()) return false;
  return true;
}

/**
 * Strip the Commission's mark-up characters (guide, "General note").
 * `|` is an unbreakable space and appears throughout the rice descriptions ("5|kg").
 */
export function taricText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/!1!/g, '\n')
    .replace(/\|/g, ' ')
    .replace(/!<=!/g, '≤').replace(/!>=!/g, '≥')
    .replace(/!x!/gi, '×').replace(/!o!/gi, '°')
    .replace(/[$@]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
