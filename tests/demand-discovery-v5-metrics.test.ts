import { describe, expect, test } from 'vitest';
import { assertPolicy, DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY, policyHash, type DemandDiscoveryV5Policy } from '../src/lib/demand-discovery-v5/policy';
import { buildMarketSeries, importsIn, indiaExportUnitValues, marketUnitValues, type MarketSeries, type TradeFlowInput } from '../src/lib/demand-discovery-v5/series';
import {
  averageImportsUsd, greatCircleKm, marketMedianUnitValue, olsSlope, priceRatioScore, scoreCountryRisk, scoreDistanceFit, scoreDuty, scoreGrowth,
  scoreIndiaFoothold, scoreLogistics, scoreMarketSize, scoreOpenness, scorePriceFit, scorePriceHeadroom, scoreStability, scoreVolumeFit,
  tukeyFilter, weightedMedian,
} from '../src/lib/demand-discovery-v5/metrics';
import { agreementInForce, dutyInputs, tariffSector, type IndiaTradeAgreement } from '../src/lib/demand-discovery-v5/duty-inputs';
import { metricSentence } from '../src/lib/demand-discovery-v5/explain';
import { exporterUsdPerKg, exporterYearlyKg, kgPerUnit } from '../src/lib/demand-discovery-v5/exporter-inputs';
import type { OfficialDutyResolution } from '../src/lib/demand-discovery-v5/official-duty';
import { splitByAge } from '../src/lib/demand-discovery-v5/world-bank';
import { fitLpiOnLsci, logisticsEstimates } from '../src/lib/demand-discovery-v5/logistics-fallback';

const WINDOW = [2019, 2020, 2021, 2022, 2023, 2024];
const flow = (year: number, exporter: string, importer: string, value_usd: number, quantity_kg: number | null = null): TradeFlowInput => ({ year, exporter, importer, value_usd, quantity_kg });

/** A market whose only supplier is `CN`, importing `values[i]` in `WINDOW[i]` (0 = no flow). */
function seriesOf(values: number[], market = 'DE'): MarketSeries {
  const flows = values.flatMap((value, index) => (value > 0 ? [flow(WINDOW[index], 'CN', market, value)] : []));
  return buildMarketSeries(flows, [market]).get(market)!;
}

describe('v5 policy', () => {
  test('the default policy is valid, its points sum to 100 and its parts match D-012', () => {
    expect(() => assertPolicy(POLICY)).not.toThrow();
    const partTotal = (part: keyof DemandDiscoveryV5Policy['parts']) => POLICY.parts[part].reduce((sum, key) => sum + POLICY.points[key], 0);
    expect({ demand: partTotal('demand'), india: partTotal('india_opportunity'), access: partTotal('access'), risk: partTotal('risk'), fit: partTotal('exporter_fit') })
      .toEqual({ demand: 35, india: 25, access: 20, risk: 10, fit: 10 });
  });

  test('the hash is stable under key order and changes with any value', () => {
    const reordered = Object.fromEntries(Object.entries(POLICY).reverse()) as unknown as DemandDiscoveryV5Policy;
    expect(policyHash(reordered)).toBe(policyHash(POLICY));
    expect(policyHash({ ...POLICY, ranking: { ...POLICY.ranking, minimum_live_points: 59 } })).not.toBe(policyHash(POLICY));
  });

  test('refuses points that do not sum to 100, a metric outside the parts, and inverted ranges', () => {
    expect(() => assertPolicy({ ...POLICY, points: { ...POLICY.points, market_size: 21 } })).toThrow(/sum to 101/);
    expect(() => assertPolicy({ ...POLICY, parts: { ...POLICY.parts, demand: ['market_size', 'growth'] } })).toThrow(/exactly one part/);
    expect(() => assertPolicy({ ...POLICY, volume: { ...POLICY.volume, full_share: 0.3 } })).toThrow(/Volume/);
    expect(() => assertPolicy({ ...POLICY, chain_link: { max_change_ratio: 1 } })).toThrow(/chain-link/);
  });
});

describe('v5 series', () => {
  test('sums imports, India and quantities per market and year, and records each market’s exports', () => {
    const series = buildMarketSeries([
      flow(2024, 'CN', 'DE', 300, 100), flow(2024, 'IN', 'DE', 100, 50), flow(2024, 'IN', 'DE', 50, null),
      flow(2024, 'DE', 'FR', 70), flow(2023, 'CN', 'DE', 200),
    ], ['DE', 'FR', 'NP']);
    const de = series.get('DE')!;
    expect(de.years.get(2024)).toMatchObject({ total_usd: 450, india_usd: 150, value_with_quantity_usd: 400, quantity_kg_reported: 150 });
    expect(de.years.get(2024)!.suppliers.get('IN')).toEqual({ value_usd: 150, quantity_kg: null });
    expect(de.exports_usd.get(2024)).toBe(70);
    expect(importsIn(de, 2023)).toBe(200);
    expect(importsIn(de, 2020)).toBe(0);
    expect(series.get('NP')!.years.size).toBe(0);
    expect(() => buildMarketSeries([flow(2024, 'CN', 'DE', 0)], ['DE'])).toThrow(/non-positive/);
  });

  test('unit values: India per destination, the market per supplier, only where weight is known', () => {
    const flows = [flow(2024, 'IN', 'DE', 200, 100), flow(2024, 'IN', 'DE', 100, 50), flow(2024, 'IN', 'US', 90, null), flow(2024, 'CN', 'DE', 300, 100)];
    expect(indiaExportUnitValues(flows, 2024)).toEqual([{ unit_value: 2, quantity_kg: 150 }]);
    const de = buildMarketSeries(flows, ['DE']).get('DE')!;
    expect(marketUnitValues(de, 2024).sort((a, b) => a.unit_value - b.unit_value)).toEqual([{ unit_value: 2, quantity_kg: 150 }, { unit_value: 3, quantity_kg: 100 }]);
  });
});

