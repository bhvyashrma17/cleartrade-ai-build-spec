import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const NZ_BUNDLE_READER_VERSION = 'nz-cusmod-bundle-reader-v1' as const;

export class NzBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'NzBundleError';
  }
}

/**
 * Minimal USTAR/POSIX tar reader. No new dependency: the format is a stable, fully documented
 * fixed-width binary layout (512-byte header, octal size at offset 124, data padded to 512-byte
 * blocks), unlike the Access database format that genuinely warranted `mdb-reader`.
 */
function readTar(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break; // end-of-archive marker
    const name = header.subarray(0, 100).toString('utf8').replace(/\0[\s\S]*$/, '');
    const sizeOctal = header.subarray(124, 136).toString('utf8').replace(/\0[\s\S]*$/, '').trim();
    const size = Number.parseInt(sizeOctal, 8);
    const typeFlag = String.fromCharCode(header[156]!);
    offset += 512;
    if (!Number.isFinite(size) || size < 0) throw new NzBundleError('corrupt_tar', 'The NZ Customs tar archive has a malformed header.');
    if ((typeFlag === '0' || typeFlag === '\0') && name) {
      files.set(name, bytes.subarray(offset, offset + size));
    }
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

const TARIFF_DETAILS_COLUMNS = [
  'Tic Tariff Level 1', 'Tic Tariff Level 2', 'Tic Tariff Level 3', 'Tic Tariff Level 4', 'Tic Tariff Level 5',
  'Tic Tariff Letter', 'Tic Tariff Section', 'Tic Statistical Unit', 'Tic Supplementary Unit',
  'Tic Alternate Tariff Item', 'Tic Alternate Ind', 'Tic Gst Exempt Ind', 'Tic Start Date', 'Tic Expiry Date',
  'Tic Tariff Description',
] as const;

const TARIFF_RATES_COLUMNS = [
  'Tdrc Tariff Level 1', 'Tdrc Tariff Level 2', 'Tdrc Tariff Level 3', 'Tdrc Tariff Level 4', 'Tdrc Tariff Level 5',
  'Tdrc Rate Group', 'Tdrc Start Date', 'Tdrc Expiry Date', 'Tdrc Excise Factor', 'Tdrc Rate Formula',
  'Tdrc Factor A', 'Tdrc Factor B', 'Tdrc Factor C', 'Tdrc Factor D', 'Tdrc Factor E', 'Tdrc Factor F',
] as const;

export interface NzTariffDetailRow {
  code: string;
  section: string;
  statistical_unit: string | null;
  /** Epoch milliseconds, not a `Date` — see the comment on `parseNzDateMs` for why. */
  start_date: number | null;
  expiry_date: number | null;
  description: string;
}

export interface NzTariffRateRow {
  code: string;
  rate_group: string;
  start_date: number | null;
  expiry_date: number | null;
  formula: number | null;
  factor_a: number | null;
  factor_b: number | null;
  factor_c: number | null;
  factor_d: number | null;
}

/**
 * "Jan  1 2002 12:00AM" — a fixed-width month/day/year/time format, variable inner spacing.
 *
 * Returns epoch milliseconds (a plain number) rather than a `Date` object. The real CusMod
 * archive carries ~945K date-bearing rows across both files; constructing a `Date` per date
 * field at load time (observed: ~1.9M `Date` instances) pushed retained heap to ~460MB and RSS
 * to ~1GB against this worker's 1GB container limit, and crashed it. Callers convert to `Date`
 * only for the handful of rows that survive filtering into an actual result.
 */
function parseNzDateMs(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})\s+(\d{1,2}):(\d{2})(AM|PM)$/.exec(trimmed);
  if (!match) return null;
  const months: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const month = months[match[1]!];
  if (month == null) return null;
  let hour = Number.parseInt(match[4]!, 10) % 12;
  if (match[6] === 'PM') hour += 12;
  const ms = Date.UTC(Number.parseInt(match[3]!, 10), month, Number.parseInt(match[2]!, 10), hour, Number.parseInt(match[5]!, 10));
  return Number.isNaN(ms) ? null : ms;
}

