import { describe, expect, test } from 'vitest';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY, type MetricKey } from '../src/lib/demand-discovery-v5/policy';
import type { MetricResult } from '../src/lib/demand-discovery-v5/metrics';
import { rankMarkets, scoreMarket, summarizeRun, type MarketGate, type ScoredMarket } from '../src/lib/demand-discovery-v5/score';
import { formatPercent, formatUsd, marketLabels, marketReasons, metricSentence, type MarketFacts } from '../src/lib/demand-discovery-v5/explain';
import { chainLinkNewestYear, extendWindow, type ComtradeNewestYearInput } from '../src/lib/demand-discovery-v5/chain-link';
import { testHsRevision, worldTotals } from '../src/lib/demand-discovery-v5/hs-revision';
import { baciFlowsToTradeFlows, sortFlows } from '../src/lib/demand-discovery-v5/baci-flows';
import type { MarketYear } from '../src/lib/demand-discovery-v5/series';

const OPEN: MarketGate = { excluded_reason: null, no_recorded_demand: false, flag_reasons: [] };
const ALL: MetricKey[] = ['market_size', 'growth', 'stability', 'india_foothold', 'price_headroom', 'openness', 'duty', 'distance_fit', 'logistics', 'country_risk', 'price_fit', 'volume_fit'];

const metric = (key: MetricKey, score: number | null, extra: Partial<MetricResult> = {}): MetricResult => ({ key, score, quality: score == null ? 0 : 1, reason: score == null ? 'missing' : null, inputs: {}, ...extra });
const allAt = (score: number) => ALL.map((key) => metric(key, score));
const facts = (extra: Partial<MarketFacts> = {}): MarketFacts => ({ partner_only: false, newest_year_linked: false, short_history: false, comtrade_fallback: false, hub_ratio: null, ecgc_cover: 'open', window: [2019, 2024], ...extra });

