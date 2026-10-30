import { describe, expect, test } from 'vitest';
import { assessMarkets, type AssessMarketsInput, type AssessedMarket } from '../src/lib/demand-discovery-v5/assess';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY, type MetricKey } from '../src/lib/demand-discovery-v5/policy';
import type { TradeFlowInput } from '../src/lib/demand-discovery-v5/series';
import type { ComtradeNewestYearInput } from '../src/lib/demand-discovery-v5/chain-link';

/**
 * A synthetic world for one product. Values are invented; shapes follow BACI after conversion
 * (USD, kg, ISO alpha-2, `cepii_baci:490` for Taiwan).
 */
const YEARS = [2019, 2020, 2021, 2022, 2023, 2024];
const TAIWAN = 'cepii_baci:490';

function series(exporter: string, importer: string, start: number, growth: number, usdPerKg: number | null): TradeFlowInput[] {
  return YEARS.map((year) => {
    const value = start * (1 + growth) ** (year - 2019);
    return { year, exporter, importer, value_usd: value, quantity_kg: usdPerKg == null ? null : value / usdPerKg };
  });
}

function world(): TradeFlowInput[] {
  return [
    ...series('CN', 'US', 1e8, 0.08, 2.0), ...series('VN', 'US', 3e7, 0.1, 2.2), ...series('IN', 'US', 1e7, 0.12, 1.8), ...series(TAIWAN, 'US', 5e6, 0, 3),
    ...series('CN', 'DE', 2e7, 0, 2.5), ...series('VN', 'DE', 1e7, 0, 2.6), ...series('IN', 'DE', 2e6, 0, 2.0),
    ...series('CN', 'AE', 1e7, 0.05, 2.1), ...series('IN', 'AE', 5e6, 0.05, 1.9), ...series('VN', 'AE', 2e6, 0.05, 2.3),
    ...series('AE', 'US', 9e6, 0.05, 2.4), ...series('AE', 'NP', 1e5, 0, 2.4), ...series('IN', 'NP', 2e5, 0, 1.7), ...series('CN', 'NP', 3e4, 0, 2.2),
    ...series('CN', 'KP', 1e6, 0, 2.0),
  ];
}

const sumIn = (flows: TradeFlowInput[], importer: string, year: number, exporter?: string) => flows.filter((flow) => flow.importer === importer && flow.year === year && (!exporter || flow.exporter === exporter)).reduce((sum, flow) => sum + flow.value_usd, 0);

