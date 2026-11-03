import { describe, expect, test } from 'vitest';
import { offlineConfig, rankIndiaExports, summarizeHealthCheck, type HealthCheckProduct } from '@/lib/demand-discovery-v5/health-check';
import { CONFIG_DEFAULTS } from '@/lib/config';

/** Owner-approved idea 3 (E-042): the scoring's health across India's export sectors. */
describe('the sector health check', () => {
  test("India's exports are ranked by value across every product; other exporters do not count", () => {
    const flow = (exporter: string, product: string, value_kusd: number) => ({ year: 2024, exporter, importer: '842', product, value_kusd, quantity_t: null });
    expect(rankIndiaExports([flow('699', '100630', 9000), flow('699', '710239', 20000), flow('156', '851713', 99999), flow('699', '100630', 2000), flow('699', '300490', 11000)], '699', 2))
      .toEqual([{ hs6: '710239', india_usd: 20_000_000 }, { hs6: '100630', india_usd: 11_000_000 }]);
  });

  test('every provider call is switched off; the scoring policy is untouched', () => {
    const config = CONFIG_DEFAULTS['demand_discovery.v5'];
    expect(offlineConfig(config)).toEqual({ ...config, comtrade_newest_year: false, comtrade_market_fallback: false, tariff_acquisition: false, fx_fetch_missing: false, fx_treasury_fallback: false });
    expect(offlineConfig(config).policy).toBe(config.policy);
  });

  test('the summary: passes, the median overlap where India exports, results by chapter and the markets missed most often', () => {
    const item = (hs6: string, verdict: HealthCheckProduct['verdict'], overlap: number, missed: string[]): HealthCheckProduct => ({
      hs6, india_usd: 1, status: 'compared', verdict, overlap, top: 10, missed: missed.map((market) => ({ market, rank: 50, status: 'ranked', reasons: [] })),
    });
    const summary = summarizeHealthCheck([
      item('100630', 'calibration_failure', 4, ['IR', 'IQ', 'YE']), item('100640', 'pass', 7, ['IR']), item('710239', 'calibration_failure', 3, ['HK', 'IR', 'BE']),
      item('300490', 'no_india_exports', 0, []), { hs6: '851713', india_usd: 1, status: 'failed', error: 'No BACI flows for this code.' },
    ]);
    expect(summary).toMatchObject({ products: 5, compared: 4, failed: 1, pass: 1, calibration_failure: 2, no_india_exports: 1, median_overlap: 4 });
    expect(summary.by_chapter).toEqual({ 10: { compared: 2, pass: 1 }, 30: { compared: 1, pass: 0 }, 71: { compared: 1, pass: 0 } });
    expect(summary.most_missed.slice(0, 2)).toEqual([{ market: 'IR', products: 3 }, { market: 'BE', products: 1 }]);
  });
});