function parseCsv(text: string, expectedColumns: readonly string[], errorCode: string): string[][] {
  const lines = text.split(/\r\n|\n/).filter((line) => line.length > 0);
  if (!lines.length) throw new NzBundleError(errorCode, 'The NZ Customs CSV file is empty.');
  const header = lines[0]!.split('~');
  if (header.length !== expectedColumns.length || header.some((column, index) => column !== expectedColumns[index])) {
    throw new NzBundleError(errorCode, 'The NZ Customs CSV column order changed; refusing to parse the wrong fields.');
  }
  return lines.slice(1).map((line) => line.split('~'));
}

function code(levels: string[]): string {
  return levels.join('');
}

export interface NzAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  tariff_archive_url: string;
  time_stamp: string;
  details: NzTariffDetailRow[];
  rates: NzTariffRateRow[];
  reader_version: typeof NZ_BUNDLE_READER_VERSION;
}

/** Validate and decode the retained nightly CusMod archive without guessing around schema drift. */
export function readNzAuthorityBundle(args: {
  bytes: Buffer;
  release_identifier: string;
  tariff_archive_url: string;
}): NzAuthorityBundle {
  let gunzipped: Buffer;
  try {
    gunzipped = gunzipSync(args.bytes);
  } catch {
    throw new NzBundleError('corrupt_archive', 'The NZ Customs authority bundle is not a readable gzip stream.');
  }
  const files = readTar(gunzipped);
  const required = ['time_stamp.txt', 'Tariff_Rates.csv', 'Tariff_Levies.csv', 'Tariff_Levy_Formulas.csv', 'Tariff_Details.csv'];
  for (const name of required) {
    if (!files.has(name)) throw new NzBundleError('unexpected_bundle_files', `The NZ Customs authority bundle is missing the official ${name} file.`);
  }

  const detailRows = parseCsv(files.get('Tariff_Details.csv')!.toString('utf8'), TARIFF_DETAILS_COLUMNS, 'unexpected_details_schema');
  const rateRows = parseCsv(files.get('Tariff_Rates.csv')!.toString('utf8'), TARIFF_RATES_COLUMNS, 'unexpected_rates_schema');
  if (!detailRows.length) throw new NzBundleError('empty_details', 'The NZ Customs Tariff_Details.csv file is empty.');
  if (!rateRows.length) throw new NzBundleError('empty_rates', 'The NZ Customs Tariff_Rates.csv file is empty.');

  const num = (value: string) => (value.trim() === '' ? null : Number.parseFloat(value));

  const details: NzTariffDetailRow[] = detailRows.map((cells) => ({
    code: code(cells.slice(0, 5)),
    section: cells[6] ?? '',
    statistical_unit: cells[7]?.trim() || null,
    start_date: parseNzDateMs(cells[12] ?? ''),
    expiry_date: parseNzDateMs(cells[13] ?? ''),
    description: (cells[14] ?? '').trim(),
  }));

  const rates: NzTariffRateRow[] = rateRows.map((cells) => ({
    code: code(cells.slice(0, 5)),
    rate_group: (cells[5] ?? '').trim(),
    start_date: parseNzDateMs(cells[6] ?? ''),
    expiry_date: parseNzDateMs(cells[7] ?? ''),
    formula: num(cells[9] ?? ''),
    factor_a: num(cells[10] ?? ''),
    factor_b: num(cells[11] ?? ''),
    factor_c: num(cells[12] ?? ''),
    factor_d: num(cells[13] ?? ''),
  }));

  const file = (name: string, data: Buffer, role: string) => ({
    name, sha256: createHash('sha256').update(data).digest('hex'), size_bytes: data.length, role,
  });

  return {
    checksum: createHash('sha256').update(args.bytes).digest('hex'),
    size_bytes: args.bytes.length,
    files: required.map((name) => file(name, files.get(name)!, name === 'Tariff_Rates.csv' ? 'official_tariff_rates' : name === 'Tariff_Details.csv' ? 'official_tariff_details' : 'official_supporting_file')),
    release_identifier: args.release_identifier,
    tariff_archive_url: args.tariff_archive_url,
    time_stamp: files.get('time_stamp.txt')!.toString('utf8').trim(),
    details,
    rates,
    reader_version: NZ_BUNDLE_READER_VERSION,
  };
}