function input(overrides: Partial<AssessMarketsInput> = {}): AssessMarketsInput {
  const flows = world();
  const us2024 = sumIn(flows, 'US', 2024);
  const usIndia2024 = sumIn(flows, 'US', 2024, 'IN');
  const ae2024 = sumIn(flows, 'AE', 2024);
  const newest: ComtradeNewestYearInput[] = [
    { market: 'US', base_year: 2024, world_base_usd: us2024 * 1.05, world_newest_usd: us2024 * 1.05 * 1.07, india_base_usd: usIndia2024 * 1.05, india_newest_usd: usIndia2024 * 1.05 * 1.15 },
    { market: 'DE', base_year: 2024, world_base_usd: 3.1e7, world_newest_usd: null, india_base_usd: 2.1e6, india_newest_usd: null },
    { market: 'AE', base_year: 2024, world_base_usd: ae2024, world_newest_usd: ae2024 * 20, india_base_usd: 1, india_newest_usd: 1 },
  ];
  return {
    policy: POLICY,
    markets: ['US', 'DE', 'AE', 'NP', 'KP', 'TV', 'BT', 'MV'],
    base: { years: YEARS, flows, markets_covered: new Set(['US', 'DE', 'AE', 'NP', 'KP', 'TV', 'IN', 'CN', 'VN']), short_history: false },
    fallback: new Map([['MV', { years: [2019, 2020, 2021, 2022, 2023], flows: [...series('CN', 'MV', 2e6, 0.03, 2.2), ...series('IN', 'MV', 5e5, 0.03, 1.9), ...series('VN', 'MV', 3e5, 0.03, 2.4)].filter((flow) => flow.year <= 2023) }]]),
    reported_latest_year: new Set(['US', 'DE', 'AE']),
    newest_year: new Map(newest.map((item) => [item.market, item])),
    coordinates: new Map([
      ['US', { lat: 38.9, lon: -77.0 }], ['DE', { lat: 52.5, lon: 13.4 }], ['AE', { lat: 24.5, lon: 54.4 }], ['NP', { lat: 27.7, lon: 85.3 }], ['KP', { lat: 39.0, lon: 125.8 }],
      ['TV', { lat: -8.5, lon: 179.2 }], ['BT', { lat: 27.5, lon: 89.6 }], ['MV', { lat: 4.2, lon: 73.5 }], ['IN', { lat: 28.6, lon: 77.2 }], ['CN', { lat: 39.9, lon: 116.4 }],
      ['VN', { lat: 21.0, lon: 105.8 }], [TAIWAN, { lat: 25.0, lon: 121.5 }],
    ]),
    lpi: new Map([['US', 3.8], ['DE', 4.1], ['AE', 4.0], ['NP', 2.5], ['MV', 2.6]]),
    ecgc: new Map([['US', { grade: 'A1', cover: 'open' as const }], ['DE', { grade: 'A1', cover: 'open' as const }], ['AE', { grade: 'A2', cover: 'open' as const }], ['NP', { grade: 'C1', cover: 'restricted_group_ii' as const }], ['MV', { grade: 'B2', cover: 'open' as const }], ['KP', { grade: 'D', cover: 'off_cover' as const }]]),
    duty: new Map([
      ['US', { kind: 'official' as const, duty_percent: 3, source: 'authority-release:us-hts' }],
      ['DE', { kind: 'estimate' as const, sector_average_percent: 4.2, agreement_scope: 'none' as const, agreement_name: null }],
      ['AE', { kind: 'estimate' as const, sector_average_percent: 5, agreement_scope: 'comprehensive' as const, agreement_name: 'India–UAE CEPA' }],
      ['NP', { kind: 'estimate' as const, sector_average_percent: 12, agreement_scope: 'comprehensive' as const, agreement_name: 'India–Nepal Treaty of Trade' }],
      ['MV', { kind: 'estimate' as const, sector_average_percent: 15, agreement_scope: 'partial' as const, agreement_name: 'SAFTA' }],
    ]),
    exporter: { usd_per_kg: 2.0, yearly_kg: 50_000 },
    ...overrides,
  };
}

const byMarket = (markets: AssessedMarket[]) => new Map(markets.map((market) => [market.market, market]));
const metricOf = (market: AssessedMarket, key: MetricKey) => market.metrics.find((result) => result.key === key)!;

