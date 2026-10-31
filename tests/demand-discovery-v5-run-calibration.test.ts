import { describe, expect, test } from 'vitest';
import { aggregateRunCalibration, compareWithIndiaExports, readRunCalibration, summarizeRunCalibration, type RunCalibrationSummary } from '@/lib/demand-discovery-v5/calibration';

/** Owner-approved idea 2 (E-042): every real run records how its top 10 compares with where India already sells. */
describe('calibration stored with every run', () => {
  test('a run keeps the comparison small: market codes, overlap, verdict and what it missed', () => {
    const flows = [
      { year: 2024, exporter: 'IN', importer: 'US', value_usd: 900, quantity_kg: 1 }, { year: 2024, exporter: 'IN', importer: 'AE', value_usd: 500, quantity_kg: 1 },
      { year: 2024, exporter: 'IN', importer: 'IR', value_usd: 400, quantity_kg: 1 }, { year: 2023, exporter: 'IN', importer: 'US', value_usd: 100, quantity_kg: 1 },
    ];
    const markets = [
      { market: 'US', status: 'ranked', rank: 1, overall: 85, reasons: [] }, { market: 'AE', status: 'ranked', rank: 2, overall: 80, reasons: [] },
      { market: 'IR', status: 'ranked', rank: 91, overall: 40, reasons: ['Payment risk is high.'] },
    ];
    const summary = summarizeRunCalibration(compareWithIndiaExports({ hs6: '100630', flows, years: [2023, 2024], markets, top: 2 }));
    expect(summary).toEqual({ top: 2, years: [2023, 2024], overlap: 2, verdict: 'pass', india_top: ['US', 'AE'], missed: [] });
    const wider = summarizeRunCalibration(compareWithIndiaExports({ hs6: '100630', flows, years: [2024], markets, top: 3 }));
    expect(wider).toMatchObject({ overlap: 2, verdict: 'pass', india_top: ['US', 'AE', 'IR'], missed: [{ market: 'IR', status: 'ranked', rank: 91 }] });
    // Read back from a stored summary; older runs have none.
    expect(readRunCalibration({ ranked: 3, calibration: summary })).toEqual(summary);
    expect(readRunCalibration({ ranked: 3 })).toBeNull();
    expect(readRunCalibration(null)).toBeNull();
  });

  test('across runs: passes, failures, products India does not export, and the median overlap where it does', () => {
    const run = (overlap: number, verdict: RunCalibrationSummary['verdict']): RunCalibrationSummary => ({ top: 10, years: [2024], overlap, verdict, india_top: [], missed: [] });
    expect(aggregateRunCalibration([run(8, 'pass'), run(4, 'calibration_failure'), run(0, 'no_india_exports'), run(6, 'pass')])).toEqual({ compared: 4, pass: 2, calibration_failure: 1, no_india_exports: 1, median_overlap: 6 });
    expect(aggregateRunCalibration([run(8, 'pass'), run(4, 'calibration_failure')]).median_overlap).toBe(6);
    expect(aggregateRunCalibration([])).toEqual({ compared: 0, pass: 0, calibration_failure: 0, no_india_exports: 0, median_overlap: null });
  });
});
