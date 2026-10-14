/**
 * Demand Discovery v5 for one product across every screening market (docs/36). Pure: the caller
 * reads the frozen releases and passes their rows in; this computes the twelve metrics for each
 * market, gates, scores, ranks, labels and explains them. Nothing here reads a database or a network.
 *
 * Years per market:
 *   - the base window is the base dataset's last `window_years` years (BACI: 2019–2024, or
 *     2022–2024 with `short_history`);
 *   - where the newest year links (§5.3), size, growth and stability use the window extended to
 *     `L+1`, and India's foothold does too when India's own flow links;
 *   - supplier mix, unit values and quantities — openness, distance, prices, volume — use the
 *     base window's last year, the "structure year".
 */
import { assertPolicy, DEMAND_DISCOVERY_V5_MODEL, policyHash, type DemandDiscoveryV5Policy } from './policy';
import { buildMarketSeries, importsIn, indiaExportUnitValues, marketUnitValues, type MarketSeries, type TradeFlowInput } from './series';
import {
  averageImportsUsd, marketMedianUnitValue, scoreCountryRisk, scoreDistanceFit, scoreDuty, scoreGrowth, scoreIndiaFoothold, scoreLogistics,
  scoreMarketSize, scoreOpenness, scorePriceFit, scorePriceHeadroom, scoreStability, scoreVolumeFit,
  type DutyInput, type EcgcRating, type MetricResult,
} from './metrics';
import { chainLinkNewestYear, extendWindow, type ChainLinkRefusal, type ComtradeNewestYearInput, type LinkedNewestYear } from './chain-link';
import { rankMarkets, scoreMarket, summarizeRun, type MarketGate, type RunSummary, type ScoredMarket } from './score';
import { marketLabels, marketReasons, type MarketFacts, type MarketLabel, type MarketReason } from './explain';
import { sortFlows } from './baci-flows';

export type MarketSource = 'baci' | 'comtrade_fallback' | 'none';

export interface AssessMarketsInput {
  policy: DemandDiscoveryV5Policy;
  /** The screening universe, ISO alpha-2 (docs/31). */
  markets: readonly string[];
  /**
   * The BACI release's flows. `null` when no BACI release is ready (§3.3 release-level fallback):
   * every market then needs a Comtrade fallback series, and India's prices need `india_exports`.
   */
  base: {
    /** Ascending consecutive years; the last `window_years` form the base window. */
    years: readonly number[];
    flows: readonly TradeFlowInput[];
    /** Markets the dataset's own country reference covers. A covered market with no flow has recorded zero imports. */
    markets_covered: ReadonlySet<string>;
    short_history: boolean;
  } | null;
  /** The market's own Comtrade series, for markets the base dataset does not cover (§3.3). */
  fallback?: ReadonlyMap<string, { years: readonly number[]; flows: readonly TradeFlowInput[] }>;
  /** India's exports by destination when there is no base dataset (Comtrade, FOB). */
  india_exports?: readonly TradeFlowInput[];
  /** Markets that reported the base dataset's last year to Comtrade themselves (getDa). */
  reported_latest_year: ReadonlySet<string>;
  /** What each market reported for `L` and `L+1`, for the newest-year link. */
  newest_year?: ReadonlyMap<string, ComtradeNewestYearInput>;
  /** Capital coordinates by identity (ISO alpha-2, or a provider identity such as `cepii_baci:490`). */
  coordinates: ReadonlyMap<string, { lat: number; lon: number }>;
  lpi: ReadonlyMap<string, number>;
  /** Markets whose latest logistics score is older than the policy's World Bank age limit, with its year. */
  lpi_too_old?: ReadonlyMap<string, number>;
  ecgc: ReadonlyMap<string, EcgcRating>;
  duty: ReadonlyMap<string, Exclude<DutyInput, null>>;
  /** The exporter's own figures; a missing one may carry the specific reason it is missing. */
  exporter: { usd_per_kg: number | null; yearly_kg: number | null; price_reason?: string | null; volume_reason?: string | null };
}

export interface AssessedMarket extends ScoredMarket {
  source: MarketSource;
  /** The years size and growth were measured over. */
  window: number[];
  structure_year: number | null;
  newest_year: { linked: LinkedNewestYear | null; refusal: ChainLinkRefusal | null } | null;
  facts: MarketFacts;
  labels: MarketLabel[];
  reasons: MarketReason[];
}

export interface AssessmentResult {
  model_version: typeof DEMAND_DISCOVERY_V5_MODEL;
  policy_version: string;
  policy_hash: string;
  base_provider: 'cepii_baci' | null;
  base_years: number[];
  short_history: boolean;
  /** India's typical export price per kg by structure year, the price headroom's denominator. */
  india_unit_values: { year: number; usd_per_kg: number | null; destinations: number }[];
  largest_market_usd: number | null;
  markets: AssessedMarket[];
  summary: RunSummary;
}

const unavailableTrade = (key: MetricResult['key'], reason: string): MetricResult => ({ key, score: null, quality: 0, reason, inputs: {} });

