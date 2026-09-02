import { createHash } from 'node:crypto';
import JSZip from 'jszip';

export const AUSTRALIA_BUNDLE_READER_VERSION = 'abf-bundle-reader-v1' as const;

export class AustraliaBundleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'AustraliaBundleError';
  }
}

/** Exact Schedule 3 column order. A layout change must stop the read, not shift the fields. */
const SCHEDULE_3_COLUMNS = ['ReferenceNumber', 'StatisticalCode', 'Unit', 'Goods', 'Rate#'] as const;

export interface AustraliaTariffRow {
  /** ABF "Reference Number", e.g. `6101.20.00`. */
  reference_number: string;
  /** ABF "Statistical Code", e.g. `02`. Combined with the reference number this is the full line. */
  statistical_code: string;
  unit: string;
  description: string;
  /** The Rate# cell verbatim, entities decoded but otherwise untouched. */
  rate_text: string;
}

/**
 * One row of Schedule 10A. Australia expresses India ECTA treatment as an EXCEPTION LIST: the
 * schedule's own note reads "Except for the subheadings outlined in the table below, all rates are
 * Free", so a subheading's absence from this table is meaningful evidence (duty-free under ECTA),
 * not missing data — provided the goods are Indian originating goods, which is a separate question.
 */
export interface AustraliaIndiaExceptionRow {
  item: string;
  heading: string;
  rate_text: string;
}

export interface AustraliaAuthorityBundle {
  checksum: string;
  size_bytes: number;
  files: Array<{ name: string; sha256: string; size_bytes: number; role: string }>;
  release_identifier: string;
  chapter: string;
  chapter_url: string;
  schedule_10a_url: string;
  rows: AustraliaTariffRow[];
  india_exceptions: AustraliaIndiaExceptionRow[];
  /** The verbatim Schedule 10A default-treatment note, retained as the basis for the default. */
  india_default_note: string;
  reader_version: typeof AUSTRALIA_BUNDLE_READER_VERSION;
}

/** ABF pages carry numeric entities and zero-width spaces inside tariff codes; both must go. */
function decodeCell(html: string): string {
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[​‌‍﻿]/g, '')
    .replace(/ /g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  for (const table of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    for (const row of table[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...row[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decodeCell(c[1]!));
      if (cells.length) rows.push(cells);
    }
  }
  return rows;
}

/** A declarable Australian line is `NNNN.NN.NN`; headings carry a bare heading number instead. */
const REFERENCE_NUMBER = /^\d{4}\.\d{2}\.\d{2}$/;

export function readAustraliaAuthorityBundle(args: {
  bytes: Buffer;
  release_identifier: string;
  chapter: string;
  chapter_url: string;
  schedule_10a_url: string;
}): Promise<AustraliaAuthorityBundle> {
  return readBundle(args);
}

async function readBundle(args: {
  bytes: Buffer;
  release_identifier: string;
  chapter: string;
  chapter_url: string;
  schedule_10a_url: string;
}): Promise<AustraliaAuthorityBundle> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(args.bytes);
  } catch {
    throw new AustraliaBundleError('corrupt_archive', 'The Australian authority bundle is not a readable archive.');
  }
  const required = ['schedule-3-chapter.html', 'schedule-10a-india.html', 'acquisition.json'];
  const contents = new Map<string, Buffer>();
  for (const name of required) {
    const entry = zip.file(name);
    if (!entry) throw new AustraliaBundleError('unexpected_bundle_files', `The Australian authority bundle is missing ${name}.`);
    contents.set(name, Buffer.from(await entry.async('nodebuffer')));
  }

  const chapterHtml = contents.get('schedule-3-chapter.html')!.toString('utf8');
  const scheduleHtml = contents.get('schedule-10a-india.html')!.toString('utf8');

  const allRows = tableRows(chapterHtml);
  const header = allRows.find((cells) => cells[0]?.replace(/\s/g, '') === 'ReferenceNumber');
  if (!header) {
    throw new AustraliaBundleError('unexpected_schedule_3_schema', 'No Schedule 3 tariff table was found on the ABF chapter page; refusing to guess its layout.');
  }
  const normalizedHeader = header.map((cell) => cell.replace(/\s/g, ''));
  for (const [index, expected] of SCHEDULE_3_COLUMNS.entries()) {
    if (normalizedHeader[index] !== expected) {
      throw new AustraliaBundleError(
        'unexpected_schedule_3_schema',
        `The ABF Schedule 3 column order changed (expected "${expected}" at position ${index}, saw "${normalizedHeader[index] ?? ''}"); refusing to parse the wrong fields.`,
      );
    }
  }

  const rows: AustraliaTariffRow[] = [];
  for (const cells of allRows) {
    const reference = (cells[0] ?? '').replace(/\s/g, '');
    if (!REFERENCE_NUMBER.test(reference)) continue; // heading rows and the header itself
    rows.push({
      reference_number: reference,
      statistical_code: (cells[1] ?? '').replace(/\s/g, ''),
      unit: cells[2] ?? '',
      description: cells[3] ?? '',
      rate_text: cells[4] ?? '',
    });
  }
  if (!rows.length) {
    throw new AustraliaBundleError('empty_schedule_3', `The ABF Schedule 3 page for chapter ${args.chapter} contained no declarable tariff lines.`);
  }

  // Schedule 10A: "Item | Heading or subheading in Schedule 3 | # Rate".
  const scheduleRows = tableRows(scheduleHtml);
  const india: AustraliaIndiaExceptionRow[] = [];
  for (const cells of scheduleRows) {
    if (cells.length < 3) continue;
    const heading = (cells[1] ?? '').replace(/\s/g, '');
    if (!/^\d{4}(\.\d{2})?(\.\d{2})?$/.test(heading)) continue;
    india.push({ item: cells[0] ?? '', heading, rate_text: cells[2] ?? '' });
  }

  // The default-Free rule is the load-bearing claim for every subheading NOT in the table, so the
  // note stating it is retained verbatim as evidence rather than being hardcoded as an assumption.
  const plain = decodeCell(scheduleHtml);
  const noteMatch = /Except for the subheadings[^.]*\./i.exec(plain);
  if (!noteMatch) {
    throw new AustraliaBundleError(
      'missing_schedule_10a_note',
      'The Schedule 10A default-treatment note ("Except for the subheadings ... all rates are Free") was not found. '
      + 'Without it the default India ECTA treatment is unproven, and absence from the exception table cannot be read as duty-free.',
    );
  }

  const file = (name: string, role: string) => {
    const data = contents.get(name)!;
    return { name, sha256: createHash('sha256').update(data).digest('hex'), size_bytes: data.length, role };
  };

  return {
    checksum: createHash('sha256').update(args.bytes).digest('hex'),
    size_bytes: args.bytes.length,
    files: [
      file('schedule-3-chapter.html', 'official_schedule_3_chapter'),
      file('schedule-10a-india.html', 'official_schedule_10a_india'),
      file('acquisition.json', 'acquisition_manifest'),
    ],
    release_identifier: args.release_identifier,
    chapter: args.chapter,
    chapter_url: args.chapter_url,
    schedule_10a_url: args.schedule_10a_url,
    rows,
    india_exceptions: india,
    india_default_note: noteMatch[0].trim(),
    reader_version: AUSTRALIA_BUNDLE_READER_VERSION,
  };
}
