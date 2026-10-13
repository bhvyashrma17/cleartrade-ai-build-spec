/**
 * The v5 score, ranking and confidence (docs/36 §5). Pure: metric results in, ranked markets out.
 *
 * - overall = Σ(score × points) / Σ live points. An unavailable metric drops out and its points are
 *   shared among the rest; it is never scored as zero.
 * - Ranked only with ≥ `ranking.minimum_live_points` live points and every required metric live;
 *   otherwise `not_enough_data`, shown with its partial score and never ranked.
 * - confidence = (live points / 100) × evidence quality × decay^lag.
 * - Gates run before scoring: sanctioned markets are `excluded`, markets without any recorded imports
 *   are `no_recorded_demand`, and restricted ECGC cover is a flag on an otherwise normal result.
 */
import type { DemandDiscoveryV5Policy, MetricKey, PartKey } from './policy';
import type { MetricResult } from './metrics';

export type MarketStatus = 'ranked' | 'not_enough_data' | 'no_recorded_demand' | 'excluded';

export interface MarketGate {
  /** Set for markets the policy excludes outright (D-016). */
  excluded_reason: string | null;
  /** No recorded imports in any year of the market's window. */
  no_recorded_demand: boolean;
  /** Reasons the market is flagged; it is still scored and ranked. */
  flag_reasons: string[];
}

export interface PartScore {
  part: PartKey;
  points: number;
  live_points: number;
  /** 0–100 over the part's live metrics, or null when none is live. */
  score: number | null;
}

export interface RankingShortfall {
  live_points: number;
  minimum_live_points: number;
  missing_required: MetricKey[];
}

export interface ScoredMarket {
  market: string;
  status: MarketStatus;
  flagged: boolean;
  flag_reasons: string[];
  excluded_reason: string | null;
  /** Whole number shown to people; `overall_exact` orders the ranking. */
  overall: number | null;
  overall_exact: number | null;
  live_points: number;
  parts: PartScore[];
  /** Points-weighted mean evidence quality of the live metrics. */
  quality: number | null;
  /** The market's newest data year (the window's last year). */
  data_year: number | null;
  lag: number | null;
  confidence: number | null;
  rank: number | null;
  handed_off: boolean;
  shortfall: RankingShortfall | null;
  metrics: MetricResult[];
}

export interface MarketScoreInput {
  market: string;
  gate: MarketGate;
  metrics: MetricResult[];
  data_year: number | null;
}

const round = (value: number, digits = 4) => Number(value.toFixed(digits));

function partScores(metrics: ReadonlyMap<MetricKey, MetricResult>, policy: DemandDiscoveryV5Policy): PartScore[] {
  return (Object.entries(policy.parts) as [PartKey, MetricKey[]][]).map(([part, keys]) => {
    let points = 0;
    let live = 0;
    let weighted = 0;
    for (const key of keys) {
      points += policy.points[key];
      const result = metrics.get(key);
      if (result?.score == null) continue;
      live += policy.points[key];
      weighted += result.score * policy.points[key];
    }
    return { part, points, live_points: live, score: live > 0 ? round(weighted / live) : null };
  });
}