describe('v5 score', () => {
  test('overall is the points-weighted mean of live metrics; missing metrics drop out, never count as zero', () => {
    const full = scoreMarket({ market: 'DE', gate: OPEN, metrics: allAt(50), data_year: 2024 }, POLICY);
    expect(full).toMatchObject({ status: 'ranked', overall: 50, live_points: 100 });
    expect(full.parts.map((part) => [part.part, part.points, part.score])).toEqual([['demand', 35, 50], ['india_opportunity', 25, 50], ['access', 20, 50], ['risk', 10, 50], ['exporter_fit', 10, 50]]);

    const sparse = scoreMarket({
      market: 'DE', gate: OPEN, data_year: 2024,
      metrics: [metric('market_size', 80), metric('growth', 60), metric('duty', 100), metric('country_risk', 70), metric('openness', 50), metric('logistics', 40), ...['stability', 'india_foothold', 'price_headroom', 'distance_fit', 'price_fit', 'volume_fit'].map((key) => metric(key as MetricKey, null))],
    }, POLICY);
    expect(sparse).toMatchObject({ status: 'ranked', live_points: 60, overall_exact: 72.5, overall: 73, shortfall: null });
    expect(sparse.parts.find((part) => part.part === 'exporter_fit')).toEqual({ part: 'exporter_fit', points: 10, live_points: 0, score: null });
  });

  test('ranking needs 60 live points and both size and growth; otherwise not_enough_data with its partial score', () => {
    const short = scoreMarket({ market: 'DE', gate: OPEN, data_year: 2024, metrics: [metric('market_size', 80), metric('growth', 60), metric('duty', 100), metric('country_risk', 70), metric('openness', 50)] }, POLICY);
    expect(short).toMatchObject({ status: 'not_enough_data', live_points: 55, overall: 75, shortfall: { live_points: 55, minimum_live_points: 60, missing_required: [] } });
    const noGrowth = scoreMarket({ market: 'DE', gate: OPEN, data_year: 2024, metrics: ALL.map((key) => metric(key, key === 'growth' ? null : 70)) }, POLICY);
    expect(noGrowth).toMatchObject({ status: 'not_enough_data', live_points: 90, overall: 70, shortfall: { missing_required: ['growth'] } });
  });

  test('gates: excluded and no-recorded-demand markets are not scored; a flag leaves the score alone', () => {
    expect(scoreMarket({ market: 'KP', gate: { ...OPEN, excluded_reason: 'UN sanctions' }, metrics: allAt(90), data_year: 2024 }, POLICY))
      .toMatchObject({ status: 'excluded', overall: null, metrics: [], excluded_reason: 'UN sanctions' });
    expect(scoreMarket({ market: 'TV', gate: { ...OPEN, no_recorded_demand: true }, metrics: [], data_year: 2024 }, POLICY)).toMatchObject({ status: 'no_recorded_demand', overall: null });
    expect(scoreMarket({ market: 'NP', gate: { ...OPEN, flag_reasons: ['ECGC offers no cover'] }, metrics: allAt(60), data_year: 2024 }, POLICY))
      .toMatchObject({ status: 'ranked', flagged: true, overall: 60, flag_reasons: ['ECGC offers no cover'] });
  });

  test('refuses a duplicated metric, a metric outside the policy and a score outside 0–100', () => {
    expect(() => scoreMarket({ market: 'DE', gate: OPEN, data_year: 2024, metrics: [metric('growth', 1), metric('growth', 2)] }, POLICY)).toThrow(/twice/);
    expect(() => scoreMarket({ market: 'DE', gate: OPEN, data_year: 2024, metrics: [metric('gdp' as MetricKey, 1)] }, POLICY)).toThrow(/not in policy/);
    expect(() => scoreMarket({ market: 'DE', gate: OPEN, data_year: 2024, metrics: [metric('growth', 101)] }, POLICY)).toThrow(/outside 0–100/);
  });

  test('confidence = live/100 × points-weighted quality × 0.8^lag, with lag from the newest data year', () => {
    const estimatedDuty = ALL.map((key) => (key === 'duty' ? metric(key, 60, { quality: 0.5 }) : metric(key, 60)));
    const markets = rankMarkets([
      scoreMarket({ market: 'US', gate: OPEN, metrics: estimatedDuty, data_year: 2025 }, POLICY),
      scoreMarket({ market: 'DE', gate: OPEN, metrics: allAt(60), data_year: 2024 }, POLICY),
    ], POLICY);
    expect(markets[0]).toMatchObject({ lag: 0, quality: 0.95, confidence: 0.95 });
    expect(markets[1]).toMatchObject({ lag: 1, quality: 1, confidence: 0.8 });
  });

  test('ranks by exact score, then confidence, then ISO code; hands the top N to regional discovery', () => {
    const at = (market: string, score: number, year = 2024) => scoreMarket({ market, gate: OPEN, metrics: allAt(score), data_year: year }, POLICY);
    const ranked = rankMarkets([at('FR', 70), at('AE', 70), at('US', 80, 2025), at('NP', 70, 2025), scoreMarket({ market: 'TV', gate: { ...OPEN, no_recorded_demand: true }, metrics: [], data_year: null }, POLICY)], { ...POLICY, ranking: { ...POLICY.ranking, handoff_count: 2 } });
    const order = [...ranked].filter((market) => market.rank != null).sort((a, b) => a.rank! - b.rank!).map((market) => market.market);
    expect(order).toEqual(['US', 'NP', 'AE', 'FR']);
    expect(ranked.filter((market) => market.handed_off).map((market) => market.market).sort()).toEqual(['NP', 'US']);
    expect(ranked.find((market) => market.market === 'TV')).toMatchObject({ rank: null, lag: null, confidence: null });
    expect(summarizeRun(ranked)).toMatchObject({ markets: 5, ranked: 4, no_recorded_demand: 1, newest_data_year: 2025, handed_off: [{ market: 'US', rank: 1, overall: 80 }, { market: 'NP', rank: 2, overall: 70 }] });
  });
});