describe('v5 statistics', () => {
  test('weighted median, Tukey fences, OLS slope and great-circle distance', () => {
    expect(weightedMedian([{ unit_value: 1, quantity_kg: 1 }, { unit_value: 2, quantity_kg: 1 }, { unit_value: 10, quantity_kg: 10 }])).toBe(10);
    expect(weightedMedian([{ unit_value: 3, quantity_kg: 1 }, { unit_value: 1, quantity_kg: 5 }, { unit_value: 2, quantity_kg: 1 }])).toBe(1);
    const kept = tukeyFilter([1, 2, 3, 4, 100].map((unit_value) => ({ unit_value, quantity_kg: 1 })), 1.5).map((point) => point.unit_value);
    expect(kept).toEqual([1, 2, 3, 4]);
    expect(olsSlope([{ x: 2019, y: 1 }, { x: 2020, y: 3 }, { x: 2021, y: 5 }])).toBeCloseTo(2, 10);
    expect(greatCircleKm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111.195, 2);
  });
});

describe('v5 demand metrics', () => {
  test('market size is log-scaled from the $100k floor to the largest market', () => {
    expect(scoreMarketSize(1e7, 1e9, 1, POLICY).score).toBeCloseTo(50, 6);
    expect(scoreMarketSize(1e5, 1e9, 1, POLICY).score).toBe(0);
    expect(scoreMarketSize(5e4, 1e9, 1, POLICY).score).toBe(0);
    expect(scoreMarketSize(1e9, 1e9, 1, POLICY).score).toBe(100);
    // A product whose largest market is below $1m still spans one decade above the floor.
    expect(scoreMarketSize(5e5, 5e5, 1, POLICY).score).toBeCloseTo((Math.log10(5e5) - 5) * 100, 3);
    expect(scoreMarketSize(null, 1e9, 1, POLICY)).toMatchObject({ score: null, reason: expect.stringMatching(/No recorded imports/) });
  });

  test('the size input averages the last three years of the window, counting a recorded zero', () => {
    expect(averageImportsUsd(seriesOf([0, 0, 0, 300, 0, 600]), WINDOW, POLICY)).toBe(300);
    expect(averageImportsUsd(seriesOf([500, 500, 500, 0, 0, 0]), WINDOW, POLICY)).toBeNull();
  });

  test('growth blends 70% CAGR with 30% last-year change, each mapped −20%..+20%', () => {
    const end = 100 * 1.1 ** 5;
    const steady = scoreGrowth(seriesOf([100, 110, 121, 133.1, end, end]), WINDOW, 1, POLICY);
    expect(steady.inputs.cagr_percent).toBeCloseTo(10, 6);
    expect(steady.inputs.momentum_percent).toBeCloseTo(0, 6);
    expect(steady.score).toBeCloseTo(0.7 * 75 + 0.3 * 50, 3);
  });

  test('a zero at the end is a real fall, scored by momentum; a zero start leaves CAGR not calculable', () => {
    const stopped = scoreGrowth(seriesOf([100, 100, 100, 100, 100, 0]), WINDOW, 1, POLICY);
    expect(stopped).toMatchObject({ score: 0, inputs: { cagr_percent: null, momentum_percent: -100, cagr_status: 'not_calculable' } });
    const started = scoreGrowth(seriesOf([0, 0, 0, 0, 100, 110]), WINDOW, 1, POLICY);
    expect(started.inputs).toMatchObject({ cagr_percent: null, cagr_status: 'not_calculable' });
    expect(started.score).toBeCloseTo(75, 6);
    expect(scoreGrowth(seriesOf([0, 0, 0, 0, 0, 100]), WINDOW, 1, POLICY)).toMatchObject({ score: null, reason: expect.stringMatching(/year before the last/) });
  });

  test('stability is 100 × (1 − SD/50) over yearly growth rates, and needs four of them', () => {
    expect(scoreStability(seriesOf([100, 110, 121, 133.1, 146.41, 161.051]), WINDOW, 1, POLICY).score).toBeCloseTo(100, 6);
    const swinging = scoreStability(seriesOf([100, 150, 100, 150, 100, 150]), WINDOW, 1, POLICY);
    const rates = [50, -100 / 3, 50, -100 / 3, 50];
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    const sd = Math.sqrt(rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / rates.length);
    expect(swinging.score).toBeCloseTo(100 * (1 - sd / 50), 3);
    expect(scoreStability(seriesOf([0, 0, 100, 110, 120, 130]), WINDOW, 1, POLICY)).toMatchObject({ score: null, inputs: { rates: 3 } });
  });
});

