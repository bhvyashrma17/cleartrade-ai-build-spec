import { describe, expect, test, vi } from 'vitest';
import { createUsdRateResolver } from '../src/lib/demand-discovery-v5/fx';
import { ecbSeriesKey } from '../src/lib/fx/ecb';
import { prisma } from '../src/lib/prisma';

/**
 * A v5 run's exchange rates (E-018): stored ECB observations first; when none cover the run's date,
 * the run fetches the missing series over its lookback window, keeps them, and derives again. Rates
 * are invented; each test uses its own years so stored rows from one cannot satisfy another.
 */
const HEADER = 'KEY,FREQ,CURRENCY,CURRENCY_DENOM,EXR_TYPE,EXR_SUFFIX,TIME_PERIOD,OBS_VALUE,OBS_STATUS,TITLE';
const csv = (currency: string, rows: [string, string][]) => [HEADER, ...rows.map(([date, value]) => `EXR.D.${currency}.EUR.SP00.A,D,${currency},EUR,SP00,A,${date},${value},A,"ECB reference exchange rate, ${currency}/Euro"`)].join('\n');

/** A stand-in for the ECB SDMX service: `series` maps a currency to its CSV, or to an HTTP status. */
function ecb(series: Record<string, string | number>) {
  const calls: URL[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    const currency = url.pathname.split('/').pop()!.split('.')[1]!;
    const body = series[currency];
    if (body == null) throw new Error(`unexpected ECB request ${url}`);
    return typeof body === 'number' ? new Response('', { status: body }) : new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });
  });
  return calls;
}

describe('v5 exchange rates', () => {
  test('fetches the missing ECB series over the lookback window, stores them, and derives the cross rate', async () => {
    const calls = ecb({
      INR: csv('INR', [['2030-06-12', '100'], ['2030-06-13', '102']]),
      USD: csv('USD', [['2030-06-12', '1.10'], ['2030-06-13', '1.122']]),
    });
    const resolver = createUsdRateResolver({ as_of: new Date('2030-06-14T10:00:00Z'), lookback_days: 7, fetch_missing: true });
    const inr = await resolver.usd('inr');
    expect(inr.rate).toBeCloseTo(1.122 / 102, 10);
    expect(inr.frozen).toMatchObject({ currency: 'INR', observation_date: '2030-06-13', derivation: 'cross_via_eur' });
    expect(calls.map((url) => url.pathname.split('/').pop()).sort()).toEqual([ecbSeriesKey('INR'), ecbSeriesKey('USD')]);
    expect(calls.every((url) => url.searchParams.get('startPeriod') === '2030-06-07' && url.searchParams.get('endPeriod') === '2030-06-14')).toBe(true);
    expect(await resolver.fetches()).toMatchObject([
      { currency: 'INR', status: 'stored', observations: 2, http_status: 200, snapshot_id: expect.any(String) },
      { currency: 'USD', status: 'stored', observations: 2, http_status: 200, snapshot_id: expect.any(String) },
    ]);
    expect(await prisma.authoritativeFxObservation.count({ where: { environment: 'test', quote_currency: { in: ['INR', 'USD'] }, observation_date: { gte: new Date('2030-06-12T00:00:00Z'), lte: new Date('2030-06-13T00:00:00Z') } } })).toBe(4);

    // The same rate again in this run, and a later run on the same day, read what is stored: no new request.
    expect((await resolver.usd('INR')).rate).toBe(inr.rate);
    const later = createUsdRateResolver({ as_of: new Date('2030-06-14T15:00:00Z'), lookback_days: 7, fetch_missing: true });
    expect((await later.usd('INR')).rate).toBeCloseTo(inr.rate!, 12);
    expect(await later.fetches()).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  test('the euro needs only the dollar leg; US dollars and malformed codes need no request at all', async () => {
    const calls = ecb({ USD: csv('USD', [['2031-02-03', '1.05']]) });
    const resolver = createUsdRateResolver({ as_of: new Date('2031-02-04T09:00:00Z'), lookback_days: 7, fetch_missing: true });
    expect((await resolver.usd('EUR')).rate).toBeCloseTo(1.05, 10);
    expect(await resolver.usd('USD')).toEqual({ rate: 1, frozen: { currency: 'USD', rate: 1, derivation: 'identity' } });
    expect(await resolver.usd('RUPEES')).toMatchObject({ rate: null, frozen: { status: 'unavailable', reason: expect.stringContaining('ISO 4217') } });
    expect(await resolver.usd(null)).toEqual({ rate: null, frozen: null });
    expect(calls.map((url) => url.pathname.split('/').pop())).toEqual([ecbSeriesKey('USD')]);
  });

  test('a failed request leaves the rate unavailable and is recorded as failed; an ECB 404 is a fact, not a failure', async () => {
    ecb({ JPY: 503, USD: csv('USD', [['2032-03-01', '1.2']]), XAU: 404 });
    const resolver = createUsdRateResolver({ as_of: new Date('2032-03-02T09:00:00Z'), lookback_days: 7, fetch_missing: true });
    expect(await resolver.usd('JPY')).toMatchObject({ rate: null, frozen: { currency: 'JPY', status: 'unavailable' } });
    expect(await resolver.usd('XAU')).toMatchObject({ rate: null, frozen: { currency: 'XAU', status: 'unavailable' } });
    expect(await resolver.fetches()).toMatchObject([
      { currency: 'JPY', status: 'failed', http_status: 503, reason: 'ECB SDMX returned 503.' },
      { currency: 'USD', status: 'stored', observations: 1 },
      { currency: 'XAU', status: 'unavailable', http_status: 404, reason: expect.stringContaining('no reference-rate series for XAU') },
    ]);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND data-api.ecb.europa.eu'));
    const offline = createUsdRateResolver({ as_of: new Date('2033-01-05T09:00:00Z'), lookback_days: 7, fetch_missing: true });
    expect((await offline.usd('GBP')).rate).toBeNull();
    expect((await offline.fetches()).map((item) => [item.currency, item.status, item.reason])).toEqual([
      ['GBP', 'failed', 'getaddrinfo ENOTFOUND data-api.ecb.europa.eu'],
      ['USD', 'failed', 'getaddrinfo ENOTFOUND data-api.ecb.europa.eu'],
    ]);
  });

  test('with fetching switched off, a missing rate stays missing and nothing is requested', async () => {
    const calls = ecb({});
    const resolver = createUsdRateResolver({ as_of: new Date('2034-07-01T09:00:00Z'), lookback_days: 7, fetch_missing: false });
    expect(await resolver.usd('INR')).toMatchObject({ rate: null, frozen: { status: 'unavailable', reason: expect.stringContaining('No published observation') } });
    expect(await resolver.fetches()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