describe('v5 labels and reasons', () => {
  const rich = () => scoreMarket({
    market: 'AE', gate: OPEN, data_year: 2025,
    metrics: [
      metric('market_size', 85, { inputs: { average_imports_usd: 42_300_000 } }),
      metric('growth', 70, { inputs: { cagr_percent: 6.2, momentum_percent: 4, cagr_years: 5 } }),
      metric('stability', 30, { inputs: { growth_sd_pp: 35 } }),
      metric('india_foothold', 90, { inputs: { india_share_percent: 12.5, share_trend_pp_per_year: 0.8 } }),
      metric('price_headroom', 80, { inputs: { ratio: 1.3 } }),
      metric('openness', 70, { inputs: { suppliers: 41 } }),
      metric('duty', 80, { estimated: true, quality: 0.5, inputs: { duty_percent: 2.5, basis: 'estimate' } }),
      metric('distance_fit', 100, { inputs: { india_km: 1940, usual_supplier_km: 4200 } }),
      metric('logistics', 75, { inputs: { lpi: 4 } }),
      metric('country_risk', 85, { inputs: { grade: 'A2', cover: 'open' } }),
      metric('price_fit', null), metric('volume_fit', null),
    ],
  }, POLICY);

  test('labels follow the configured thresholds and say when duty is estimated', () => {
    const labels = marketLabels(rich(), facts({ newest_year_linked: true, hub_ratio: 0.8 }), POLICY);
    expect(labels.map((label) => label.key)).toEqual(['big_and_growing', 'india_already_sells', 'pays_above_india_price', 'low_duty_for_india', 'trading_hub', 'newer_data_used']);
    expect(labels.find((label) => label.key === 'low_duty_for_india')).toMatchObject({ text: 'Low duty for India (estimated)', estimated: true });
    expect(marketLabels(rich(), facts({ ecgc_cover: 'off_cover', partner_only: true, short_history: true, comtrade_fallback: true }), POLICY).map((label) => label.text))
      .toEqual(expect.arrayContaining(['No ECGC cover', "Estimated from partners' figures", 'Short history', "From the market's own customs reports"]));
  });

  test('three reasons: the two metrics adding most points and the one costing most', () => {
    const reasons = marketReasons(rich(), facts(), POLICY);
    expect(reasons).toEqual([
      { metric: 'market_size', effect: 'adds', text: 'Imports averaged $42.3 million a year over the last three years.' },
      { metric: 'india_foothold', effect: 'adds', text: 'India supplies 12.5% of imports, and its share is rising.' },
      { metric: 'stability', effect: 'costs', text: 'Imports swing a lot from year to year (yearly growth varies by about 35 points).' },
    ]);
  });

  test('a market that is not ranked leads with why; gated markets get one status sentence', () => {
    const partial = scoreMarket({ market: 'BT', gate: OPEN, data_year: 2024, metrics: [metric('duty', 100, { inputs: { duty_percent: 0 } }), metric('market_size', null), metric('growth', null)] }, POLICY);
    expect(marketReasons(partial, facts(), POLICY).map((reason) => reason.text)).toEqual(['Not ranked: market size and growth have no data.', 'Indian goods enter duty-free.']);
    const tv = scoreMarket({ market: 'TV', gate: { ...OPEN, no_recorded_demand: true }, metrics: [], data_year: 2024 }, POLICY);
    expect(marketReasons(tv, facts({ window: [2019, 2020, 2021, 2022, 2023, 2024] }), POLICY)).toEqual([{ metric: null, effect: 'status', text: 'No imports of this product were recorded in 2019–2024.' }]);
    expect(marketLabels(tv, facts({ hub_ratio: 3 }), POLICY)).toEqual([]);
  });

  test('sentences state observed values in plain words', () => {
    expect(formatUsd(950)).toBe('$950');
    expect(formatUsd(450_000)).toBe('$450,000');
    expect(formatUsd(2_340_000_000)).toBe('$2.3 billion');
    expect(formatPercent(0.043)).toBe('0.04%');
    expect(formatPercent(12.46)).toBe('12.5%');
    expect(formatPercent(150)).toBe('150%');
    expect(metricSentence(metric('growth', 0, { inputs: { cagr_percent: null, momentum_percent: -100, cagr_years: 5 } }))).toBe('Imports stopped in the latest year.');
    expect(metricSentence(metric('growth', 30, { inputs: { cagr_percent: -4.25, momentum_percent: 1, cagr_years: 5 } }))).toBe('Imports fell 4.3% a year over 5 years.');
    expect(metricSentence(metric('price_headroom', 20, { inputs: { ratio: 0.8 } }))).toBe("Buyers here pay about 20% less than India's usual export price.");
    expect(metricSentence(metric('price_fit', 20, { inputs: { ratio: 0.8 } }))).toBe('Your price is about 25% above what this market usually pays.');
    expect(metricSentence(metric('distance_fit', 40, { inputs: { india_km: 6543, usual_supplier_km: 2100 } }))).toBe('India is farther away than its usual suppliers (6,540 km against 2,100 km).');
    expect(metricSentence(metric('country_risk', 20, { inputs: { grade: 'C1', cover: 'restricted_group_ii' } }))).toBe('High payment risk: ECGC rates the country C1, with restricted ECGC cover.');
    expect(metricSentence(metric('duty', 80, { inputs: { duty_percent: 5, basis: 'official', preference_percent: 0, preference_applicability: 'potentially_applicable_requires_origin_proof' } }))).toBe('Duty on Indian goods is 5%; duty-free entry may apply with proof of Indian origin.');
    expect(metricSentence(metric('duty', 0, { inputs: { duty_percent: 25.4, basis: 'official', duty_expression: '175.00 EUR / 1000 kg' } }))).toBe("Duty on Indian goods is about 25.4% (175.00 EUR / 1000 kg at this market's prices).");
    expect(metricSentence(metric('duty', 82, { estimated: true, inputs: { duty_percent: 4.5, basis: 'estimate' } }))).toBe('Duty on Indian goods is 4.5% (estimated).');
    expect(metricSentence(metric('market_size', 10, { inputs: { average_imports_usd: 330_000 } }), 'costs')).toBe('It is a small market: imports averaged $330,000 a year over the last three years.');
    expect(metricSentence(metric('growth', 62.5, { inputs: { cagr_percent: 5, momentum_percent: 5, cagr_years: 5 } }), 'costs')).toBe('Imports grew a modest 5% a year over 5 years.');
    expect(metricSentence(metric('growth', 50, { inputs: { cagr_percent: 0.2, momentum_percent: 0, cagr_years: 5 } }))).toBe('Imports have been flat over 5 years.');
    expect(metricSentence(metric('price_headroom', 63, { inputs: { ratio: 1.11 } }), 'costs')).toBe("Buyers here pay only about 11% more than India's usual export price.");
    expect(metricSentence(metric('price_fit', 50, { inputs: { ratio: 1 } }))).toBe('Your price matches what this market usually pays.');
    expect(metricSentence(metric('price_fit', 77, { inputs: { ratio: 1.25 } }))).toBe('Your price is about 20% below what this market usually pays.');
    expect(metricSentence(metric('india_foothold', 45, { inputs: { india_share_percent: 0.4, share_trend_pp_per_year: null } }), 'costs')).toBe('India supplies only 0.4% of imports so far.');
    expect(metricSentence(metric('volume_fit', 0, { inputs: { your_share_of_market: 0.289 } }))).toBe("Your capacity would be 28.9% of this market's imports by weight.");
  });
});

