import { describe, expect, test } from 'vitest';
import { aggregateRunCalibration, compareWithIndiaExports, readRunCalibration, riskExplanation, summarizeRunCalibration, type RunCalibrationSummary } from '@/lib/demand-discovery-v5/calibration';
import { indiaMarkets } from '@/lib/demand-discovery-v5/india-markets';

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
    expect(summary).toEqual({ top: 2, years: [2023, 2024], overlap: 2, explained: 0, verdict: 'pass', india_top: ['US', 'AE'], missed: [] });
    const wider = summarizeRunCalibration(compareWithIndiaExports({ hs6: '100630', flows, years: [2024], markets, top: 3 }));
    expect(wider).toMatchObject({ overlap: 2, explained: 0, verdict: 'pass', india_top: ['US', 'AE', 'IR'], missed: [{ market: 'IR', status: 'ranked', rank: 91, explained_by: null }] });
    // Read back from a stored summary; older runs have none.
    expect(readRunCalibration({ ranked: 3, calibration: summary })).toEqual(summary);
    expect(readRunCalibration({ ranked: 3 })).toBeNull();
    expect(readRunCalibration(null)).toBeNull();
  });

  test('across runs: passes, failures, products India does not export, and the median overlap where it does', () => {
    const run = (overlap: number, verdict: RunCalibrationSummary['verdict']): RunCalibrationSummary => ({ top: 10, years: [2024], overlap, explained: 0, verdict, india_top: [], missed: [] });
    expect(aggregateRunCalibration([run(8, 'pass'), run(4, 'calibration_failure'), run(0, 'no_india_exports'), run(6, 'pass')])).toEqual({ compared: 4, pass: 2, calibration_failure: 1, no_india_exports: 1, median_overlap: 6 });
    expect(aggregateRunCalibration([run(8, 'pass'), run(4, 'calibration_failure')]).median_overlap).toBe(6);
    expect(aggregateRunCalibration([])).toEqual({ compared: 0, pass: 0, calibration_failure: 0, no_india_exports: 0, median_overlap: null });
  });

  test('E-045: a miss explained by restricted or no ECGC cover, or sanctions, counts towards the pass; any other miss does not', () => {
    // The 31 Oct rice run: 4 of India's top 10 in the run's top 10. On ECGC's 1 Jul 2026 list Iraq and
    // Guinea are in restricted cover Group I, Iran and Yemen in Group II; Togo and Côte d'Ivoire are open.
    const india = ['SA', 'IR', 'IQ', 'BJ', 'AE', 'GN', 'YE', 'US', 'TG', 'CI'];
    const flows = india.map((market, index) => ({ year: 2024, exporter: 'IN', importer: market, value_usd: 1000 - index, quantity_kg: 1 }));
    const runTop = ['US', 'SA', 'GB', 'QA', 'KW', 'AE', 'AU', 'BJ', 'CA', 'SG'];
    const lower: Record<string, number> = { IR: 91, IQ: 35, GN: 27, YE: 36, TG: 20, CI: 11 };
    const restricted = new Set(['IR', 'IQ', 'GN', 'YE']);
    const markets = [
      ...runTop.map((market, index) => ({ market, status: 'ranked', rank: index + 1, overall: 90 - index, reasons: [] })),
      ...Object.entries(lower).map(([market, rank]) => ({ market, status: 'ranked', rank, overall: 50, reasons: [], explained_by: restricted.has(market) ? 'ecgc_restricted' as const : null })),
    ];
    const result = compareWithIndiaExports({ hs6: '100630', flows, years: [2024], markets });
    expect(result).toMatchObject({ overlap: 4, explained: 4, verdict: 'pass' });
    expect(result.missed.filter((item) => !item.explained_by).map((item) => item.market)).toEqual(['TG', 'CI']);
    // Without the explanations, the same run fails, as it did on 31 Oct.
    expect(compareWithIndiaExports({ hs6: '100630', flows, years: [2024], markets: markets.map((market) => ({ ...market, explained_by: null })) }).verdict).toBe('calibration_failure');
    // A sanctions flag counts as well, and so does any mix: 4 + 1 is enough.
    const one = markets.map((market) => ({ ...market, explained_by: market.market === 'TG' ? 'sanctions' as const : null }));
    expect(compareWithIndiaExports({ hs6: '100630', flows, years: [2024], markets: one })).toMatchObject({ explained: 1, verdict: 'pass' });
  });

  test('the explanation is read from the payment-risk measure\'s ECGC cover, then from a sanctions flag', () => {
    const risk = (cover: string) => [{ key: 'country_risk', inputs: { grade: 'C2', cover } }];
    expect(riskExplanation({ metrics: risk('off_cover'), flag_reasons: [] })).toBe('ecgc_off_cover');
    expect(riskExplanation({ metrics: risk('restricted_group_i'), flag_reasons: [] })).toBe('ecgc_restricted');
    expect(riskExplanation({ metrics: risk('restricted_group_ii'), flag_reasons: ['ECGC cover is restricted (Group II)'] })).toBe('ecgc_restricted');
    expect(riskExplanation({ metrics: risk('open'), flag_reasons: ['US: Comprehensive sanctions programme'] })).toBe('sanctions');
    expect(riskExplanation({ metrics: risk('open'), flag_reasons: [] })).toBeNull();
    expect(riskExplanation({ metrics: null, flag_reasons: null })).toBeNull();
  });

  test('"Where India already sells most": each of India\'s destinations with its rank, India\'s share, and why it ranks lower (E-045)', () => {
    const summary = { calibration: { top: 10, years: [2024], overlap: 1, explained: 1, verdict: 'calibration_failure', india_top: ['SA', 'IR', 'GN', 'ZZ'], missed: [] } };
    const row = (country_code: string, rank: number | null, metrics: unknown[], reasons: unknown[], flag_reasons: string[] = []) =>
      ({ country_code, rank, market_status: rank == null ? 'not_enough_data' : 'ranked', score_breakdown: { metrics }, flag_reasons, reasons });
    const foothold = (share: number) => ({ key: 'india_foothold', inputs: { india_share_percent: share } });
    const markets = indiaMarkets(summary, [
      row('SA', 2, [foothold(31.5)], [{ effect: 'adds', text: 'Large market.' }]),
      row('IR', 91, [foothold(22), { key: 'country_risk', inputs: { cover: 'open' } }], [{ effect: 'adds', text: 'Large market.' }, { effect: 'costs', text: 'Imports have fallen.' }], ['US: Comprehensive sanctions programme']),
      row('GN', null, [], [{ effect: 'status', text: 'Not enough data to rank.' }]),
    ]);
    expect(markets).toEqual([
      { country_code: 'SA', rank: 2, market_status: 'ranked', india_share_percent: 31.5, in_top: true, explained_by: null, explained_text: null, reason: null },
      { country_code: 'IR', rank: 91, market_status: 'ranked', india_share_percent: 22, in_top: false, explained_by: 'sanctions', explained_text: 'a sanctions programme is flagged', reason: 'Imports have fallen.' },
      { country_code: 'GN', rank: null, market_status: 'not_enough_data', india_share_percent: null, in_top: false, explained_by: null, explained_text: null, reason: 'Not enough data to rank.' },
      // A destination the run has no row for still appears, so the list never hides one of India's markets.
      { country_code: 'ZZ', rank: null, market_status: null, india_share_percent: null, in_top: false, explained_by: null, explained_text: null, reason: null },
    ]);
    // A run without a stored comparison shows no list.
    expect(indiaMarkets({}, [])).toEqual([]);
  });
});
