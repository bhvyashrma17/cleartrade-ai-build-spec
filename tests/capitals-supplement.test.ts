import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CAPITALS_SUPPLEMENT_KEY, parseCapitalsSupplement } from '../src/lib/reference-datasets/capitals-supplement';
import { manifestEntryFor, readReferenceManifest } from '../src/lib/reference-datasets/manifest';
import { referenceDatasetDefinition } from '../src/lib/reference-datasets/registry';
import { coordinateInputs } from '../src/lib/demand-discovery-v5/reference-inputs';
import type { CapitalRow } from '../src/lib/reference-datasets/geodist';

/** The six capitals GeoDist (2011) lacks, curated with a source per row (docs/36 §9). */
const bytes = readFileSync(join(__dirname, '..', 'data', 'reference', 'capitals-supplement-v1.json'));

describe('capitals supplement', () => {
  test('the curated file parses, names a source per row, and is recorded in the manifest', () => {
    const parsed = parseCapitalsSupplement(bytes);
    expect(parsed.rows.map((row) => row.iso2)).toEqual(['BL', 'BQ', 'ME', 'SS', 'SX', 'VA']);
    expect(parsed.rows.every((row) => row.source.length > 10 && row.source_url.startsWith('https://'))).toBe(true);
    expect(referenceDatasetDefinition(CAPITALS_SUPPLEMENT_KEY).parse(bytes)).toMatchObject({ version: 'capitals-supplement-v1 compiled 2026-10-14' });
    expect(manifestEntryFor(readReferenceManifest(), bytes)).toMatchObject({ dataset_key: CAPITALS_SUPPLEMENT_KEY, derived_from: null });
  });

  test('a repeated market or a row without a source refuses the file', () => {
    const file = JSON.parse(bytes.toString('utf8')) as { rows: Record<string, unknown>[] };
    expect(() => parseCapitalsSupplement(Buffer.from(JSON.stringify({ ...file, rows: [...file.rows, file.rows[0]] })))).toThrow(/repeats BL/);
    expect(() => parseCapitalsSupplement(Buffer.from(JSON.stringify({ ...file, rows: [{ ...file.rows[0], source: '' }] })))).toThrow(/source/);
  });

  test("curated capitals fill only markets GeoDist has no row for; GeoDist's own row wins", () => {
    const geodist = [{ iso2: 'ME', lat: 1, lon: 1, city: 'From GeoDist', cnum: '499' } as unknown as CapitalRow];
    const { map } = coordinateInputs({ capitals: geodist, provider_codes_without_iso: [], supplement: parseCapitalsSupplement(bytes).rows });
    expect(map.get('ME')).toEqual({ lat: 1, lon: 1 });
    expect(map.get('SS')).toEqual({ lat: 4.829975, lon: 31.580026 });
    expect(map.size).toBe(6);
  });
});