describe('v5 newest-year chain-link', () => {
  const baci: MarketYear = { year: 2024, total_usd: 1000, india_usd: 100, value_with_quantity_usd: 1000, quantity_kg_reported: 500, suppliers: new Map() };
  const ct = (extra: Partial<ComtradeNewestYearInput> = {}): ComtradeNewestYearInput => ({ market: 'US', base_year: 2024, world_base_usd: 800, world_newest_usd: 1000, india_base_usd: 80, india_newest_usd: 120, ...extra });

  test('BACI keeps the level, Comtrade supplies the change, for the market and for India', () => {
    const result = chainLinkNewestYear(baci, ct(), POLICY);
    expect(result.refusal).toBeNull();
    expect(result.linked).toMatchObject({ year: 2025, total_usd: 1250, india_usd: 150, india_refusal: null, provenance: { baci_base_usd: 1000, comtrade_base_usd: 800, comtrade_newest_usd: 1000, change_ratio: 1.25, india_change_ratio: 1.5 } });
  });

  test('refuses a link it cannot make honestly, and says which', () => {
    expect(chainLinkNewestYear(baci, ct({ world_newest_usd: null }), POLICY).refusal).toBe('not_reported');
    expect(chainLinkNewestYear(undefined, ct(), POLICY).refusal).toBe('no_baci_base');
    expect(chainLinkNewestYear({ ...baci, year: 2023 }, ct(), POLICY).refusal).toBe('no_baci_base');
    expect(chainLinkNewestYear(baci, ct({ world_base_usd: 0 }), POLICY).refusal).toBe('no_comtrade_base');
    expect(chainLinkNewestYear(baci, ct({ world_newest_usd: 8_100 }), POLICY).refusal).toBe('implausible_change');
    expect(chainLinkNewestYear(baci, ct({ world_newest_usd: 0 }), POLICY).refusal).toBe('implausible_change');
  });

  test("India's flow links only when both sources agree it exists; otherwise the market links without it", () => {
    const india = (extra: Partial<ComtradeNewestYearInput>, base: MarketYear = baci) => {
      const linked = chainLinkNewestYear(base, ct(extra), POLICY).linked!;
      return [linked.india_usd, linked.india_refusal];
    };
    expect(india({ india_newest_usd: null })).toEqual([null, 'not_reported']);
    expect(india({ india_base_usd: 0, india_newest_usd: 10 })).toEqual([null, 'india_entered']);
    expect(india({ india_base_usd: 0, india_newest_usd: 0 })).toEqual([null, 'sources_disagree']);
    expect(india({ india_base_usd: 0, india_newest_usd: 0 }, { ...baci, india_usd: 0 })).toEqual([0, null]);
    expect(india({}, { ...baci, india_usd: 0 })).toEqual([null, 'sources_disagree']);
    expect(india({ india_newest_usd: 0 })).toEqual([null, 'implausible_change']);
    expect(india({ india_newest_usd: 160 }, { ...baci, india_usd: 900 })).toEqual([null, 'exceeds_market']);
  });

  test('the window grows by one year and keeps at most window_years', () => {
    expect(extendWindow([2019, 2020, 2021, 2022, 2023, 2024], 2025, 6)).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(extendWindow([2022, 2023, 2024], 2025, 6)).toEqual([2022, 2023, 2024, 2025]);
    expect(() => extendWindow([2022, 2023], 2025, 6)).toThrow(/does not follow/);
  });
});

