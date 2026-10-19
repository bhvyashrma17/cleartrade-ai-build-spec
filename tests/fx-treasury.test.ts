import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { createUsdRateResolver } from '../src/lib/demand-discovery-v5/fx';
import { ingestTreasuryRates, parseTreasuryRates, TREASURY_CURRENCY_CODES, TREASURY_PROVIDER, TREASURY_UNMAPPED_DESCRIPTIONS, treasuryRequestUrl } from '../src/lib/fx/treasury';
import { prisma } from '../src/lib/prisma';

/**
 * D-028: US Treasury reporting rates for floating currencies the ECB does not publish. The fixture
 * is the live Fiscal Data response for the record date 30 Sep 2026 (168 rows, retrieved 18 Oct 2026
 * through the owner's browser, sha256 4cfa4df8…53a8), including three amendments effective 15 Oct.
 */
const FIXTURE = readFileSync(new URL('./fixtures/treasury-rates-of-exchange-2026-09-30.json', import.meta.url), 'utf8');
/** The same response moved to other years, so each test's stored rows are its own. */
const shifted = (year: number) => FIXTURE.replaceAll('2026-09-30', `${year}-09-30`).replaceAll('2026-10-15', `${year}-10-15`);

afterEach(() => vi.restoreAllMocks());

/** Stand-ins for the ECB SDMX service and the Treasury API on one `fetch`. */
function providers(args: { ecb: Record<string, string | number>; treasury?: string | number }) {
  const calls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    if (url.startsWith('https://api.fiscaldata.treasury.gov/')) {
      if (args.treasury == null) throw new Error(`unexpected Treasury request ${url}`);
      return typeof args.treasury === 'number' ? new Response('', { status: args.treasury }) : new Response(args.treasury, { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const currency = new URL(url).pathname.split('/').pop()!.split('.')[1]!;
    const body = args.ecb[currency];
    if (body == null) throw new Error(`unexpected ECB request ${url}`);
    return typeof body === 'number' ? new Response('', { status: body }) : new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });
  });
  return calls;
}
const ecbCsv = (currency: string, rows: [string, string][]) => ['KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE', ...rows.map(([date, value]) => `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${date},${value},A,"${currency}/Euro"`)].join('\n');

