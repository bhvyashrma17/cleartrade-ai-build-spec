import { describe, expect, test } from 'vitest';
import { batchedQueryUrl, ComtradeBatchError, fetchBatchedComtrade, parseBatchedPage, type BatchedComtradeQuery, type BatchedComtradeRow } from '../src/lib/comtrade/batch';
import { ComtradeProviderRequestError, ComtradeRateLimitError } from '../src/lib/comtrade/client';
import { comtradePartnerIdentity, fallbackMarketSeries, indiaExportFlows, newestYearInputs } from '../src/lib/demand-discovery-v5/comtrade-inputs';

/** Rows in the provider's documented response shape; values invented. */
function apiRow(reporter: string, partner: string, period: number, value: unknown, extra: Record<string, unknown> = {}) {
  return { reporterCode: Number(reporter), partnerCode: Number(partner), partner2Code: 0, cmdCode: '100630', period, refYear: period, flowCode: 'M', freqCode: 'A', customsCode: 'C00', motCode: 0, primaryValue: value, netWgt: 10, isNetWgtEstimated: false, classificationCode: 'H6', isOriginalClassification: true, ...extra };
}
const body = (rows: unknown[]) => JSON.stringify({ elapsedTime: '0.1 secs', count: rows.length, data: rows, error: '' });
const QUERY: BatchedComtradeQuery = { hs6: '100630', flow: 'M', periods: [2024, 2025], reporters: 'all', partners: ['0', '699'], max_records: 3 };
const POLICY = { max_retries: 2, retry_backoff_ms: 0, request_timeout_ms: 1_000, request_delay_ms: 0 };

type Responder = (url: URL) => { status: number; text: string; headers?: Record<string, string> };
function fakeFetch(responder: Responder) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const answer = responder(url);
    return new Response(answer.text, { status: answer.status, headers: answer.headers });
  }) as typeof fetch;
  return { impl, calls };
}
const deps = (impl: typeof fetch, extra: Record<string, unknown> = {}) => ({ api_key: 'test-key', policy: POLICY, reporter_universe: ['4', '8', '12', '16'], fetch: impl, sleep: async () => {}, ...extra });

describe('batched Comtrade query', () => {
  test('one call names the product, flow, periods and partners; every reporter means the parameter is left out', () => {
    const url = batchedQueryUrl(QUERY);
    expect(Object.fromEntries(url.searchParams)).toEqual({ cmdCode: '100630', flowCode: 'M', period: '2024,2025', partnerCode: '0,699', partner2Code: '0', customsCode: 'C00', motCode: '0', breakdownMode: 'classic', maxRecords: '3', includeDesc: 'false' });
    expect(batchedQueryUrl({ ...QUERY, reporters: ['842', '36'] }).searchParams.get('reporterCode')).toBe('36,842');
    expect(() => batchedQueryUrl({ ...QUERY, hs6: '1006' })).toThrow(/six-digit/);
    expect(() => batchedQueryUrl({ ...QUERY, periods: Array.from({ length: 13 }, (_, index) => 2010 + index) })).toThrow(/12 periods/);
    expect(() => batchedQueryUrl({ ...QUERY, partners: ['World'] })).toThrow(/numeric/);
  });

  test('rows must answer the question asked: anything else is rejected and counted, never reinterpreted', () => {
    const parsed = parseBatchedPage(JSON.parse(body([
      apiRow('842', '0', 2024, 1000),
      apiRow('842', '699', 2024, 0),
      apiRow('842', '156', 2024, 5),
      apiRow('842', '0', 2023, 5),
      apiRow('842', '0', 2024, 7),
      apiRow('276', '0', 2024, 5, { cmdCode: '100640' }),
      apiRow('276', '0', 2024, 5, { flowCode: 'X' }),
      apiRow('276', '699', 2024, null),
    ])), QUERY);
    expect(parsed.rows.map((row) => [row.reporter_code, row.partner_code, row.period, row.value_usd, row.value_status])).toEqual([
      ['842', '0', 2024, 1000, 'observed'], ['842', '699', 2024, 0, 'observed_zero'], ['276', '699', 2024, null, 'missing'],
    ]);
    expect(parsed).toMatchObject({ returned: 8, rejected: 5, provider_count: 8 });
    expect(() => parseBatchedPage({ error: 'Invalid subscription key' }, QUERY)).toThrow(/no data array: Invalid subscription key/);
  });
});