describe('v5 HS revision test', () => {
  const years = [2022, 2023, 2024];
  const totals = (values: number[]) => new Map(values.map((value, index) => [years[index], value]));

  test('the older file supplies the window only when world totals agree within 2% every year', () => {
    expect(testHsRevision({ hs6: '100630', older: totals([100, 101, 99]), newer: totals([100, 100, 100]), overlap_years: years, max_divergence: 0.02 })).toMatchObject({ verdict: 'consistent', use_older_revision: true });
    expect(testHsRevision({ hs6: '850760', older: totals([100, 110, 100]), newer: totals([100, 100, 100]), overlap_years: years, max_divergence: 0.02 })).toMatchObject({ verdict: 'totals_diverge', use_older_revision: false });
    expect(testHsRevision({ hs6: '850760', older: totals([0, 100, 100]), newer: totals([50, 100, 100]), overlap_years: years, max_divergence: 0.02 }).years[0]).toEqual({ year: 2022, older_usd: 0, newer_usd: 50, divergence: 1 });
    expect(testHsRevision({ hs6: '850760', older: new Map(), newer: totals([50, 60, 70]), overlap_years: years, max_divergence: 0.02 }).verdict).toBe('absent_in_older_revision');
    expect(testHsRevision({ hs6: '999999', older: new Map(), newer: new Map(), overlap_years: years, max_divergence: 0.02 }).verdict).toBe('no_overlap_trade');
  });

  test('world totals sum every bilateral flow per year', () => {
    expect(worldTotals([{ year: 2024, value_usd: 1 }, { year: 2024, value_usd: 2 }, { year: 2023, value_usd: 5 }])).toEqual(new Map([[2024, 3], [2023, 5]]));
  });
});

describe('v5 BACI flow conversion', () => {
  const countries = [{ provider_code: '699', iso2: 'IN' }, { provider_code: '842', iso2: 'US' }, { provider_code: '490', iso2: null }, { provider_code: '251', iso2: 'FR' }, { provider_code: '250', iso2: 'FR' }];
  const baciFlow = (exporter: string, importer: string, value_kusd: number, quantity_t: number | null) => ({ year: 2024, exporter, importer, product: '100630', value_kusd, quantity_t });

  test('thousand USD and tonnes become USD and kg; codes become ISO, or a provider identity without one', () => {
    const converted = baciFlowsToTradeFlows([baciFlow('699', '842', 1.5, 0.2), baciFlow('490', '842', 10, null), baciFlow('251', '250', 3, 1)], countries);
    expect(converted.flows).toEqual([
      { year: 2024, exporter: 'IN', importer: 'US', value_usd: 1500, quantity_kg: 200 },
      { year: 2024, exporter: 'cepii_baci:490', importer: 'US', value_usd: 10_000, quantity_kg: null },
    ]);
    expect(converted.dropped_self_flows).toBe(1);
    expect([...converted.markets_covered].sort()).toEqual(['FR', 'IN', 'US']);
    expect(() => baciFlowsToTradeFlows([baciFlow('999', '842', 1, 1)], countries)).toThrow(/999 is not in the release's country file/);
  });

  test('flows sort into one order whatever order they were read in', () => {
    const flows = [{ year: 2024, exporter: 'CN', importer: 'US', value_usd: 2, quantity_kg: null }, { year: 2023, exporter: 'IN', importer: 'US', value_usd: 1, quantity_kg: null }, { year: 2024, exporter: 'CN', importer: 'DE', value_usd: 3, quantity_kg: null }];
    expect(sortFlows([...flows])).toEqual(sortFlows([...flows].reverse()));
    expect(sortFlows([...flows]).map((flow) => `${flow.year}${flow.importer}`)).toEqual(['2023US', '2024DE', '2024US']);
  });
});

describe('v5 ranked market shape', () => {
  test('rankMarkets returns new objects and leaves its input untouched', () => {
    const input: ScoredMarket[] = [scoreMarket({ market: 'DE', gate: OPEN, metrics: allAt(50), data_year: 2024 }, POLICY)];
    const snapshot = JSON.stringify(input);
    rankMarkets(input, POLICY);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