/** A copy of `series` with the linked newest year added. Only total and India values exist for it. */
function withNewestYear(series: MarketSeries, linked: LinkedNewestYear): MarketSeries {
  const years = new Map(series.years);
  years.set(linked.year, {
    year: linked.year, total_usd: linked.total_usd, india_usd: linked.india_usd ?? 0,
    value_with_quantity_usd: 0, quantity_kg_reported: 0, suppliers: new Map(),
  });
  return { market: series.market, years, exports_usd: series.exports_usd };
}

function ecgcFlag(rating: EcgcRating | undefined): string | null {
  if (!rating) return null;
  if (rating.cover === 'off_cover') return 'ECGC offers no cover for this market';
  if (rating.cover === 'restricted_group_ii') return 'ECGC cover is restricted (Group II)';
  return null;
}

interface MarketContext {
  market: string;
  source: MarketSource;
  series: MarketSeries | null;
  window: number[];
  quality: number;
  partner_only: boolean;
  link: { linked: LinkedNewestYear | null; refusal: ChainLinkRefusal | null } | null;
  demand_series: MarketSeries | null;
  demand_window: number[];
  foothold_series: MarketSeries | null;
  foothold_window: number[];
  excluded_reason: string | null;
  no_recorded_demand: boolean;
  average_imports: number | null;
}

