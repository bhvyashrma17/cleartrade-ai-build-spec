/**
 * Year × HS2-chapter partitions of a trade dataset release (docs/36 §3.1).
 *
 * Writing: rows stream in from one year's CSV and go to one gzip stream per chapter, so memory
 * holds compressed output only. Reading: a run fetches the few partitions its product needs,
 * verifies each object's sha256 against the release manifest, and filters to the HS6 code.
 */
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import { createGzip, gunzipSync, type Gzip } from 'node:zlib';
import { BACI_DATA_HEADER, BaciFormatError, formatBaciDataLine, parseBaciDataLine, splitCsvLine, type BaciFlow } from './baci';

/** Yields the lines of a byte stream, decoding UTF-8 across chunk boundaries. Stream errors propagate. */
export async function* readLines(stream: Readable): AsyncGenerator<string> {
  const decoder = new StringDecoder('utf8');
  let carry = '';
  for await (const chunk of stream) {
    carry += decoder.write(chunk as Buffer);
    let newline = carry.indexOf('\n');
    while (newline >= 0) {
      const line = carry.slice(0, newline);
      carry = carry.slice(newline + 1);
      yield line.endsWith('\r') ? line.slice(0, -1) : line;
      newline = carry.indexOf('\n');
    }
  }
  carry += decoder.end();
  if (carry.length) yield carry.endsWith('\r') ? carry.slice(0, -1) : carry;
}

export interface EncodedPartition {
  year: number;
  hs_chapter: string;
  bytes: Buffer;
  sha256: string;
  row_count: number;
  /** Sum of values in thousandths of the publisher's unit, kept as an exact integer. */
  value_sum_thousandths: number;
}

interface OpenPartition {
  gzip: Gzip;
  chunks: Buffer[];
  rows: number;
  valueThousandths: number;
  done: Promise<void>;
}

const HEADER_LINE = `${BACI_DATA_HEADER.join(',')}\n`;

/** Accumulates one year's rows into one gzip CSV per HS2 chapter. */
export class YearPartitionWriter {
  private readonly open = new Map<string, OpenPartition>();

  constructor(readonly year: number) {}

  private partition(chapter: string): OpenPartition {
    const existing = this.open.get(chapter);
    if (existing) return existing;
    const gzip = createGzip({ level: 6 });
    const chunks: Buffer[] = [];
    gzip.on('data', (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => { gzip.on('end', resolve); gzip.on('error', reject); });
    gzip.write(HEADER_LINE);
    const created: OpenPartition = { gzip, chunks, rows: 0, valueThousandths: 0, done };
    this.open.set(chapter, created);
    return created;
  }

  /** Adds a row given its parsed flow and the raw value and quantity tokens, which are kept verbatim. */
  async add(flow: BaciFlow, rawValue: string, rawQuantity: string): Promise<void> {
    if (flow.year !== this.year) throw new BaciFormatError(`Row for ${flow.year} written to the ${this.year} partition set.`);
    const target = this.partition(flow.product.slice(0, 2));
    target.rows += 1;
    target.valueThousandths += Math.round(flow.value_kusd * 1000);
    if (!target.gzip.write(`${formatBaciDataLine(flow, rawValue, rawQuantity)}\n`)) {
      await new Promise<void>((resolve) => target.gzip.once('drain', resolve));
    }
  }

  async finish(): Promise<EncodedPartition[]> {
    const finished: EncodedPartition[] = [];
    for (const [chapter, partition] of [...this.open.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      partition.gzip.end();
      await partition.done;
      const bytes = Buffer.concat(partition.chunks);
      finished.push({
        year: this.year,
        hs_chapter: chapter,
        bytes,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        row_count: partition.rows,
        value_sum_thousandths: partition.valueThousandths,
      });
    }
    this.open.clear();
    return finished;
  }
}

/** Raw value and quantity tokens of a data line, for verbatim re-writing. */
export function rawValueTokens(line: string): { value: string; quantity: string } {
  const fields = splitCsvLine(line);
  return { value: fields[4] ?? '', quantity: fields[5] ?? '' };
}

export class PartitionIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartitionIntegrityError';
  }
}

/**
 * Decodes one partition and returns its rows for one HS6 product. The object's sha256 must equal
 * the manifest's; a partition that does not is never read.
 */
export function readPartitionFlows(args: { bytes: Buffer; expected_sha256: string; year: number; hs6?: string; label: string }): BaciFlow[] {
  const actual = createHash('sha256').update(args.bytes).digest('hex');
  if (actual !== args.expected_sha256) throw new PartitionIntegrityError(`${args.label}: sha256 ${actual} does not match the manifest's ${args.expected_sha256}.`);
  const lines = gunzipSync(args.bytes).toString('utf8').split('\n');
  if (`${lines[0]}\n` !== HEADER_LINE) throw new PartitionIntegrityError(`${args.label}: unexpected header ${JSON.stringify(lines[0])}.`);
  const flows: BaciFlow[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (args.hs6 && !line.includes(`,${args.hs6},`)) continue;
    const flow = parseBaciDataLine(line, `${args.label} line ${index + 1}`, args.year);
    if (!args.hs6 || flow.product === args.hs6) flows.push(flow);
  }
  return flows;
}
