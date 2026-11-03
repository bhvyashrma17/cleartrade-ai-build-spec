import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { anchorPerUnit, CURRENCY_PEGS_KEY, parseCurrencyPegs } from '../src/lib/reference-datasets/currency-pegs';
import { manifestEntryFor, readReferenceManifest } from '../src/lib/reference-datasets/manifest';
import { referenceDatasetDefinition } from '../src/lib/reference-datasets/registry';

/** D-025: official fixed exchange rates for currencies the ECB does not publish. */
const bytes = readFileSync(join(__dirname, '..', 'data', 'reference', 'currency-pegs-v1.json'));

describe('currency pegs', () => {
  test('the curated file parses, names a source per row, anchors every peg to an ECB currency, and is in the manifest', () => {
    const parsed = parseCurrencyPegs(bytes);
    expect(parsed.rows.map((row) => row.currency)).toEqual(['AED', 'BAM', 'BHD', 'BND', 'BTN', 'KMF', 'NPR', 'OMR', 'QAR', 'SAR', 'XAF', 'XCD', 'XOF', 'XPF']);
    expect(new Set(parsed.rows.map((row) => row.anchor))).toEqual(new Set(['USD', 'EUR', 'INR', 'SGD']));
    expect(parsed.rows.every((row) => row.source_url.startsWith('https://') && row.basis.length > 10)).toBe(true);
    expect(parsed.rows.filter((row) => row.source_kind === 'official').map((row) => row.currency)).toEqual(['BAM', 'BHD', 'BND', 'KMF', 'OMR', 'XAF', 'XCD', 'XOF', 'XPF']);
    expect(referenceDatasetDefinition(CURRENCY_PEGS_KEY).parse(bytes)).toMatchObject({ version: 'currency-pegs-v1 compiled 2026-10-17' });
    expect(manifestEntryFor(readReferenceManifest(), bytes)).toMatchObject({ dataset_key: CURRENCY_PEGS_KEY, derived_from: null });
  });

  test('a parity is used exactly as its source states it, in either direction', () => {
    const rows = new Map(parseCurrencyPegs(bytes).rows.map((row) => [row.currency, row]));
    expect(anchorPerUnit(rows.get('OMR')!)).toBe(2.6008);
    expect(anchorPerUnit(rows.get('SAR')!)).toBeCloseTo(1 / 3.75, 15);
    expect(anchorPerUnit(rows.get('XPF')!)).toBe(0.00838);
    expect(1 / anchorPerUnit(rows.get('XOF')!)).toBeCloseTo(655.957, 9);
  });

  test('a repeated currency, a self-anchored or chained peg, or a rate stated both ways or neither refuses the file', () => {
    const file = JSON.parse(bytes.toString('utf8')) as { rows: Record<string, unknown>[] };
    const refuse = (rows: Record<string, unknown>[]) => () => parseCurrencyPegs(Buffer.from(JSON.stringify({ ...file, rows })));
    const sar = file.rows.find((row) => row.currency === 'SAR')!;
    expect(refuse([...file.rows, sar])).toThrow(/repeats SAR/);
    expect(refuse([{ ...sar, anchor: 'SAR' }])).toThrow(/anchored to itself/);
    expect(refuse([{ ...sar, anchor_per_unit: '0.2667' }])).toThrow(/one way only/);
    expect(refuse([{ ...sar, units_per_anchor: null }])).toThrow(/one way only/);
    expect(refuse([sar, { ...sar, currency: 'YER', anchor: 'SAR' }])).toThrow(/itself pegged/);
    expect(refuse([{ ...sar, units_per_anchor: '0' }])).toThrow(/positive/);
  });
});
