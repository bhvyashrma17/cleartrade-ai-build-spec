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

/**
 * A stand-in for the ECB SDMX service: `series` maps a currency to its CSV, to an HTTP status, or to
 * a list of those answered in turn (the last one repeats).
 */
function ecb(series: Record<string, string | number | (string | number)[]>) {
  const calls: URL[] = [];
  const asked = new Map<string, number>();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    calls.push(url);
    const currency = url.pathname.split('/').pop()!.split('.')[1]!;
    const answers = series[currency];
    if (answers == null) throw new Error(`unexpected ECB request ${url}`);
    const turn = asked.get(currency) ?? 0;
    asked.set(currency, turn + 1);
    const body = Array.isArray(answers) ? answers[Math.min(turn, answers.length - 1)]! : answers;
    return typeof body === 'number' ? new Response('', { status: body }) : new Response(body, { status: 200, headers: { 'content-type': 'text/csv' } });
  });
  return calls;
}
const asked = (calls: URL[], currency: string) => calls.filter((url) => url.pathname.endsWith(ecbSeriesKey(currency))).length;

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

  test('a request that fails twice leaves the rate unavailable and is recorded as failed; an ECB 404 is a fact, asked once', async () => {
    const calls = ecb({ JPY: 503, USD: csv('USD', [['2032-03-01', '1.2']]), XAU: 404 });
    const resolver = createUsdRateResolver({ as_of: new Date('2032-03-02T09:00:00Z'), lookback_days: 7, fetch_missing: true, retry_delay_ms: 0 });
    expect(await resolver.usd('JPY')).toMatchObject({ rate: null, frozen: { currency: 'JPY', status: 'unavailable' } });
    expect(await resolver.usd('XAU')).toMatchObject({ rate: null, frozen: { currency: 'XAU', status: 'unavailable' } });
    expect(await resolver.fetches()).toMatchObject([
      { currency: 'JPY', status: 'failed', http_status: 503, reason: 'ECB SDMX returned 503.', attempts: 2 },
      { currency: 'USD', status: 'stored', observations: 1, attempts: 1 },
      { currency: 'XAU', status: 'unavailable', http_status: 404, reason: expect.stringContaining('no reference-rate series for XAU'), attempts: 1 },
    ]);
    expect([asked(calls, 'JPY'), asked(calls, 'USD'), asked(calls, 'XAU')]).toEqual([2, 1, 1]);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('getaddrinfo ENOTFOUND data-api.ecb.europa.eu'));
    const offline = createUsdRateResolver({ as_of: new Date('2033-01-05T09:00:00Z'), lookback_days: 7, fetch_missing: true, retry_delay_ms: 0 });
    expect((await offline.usd('GBP')).rate).toBeNull();
    expect((await offline.fetches()).map((item) => [item.currency, item.status, item.reason, item.attempts])).toEqual([
      ['GBP', 'failed', 'getaddrinfo ENOTFOUND data-api.ecb.europa.eu', 2],
      ['USD', 'failed', 'getaddrinfo ENOTFOUND data-api.ecb.europa.eu', 2],
    ]);
  });

  test('a failed request is tried once more after the wait, and a second answer that works is used (E-056)', async () => {
    // On 9 Nov 2026 one ECB 504 for IDR left a production run partial.
    const calls = ecb({ IDR: [504, csv('IDR', [['2037-05-04', '17500']])], USD: csv('USD', [['2037-05-04', '1.10']]) });
    const resolver = createUsdRateResolver({ as_of: new Date('2037-05-05T09:00:00Z'), lookback_days: 7, fetch_missing: true, retry_delay_ms: 25 });
    const started = Date.now();
    expect((await resolver.usd('IDR')).rate).toBeCloseTo(1.10 / 17500, 12);
    expect(Date.now() - started).toBeGreaterThanOrEqual(20);
    expect(await resolver.fetches()).toMatchObject([
      { currency: 'IDR', status: 'stored', http_status: 200, observations: 1, attempts: 2 },
      { currency: 'USD', status: 'stored', attempts: 1 },
    ]);
    expect([asked(calls, 'IDR'), asked(calls, 'USD')]).toEqual([2, 1]);
  });

  test('a pegged currency the ECB does not publish converts through its anchor, with no request for its own series (D-025)', async () => {
    const calls = ecb({
      USD: csv('USD', [['2035-04-10', '1.10']]),
      INR: csv('INR', [['2035-04-10', '99']]),
    });
    const peg = (currency: string, anchor: string, rates: { units_per_anchor?: string; anchor_per_unit?: string }) => ({
      currency, anchor, units_per_anchor: rates.units_per_anchor ?? null, anchor_per_unit: rates.anchor_per_unit ?? null,
      authority: 'Fixture authority', basis: 'Fixture parity for the test.', source_url: 'https://example.test/peg', source_kind: 'official' as const,
    });
    const pegs = [peg('SAR', 'USD', { units_per_anchor: '3.75' }), peg('OMR', 'USD', { anchor_per_unit: '2.6008' }), peg('XOF', 'EUR', { units_per_anchor: '655.957' }), peg('NPR', 'INR', { units_per_anchor: '1.6' }), peg('ZZZ', 'GBP', { units_per_anchor: '2' })];
    const resolver = createUsdRateResolver({ as_of: new Date('2035-04-11T09:00:00Z'), lookback_days: 7, fetch_missing: true, pegs, retry_delay_ms: 0 });

    expect(await resolver.usd('SAR')).toMatchObject({ rate: expect.closeTo(1 / 3.75, 12), frozen: { currency: 'SAR', derivation: 'peg', peg: { anchor: 'USD', units_per_anchor: '3.75', source_kind: 'official' }, anchor_rate: { derivation: 'identity' } } });
    expect((await resolver.usd('OMR')).rate).toBeCloseTo(2.6008, 12);
    // The CFA franc: USD per euro from the ECB, times euros per franc.
    expect((await resolver.usd('XOF')).rate).toBeCloseTo(1.10 / 655.957, 12);
    // The Nepalese rupee: USD per Indian rupee (an ECB cross rate), divided by 1.6.
    expect(await resolver.usd('NPR')).toMatchObject({ rate: expect.closeTo(1.10 / 99 / 1.6, 12), frozen: { anchor_rate: { currency: 'INR', derivation: 'cross_via_eur', observation_date: '2035-04-10' } } });
    // Only the anchors were asked for; no request ever named a pegged currency.
    expect(calls.map((url) => url.pathname.split('/').pop()).sort()).toEqual([ecbSeriesKey('INR'), ecbSeriesKey('USD')]);

    // An anchor without a rate leaves the pegged currency unavailable, saying why.
    vi.restoreAllMocks();
    ecb({ GBP: 503 });
    expect(await resolver.usd('ZZZ')).toMatchObject({ rate: null, frozen: { status: 'unavailable', reason: expect.stringContaining('ZZZ is fixed to GBP, and the GBP rate is unavailable') } });
  });

  test('a stored ECB rate comes before a peg for the same currency', async () => {
    ecb({ USD: csv('USD', [['2036-09-01', '1.2']]), GBP: csv('GBP', [['2036-09-01', '0.8']]) });
    const pegs = [{ currency: 'GBP', anchor: 'USD', units_per_anchor: '5', anchor_per_unit: null, authority: 'Fixture', basis: 'A peg that must lose to the ECB.', source_url: 'https://example.test/peg', source_kind: 'reference' as const }];
    const warm = createUsdRateResolver({ as_of: new Date('2036-09-02T09:00:00Z'), lookback_days: 7, fetch_missing: true });
    await warm.usd('GBP');
    const resolver = createUsdRateResolver({ as_of: new Date('2036-09-02T09:00:00Z'), lookback_days: 7, fetch_missing: true, pegs });
    expect(await resolver.usd('GBP')).toMatchObject({ rate: expect.closeTo(1.2 / 0.8, 12), frozen: { derivation: 'cross_via_eur' } });
  });

  test('with fetching switched off, a missing rate stays missing and nothing is requested', async () => {
    const calls = ecb({});
    const resolver = createUsdRateResolver({ as_of: new Date('2034-07-01T09:00:00Z'), lookback_days: 7, fetch_missing: false });
    expect(await resolver.usd('INR')).toMatchObject({ rate: null, frozen: { status: 'unavailable', reason: expect.stringContaining('No published observation') } });
    expect(await resolver.fetches()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