export function assessMarkets(input: AssessMarketsInput): AssessmentResult {
  const { policy } = input;
  assertPolicy(policy);
  const quality = policy.quality;
  const base = input.base;
  const baseWindow = base ? [...base.years].slice(-policy.window_years) : [];
  for (let index = 1; index < baseWindow.length; index += 1) {
    if (baseWindow[index] !== baseWindow[index - 1] + 1) throw new Error(`Base years must be consecutive; got ${baseWindow.join(', ')}.`);
  }
  // Sorted first: floating-point sums then do not depend on the order partitions were read in.
  const baseFlows = base ? sortFlows([...base.flows]) : [];
  const baseSeries = base ? buildMarketSeries(baseFlows, input.markets) : new Map<string, MarketSeries>();
  const latestBaseYear = baseWindow.length ? baseWindow[baseWindow.length - 1] : null;

  const contexts: MarketContext[] = input.markets.map((market) => {
    let source: MarketSource = 'none';
    let series: MarketSeries | null = null;
    let window: number[] = [];
    let marketQuality = 0;
    let partnerOnly = false;
    if (base && base.markets_covered.has(market)) {
      source = 'baci';
      series = baseSeries.get(market)!;
      window = baseWindow;
      partnerOnly = !input.reported_latest_year.has(market);
      marketQuality = partnerOnly ? quality.baci_partner_only : quality.baci_market_reported;
    } else if (input.fallback?.has(market)) {
      const fallback = input.fallback.get(market)!;
      source = 'comtrade_fallback';
      series = buildMarketSeries(sortFlows([...fallback.flows]), [market]).get(market)!;
      window = [...fallback.years].slice(-policy.window_years);
      marketQuality = quality.comtrade_fallback;
    }
    const excludedReason = policy.excluded_markets[market] ?? null;
    const noRecordedDemand = !excludedReason && series != null && window.every((year) => importsIn(series!, year) <= 0);

    let link: MarketContext['link'] = null;
    const newest = input.newest_year?.get(market);
    if (!excludedReason && !noRecordedDemand && source === 'baci' && newest && latestBaseYear != null) {
      if (newest.base_year !== latestBaseYear) throw new Error(`Newest-year input for ${market} links onto ${newest.base_year}, not ${latestBaseYear}.`);
      const result = chainLinkNewestYear(series!.years.get(latestBaseYear), newest, policy);
      link = { linked: result.linked, refusal: result.refusal };
    }
    const linked = link?.linked ?? null;
    const demandSeries = linked ? withNewestYear(series!, linked) : series;
    const demandWindow = linked ? extendWindow(window, linked.year, policy.window_years) : window;
    const indiaLinked = linked != null && linked.india_usd != null;
    return {
      market, source, series, window, quality: marketQuality, partner_only: partnerOnly, link,
      demand_series: demandSeries, demand_window: demandWindow,
      foothold_series: indiaLinked ? demandSeries : series, foothold_window: indiaLinked ? demandWindow : window,
      excluded_reason: excludedReason, no_recorded_demand: noRecordedDemand,
      average_imports: !excludedReason && demandSeries ? averageImportsUsd(demandSeries, demandWindow, policy) : null,
    };
  });

  const sizes = contexts.map((context) => context.average_imports).filter((value): value is number => value != null);
  const largest = sizes.length ? Math.max(...sizes) : null;

  const indiaFlows = input.india_exports ? sortFlows([...input.india_exports]) : baseFlows;
  const indiaUnitValues = new Map<number, { usd_per_kg: number | null; destinations: number }>();
  const indiaUv = (year: number) => {
    if (!indiaUnitValues.has(year)) {
      const points = indiaExportUnitValues(indiaFlows, year);
      indiaUnitValues.set(year, { usd_per_kg: marketMedianUnitValue(points, policy), destinations: points.length });
    }
    return indiaUnitValues.get(year)!.usd_per_kg;
  };

  const scored = contexts.map((context) => {
    const structureYear = context.window.length ? context.window[context.window.length - 1] : null;
    const rating = input.ecgc.get(context.market);
    const flag = ecgcFlag(rating);
    const gate: MarketGate = { excluded_reason: context.excluded_reason, no_recorded_demand: context.no_recorded_demand, flag_reasons: flag ? [flag] : [] };
    const metrics: MetricResult[] = [];
    let marketUv: number | null = null;
    if (!context.excluded_reason && !context.no_recorded_demand) {
      const linkedQuality = context.link?.linked ? quality.chain_linked : context.quality;
      const indiaQuality = context.link?.linked?.india_usd != null ? quality.chain_linked : context.quality;
      if (context.series && structureYear != null) {
        const series = context.series;
        marketUv = marketMedianUnitValue(marketUnitValues(series, structureYear), policy);
        const valuation = context.source === 'comtrade_fallback' ? 'cif' : 'fob';
        const priced = (result: MetricResult): MetricResult => (result.score == null ? result : { ...result, inputs: { ...result.inputs, market_valuation: valuation, year: structureYear } });
        // The exporter-input reasons say exactly which product fact is missing or unusable.
        const because = (result: MetricResult, missing: boolean, reason: string | null | undefined): MetricResult => (result.score == null && missing && reason ? { ...result, reason } : result);
        metrics.push(
          scoreMarketSize(context.average_imports, largest, linkedQuality, policy),
          scoreGrowth(context.demand_series!, context.demand_window, linkedQuality, policy),
          scoreStability(context.demand_series!, context.demand_window, linkedQuality, policy),
          scoreIndiaFoothold(context.foothold_series!, context.foothold_window, indiaQuality, policy),
          priced(scorePriceHeadroom(marketUv, indiaUv(structureYear), context.quality, policy)),
          scoreOpenness(series, structureYear, context.quality, policy),
          scoreDistanceFit(series, structureYear, input.coordinates, context.quality, policy),
          because(priced(scorePriceFit(marketUv, input.exporter.usd_per_kg, context.quality, policy)), input.exporter.usd_per_kg == null, input.exporter.price_reason),
          because(scoreVolumeFit(series, structureYear, input.exporter.yearly_kg, context.quality, policy), input.exporter.yearly_kg == null, input.exporter.volume_reason),
        );
      } else {
        const reason = 'No trade dataset covers this market.';
        for (const key of ['market_size', 'growth', 'stability', 'india_foothold', 'price_headroom', 'openness', 'distance_fit', 'price_fit', 'volume_fit'] as const) metrics.push(unavailableTrade(key, reason));
      }
      metrics.push(
        scoreDuty(input.duty.get(context.market) ?? null, policy, { official: quality.official, estimate: quality.duty_estimate }, marketUv),
        scoreLogistics(input.lpi.get(context.market) ?? null, quality.logistics_lpi, policy, input.lpi_too_old?.get(context.market) ?? null),
        scoreCountryRisk(rating ?? null, quality.official, policy),
      );
    }
    const dataYear = context.demand_window.length ? context.demand_window[context.demand_window.length - 1] : null;
    return { context, structureYear, rating, result: scoreMarket({ market: context.market, gate, metrics, data_year: dataYear }, policy) };
  });

  const ranked = rankMarkets(scored.map((item) => item.result), policy);
  const markets: AssessedMarket[] = ranked.map((result, index) => {
    const { context, structureYear, rating } = scored[index];
    const imports = context.series && structureYear != null ? importsIn(context.series, structureYear) : 0;
    const facts: MarketFacts = {
      partner_only: context.partner_only,
      newest_year_linked: context.link?.linked != null,
      short_history: context.source === 'baci' && (base?.short_history ?? false),
      comtrade_fallback: context.source === 'comtrade_fallback',
      hub_ratio: context.source === 'baci' && imports > 0 ? (context.series!.exports_usd.get(structureYear!) ?? 0) / imports : null,
      ecgc_cover: rating?.cover ?? null,
      window: context.demand_window,
    };
    return {
      ...result,
      source: context.source,
      window: context.demand_window,
      structure_year: structureYear,
      newest_year: context.link,
      facts,
      labels: marketLabels(result, facts, policy),
      reasons: marketReasons(result, facts, policy),
    };
  });

  return {
    model_version: DEMAND_DISCOVERY_V5_MODEL,
    policy_version: policy.policy_version,
    policy_hash: policyHash(policy),
    base_provider: base ? 'cepii_baci' : null,
    base_years: baseWindow,
    short_history: base?.short_history ?? false,
    india_unit_values: [...indiaUnitValues.entries()].sort(([a], [b]) => a - b).map(([year, value]) => ({ year, ...value })),
    largest_market_usd: largest,
    markets,
    summary: summarizeRun(markets),
  };
}