describe('v5 assessment across every market', () => {
  const result = assessMarkets(input());
  const markets = byMarket(result.markets);

  test('every universe market gets exactly one result, with a status that says why', () => {
    expect(result.markets.map((market) => market.market)).toEqual(['US', 'DE', 'AE', 'NP', 'KP', 'TV', 'BT', 'MV']);
    expect(Object.fromEntries(result.markets.map((market) => [market.market, market.status]))).toEqual({
      US: 'ranked', DE: 'ranked', AE: 'ranked', NP: 'ranked', KP: 'excluded', TV: 'no_recorded_demand', BT: 'not_enough_data', MV: 'ranked',
    });
    expect(markets.get('KP')).toMatchObject({ excluded_reason: POLICY.excluded_markets.KP, metrics: [], labels: [] });
    expect(markets.get('TV')!.reasons[0].text).toBe('No imports of this product were recorded in 2019–2024.');
    expect(markets.get('BT')).toMatchObject({ source: 'none', live_points: 0, overall: null, confidence: null });
    expect(markets.get('BT')!.reasons[0].text).toMatch(/none of the measures has data/);
  });

  test('the newest year links where both sources allow it, and the result records why not elsewhere', () => {
    const us = markets.get('US')!;
    expect(us).toMatchObject({ window: [2020, 2021, 2022, 2023, 2024, 2025], structure_year: 2024, data_year: 2025, lag: 0 });
    const usFlows = world();
    expect(us.newest_year!.linked!.total_usd).toBeCloseTo(sumIn(usFlows, 'US', 2024) * 1.07, 0);
    expect(us.newest_year!.linked!.india_usd).toBeCloseTo(sumIn(usFlows, 'US', 2024, 'IN') * 1.15, 0);
    expect(metricOf(us, 'growth').quality).toBe(POLICY.quality.chain_linked);
    expect(metricOf(us, 'india_foothold').inputs.trend_points).toBe(6);
    expect(metricOf(us, 'openness').quality).toBe(POLICY.quality.baci_market_reported);
    expect(us.labels.map((label) => label.key)).toContain('newer_data_used');

    expect(markets.get('DE')).toMatchObject({ window: YEARS, data_year: 2024, lag: 1, newest_year: { linked: null, refusal: 'not_reported' } });
    expect(markets.get('AE')!.newest_year).toEqual({ linked: null, refusal: 'implausible_change' });
  });

  test('confidence carries quality, live points and lag; partner-only and fallback markets say so', () => {
    const de = markets.get('DE')!;
    expect(de.confidence).toBeCloseTo((de.live_points / 100) * de.quality! * 0.8, 4);
    const np = markets.get('NP')!;
    expect(np).toMatchObject({ flagged: true, flag_reasons: ['ECGC cover is restricted (Group II)'] });
    expect(metricOf(np, 'market_size').quality).toBe(POLICY.quality.baci_partner_only);
    expect(np.labels.map((label) => label.key)).toEqual(expect.arrayContaining(['estimated_from_partners', 'ecgc_cover_restricted']));
    // D-025: a sanctions programme is a flag beside the ECGC one; the market is scored and ranked exactly as before.
    const flagged = new Map(assessMarkets(input({ sanctions: new Map([['NP', ['UN: invented programme for the test']], ['US', ['US: another invented one']]]) })).markets.map((market) => [market.market, market]));
    expect(flagged.get('NP')).toMatchObject({ flagged: true, flag_reasons: ['ECGC cover is restricted (Group II)', 'UN: invented programme for the test'], overall_exact: np.overall_exact, rank: np.rank });
    expect(flagged.get('US')).toMatchObject({ flagged: true, overall_exact: markets.get('US')!.overall_exact, rank: markets.get('US')!.rank, handed_off: markets.get('US')!.handed_off });
    const mv = markets.get('MV')!;
    expect(mv).toMatchObject({ source: 'comtrade_fallback', window: [2019, 2020, 2021, 2022, 2023], data_year: 2023, lag: 2 });
    expect(metricOf(mv, 'price_headroom').inputs).toMatchObject({ market_valuation: 'cif', year: 2023 });
    expect(mv.labels.map((label) => label.key)).toContain('comtrade_figures');
  });

  test('size is measured against the largest market; the hub, duty and foothold labels come from the data', () => {
    expect(metricOf(markets.get('US')!, 'market_size').score).toBe(100);
    expect(result.largest_market_usd).toBeCloseTo(markets.get('US')!.metrics.find((item) => item.key === 'market_size')!.inputs.average_imports_usd as number, 0);
    expect(markets.get('AE')!.facts.hub_ratio).toBeGreaterThan(0.5);
    expect(markets.get('AE')!.labels.map((label) => label.key)).toEqual(expect.arrayContaining(['trading_hub', 'low_duty_for_india', 'india_already_sells']));
    expect(metricOf(markets.get('AE')!, 'duty')).toMatchObject({ estimated: true, inputs: { duty_percent: 2.5, agreement: 'India–UAE CEPA' } });
    expect(metricOf(markets.get('US')!, 'distance_fit').inputs.covered_share).toBe(1);
  });

  test("India's price is the quantity-weighted median of its export prices in the structure year", () => {
    const india2024 = result.india_unit_values.find((item) => item.year === 2024)!;
    expect(india2024.destinations).toBe(4);
    expect(india2024.usd_per_kg).toBeCloseTo(1.8, 10);
    expect(result.india_unit_values.map((item) => item.year)).toEqual([2023, 2024]);
    expect(metricOf(markets.get('DE')!, 'price_headroom').inputs).toMatchObject({ india_usd_per_kg: 1.8, market_usd_per_kg: 2.5, market_valuation: 'fob' });
  });

  test('every live figure records the years it covers; the LPI year, ECGC list and tariff-average year pass through (item 8)', () => {
    const base = input();
    const dated = byMarket(assessMarkets({
      ...base,
      lpi_years: new Map([['US', 2023]]),
      ecgc: new Map([...base.ecgc].map(([market, rating]) => [market, { ...rating, list: 'ECGC short-term list w.e.f. 2026-07-01' }])),
      duty: new Map([...base.duty].map(([market, duty]) => [market, duty.kind === 'estimate' ? { ...duty, sector_average_year: 2022 } : duty])),
    }).markets);
    const us = dated.get('US')!;
    const span = (market: AssessedMarket, key: MetricKey) => [metricOf(market, key).inputs.first_year, metricOf(market, key).inputs.last_year];
    // The US links 2025 from its own Comtrade report: size and India's sales average the last three
    // years, the trends run over the whole window, and the structure measures read 2024.
    expect(span(us, 'market_size')).toEqual([2023, 2025]);
    expect(span(us, 'growth')).toEqual([2020, 2025]);
    expect(span(us, 'stability')).toEqual([2020, 2025]);
    expect(span(us, 'india_foothold')).toEqual([2020, 2025]);
    expect(span(us, 'india_sales')).toEqual([2023, 2025]);
    for (const key of ['price_headroom', 'openness', 'distance_fit', 'price_fit', 'volume_fit'] as MetricKey[]) expect(span(us, key), key).toEqual([2024, 2024]);
    // A market on its own Comtrade reports records its own window.
    expect(span(dated.get('MV')!, 'market_size')).toEqual([2021, 2023]);
    expect(span(dated.get('MV')!, 'price_headroom')).toEqual([2023, 2023]);
    expect(metricOf(us, 'logistics').inputs).toEqual({ lpi: 3.8, lpi_year: 2023 });
    expect(metricOf(us, 'country_risk').inputs).toEqual({ grade: 'A1', cover: 'open', list: 'ECGC short-term list w.e.f. 2026-07-01' });
    expect(metricOf(dated.get('DE')!, 'duty').inputs).toMatchObject({ basis: 'estimate', sector_average_percent: 4.2, sector_average_year: 2022 });
    // No year is invented: without one the figure records none, and a figure without data records nothing.
    expect(metricOf(dated.get('DE')!, 'logistics').inputs).toEqual({ lpi: 4.1 });
    expect(metricOf(markets.get('US')!, 'country_risk').inputs).toEqual({ grade: 'A1', cover: 'open' });
    expect(metricOf(dated.get('BT')!, 'market_size').inputs).toEqual({});
    // Only the recorded inputs change: every status, score and rank is the same.
    for (const market of result.markets) expect(dated.get(market.market), market.market).toMatchObject({ status: market.status, overall_exact: market.overall_exact, confidence: market.confidence, rank: market.rank });
  });

  test('the US leads, ranks are dense from 1, and the summary hands the ranked markets on in order', () => {
    const ranked = result.markets.filter((market) => market.rank != null).sort((a, b) => a.rank! - b.rank!);
    expect(ranked[0].market).toBe('US');
    expect(ranked.map((market) => market.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(result.summary).toMatchObject({ markets: 8, ranked: 5, excluded: 1, no_recorded_demand: 1, not_enough_data: 1, flagged: 1, newest_data_year: 2025 });
    expect(result.summary.handed_off.map((item) => item.market)).toEqual(ranked.map((market) => market.market));
    expect(result).toMatchObject({ model_version: 'market-opportunity-v5', policy_version: POLICY.policy_version, base_provider: 'cepii_baci', base_years: YEARS });
  });

  test('the same inputs in any order give the same result', () => {
    const shuffled = input();
    const flows = [...shuffled.base!.flows];
    let seed = 7;
    for (let index = flows.length - 1; index > 0; index -= 1) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      const swap = seed % (index + 1);
      [flows[index], flows[swap]] = [flows[swap], flows[index]];
    }
    const again = assessMarkets({ ...shuffled, base: { ...shuffled.base!, flows } });
    const scores = (run: typeof result) => run.markets.map((market) => [market.market, market.overall_exact, market.rank, market.confidence]);
    expect(scores(again)).toEqual(scores(result));
  });

  test('a short history keeps its HS22 years and says so', () => {
    const short = assessMarkets(input({ base: { ...input().base!, years: [2022, 2023, 2024], short_history: true }, newest_year: new Map() }));
    const de = byMarket(short.markets).get('DE')!;
    expect(de.window).toEqual([2022, 2023, 2024]);
    expect(metricOf(de, 'stability').score).toBeNull();
    expect(de.labels.map((label) => label.key)).toContain('short_history');
  });

  test('without a BACI release every market needs its own Comtrade series, and India its own exports', () => {
    const fallbackOnly = assessMarkets(input({ base: null, newest_year: new Map(), india_exports: world().filter((flow) => flow.exporter === 'IN') }));
    const statuses = Object.fromEntries(fallbackOnly.markets.map((market) => [market.market, [market.source, market.status]]));
    expect(statuses).toMatchObject({ MV: ['comtrade_fallback', 'ranked'], US: ['none', 'not_enough_data'], KP: ['none', 'excluded'] });
    expect(fallbackOnly.base_provider).toBeNull();
  });
});

/** Seeded generator so a failing case can be replayed. */
function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('v5 property: a missing input never scores zero', () => {
  test('across 300 random worlds, every dropped input leaves its metric unavailable and outside the overall', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = mulberry32(seed);
      const drop = { lpi: random() < 0.5, ecgc: random() < 0.5, duty: random() < 0.5, price: random() < 0.5, volume: random() < 0.5, quantities: random() < 0.4, coordinates: random() < 0.4, india: random() < 0.3 };
      const base = input();
      const flows = base.base!.flows
        .filter((flow) => !(drop.india && flow.exporter === 'IN' && flow.importer === 'DE'))
        .map((flow) => (drop.quantities && flow.importer === 'DE' ? { ...flow, quantity_kg: null } : flow))
        .map((flow) => (flow.importer === 'DE' ? { ...flow, value_usd: flow.value_usd * (0.5 + random()) } : flow));
      const without = <T>(map: ReadonlyMap<string, T>, dropIt: boolean) => new Map([...map].filter(([key]) => !(dropIt && key === 'DE')));
      const run = assessMarkets({
        ...base,
        base: { ...base.base!, flows },
        lpi: without(base.lpi, drop.lpi), ecgc: without(base.ecgc, drop.ecgc), duty: without(base.duty, drop.duty), coordinates: without(base.coordinates, drop.coordinates),
        exporter: { usd_per_kg: drop.price ? null : 1 + random() * 3, yearly_kg: drop.volume ? null : 1e3 + random() * 1e6 },
      });
      const de = run.markets.find((market) => market.market === 'DE')!;
      const score = (key: MetricKey) => metricOf(de, key).score;
      const context = `seed ${seed} ${JSON.stringify(drop)}`;
      if (drop.lpi) expect(score('logistics'), context).toBeNull();
      if (drop.ecgc) expect(score('country_risk'), context).toBeNull();
      if (drop.duty) expect(score('duty'), context).toBeNull();
      if (drop.price || drop.quantities) expect(score('price_fit'), context).toBeNull();
      if (drop.volume || drop.quantities) expect(score('volume_fit'), context).toBeNull();
      if (drop.quantities) expect(score('price_headroom'), context).toBeNull();
      if (drop.coordinates) expect(score('distance_fit'), context).toBeNull();
      for (const result of de.metrics) {
        if (result.score == null) expect(result.reason, `${context} ${result.key}`).toBeTruthy();
        else expect(result.score, `${context} ${result.key}`).toBeGreaterThanOrEqual(0);
      }
      const live = de.metrics.filter((result) => result.score != null);
      const livePoints = live.reduce((sum, result) => sum + POLICY.points[result.key], 0);
      expect(de.live_points, context).toBe(livePoints);
      expect(de.overall_exact!, context).toBeCloseTo(live.reduce((sum, result) => sum + result.score! * POLICY.points[result.key], 0) / livePoints, 3);
      expect(de.status, context).toBe(livePoints >= 60 ? 'ranked' : 'not_enough_data');
    }
  });
});
