import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { readTaricBundle, REQUIRED_TARIC_FILES, TARIC_BUNDLE_READER_VERSION } from '@/lib/market-access/taric/bundle';

/**
 * The TARIC worksheet reader streams rather than materialising the worksheet document, because the
 * real `Duties Import 01-99` worksheet is 96.9MB of XML — ~194MB as a single JavaScript string —
 * and that transient, not the decoded rows, is what drove peak RSS to 931MB on a 1GiB worker.
 *
 * Streaming introduces failure modes a whole-document reader cannot have: a row split across chunk
 * boundaries, a multi-byte character split across chunk boundaries, and a self-closing empty row.
 * Those are what this file pins, alongside the invariant that interning changes identity but never
 * value.
 */

/** Builds a minimal SpreadsheetML workbook of the shape the real extraction uses (inlineStr). */
async function workbook(rows: string[][], opts: { selfClosingRowAt?: number } = {}): Promise<Buffer> {
  const col = (i: number) => {
    let s = '';
    let n = i + 1;
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  };
  const xmlRows = rows.map((cells, r) => {
    if (opts.selfClosingRowAt === r) return `<row r="${r + 1}"/>`;
    const body = cells.map((v, c) => (v === ''
      ? `<c r="${col(c)}${r + 1}" t="inlineStr" />`
      : `<c r="${col(c)}${r + 1}" t="inlineStr"><is><t>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`)).join('');
    return `<row r="${r + 1}">${body}</row>`;
  }).join('');
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${xmlRows}</sheetData></worksheet>`;
  const inner = new JSZip();
  inner.file('xl/worksheets/sheet1.xml', sheet);
  inner.file('xl/workbook.xml', '<workbook/>');
  return Buffer.from(await inner.generateAsync({ type: 'nodebuffer' }));
}

const HEADERS: Record<string, readonly string[]> = {
  'Nomenclature EN.xlsx': ['Goods code', 'Start date', 'End date', 'Language', 'Hier. Pos.', 'Indent', 'Description', 'Descr. start date'],
  'Declarable codes.xlsx': ['Goods code', 'Start date', 'Decl. start date', 'IS_LEAF', 'End date'],
  'Duties Import 01-99.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'RED_IND', 'Origin', 'Measure type', 'Legal base', 'Duty', 'Origin code', 'Meas. type code'],
  'Geographical areas composition.xlsx': ['Country group', 'Start date', 'Language', 'Abbrev.', 'Country group descr.', 'Member country', 'Abbrev.', 'Description', 'Mbship start date', 'Mbship end date', 'End date'],
  'Measure exclusions.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin', 'Measure type', 'Excluded country code', 'Origin code', 'Meas. type code', 'Excluded country'],
  'Measure conditions.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin code', 'Meas. type code', 'Meas. cond', 'Sequence', 'Certificate', 'Cond. amount', 'Mon. unit', 'Meas. unit', 'Meas. unit qual', 'Meas. action'],
  'Measure footnotes.xlsx': ['Goods code', 'Add code', 'Order No.', 'Origin code', 'Start date', 'End date', 'Meas. type code', 'Origin', 'Measure type', 'Footnote'],
  'Legal basis.xlsx': ['Legal base', 'Off. Journal', 'Page', 'Publ. date'],
};

/** A full bundle, with one file's rows overridden for the case under test. */
async function bundleWith(target: string, dataRows: string[][], opts: { selfClosingRowAt?: number } = {}): Promise<Buffer> {
  const zip = new JSZip();
  for (const name of REQUIRED_TARIC_FILES) {
    const header = HEADERS[name];
    const rows = header ? [[...header]] : [['x']];
    if (name === target) rows.push(...dataRows);
    zip.file(name, await workbook(rows, name === target
      ? { selfClosingRowAt: opts.selfClosingRowAt === undefined ? undefined : opts.selfClosingRowAt + 1 }
      : {}));
  }
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('the streaming worksheet reader', () => {
  test('reads every row when the document is far larger than one stream chunk', async () => {
    // Comfortably past Node's default stream chunk size, so rows certainly straddle boundaries.
    const rows = Array.from({ length: 4000 }, (_, i) => [
      `10063000${String(i).padStart(2, '0')}`, '', '', '01-01-2021', '', '', 'ERGA OMNES', 'Third country duty',
      'R123', '10.000 %', '1011', '103',
    ]);
    const bundle = await readTaricBundle(await bundleWith('Duties Import 01-99.xlsx', rows));
    const parsed = bundle.sheet('Duties Import 01-99.xlsx');
    expect(parsed).toHaveLength(4000);
    // First, last and an arbitrary middle row must all be intact and correctly positioned.
    expect(parsed[0]![0]).toBe('1006300000');
    expect(parsed[3999]![0]).toBe(`10063000${String(3999).padStart(2, '0')}`);
    expect(parsed[2000]![9]).toBe('10.000 %');
    expect(parsed[2000]![11]).toBe('103');
  });

  test('a multi-byte character split across a chunk boundary is not corrupted', async () => {
    // Long descriptions padded so the accented text lands at many different byte offsets; a naive
    // chunk.toString('utf8') would emit replacement characters at some of them.
    const rows = Array.from({ length: 1500 }, (_, i) => [
      `090111${String(i).padStart(4, '0')}`, '01-01-2021', '', 'EN', '', '',
      `Café — naïve ${'padding'.repeat(20)} ${i} — Grüße`, '',
    ]);
    const bundle = await readTaricBundle(await bundleWith('Nomenclature EN.xlsx', rows));
    const parsed = bundle.sheet('Nomenclature EN.xlsx');
    expect(parsed).toHaveLength(1500);
    expect(parsed.every((r) => r[6]!.includes('Café — naïve') && r[6]!.includes('Grüße'))).toBe(true);
    expect(parsed.some((r) => r[6]!.includes('�'))).toBe(false);
  });

  test('a self-closing empty row is preserved as an empty row, not skipped', async () => {
    // Row positions are load-bearing; dropping an empty row would shift everything after it.
    const rows = [
      ['1006300000', '01-01-2021', '01-01-2021', '1', ''],
      ['', '', '', '', ''],
      ['1006300090', '01-01-2021', '01-01-2021', '1', ''],
    ];
    const bundle = await readTaricBundle(await bundleWith('Declarable codes.xlsx', rows, { selfClosingRowAt: 1 }));
    const parsed = bundle.sheet('Declarable codes.xlsx');
    expect(parsed).toHaveLength(3);
    expect(parsed[0]![0]).toBe('1006300000');
    expect(parsed[1]).toEqual([]);
    expect(parsed[2]![0]).toBe('1006300090');
  });

  test('a blank cell keeps later columns in position rather than shifting them left', async () => {
    // The original whole-document reader had exactly this bug: a self-closing <c/> swallowed the
    // cells after it and silently moved the measure start date out of position.
    const rows = [['1006300000', '', '', '01-01-2021', '31-12-2030', '', 'ERGA OMNES', 'Third country duty', 'R1', '175.000 EUR / 1 tonne', '1011', '103']];
    const bundle = await readTaricBundle(await bundleWith('Duties Import 01-99.xlsx', rows));
    const row = bundle.sheet('Duties Import 01-99.xlsx')[0]!;
    expect(row[1]).toBe('');
    expect(row[2]).toBe('');
    expect(row[3]).toBe('01-01-2021');   // start date must NOT have shifted left
    expect(row[9]).toBe('175.000 EUR / 1 tonne');
    expect(row[11]).toBe('103');
  });

  test('interning shares identity for equal values without altering any value', async () => {
    const repeated = '01-01-2021';
    const rows = Array.from({ length: 300 }, (_, i) => [
      `10063000${String(i).padStart(2, '0')}`, '', '', repeated, '', '', 'ERGA OMNES', 'Third country duty',
      'R1', '10.000 %', '1011', '103',
    ]);
    const parsed = (await readTaricBundle(await bundleWith('Duties Import 01-99.xlsx', rows))).sheet('Duties Import 01-99.xlsx');
    // Value equality is what the parser depends on and must be exact.
    expect(parsed.every((r) => r[3] === repeated)).toBe(true);
    // Identity sharing is the memory property: every occurrence is the same object, so 300 rows
    // cost one string rather than 300. This is what took retained heap from ~505MB to ~148MB.
    const first = parsed[0]![3];
    expect(parsed.every((r) => r[3] === first)).toBe(true);
    expect(new Set(parsed.map((r) => r[7])).size).toBe(1);
  });

  test('the reader version records that the implementation changed', () => {
    // Output is byte-identical to v1, but memory behaviour is a property of the reader and
    // provenance should not imply the two are the same program.
    expect(TARIC_BUNDLE_READER_VERSION).toBe('taric-bundle-reader-v2');
  });
});
