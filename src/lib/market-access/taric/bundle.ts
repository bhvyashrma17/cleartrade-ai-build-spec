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

export const TARIC_BUNDLE_READER_VERSION = 'taric-bundle-reader-v1' as const;

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
 * Minimal xlsx reader.
 *
 * The bundle is plain SpreadsheetML with a shared-string table and no formulas, so a full
 * spreadsheet engine would be a large dependency for a narrow job. This reads exactly what the
 * extraction contains: inline and shared strings, by column position, in row order.
 */
async function readSheet(bytes: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(bytes);
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
  const xml = await zip.file(sheetName)!.async('string');

  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    // A blank cell is written self-closing (`<c r="B2"/>`). The attribute class must exclude `/`
    // and the self-closing form must be part of the SAME alternation, or `<c([^>]*)>` matches the
    // self-closing tag and then scans to the next `</c>`, swallowing the cells in between and
    // shifting every later column. Caught against the real bundle: it silently moved the measure
    // start date out of position, which would have disabled effective-date filtering entirely.
    for (const cellMatch of (rowMatch[1] ?? '').matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1] ?? '';
      const body = cellMatch[2] ?? '';
      // The `r` attribute is the A1 reference; blank cells are omitted entirely, so the column
      // index has to come from the reference or positions silently shift.
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
      while (cells.length < index) cells.push('');
      cells[index] = text;
    }
    rows.push(cells);
  }
  return rows;
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