describe("v5 India's opportunity metrics", () => {
  function footholdSeries(shares: number[]) {
    const flows = shares.flatMap((share, index) => [flow(WINDOW[index], 'CN', 'DE', 100 - share), ...(share > 0 ? [flow(WINDOW[index], 'IN', 'DE', share)] : [])]);
    return buildMarketSeries(flows, ['DE']).get('DE')!;
  }

  test('foothold: 70% share on a log curve from 40 at zero to 100 at 10%, 30% share trend', () => {
    const rising = scoreIndiaFoothold(footholdSeries([0, 1, 2, 3, 4, 5]), WINDOW, 1, POLICY);
    const shareScore = 40 + 60 * (Math.log10(6) / Math.log10(11));
    const trendScore = ((1 + 5) / 10) * 100;
    expect(rising.inputs).toMatchObject({ india_share_percent: 5, share_trend_pp_per_year: 1, trend_points: 6 });
    expect(rising.score).toBeCloseTo(0.7 * shareScore + 0.3 * trendScore, 3);
    expect(scoreIndiaFoothold(footholdSeries([0, 0, 0, 0, 0, 0]), WINDOW, 1, POLICY).score).toBeCloseTo(0.7 * 40 + 0.3 * 50, 6);
    expect(scoreIndiaFoothold(footholdSeries([20, 20, 20, 20, 20, 20]), WINDOW, 1, POLICY).score).toBeCloseTo(0.7 * 100 + 0.3 * 50, 6);
  });

  test('foothold needs the latest year, and drops the trend with fewer than three points', () => {
    expect(scoreIndiaFoothold(seriesOf([100, 100, 100, 100, 100, 0]), WINDOW, 1, POLICY)).toMatchObject({ score: null, reason: 'No recorded imports in 2024.' });
    const lateStart = buildMarketSeries([flow(2023, 'IN', 'DE', 1), flow(2023, 'CN', 'DE', 99), flow(2024, 'IN', 'DE', 1), flow(2024, 'CN', 'DE', 99)], ['DE']).get('DE')!;
    const twoYears = scoreIndiaFoothold(lateStart, WINDOW, 1, POLICY);
    expect(twoYears.inputs.share_trend_pp_per_year).toBeNull();
    expect(twoYears.score).toBeCloseTo(40 + 60 * (Math.log10(2) / Math.log10(11)), 3);
  });

  test('a price ratio maps neutral → 50, ×1.5 → 100, ÷1.5 → 0 on a log scale', () => {
    expect(priceRatioScore(1, POLICY)).toBeCloseTo(50, 10);
    expect(priceRatioScore(1.5, POLICY)).toBeCloseTo(100, 10);
    expect(priceRatioScore(1 / 1.5, POLICY)).toBeCloseTo(0, 10);
    expect(priceRatioScore(3, POLICY)).toBe(100);
    expect(priceRatioScore(1.2, POLICY)).toBeCloseTo(50 + 50 * (Math.log(1.2) / Math.log(1.5)), 10);
  });

  test('price headroom compares the market’s median supplier price with India’s, both FOB', () => {
    const points = [{ unit_value: 3, quantity_kg: 10 }, { unit_value: 3, quantity_kg: 10 }, { unit_value: 4, quantity_kg: 1 }];
    const marketUv = marketMedianUnitValue(points, POLICY);
    expect(marketUv).toBe(3);
    expect(scorePriceHeadroom(marketUv, 2, 1, POLICY)).toMatchObject({ score: 100, inputs: { ratio: 1.5 } });
    expect(marketMedianUnitValue(points.slice(0, 2), POLICY)).toBeNull();
    expect(scorePriceHeadroom(null, 2, 1, POLICY)).toMatchObject({ score: null, reason: expect.stringMatching(/Fewer than 3 suppliers/) });
    expect(scorePriceHeadroom(3, null, 1, POLICY)).toMatchObject({ score: null, reason: expect.stringMatching(/India's export price/) });
  });

  test('openness is 100 × (1 − HHI), refused when the supplier breakdown does not cover imports', () => {
    const series = buildMarketSeries([flow(2024, 'CN', 'DE', 50), flow(2024, 'VN', 'DE', 50)], ['DE']).get('DE')!;
    expect(scoreOpenness(series, 2024, 1, POLICY)).toMatchObject({ score: 50, inputs: { hhi: 0.5, suppliers: 2 } });
    series.years.get(2024)!.total_usd = 200;
    expect(scoreOpenness(series, 2024, 1, POLICY)).toMatchObject({ score: null, inputs: { coverage: 0.5 } });
    expect(scoreOpenness(series, 2023, 1, POLICY).score).toBeNull();
  });
});

describe('v5 access, risk and exporter-fit metrics', () => {
  const duty = { official: 1, estimate: 0.5 };

  test('duty: official evidence at full quality; the labelled estimate scales the sector average by agreement', () => {
    expect(scoreDuty({ kind: 'official', duty_percent: 5, source: 'atlas' }, POLICY, duty)).toMatchObject({ score: 80, quality: 1, inputs: { basis: 'official' } });
    expect(scoreDuty({ kind: 'estimate', sector_average_percent: 10, agreement_scope: 'comprehensive', agreement_name: 'India–UAE CEPA' }, POLICY, duty))
      .toMatchObject({ score: 80, quality: 0.5, estimated: true, inputs: { duty_percent: 5, basis: 'estimate', agreement: 'India–UAE CEPA' } });
    expect(scoreDuty({ kind: 'estimate', sector_average_percent: 10, agreement_scope: 'partial', agreement_name: 'APTA' }, POLICY, duty).score).toBe(68);
    expect(scoreDuty({ kind: 'estimate', sector_average_percent: 10, agreement_scope: 'none', agreement_name: null }, POLICY, duty).score).toBe(60);
    expect(scoreDuty({ kind: 'official', duty_percent: 40, source: 'atlas' }, POLICY, duty).score).toBe(0);
    expect(scoreDuty(null, POLICY, duty).score).toBeNull();
  });

  test('duty: an official specific duty becomes its ad-valorem equivalent at the market unit value, or falls back to the estimate', () => {
    const specific = { kind: 'official_specific' as const, usd_per_kg: 0.2, expression: '175.00 EUR / 1000 kg', source: 'EU TARIC 1006309800', estimate: { kind: 'estimate' as const, sector_average_percent: 4, agreement_scope: 'none' as const, agreement_name: null } };
    expect(scoreDuty(specific, POLICY, duty, 0.8)).toMatchObject({ score: 0, quality: 1, inputs: { duty_percent: 25, basis: 'official', duty_expression: '175.00 EUR / 1000 kg', market_usd_per_kg: 0.8 } });
    expect(scoreDuty(specific, POLICY, duty, 2)).toMatchObject({ score: 60, inputs: { duty_percent: 10 } });
    expect(scoreDuty(specific, POLICY, duty, null)).toMatchObject({ score: 84, estimated: true, inputs: { basis: 'estimate', official_note: expect.stringMatching(/charged per kilogram/) } });
    expect(scoreDuty({ ...specific, estimate: null }, POLICY, duty, null)).toMatchObject({ score: null, reason: expect.stringMatching(/charged per kilogram/) });
    expect(scoreDuty({ kind: 'unusable', reason: 'Compound duty.' }, POLICY, duty)).toMatchObject({ score: null, reason: 'Compound duty.' });
    expect(scoreDuty({ kind: 'official', duty_percent: 5, source: 'atlas', preference: { applicability: 'potentially_applicable_requires_origin_proof', duty_expression: '0%', percent: 0 } }, POLICY, duty).inputs)
      .toMatchObject({ duty_percent: 5, basis: 'official', preference_percent: 0, preference_applicability: 'potentially_applicable_requires_origin_proof' });
  });

  // D-026 (policy v6): India's published preference scored instead of the standard rate.
  test('duty: a scored preference says so, keeps the standard rate beside it, and a quota preference is only shown', () => {
    expect(POLICY.policy_version).toBe('demand-discovery-v5-policy-v6');
    expect(POLICY.duty.score_india_preference).toBe(true);
    const preference = { applicability: 'potentially_applicable_requires_origin_proof', duty_expression: '2.5%', percent: 2.5 };
    const scored = scoreDuty({ kind: 'official', duty_percent: 2.5, source: 'USITC HTS 1006304010', preference, rate_basis: 'india_preference', standard: { duty_percent: 11.2, expression: '11.2%' } }, POLICY, duty);
    expect(scored).toMatchObject({ score: 90, quality: 1, inputs: { duty_percent: 2.5, basis: 'official', rate: 'india_preference', standard_percent: 11.2, standard_duty: '11.2%' } });
    expect(metricSentence(scored)).toBe("Duty on Indian goods is 2.5% at India's preferential rate (standard rate 11.2%); claiming it needs proof of Indian origin.");
    const free = scoreDuty({ kind: 'official', duty_percent: 0, source: 'Japan Customs', preference: { ...preference, duty_expression: 'Free', percent: 0 }, rate_basis: 'india_preference', standard: { duty_percent: null, expression: '10 yen/kg' } }, POLICY, duty);
    expect(metricSentence(free)).toBe("Indian goods enter duty-free at India's preferential rate (standard rate 10 yen/kg); claiming it needs proof of Indian origin.");
    const quota = scoreDuty({ kind: 'official', duty_percent: 10, source: 'Japan Customs', preference: { ...preference, duty_expression: '0%', percent: 0, quota: true } }, POLICY, duty);
    expect(quota.inputs).toMatchObject({ duty_percent: 10, preference_quota: 'yes' });
    expect(quota.inputs.rate).toBeUndefined();
    expect(metricSentence(quota)).toBe('Duty on Indian goods is 10%; duty-free entry applies only within a tariff quota.');
  });

  test('distance fit is 100 when India is no farther than the usual supplier, else e^−Δ in log distance', () => {
    const coordinates = new Map([['DE', { lat: 0, lon: 0 }], ['IN', { lat: 0, lon: 10 }], ['CN', { lat: 0, lon: 20 }], ['VN', { lat: 0, lon: 5 }]]);
    const far = buildMarketSeries([flow(2024, 'CN', 'DE', 100)], ['DE']).get('DE')!;
    expect(scoreDistanceFit(far, 2024, coordinates, 1, POLICY).score).toBe(100);
    const near = buildMarketSeries([flow(2024, 'VN', 'DE', 100)], ['DE']).get('DE')!;
    expect(scoreDistanceFit(near, 2024, coordinates, 1, POLICY).score).toBeCloseTo(50, 3);
    const unknown = buildMarketSeries([flow(2024, 'VN', 'DE', 10), flow(2024, 'cepii_baci:490', 'DE', 90)], ['DE']).get('DE')!;
    expect(scoreDistanceFit(unknown, 2024, coordinates, 1, POLICY)).toMatchObject({ score: null, inputs: { covered_share: 0.1 } });
    expect(scoreDistanceFit(near, 2024, new Map([['DE', { lat: 0, lon: 0 }]]), 1, POLICY).score).toBeNull();
  });

  test('logistics maps LPI 1..5 onto 0..100', () => {
    expect(scoreLogistics(3, 0.9, POLICY)).toMatchObject({ score: 50, quality: 0.9 });
    expect(scoreLogistics(null, 0.9, POLICY).score).toBeNull();
  });

  test('without an LPI, logistics is the LPI shipping connectivity predicts, labelled as an estimate (v5, D-025)', () => {
    // Thirty invented markets lying exactly on LPI = 1.5 + 0.5 ln(LSCI).
    const codes = Array.from({ length: 30 }, (_, index) => `M${String.fromCharCode(65 + Math.floor(index / 26))}${String.fromCharCode(65 + (index % 26))}`);
    const lsci = new Map(codes.map((code, index) => [code, { value: 2 + index * 4, year: 2020 }]));
    const lpi = new Map(codes.map((code, index) => [code, 1.5 + 0.5 * Math.log(2 + index * 4)]));
    const fit = fitLpiOnLsci(lpi, lsci, POLICY.logistics.lsci_fallback_minimum_pairs)!;
    expect(fit).toMatchObject({ pairs: 30, slope: expect.closeTo(0.5, 9), intercept: expect.closeTo(1.5, 9), r2: expect.closeTo(1, 9) });
    expect(fitLpiOnLsci(new Map([...lpi].slice(0, 29)), lsci, POLICY.logistics.lsci_fallback_minimum_pairs)).toBeNull();

    // FJ has connectivity but no LPI; PY has neither; TV's and ZZ's predictions fall outside 1–5, so they are clamped.
    lsci.set('FJ', { value: 9.26, year: 2020 }).set('TV', { value: 0.1, year: 2020 }).set('ZZ', { value: 1e9, year: 2020 });
    const { estimates } = logisticsEstimates({ markets: ['FJ', 'TV', 'PY', 'ZZ', codes[0]!], lpi, lsci, policy: POLICY });
    expect([...estimates.keys()].sort()).toEqual(['FJ', 'TV', 'ZZ']);
    expect(estimates.get('FJ')!.predicted_lpi).toBeCloseTo(1.5 + 0.5 * Math.log(9.26), 9);
    expect(estimates.get('TV')!.predicted_lpi).toBe(1);
    expect(estimates.get('ZZ')!.predicted_lpi).toBe(5);

    const scored = scoreLogistics(null, 0.9, POLICY, null, { ...estimates.get('FJ')!, quality: POLICY.quality.logistics_lsci_estimate });
    expect(scored).toMatchObject({ estimated: true, quality: 0.5, inputs: { basis: 'lsci_estimate', lsci: 9.26, lsci_year: 2020, fit_pairs: 30 } });
    expect(scored.score).toBeCloseTo(((1.5 + 0.5 * Math.log(9.26)) - 1) / 4 * 100, 2);
    expect(metricSentence(scored)).toBe("No World Bank logistics score exists; from its shipping connections (UNCTAD index 9.3, 2020) it would rate about 2.6 out of 5.");
    // A usable LPI always wins over the estimate.
    expect(scoreLogistics(3, 0.9, POLICY, null, { ...estimates.get('FJ')!, quality: 0.5 })).toMatchObject({ score: 50, quality: 0.9, inputs: { lpi: 3 } });
    expect(() => assertPolicy({ ...POLICY, logistics: { ...POLICY.logistics, lsci_fallback_minimum_pairs: 5 } })).toThrow(/at least ten markets/);
  });

  test('World Bank values more than 10 years old on the run date count as missing, and say so (D-021)', () => {
    expect(POLICY.world_bank.max_age_years).toBe(10);
    const split = splitByAge(new Map([['DE', { value: 4.1, year: 2016 }], ['BI', { value: 2.1, year: 2015 }], ['IN', { value: 3.4, year: 2023 }]]), new Date('2026-10-14T00:00:00Z'), POLICY);
    expect([...split.fresh.keys()].sort()).toEqual(['DE', 'IN']);
    expect(Object.fromEntries(split.too_old)).toEqual({ BI: 2015 });
    expect(scoreLogistics(null, 0.9, POLICY, 2015)).toMatchObject({ score: null, reason: 'The World Bank logistics score for this market is from 2015, more than 10 years old, so it is not used.' });
    expect(() => assertPolicy({ ...POLICY, world_bank: { max_age_years: 2.5 } })).toThrow(/whole number/);
  });

  test('country risk follows the ECGC grade, capped by restricted cover; off cover is 0', () => {
    expect(scoreCountryRisk({ grade: 'A1', cover: 'open' }, 1, POLICY).score).toBe(100);
    expect(scoreCountryRisk({ grade: 'A1', cover: 'restricted_group_i' }, 1, POLICY).score).toBe(40);
    expect(scoreCountryRisk({ grade: 'B1', cover: 'restricted_group_ii' }, 1, POLICY).score).toBe(20);
    expect(scoreCountryRisk({ grade: 'C2', cover: 'restricted_group_i' }, 1, POLICY).score).toBe(20);
    expect(scoreCountryRisk({ grade: 'B2', cover: 'off_cover' }, 1, POLICY).score).toBe(0);
    expect(scoreCountryRisk({ grade: 'Z9', cover: 'open' }, 1, POLICY).score).toBeNull();
    expect(scoreCountryRisk(null, 1, POLICY).score).toBeNull();
  });

  test("price fit compares the market's price with the exporter's own FOB price per kg", () => {
    expect(scorePriceFit(3, 2, 1, POLICY)).toMatchObject({ score: 100, inputs: { ratio: 1.5 } });
    expect(scorePriceFit(3, 3, 1, POLICY).score).toBe(50);
    expect(scorePriceFit(3, null, 1, POLICY).reason).toMatch(/FOB price per kg/);
    expect(scorePriceFit(null, 2, 1, POLICY).score).toBeNull();
  });

  test('volume fit is 100 up to 2% of the market by weight, 0 from 25%, log-linear between', () => {
    const series = buildMarketSeries([flow(2024, 'CN', 'DE', 1000, 600_000), flow(2024, 'VN', 'DE', 1000, 400_000)], ['DE']).get('DE')!;
    expect(scoreVolumeFit(series, 2024, 20_000, 1, POLICY).score).toBe(100);
    expect(scoreVolumeFit(series, 2024, 250_000, 1, POLICY).score).toBe(0);
    expect(scoreVolumeFit(series, 2024, Math.sqrt(0.02 * 0.25) * 1_000_000, 1, POLICY).score).toBeCloseTo(50, 3);
    const partial = buildMarketSeries([flow(2024, 'CN', 'DE', 1000, 600_000), flow(2024, 'VN', 'DE', 1000, null)], ['DE']).get('DE')!;
    expect(scoreVolumeFit(partial, 2024, 20_000, 1, POLICY)).toMatchObject({ score: null, inputs: { quantity_coverage: 0.5 } });
    expect(scoreVolumeFit(series, 2024, null, 1, POLICY).reason).toMatch(/monthly capacity/);
  });
});

describe('v5 duty inputs', () => {
  /** Invented agreements for the test; the curated list cites each real one's source. */
  const agreements: IndiaTradeAgreement[] = [
    { agreement: 'Agreement A', partner_iso2: 'AE', scope: 'comprehensive', in_force_from: '2022-05-01', in_force_until: null, source_url: 'https://example.test/a' },
    { agreement: 'Agreement B', partner_iso2: 'AE', scope: 'partial', in_force_from: '2006-01-01', in_force_until: null, source_url: 'https://example.test/b' },
    { agreement: 'Agreement B', partner_iso2: 'BD', scope: 'partial', in_force_from: '2006-01-01', in_force_until: null, source_url: 'https://example.test/b' },
    { agreement: 'Agreement C', partner_iso2: 'GB', scope: 'comprehensive', in_force_from: '2027-01-01', in_force_until: null, source_url: 'https://example.test/c' },
  ];

  test('chapters 01–27 use the primary-products tariff, the rest the manufactured one', () => {
    expect(tariffSector('100630', POLICY)).toBe('primary');
    expect(tariffSector('270900', POLICY)).toBe('primary');
    expect(tariffSector('741810', POLICY)).toBe('manufactured');
    expect(() => tariffSector('7418', POLICY)).toThrow(/six-digit/);
  });

  test('the strongest agreement in force on the run date applies; one not yet in force does not', () => {
    const asOf = new Date('2026-10-13T00:00:00Z');
    expect(agreementInForce(agreements, 'AE', asOf)?.agreement).toBe('Agreement A');
    expect(agreementInForce(agreements, 'BD', asOf)?.agreement).toBe('Agreement B');
    expect(agreementInForce(agreements, 'GB', asOf)).toBeNull();
    expect(agreementInForce(agreements, 'AE', new Date('2020-01-01T00:00:00Z'))?.agreement).toBe('Agreement B');
  });

  test('official evidence wins; otherwise a labelled estimate; with no sector average, nothing', () => {
    const resolved = { source: 'authority-release:us', national_line: null, preference: null, fact_ids: ['market_access_tariff:a'], snapshot_ids: ['s1'] };
    const inputs = dutyInputs({
      markets: ['US', 'AE', 'BD', 'GB', 'TV', 'NP'], hs6: '741810', as_of: new Date('2026-10-13T00:00:00Z'),
      official: new Map<string, OfficialDutyResolution>([
        ['US', { status: 'percent', duty_percent: 3, ...resolved }],
        ['GB', { status: 'specific', usd_per_kg: 0.16, expression: '121.00 GBP / 1000 kg', fx: { currency: 'GBP', usd_per_unit: 1.3 }, ...resolved, source: 'UK Trade Tariff' }],
        ['BD', { status: 'unusable', reason: 'Compound duty.', expression: '12% + 50 EUR / 100 kg', ...resolved }],
        ['TV', { status: 'unusable', reason: 'Per litre.', expression: '2 AUD / l', ...resolved }],
        ['NP', { status: 'none', reason: 'No official tariff evidence is stored for this market and product.' }],
      ]),
      primary_tariffs: new Map([['AE', { value: 99, year: 2022 }]]),
      manufactured_tariffs: new Map([['AE', { value: 5, year: 2022 }], ['BD', { value: 12, year: 2022 }], ['GB', { value: 4, year: 2022 }], ['US', { value: 2, year: 2022 }]]),
      agreements, policy: POLICY,
    });
    expect(Object.fromEntries(inputs)).toEqual({
      US: { kind: 'official', duty_percent: 3, source: 'authority-release:us', preference: null },
      AE: { kind: 'estimate', sector_average_percent: 5, agreement_scope: 'comprehensive', agreement_name: 'Agreement A' },
      BD: { kind: 'estimate', sector_average_percent: 12, agreement_scope: 'partial', agreement_name: 'Agreement B', official_note: 'Compound duty.' },
      GB: { kind: 'official_specific', usd_per_kg: 0.16, expression: '121.00 GBP / 1000 kg', source: 'UK Trade Tariff', preference: null, estimate: { kind: 'estimate', sector_average_percent: 4, agreement_scope: 'none', agreement_name: null } },
      TV: { kind: 'unusable', reason: 'Per litre.' },
    });
  });

  test("a market without its own average borrows its customs union's common external tariff, within the union's chapters (v4)", () => {
    const run = (hs6: string) => Object.fromEntries(dutyInputs({
      markets: ['LU', 'AD', 'SM', 'GI'], hs6, as_of: new Date('2026-10-14T00:00:00Z'), official: new Map(),
      primary_tariffs: new Map([['DE', { value: 4.06, year: 2022 }]]), manufactured_tariffs: new Map([['DE', { value: 1.44, year: 2022 }]]),
      agreements, policy: POLICY,
    }));
    expect(run('741810')).toEqual({
      LU: { kind: 'estimate', sector_average_percent: 1.44, agreement_scope: 'none', agreement_name: null, customs_union: 'EU' },
      AD: { kind: 'estimate', sector_average_percent: 1.44, agreement_scope: 'none', agreement_name: null, customs_union: 'EU' },
      SM: { kind: 'estimate', sector_average_percent: 1.44, agreement_scope: 'none', agreement_name: null, customs_union: 'EU' },
    });
    // Rice is chapter 10: outside Andorra's union with the EU (chapters 25–97), so no estimate there.
    expect(Object.keys(run('100630')).sort()).toEqual(['LU', 'SM']);
    const sentence = metricSentence(scoreDuty(run('741810').LU!, POLICY, { official: 1, estimate: 0.5 }));
    expect(sentence).toBe("Duty on Indian goods is 1.4% (estimated from the EU's common external tariff).");
  });

  test('a published rule gives the duty where no tariff line does: free ports, one-rate markets, excepted goods (v5)', () => {
    expect(Object.keys(POLICY.rule_rates).sort()).toEqual(['BL', 'BQ', 'HK', 'MO', 'SG', 'SX', 'TL', 'VA']);
    const resolved = { source: 'x', national_line: null, preference: null, fact_ids: [], snapshot_ids: [] };
    const run = (hs6: string, asOf = '2026-10-14', official = new Map<string, OfficialDutyResolution>()) => Object.fromEntries(dutyInputs({
      markets: ['HK', 'TL', 'SG', 'BL'], hs6, as_of: new Date(`${asOf}T00:00:00Z`), official,
      primary_tariffs: new Map([['HK', { value: 0, year: 2024 }], ['SG', { value: 0.2, year: 2024 }]]),
      manufactured_tariffs: new Map([['HK', { value: 0, year: 2024 }], ['SG', { value: 0, year: 2024 }]]), agreements, policy: POLICY,
    }));
    const brass = run('741810');
    expect(brass.HK).toMatchObject({ kind: 'rule', duty_percent: 0, source_url: expect.stringMatching(/^https:\/\/www\.customs\.gov\.hk\//) });
    expect(brass.TL).toMatchObject({ kind: 'rule', duty_percent: 5 });
    expect(brass.BL).toMatchObject({ kind: 'rule', duty_percent: 5 });
    // Whisky is one of Hong Kong's and Singapore's dutiable goods: the rule leaves it out, so the estimate applies.
    expect(run('220830')).toMatchObject({ HK: { kind: 'estimate' }, SG: { kind: 'estimate' }, TL: { kind: 'rule' } });
    // Usable official evidence comes first; official evidence that yields no rate is never overruled by a rule.
    const official = new Map<string, OfficialDutyResolution>([['SG', { status: 'percent', duty_percent: 0, ...resolved }], ['HK', { status: 'unusable', reason: 'Per litre.', expression: '1 HKD / l', ...resolved }]]);
    expect(run('741810', '2026-10-14', official)).toMatchObject({ SG: { kind: 'official' }, HK: { kind: 'estimate', official_note: 'Per litre.' } });
    // Past its review date a rule is not applied until it is checked again.
    expect(run('741810', '2027-02-01').TL).toBeUndefined();

    const scored = scoreDuty(brass.HK!, POLICY, { official: 1, estimate: 0.5 });
    expect(scored).toMatchObject({ score: 100, quality: 1, inputs: { basis: 'rule', duty_percent: 0 } });
    expect(scored.estimated).toBeUndefined();
    expect(metricSentence(scored)).toBe('Indian goods enter duty-free. Hong Kong is a free port: only liquor, tobacco, hydrocarbon oil, methyl alcohol and motor vehicles are taxed on import.');
    expect(metricSentence(scoreDuty(brass.TL!, POLICY, { official: 1, estimate: 0.5 }))).toBe('Duty on Indian goods is 5%. Timor-Leste charges one customs duty rate on the value of all imports.');

    const broken = (entry: Partial<DemandDiscoveryV5Policy['rule_rates'][string]>) => () => assertPolicy({ ...POLICY, rule_rates: { HK: { ...POLICY.rule_rates.HK!, ...entry } } });
    expect(broken({ except_hs: ['221'] })).toThrow(/chapters, headings or subheadings/);
    expect(broken({ source_url: 'http://example.test' })).toThrow(/https source/);
    expect(broken({ review_by: '2026-10-14' })).toThrow(/later review date/);
  });

  test('a sector average past the age limit gives no estimate, and the market says why', () => {
    const inputs = dutyInputs({
      markets: ['AE', 'BI', 'TV'], hs6: '741810', as_of: new Date('2026-10-14T00:00:00Z'),
      official: new Map<string, OfficialDutyResolution>([['TV', { status: 'unusable', reason: 'Per litre.', expression: '2 AUD / l', source: 'x', national_line: null, preference: null, fact_ids: [], snapshot_ids: [] }]]),
      primary_tariffs: new Map(), manufactured_tariffs: new Map([['AE', { value: 5, year: 2022 }]]),
      manufactured_too_old: new Map([['BI', 2009], ['TV', 2004]]),
      agreements, policy: POLICY,
    });
    expect(Object.fromEntries(inputs)).toEqual({
      AE: { kind: 'estimate', sector_average_percent: 5, agreement_scope: 'comprehensive', agreement_name: 'Agreement A' },
      BI: { kind: 'unusable', reason: 'The World Bank tariff average for this market is from 2009, more than 10 years old, so it is not used.' },
      TV: { kind: 'unusable', reason: 'Per litre. The World Bank tariff average for this market is from 2004, more than 10 years old, so it is not used.' },
    });
  });
});

describe("v5 exporter figures", () => {
  const price = { price_target_amount: 180, price_target_currency: 'INR', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB', unit_net_weight_value: null, unit_net_weight_unit: null };

  test('mass units convert by their exact definitions', () => {
    expect([kgPerUnit('g'), kgPerUnit('KG'), kgPerUnit('tonnes'), kgPerUnit('lb'), kgPerUnit('carton')]).toEqual([0.001, 1, 1000, 0.45359237, null]);
  });

  test('price per kg in USD from a mass price, or a piece price with its net weight, FOB or EXW only', () => {
    expect(exporterUsdPerKg(price, 0.012)).toMatchObject({ value: 2.16, basis: { incoterm: 'FOB', currency: 'INR' } });
    expect(exporterUsdPerKg({ ...price, price_target_currency: 'USD', price_target_amount: 1500, price_target_quantity_unit: 'tonne' }, 1).value).toBeCloseTo(1.5, 10);
    expect(exporterUsdPerKg({ ...price, price_target_currency: 'USD', price_target_amount: 3, price_target_quantity_unit: 'piece', unit_net_weight_value: 500, unit_net_weight_unit: 'g' }, 1).value).toBeCloseTo(6, 10);
    expect(exporterUsdPerKg({ ...price, price_target_incoterm: 'CIF' }, 0.012)).toMatchObject({ value: null, reason: expect.stringMatching(/quoted CIF/) });
    expect(exporterUsdPerKg({ ...price, price_target_quantity_unit: 'carton' }, 0.012)).toMatchObject({ value: null, reason: expect.stringMatching(/per carton/) });
    expect(exporterUsdPerKg(price, null)).toMatchObject({ value: null, reason: expect.stringMatching(/exchange rate for INR/) });
    expect(exporterUsdPerKg({ ...price, price_target_amount: null }, 1).value).toBeNull();
  });

  test('yearly capacity in kg from a mass capacity and its period; monthly when none is given', () => {
    expect(exporterYearlyKg({ capacity_value: 4, capacity_unit: 'tonne', capacity_period: 'month' }).value).toBe(48_000);
    expect(exporterYearlyKg({ capacity_value: 500, capacity_unit: 'kg/week', capacity_period: null }).value).toBe(26_000);
    expect(exporterYearlyKg({ capacity_value: 100, capacity_unit: 'kg', capacity_period: null }).value).toBe(1_200);
    expect(exporterYearlyKg({ capacity_value: 100, capacity_unit: 'piece', capacity_period: 'month' })).toMatchObject({ value: null, reason: expect.stringMatching(/in piece/) });
    expect(exporterYearlyKg({ capacity_value: 100, capacity_unit: 'kg', capacity_period: 'fortnight' })).toMatchObject({ value: null, reason: expect.stringMatching(/fortnight/) });
  });
});