describe('batched Comtrade execution', () => {
  test('a page at the cap splits by period, then into reporter halves; only uncapped pages give rows', async () => {
    const { impl, calls } = fakeFetch((url) => {
      const period = url.searchParams.get('period');
      const reporters = url.searchParams.get('reporterCode');
      if (period === '2024,2025') return { status: 200, text: body([apiRow('4', '0', 2024, 1), apiRow('8', '0', 2024, 1), apiRow('12', '0', 2025, 1)]) };
      if (period === '2024') return { status: 200, text: body([apiRow('4', '0', 2024, 1), apiRow('8', '0', 2024, 2)]) };
      if (period === '2025' && !reporters) return { status: 200, text: body([apiRow('4', '0', 2025, 1), apiRow('8', '0', 2025, 1), apiRow('12', '0', 2025, 1)]) };
      if (reporters === '4,8') return { status: 200, text: body([apiRow('4', '0', 2025, 3), apiRow('8', '699', 2025, 4)]) };
      if (reporters === '12,16') return { status: 200, text: body([apiRow('12', '0', 2025, 5)]) };
      throw new Error(`unexpected ${url}`);
    });
    const result = await fetchBatchedComtrade(QUERY, deps(impl));
    expect(calls.map((call) => `${call.url.searchParams.get('period')}|${call.url.searchParams.get('reporterCode') ?? 'all'}`)).toEqual(['2024,2025|all', '2024|all', '2025|all', '2025|4,8', '2025|12,16']);
    expect(result.pages.map((page) => page.reached_cap)).toEqual([true, false, true, false, false]);
    expect(result.rows.map((row) => `${row.reporter_code}:${row.partner_code}:${row.period}=${row.value_usd}`)).toEqual(['4:0:2024=1', '8:0:2024=2', '4:0:2025=3', '8:699:2025=4', '12:0:2025=5']);
    expect(result).toMatchObject({ physical_calls: 5, complete: true });
    expect(result.pages[0].response_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  test('a single reporter-year still at the cap is refused, not truncated', async () => {
    const { impl } = fakeFetch(() => ({ status: 200, text: body([apiRow('4', '0', 2024, 1)]) }));
    await expect(fetchBatchedComtrade({ ...QUERY, periods: [2024], reporters: ['4'], max_records: 1 }, deps(impl))).rejects.toBeInstanceOf(ComtradeBatchError);
  });

  test('retries a 5xx and a 429, gives up on a persistent 429, and never retries a 4xx', async () => {
    let attempt = 0;
    const flaky = fakeFetch(() => (attempt++ === 0 ? { status: 503, text: 'busy' } : { status: 200, text: body([apiRow('4', '0', 2024, 1)]) }));
    expect((await fetchBatchedComtrade({ ...QUERY, max_records: 100 }, deps(flaky.impl))).physical_calls).toBe(2);

    let limited = 0;
    const once = fakeFetch(() => (limited++ === 0 ? { status: 429, text: '', headers: { 'retry-after': '0' } } : { status: 200, text: body([]) }));
    expect((await fetchBatchedComtrade({ ...QUERY, max_records: 100 }, deps(once.impl))).physical_calls).toBe(2);

    const always = fakeFetch(() => ({ status: 429, text: '', headers: { 'retry-after': '0' } }));
    await expect(fetchBatchedComtrade({ ...QUERY, max_records: 100 }, deps(always.impl))).rejects.toBeInstanceOf(ComtradeRateLimitError);
    expect(always.calls).toHaveLength(3);

    const bad = fakeFetch(() => ({ status: 400, text: '{"error":"bad period"}' }));
    await expect(fetchBatchedComtrade({ ...QUERY, max_records: 100 }, deps(bad.impl))).rejects.toBeInstanceOf(ComtradeProviderRequestError);
    expect(bad.calls).toHaveLength(1);
  });

  test('the key travels only as a header, quota is reserved before every physical call, and a refusal stops the run', async () => {
    const { impl, calls } = fakeFetch(() => ({ status: 200, text: body([]), headers: { 'x-ratelimit-remaining': '497' } }));
    let reserved = 0;
    const result = await fetchBatchedComtrade({ ...QUERY, max_records: 100 }, deps(impl, { before_physical_request: async () => { reserved += 1; } }));
    expect(calls[0].headers).toEqual({ 'Ocp-Apim-Subscription-Key': 'test-key' });
    expect(calls[0].url.toString()).not.toContain('test-key');
    expect(result.pages[0].url).not.toContain('test-key');
    expect(result.pages[0].quota.remaining).toBe(497);
    expect(reserved).toBe(1);
    await expect(fetchBatchedComtrade({ ...QUERY, max_records: 100 }, deps(impl, { before_physical_request: async () => { throw new Error('quota exhausted'); } }))).rejects.toThrow(/quota exhausted/);
  });
});

describe('v5 inputs from batched Comtrade rows', () => {
  const row = (reporter: string, partner: string, period: number, value: number | null, extra: Partial<BatchedComtradeRow> = {}): BatchedComtradeRow => ({
    reporter_code: reporter, partner_code: partner, period, hs6: '100630', flow: 'M', value_usd: value, value_status: value == null ? 'suppressed' : 'observed',
    net_weight_kg: null, net_weight_status: 'missing', net_weight_estimated: false, classification: 'H6', original_classification: true, ...extra,
  });

  test('newest-year inputs keep "did not report" (null) apart from "reported, none recorded" (0)', () => {
    const inputs = newestYearInputs({
      rows: [row('842', '0', 2024, 100), row('842', '0', 2025, 110), row('842', '699', 2024, 10), row('276', '0', 2024, 50), row('524', '0', 2025, 5)],
      base_year: 2024,
      markets: [{ iso2: 'US', reporter_code: '842' }, { iso2: 'DE', reporter_code: '276' }, { iso2: 'NP', reporter_code: '524' }, { iso2: 'BT', reporter_code: '64' }],
      reported: new Map([[2024, new Set(['842', '276'])], [2025, new Set(['842'])]]),
    });
    expect(inputs.get('US')).toMatchObject({ world_base_usd: 100, world_newest_usd: 110, india_base_usd: 10, india_newest_usd: 0 });
    expect(inputs.get('DE')).toMatchObject({ world_base_usd: 50, world_newest_usd: null, india_base_usd: 0, india_newest_usd: null });
    expect(inputs.get('NP')).toMatchObject({ world_base_usd: null, world_newest_usd: 5, india_base_usd: null, india_newest_usd: 0 });
    expect(inputs.get('BT')).toMatchObject({ world_base_usd: null, world_newest_usd: null, india_base_usd: null, india_newest_usd: null });
  });

  test("a fallback series covers only consecutive reported years ending at the market's latest", () => {
    const identity = comtradePartnerIdentity([{ reporter_code: '156', iso2: 'CN' }, { reporter_code: '699', iso2: 'IN' }, { reporter_code: '462', iso2: 'MV' }]);
    const series = fallbackMarketSeries({
      rows: [
        row('462', '0', 2024, 999), row('462', '156', 2024, 100, { net_weight_kg: 50 }), row('462', '699', 2024, 20), row('462', '490', 2023, 5),
        row('462', '251', 2022, null), row('462', '156', 2020, 70), row('462', '699', 2023, 0), row('462', '462', 2024, 3),
      ],
      market: { iso2: 'MV', reporter_code: '462' },
      candidate_years: [2019, 2020, 2021, 2022, 2023, 2024, 2025],
      reported: new Map([[2019, new Set(['462'])], [2020, new Set(['462'])], [2022, new Set(['462'])], [2023, new Set(['462'])], [2024, new Set(['462'])]]),
      window_years: 6,
      partner_identity: identity,
    })!;
    expect(series.years).toEqual([2022, 2023, 2024]);
    expect(series.withheld_rows).toBe(1);
    expect(series.flows).toEqual([
      { year: 2024, exporter: 'CN', importer: 'MV', value_usd: 100, quantity_kg: 50 },
      { year: 2024, exporter: 'IN', importer: 'MV', value_usd: 20, quantity_kg: null },
      { year: 2023, exporter: 'un_comtrade:490', importer: 'MV', value_usd: 5, quantity_kg: null },
    ]);
    expect(fallbackMarketSeries({ rows: [], market: { iso2: 'BT', reporter_code: '64' }, candidate_years: [2024], reported: new Map(), window_years: 6, partner_identity: identity })).toBeNull();
  });

  test("India's own exports by destination, for India's price when no BACI release is ready", () => {
    const identity = comtradePartnerIdentity([{ reporter_code: '842', iso2: 'US' }]);
    const flows = indiaExportFlows([
      row('699', '842', 2024, 1000, { flow: 'X', net_weight_kg: 500 }), row('699', '0', 2024, 5000, { flow: 'X' }), row('699', '490', 2024, 10, { flow: 'X' }), row('842', '699', 2024, 1),
    ], identity);
    expect(flows).toEqual([
      { year: 2024, exporter: 'IN', importer: 'US', value_usd: 1000, quantity_kg: 500 },
      { year: 2024, exporter: 'IN', importer: 'un_comtrade:490', value_usd: 10, quantity_kg: null },
    ]);
  });
});
