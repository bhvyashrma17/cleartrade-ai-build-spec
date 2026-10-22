import { describe, expect, test } from 'vitest';
import {
  buildUsRegionalResult, CENSUS_ATTRIBUTION, censusFromMonth, censusQueryUrl, CensusKeyError, fetchCensusRows, parseCensusRows,
  readUsRegionalDemand, windowMonths, withoutKey, type CensusFetch, type CensusRow,
} from '../src/lib/regional-demand/census';

/**
 * The Census Bureau reader for US regional demand (D-033, docs/38): request shape, parsing, the
 * 12-month window, and how states and ports are summed. No network: every answer is a fixture in
 * the API's own shape (a JSON array whose first row names the columns, all values as strings).
 */
const STATE_HEADER = ['STATE', 'GEN_VAL_MO', 'CNT_VAL_MO', 'CNT_WGT_MO', 'VES_VAL_MO', 'VES_WGT_MO', 'AIR_VAL_MO', 'AIR_WGT_MO', 'YEAR', 'MONTH', 'I_COMMODITY', 'CTY_CODE', 'time'];
const PORT_HEADER = ['PORT', 'PORT_NAME', 'GEN_VAL_MO', 'CNT_VAL_MO', 'CNT_WGT_MO', 'VES_VAL_MO', 'VES_WGT_MO', 'AIR_VAL_MO', 'AIR_WGT_MO', 'YEAR', 'MONTH', 'I_COMMODITY', 'CTY_CODE', 'time'];
const months = ['2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08'];

const stateRow = (state: string, month: string, value: number, container = value * 0.9, weight = value / 10, air = value * 0.05, country = '5330') =>
  [state, String(value), String(container), String(weight), String(container), String(weight), String(air), '10', month.slice(0, 4), month.slice(5), '570110', country, month];
const portRow = (port: string, name: string, month: string, value: number, country = '5330') =>
  [port, name, String(value), String(value * 0.9), String(value / 10), String(value * 0.9), String(value / 10), String(value * 0.05), '10', month.slice(0, 4), month.slice(5), '570110', country, month];

function fakeCensus(overrides: Partial<Record<string, { status: number; body: string }>> = {}): { fetchImpl: CensusFetch; urls: string[] } {
  const urls: string[] = [];
  const answers: Record<string, unknown[]> = {
    'statehs:5330': [STATE_HEADER, ...months.flatMap((m) => [stateRow('NY', m, 1_000_000), stateRow('GA', m, 400_000), stateRow('CA', m, m === '2026-08' ? 100_000 : 0)])],
    'statehs:-': [STATE_HEADER, ...months.flatMap((m) => [stateRow('NY', m, 2_000_000, 0, 0, 0, '-'), stateRow('GA', m, 500_000, 0, 0, 0, '-'), stateRow('CA', m, 3_000_000, 0, 0, 0, '-'), stateRow('TX', m, 50_000, 0, 0, 0, '-')])],
    'porths:5330': [PORT_HEADER, ...months.flatMap((m) => [portRow('1001', 'NEW YORK, NY', m, 900_000), portRow('1703', 'SAVANNAH, GA', m, 450_000), portRow('2704', 'LOS ANGELES, CA', m, m === '2026-08' ? 150_000 : 0)])],
    'porths:-': [PORT_HEADER, ...months.flatMap((m) => [portRow('1001', 'NEW YORK, NY', m, 1_800_000, '-'), portRow('1703', 'SAVANNAH, GA', m, 600_000, '-'), portRow('2704', 'LOS ANGELES, CA', m, 3_100_000, '-')])],
  };
  const fetchImpl: CensusFetch = async (url) => {
    urls.push(url);
    const parsed = new URL(url);
    const key = `${parsed.pathname.split('/').at(-1)}:${parsed.searchParams.get('CTY_CODE')}`;
    const override = overrides[key];
    if (override) return { status: override.status, text: async () => override.body };
    return { status: 200, text: async () => JSON.stringify(answers[key] ?? []) };
  };
  return { fetchImpl, urls };
}