/** Scores one market before ranking. Lag, confidence and rank need every market and come later. */
export function scoreMarket(input: MarketScoreInput, policy: DemandDiscoveryV5Policy): ScoredMarket {
  const base: ScoredMarket = {
    market: input.market, status: 'not_enough_data', flagged: input.gate.flag_reasons.length > 0, flag_reasons: [...input.gate.flag_reasons],
    excluded_reason: null, overall: null, overall_exact: null, live_points: 0, parts: [], quality: null, data_year: input.data_year,
    lag: null, confidence: null, rank: null, handed_off: false, shortfall: null, metrics: input.metrics,
  };
  if (input.gate.excluded_reason) return { ...base, status: 'excluded', excluded_reason: input.gate.excluded_reason, metrics: [], data_year: null };
  if (input.gate.no_recorded_demand) return { ...base, status: 'no_recorded_demand', metrics: [] };

  const byKey = new Map<MetricKey, MetricResult>();
  for (const result of input.metrics) {
    if (byKey.has(result.key)) throw new Error(`Metric ${result.key} appears twice for ${input.market}.`);
    if (!(result.key in policy.points)) throw new Error(`Metric ${result.key} is not in policy ${policy.policy_version}.`);
    if (result.score != null && !(result.score >= 0 && result.score <= 100)) throw new Error(`Metric ${result.key} for ${input.market} scored ${result.score}, outside 0–100.`);
    byKey.set(result.key, result);
  }

  let live = 0;
  let weighted = 0;
  let qualityWeighted = 0;
  for (const [key, result] of byKey) {
    if (result.score == null) continue;
    live += policy.points[key];
    weighted += result.score * policy.points[key];
    qualityWeighted += result.quality * policy.points[key];
  }
  const missingRequired = policy.ranking.required_metrics.filter((key) => byKey.get(key)?.score == null);
  const rankable = live >= policy.ranking.minimum_live_points && missingRequired.length === 0;
  const exact = live > 0 ? round(weighted / live) : null;
  return {
    ...base,
    status: rankable ? 'ranked' : 'not_enough_data',
    overall: exact == null ? null : Math.round(exact),
    overall_exact: exact,
    live_points: live,
    parts: partScores(byKey, policy),
    quality: live > 0 ? round(qualityWeighted / live) : null,
    shortfall: rankable ? null : { live_points: live, minimum_live_points: policy.ranking.minimum_live_points, missing_required: missingRequired },
  };
}

/**
 * Adds lag, confidence, rank and the hand-off to regional discovery. Ties on the exact score go to
 * the higher confidence, then to the ISO code, so the same inputs always give the same order.
 */
export function rankMarkets(markets: readonly ScoredMarket[], policy: DemandDiscoveryV5Policy): ScoredMarket[] {
  const scored = markets.filter((market) => market.status === 'ranked' || market.status === 'not_enough_data');
  const years = scored.map((market) => market.data_year).filter((year): year is number => year != null);
  const newest = years.length ? Math.max(...years) : null;
  const withConfidence = markets.map((market) => {
    if (market.status !== 'ranked' && market.status !== 'not_enough_data') return { ...market };
    const lag = newest != null && market.data_year != null ? newest - market.data_year : null;
    const confidence = market.quality != null && lag != null
      ? round((market.live_points / 100) * market.quality * policy.confidence.recency_decay_per_year ** lag)
      : null;
    return { ...market, lag, confidence };
  });
  const order = withConfidence
    .filter((market) => market.status === 'ranked')
    .sort((a, b) => (b.overall_exact! - a.overall_exact!) || ((b.confidence ?? 0) - (a.confidence ?? 0)) || (a.market < b.market ? -1 : a.market > b.market ? 1 : 0));
  const ranks = new Map(order.map((market, index) => [market.market, index + 1]));
  return withConfidence.map((market) => {
    const rank = ranks.get(market.market) ?? null;
    return { ...market, rank, handed_off: rank != null && rank <= policy.ranking.handoff_count };
  });
}

export interface RunSummary {
  markets: number;
  ranked: number;
  not_enough_data: number;
  no_recorded_demand: number;
  excluded: number;
  flagged: number;
  newest_data_year: number | null;
  handed_off: { market: string; rank: number; overall: number; confidence: number | null }[];
}

export function summarizeRun(markets: readonly ScoredMarket[]): RunSummary {
  const count = (status: MarketStatus) => markets.filter((market) => market.status === status).length;
  const years = markets.map((market) => market.data_year).filter((year): year is number => year != null);
  return {
    markets: markets.length,
    ranked: count('ranked'),
    not_enough_data: count('not_enough_data'),
    no_recorded_demand: count('no_recorded_demand'),
    excluded: count('excluded'),
    flagged: markets.filter((market) => market.flagged && market.status !== 'excluded').length,
    newest_data_year: years.length ? Math.max(...years) : null,
    handed_off: markets
      .filter((market) => market.handed_off)
      .sort((a, b) => a.rank! - b.rank!)
      .map((market) => ({ market: market.market, rank: market.rank!, overall: market.overall!, confidence: market.confidence })),
  };
}
