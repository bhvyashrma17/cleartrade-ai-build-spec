import { describe, expect, test } from 'vitest';
import { compareWithIndiaExports, type CalibrationMarket } from '../src/lib/demand-discovery-v5/calibration';
import type { TradeFlowInput } from '../src/lib/demand-discovery-v5/series';

/** docs/36 §8: a run's top against India's own largest destinations. Values are invented. */
const flow = (year: number, exporter: string, importer: string, value: number): TradeFlowInput => ({ year, exporter, importer, value_usd: value, quantity_kg: null });
const market = (code: string, rank: number | null, status = rank == null ? 'not_enough_data' : 'ranked', reasons: string[] = []): CalibrationMarket => ({ market: code, status, rank, overall: rank == null ? null : 90 - rank, reasons });

describe("calibration against India's export destinations", () => {
  const flows = [
    flow(2022, 'IN', 'AE', 50), flow(2023, 'IN', 'AE', 60), flow(2024, 'IN', 'AE', 70),
    flow(2024, 'IN', 'US', 100), flow(2024, 'IN', 'SA', 40), flow(2024, 'IN', 'KP', 500),
    flow(2024, 'IN', 'cepii_baci:490', 999), flow(2021, 'IN', 'GB', 1000), flow(2024, 'CN', 'US', 5000),
  ];

  test("sums India's exports over the given years, counts only screening markets, and finds the overlap", () => {
    const result = compareWithIndiaExports({
      hs6: '100630', flows, years: [2022, 2023, 2024], top: 3,
      markets: [market('US', 1), market('DE', 2), market('AE', 3), market('SA', null, 'not_enough_data', ['Not ranked: growth has no data.']), market('KP', null, 'excluded', ['Excluded: sanctions.']), market('GB', 4)],
    });
    expect(result.india_top.map((item) => [item.market, item.usd])).toEqual([['KP', 500], ['AE', 180], ['US', 100]]);
    expect(result.india_total_usd).toBe(820);
    expect(result.run_top.map((item) => [item.market, item.india_rank])).toEqual([['US', 3], ['DE', null], ['AE', 2]]);
    expect(result.overlap).toBe(2);
    expect(result.missed).toEqual([{ market: 'KP', usd: 500, status: 'excluded', rank: null, reasons: ['Excluded: sanctions.'] }]);
    expect(result.verdict).toBe('pass');
  });

  test("a top that leaves out most of India's destinations is a calibration failure; no Indian exports says so", () => {
    const failing = compareWithIndiaExports({ hs6: '100630', flows, years: [2024], top: 3, markets: [market('DE', 1), market('FR', 2), market('US', 3), market('AE', null), market('SA', null), market('KP', null, 'excluded')] });
    expect(failing.overlap).toBe(1);
    expect(failing.verdict).toBe('calibration_failure');
    expect(compareWithIndiaExports({ hs6: '100630', flows, years: [2019], markets: [market('US', 1)] }).verdict).toBe('no_india_exports');
  });
});