describe('US Treasury reporting rates (D-028)', () => {
  test('the live response parses: every description is mapped or deliberately left out, amendments kept with their own date', () => {
    const parsed = parseTreasuryRates(FIXTURE);
    expect(parsed.total_count).toBe(168);
    expect(parsed.next).toBeNull();
    expect(parsed.unrecognised).toEqual([]);
    expect(parsed.skipped).toBe(10);
    expect(parsed.rows).toHaveLength(158);
    const descriptions = new Set((JSON.parse(FIXTURE).data as { country_currency_desc: string }[]).map((row) => row.country_currency_desc));
    // The map names nothing the source no longer publishes, and leaves out only what it means to.
    expect(Object.keys(TREASURY_CURRENCY_CODES).filter((desc) => !descriptions.has(desc))).toEqual([]);
    expect([...descriptions].filter((desc) => !(desc in TREASURY_CURRENCY_CODES)).sort()).toEqual([...TREASURY_UNMAPPED_DESCRIPTIONS].sort());
    expect(Object.values(TREASURY_CURRENCY_CODES).every((code) => /^[A-Z]{3}$/.test(code))).toBe(true);
    const find = (currency: string) => parsed.rows.filter((row) => row.currency === currency);
    expect(find('LKR')).toEqual([{ country_currency_desc: 'Sri Lanka-Rupee', currency: 'LKR', units_per_usd: '330.4', effective_date: '2026-09-30', record_date: '2026-09-30' }]);
    expect(find('VND')[0]).toMatchObject({ units_per_usd: '25959.0' });
    expect(find('IRR').map((row) => [row.effective_date, row.units_per_usd])).toEqual([['2026-09-30', '1374100.0'], ['2026-10-15', '1779500.0']]);
    expect(find('XOF')).toHaveLength(8);
    expect(() => parseTreasuryRates('<html>')).toThrow('not JSON');
    expect(() => parseTreasuryRates('{"meta":{}}')).toThrow('no data array');
  });

  test('a request names its start date in the form the live API accepted', () => {
    expect(treasuryRequestUrl('2026-06-20')).toBe('https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/rates_of_exchange?fields=country_currency_desc,exchange_rate,effective_date,record_date&filter=record_date:gte:2026-06-20&sort=-record_date,country_currency_desc&page[size]=10000&page[number]=1');
    expect(() => treasuryRequestUrl('June')).toThrow('YYYY-MM-DD');
  });

  test('an ingest keeps the raw response and one observation per row; the same rows again are not duplicated', async () => {
    const body = shifted(2041);
    const calls = providers({ ecb: {}, treasury: body });
    const first = await ingestTreasuryRates({ since: '2041-06-01' });
    expect(first).toMatchObject({ status: 'stored', http_status: 200, observations: 158, unrecognised: [] });
    const snapshot = await prisma.authoritativeFxSnapshot.findUniqueOrThrow({ where: { id: first.snapshot_ids[0]! } });
    expect(snapshot).toMatchObject({ provider: TREASURY_PROVIDER, raw_response_text: body, status: 'accepted' });
    expect(await prisma.authoritativeFxObservation.findMany({ where: { provider: TREASURY_PROVIDER, quote_currency: 'IRR', observation_date: { gte: new Date('2041-09-01T00:00:00Z') } }, select: { rate: true, observation_status: true, base_currency: true }, orderBy: { observation_date: 'asc' } }))
      .toEqual([
        { rate: expect.objectContaining({}), observation_status: 'A', base_currency: 'USD' },
        { rate: expect.objectContaining({}), observation_status: 'amended', base_currency: 'USD' },
      ]);
    const again = await ingestTreasuryRates({ since: '2041-06-01' });
    expect(again).toMatchObject({ status: 'stored', observations: 0 });
    expect(calls).toHaveLength(2);
    providers({ ecb: {}, treasury: 503 });
    expect(await ingestTreasuryRates({ since: '2041-06-01' })).toMatchObject({ status: 'failed', http_status: 503, reason: 'The Treasury rates API returned 503.' });
  });

  test('a floating currency the ECB lacks converts at the Treasury rate, fetched once when none is stored', async () => {
    const calls = providers({ ecb: { LKR: 404, VND: 404, USD: ecbCsv('USD', [['2042-10-01', '1.10']]) }, treasury: shifted(2042) });
    const resolver = createUsdRateResolver({ as_of: new Date('2042-10-02T09:00:00Z'), lookback_days: 7, fetch_missing: true, treasury: { enabled: true, lookback_days: 120 } });
    const lkr = await resolver.usd('LKR');
    expect(lkr.rate).toBeCloseTo(1 / 330.4, 12);
    expect(lkr.frozen).toMatchObject({ currency: 'LKR', derivation: 'treasury_reporting_rate', observation_date: '2042-09-30', source: { provider: TREASURY_PROVIDER, series_key: 'rates_of_exchange:Sri Lanka-Rupee', units_per_usd: '330.4' } });
    expect((await resolver.usd('VND')).rate).toBeCloseTo(1 / 25959, 12);
    // One Treasury request for both currencies; the ECB was asked for each and said it has no series.
    expect(calls.filter((url) => url.includes('fiscaldata'))).toHaveLength(1);
    expect((await resolver.fetches()).map((record) => [record.currency, record.provider ?? 'ecb', record.status])).toEqual([
      ['ALL', 'us_treasury', 'stored'], ['LKR', 'ecb', 'unavailable'], ['USD', 'ecb', 'stored'], ['VND', 'ecb', 'unavailable'],
    ]);

    // Amendments apply from their own date; a later run reads what is stored and fetches nothing.
    providers({ ecb: { IRR: 404, USD: ecbCsv('USD', [['2042-10-16', '1.10']]) } });
    const before = createUsdRateResolver({ as_of: new Date('2042-10-10T09:00:00Z'), lookback_days: 7, fetch_missing: false, treasury: { enabled: true, lookback_days: 120 } });
    const after = createUsdRateResolver({ as_of: new Date('2042-10-16T09:00:00Z'), lookback_days: 7, fetch_missing: false, treasury: { enabled: true, lookback_days: 120 } });
    expect((await before.usd('IRR')).rate).toBeCloseTo(1 / 1374100, 15);
    expect(await after.usd('IRR')).toMatchObject({ rate: expect.closeTo(1 / 1779500, 15), frozen: { observation_date: '2042-10-15', source: { status: 'amended' } } });
  });

  test('never for a currency the ECB quotes, never past the lookback, and not at all with the switch off', async () => {
    providers({ ecb: { INR: 503, USD: ecbCsv('USD', [['2043-10-01', '1.10']]), LKR: 404 }, treasury: shifted(2043) });
    const resolver = createUsdRateResolver({ as_of: new Date('2043-10-02T09:00:00Z'), lookback_days: 7, fetch_missing: true, treasury: { enabled: true, lookback_days: 120 } });
    // The ECB failed for INR: a quarter-old Treasury rate is not used in its place.
    expect(await resolver.usd('INR')).toMatchObject({ rate: null, frozen: { status: 'unavailable' } });
    expect((await resolver.fetches()).some((record) => record.provider === 'us_treasury')).toBe(false);
    expect((await resolver.usd('LKR')).rate).toBeCloseTo(1 / 330.4, 12);

    providers({ ecb: { LKR: 404, USD: ecbCsv('USD', [['2044-03-01', '1.10']]) } });
    const stale = createUsdRateResolver({ as_of: new Date('2044-03-02T09:00:00Z'), lookback_days: 7, fetch_missing: false, treasury: { enabled: true, lookback_days: 120 } });
    expect(await stale.usd('LKR')).toMatchObject({ rate: null, frozen: { reason: expect.stringContaining('No US Treasury reporting rate for LKR is held within 120 days') } });
    const off = createUsdRateResolver({ as_of: new Date('2043-10-02T09:00:00Z'), lookback_days: 7, fetch_missing: false, treasury: { enabled: false, lookback_days: 120 } });
    expect((await off.usd('LKR')).rate).toBeNull();
  });
});
