import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { manifestEntryFor, readReferenceManifest } from '../src/lib/reference-datasets/manifest';
import { referenceDatasetDefinition } from '../src/lib/reference-datasets/registry';
import { parseSanctionsProgrammes, SANCTIONS_PROGRAMMES_KEY, sanctionsFlagsByMarket } from '../src/lib/reference-datasets/sanctions-programmes';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '../src/lib/demand-discovery-v5/policy';

/** D-025: country-level sanctions programmes, shown as flags on markets. */
const bytes = readFileSync(join(__dirname, '..', 'data', 'reference', 'sanctions-programmes-v1.json'));

describe('sanctions programmes', () => {
  test('the curated file parses with a legal basis and source per row, and is in the manifest', () => {
    const parsed = parseSanctionsProgrammes(bytes);
    expect(parsed.checked_on).toBe('2026-10-17');
    expect(parsed.rows).toHaveLength(24);
    expect([...new Set(parsed.rows.filter((row) => row.authority === 'UN').map((row) => row.country_code))]).toEqual(['AF', 'CD', 'CF', 'GW', 'HT', 'IQ', 'IR', 'KP', 'LB', 'LY', 'SD', 'SO', 'SS', 'YE']);
    expect(parsed.rows.filter((row) => row.scope === 'comprehensive').map((row) => `${row.country_code}:${row.authority}`)).toEqual(['CU:US', 'IR:US', 'KP:UN', 'KP:US', 'KP:EU']);
    expect(parsed.rows.every((row) => row.source_url.startsWith('https://') && row.legal_reference.length > 5)).toBe(true);
    expect(referenceDatasetDefinition(SANCTIONS_PROGRAMMES_KEY).parse(bytes)).toMatchObject({ version: 'sanctions-programmes-v1 checked 2026-10-17' });
    expect(manifestEntryFor(readReferenceManifest(), bytes)).toMatchObject({ dataset_key: SANCTIONS_PROGRAMMES_KEY, derived_from: null });
  });

  test('flags read UN first, then US and EU; the only outright exclusion stays the policy one', () => {
    const flags = sanctionsFlagsByMarket(parseSanctionsProgrammes(bytes).rows);
    expect(flags.get('IR')).toEqual([
      'UN: sanctions on arms, nuclear and missile goods, re-imposed in September 2025',
      'US: embargo with secondary sanctions; most banks refuse Iran trade',
      'EU: non-proliferation sanctions, including the UN measures re-imposed in 2025',
    ]);
    expect(flags.get('RU')).toHaveLength(2);
    expect(flags.has('IN')).toBe(false);
    expect(Object.keys(POLICY.excluded_markets)).toEqual(['KP']);
  });

  test('a repeated programme for one market, or a row without its basis, refuses the file', () => {
    const file = JSON.parse(bytes.toString('utf8')) as { rows: Record<string, unknown>[] };
    const refuse = (rows: Record<string, unknown>[]) => () => parseSanctionsProgrammes(Buffer.from(JSON.stringify({ ...file, rows })));
    expect(refuse([...file.rows, file.rows[0]!])).toThrow(/repeats UN/);
    expect(refuse([{ ...file.rows[0]!, legal_reference: '' }])).toThrow(/legal_reference/);
    expect(refuse([{ ...file.rows[0]!, scope: 'partial' }])).toThrow(/scope/);
  });
});