describe('Census request shape', () => {
  test('asks one HS6 and one origin from a start month, and the key can be stripped for provenance', () => {
    const url = censusQueryUrl({ dataset: 'porths', hs6: '570110', country: '5330', from: '2025-07', key: 'SECRET-KEY' });
    const parsed = new URL(url);
    expect(parsed.pathname).toBe('/data/timeseries/intltrade/imports/porths');
    expect(parsed.searchParams.get('get')).toBe('PORT,PORT_NAME,GEN_VAL_MO,CNT_VAL_MO,CNT_WGT_MO,VES_VAL_MO,VES_WGT_MO,AIR_VAL_MO,AIR_WGT_MO,YEAR,MONTH');
    expect(parsed.searchParams.get('I_COMMODITY')).toBe('570110');
    expect(parsed.searchParams.get('CTY_CODE')).toBe('5330');
    expect(parsed.searchParams.get('time')).toBe('from 2025-07');
    expect(withoutKey(url)).not.toContain('SECRET-KEY');
    expect(withoutKey(url)).toContain('I_COMMODITY=570110');
    expect(() => censusQueryUrl({ dataset: 'statehs', hs6: '5701', country: '5330', from: '2025-07', key: null })).toThrow(/six-digit/);
  });

  test('starts 15 months back so 12 full months survive the publication lag', () => {
    expect(censusFromMonth(new Date('2026-10-22T10:00:00Z'))).toBe('2025-07');
    expect(censusFromMonth(new Date('2026-03-01T00:00:00Z'))).toBe('2024-12');
  });
});

describe('Census answers', () => {
  test('rows are read by column name, states get their names and ports are title-cased', () => {
    const states = parseCensusRows([STATE_HEADER, stateRow('NY', '2026-08', 1000), stateRow('XX', '2026-08', 5), ['NY', 'x']], 'statehs');
    expect(states).toHaveLength(2);
    expect(states[0]).toMatchObject({ area: 'NY', area_name: 'New York', month: '2026-08', values: { GEN_VAL_MO: 1000, CNT_VAL_MO: 900, AIR_VAL_MO: 50 } });
    expect(states[1]!.area_name).toBe('State not identified');
    const ports = parseCensusRows([PORT_HEADER, portRow('1703', 'SAVANNAH, GA', '2026-07', 10)], 'porths');
    expect(ports[0]).toMatchObject({ area: '1703', area_name: 'Savannah, GA', month: '2026-07' });
    expect(parseCensusRows([], 'statehs')).toEqual([]);
    expect(parseCensusRows(null, 'porths')).toEqual([]);
  });

  test('204 is an empty answer; a refused key is a key error that never repeats the key; other failures say what happened', async () => {
    const answer = (status: number, body: string): CensusFetch => async () => ({ status, text: async () => body });
    const base = { dataset: 'statehs' as const, hs6: '570110', country: '5330', from: '2025-07', key: 'SECRET-KEY' };
    await expect(fetchCensusRows({ ...base, fetchImpl: answer(204, '') })).resolves.toEqual([]);
    const refused = fetchCensusRows({ ...base, fetchImpl: answer(200, '<html><body>Missing Key. A valid key must be included with each data API request.</body></html>') });
    await expect(refused).rejects.toBeInstanceOf(CensusKeyError);
    await expect(fetchCensusRows({ ...base, fetchImpl: answer(400, 'Invalid Key') })).rejects.toThrow(/CENSUS_API_KEY/);
    const failed = await fetchCensusRows({ ...base, fetchImpl: answer(500, 'error: internal') }).catch((error: Error) => error);
    expect(failed).toBeInstanceOf(Error);
    expect((failed as Error).message).toMatch(/HTTP 500/);
    expect((failed as Error).message).not.toContain('SECRET-KEY');
    const unreachable = await fetchCensusRows({ ...base, fetchImpl: async () => { throw new Error('ECONNRESET'); } }).catch((error: Error) => error);
    expect((unreachable as Error).message).toMatch(/could not be reached.*ECONNRESET/);
  });
});

describe('States and ports', () => {
  test('the window is the 12 calendar months ending at the newest month present', () => {
    const rows: CensusRow[] = months.map((month) => ({ area: 'NY', area_name: 'New York', month, values: { GEN_VAL_MO: 1, CNT_VAL_MO: 0, CNT_WGT_MO: 0, VES_VAL_MO: 0, VES_WGT_MO: 0, AIR_VAL_MO: 0, AIR_WGT_MO: 0 } }));
    expect(windowMonths(rows)).toEqual(months.slice(1));
    expect(windowMonths([])).toEqual([]);
  });

  test('India and all-origin values are summed over the window, ranked by India, with shares, containers and the rest folded in', async () => {
    const { fetchImpl, urls } = fakeCensus();
    const { result, requests } = await readUsRegionalDemand({ hs6: '570110', key: 'SECRET-KEY', now: new Date('2026-10-22T10:00:00Z'), fetchImpl });
    expect(urls).toHaveLength(4);
    expect(requests.every((url) => !url.includes('SECRET-KEY'))).toBe(true);
    expect(result).not.toBeNull();
    const r = result!;
    expect(r.period).toEqual({ from: '2025-09', to: '2026-08', months: 12, label: 'Sep 2025 – Aug 2026' });
    const [states, ports] = r.views;
    expect(states!.kind).toBe('state');
    expect(states!.areas.map((a) => a.code)).toEqual(['NY', 'GA', 'CA', 'TX']);
    expect(states!.areas[0]).toMatchObject({ name: 'New York', india_value_usd: 12_000_000, world_value_usd: 24_000_000, india_share_percent: 50, container_value_usd: 10_800_000, container_weight_kg: 1_200_000, india_months: 12 });
    expect(states!.areas[2]).toMatchObject({ code: 'CA', india_value_usd: 100_000, india_months: 1, world_value_usd: 36_000_000 });
    expect(states!.areas[3]).toMatchObject({ code: 'TX', india_value_usd: 0, india_share_percent: 0 });
    expect(ports!.areas.map((a) => a.name)).toEqual(['New York, NY', 'Savannah, GA', 'Los Angeles, CA']);
    expect(r.totals).toEqual({ india_value_usd: 16_900_000, world_value_usd: 66_600_000, india_share_percent: 25.38, container_share_percent: 90, air_share_percent: 5 });
    expect(r.source.attribution).toBe(CENSUS_ATTRIBUTION);
    expect(r.notes.join(' ')).toMatch(/destination state/);

    const folded = buildUsRegionalResult({ hs6: '570110', india: { state: parseCensusRows(JSON.parse(JSON.stringify([STATE_HEADER, ...months.flatMap((m) => [stateRow('NY', m, 3), stateRow('GA', m, 2), stateRow('CA', m, 1)])])), 'statehs'), port: [] }, world: { state: null, port: null }, retrieved_at: new Date(), requests: [], top: 2 });
    expect(folded!.views[0]!.areas.map((a) => a.code)).toEqual(['NY', 'GA']);
    expect(folded!.views[0]!.others).toEqual({ count: 1, india_value_usd: 12, world_value_usd: null });
    expect(folded!.totals.india_share_percent).toBeNull();
    expect(folded!.notes.join(' ')).toMatch(/all-countries figures could not be read/);
  });

  test('a failed all-countries answer drops the shares but not the run; a refused key still stops it', async () => {
    const partial = fakeCensus({ 'statehs:-': { status: 400, body: 'error: unknown predicate' } });
    const { result } = await readUsRegionalDemand({ hs6: '570110', key: 'k', now: new Date('2026-10-22T10:00:00Z'), fetchImpl: partial.fetchImpl });
    expect(result!.totals.world_value_usd).toBeNull();
    expect(result!.views[0]!.areas[0]!.world_value_usd).toBeNull();
    expect(result!.views[1]!.areas[0]!.world_value_usd).toBe(21_600_000);
    const refused = fakeCensus({ 'porths:-': { status: 200, body: 'Invalid Key: the key is not activated' } });
    await expect(readUsRegionalDemand({ hs6: '570110', key: 'k', now: new Date(), fetchImpl: refused.fetchImpl })).rejects.toBeInstanceOf(CensusKeyError);
  });

  test('nothing recorded at all is no result', async () => {
    const empty: CensusFetch = async () => ({ status: 204, text: async () => '' });
    const { result } = await readUsRegionalDemand({ hs6: '570110', key: 'k', now: new Date(), fetchImpl: empty });
    expect(result).toBeNull();
  });
});
