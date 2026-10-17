/**
 * Demand Discovery v5 policy (docs/36). Every number the score uses lives here, is frozen into
 * each run with its hash, and changes only through a new policy version — never by editing the
 * values a past run was computed with.
 */
import { createHash } from 'node:crypto';

export const DEMAND_DISCOVERY_V5_MODEL = 'market-opportunity-v5';

export type MetricKey =
  | 'market_size' | 'growth' | 'stability'
  | 'india_foothold' | 'price_headroom' | 'openness'
  | 'duty' | 'distance_fit' | 'logistics'
  | 'country_risk'
  | 'price_fit' | 'volume_fit';

export type PartKey = 'demand' | 'india_opportunity' | 'access' | 'risk' | 'exporter_fit';

export interface DemandDiscoveryV5Policy {
  policy_version: string;
  model_version: typeof DEMAND_DISCOVERY_V5_MODEL;
  /** Points per metric (D-012). They sum to 100. */
  points: Record<MetricKey, number>;
  parts: Record<PartKey, MetricKey[]>;
  window_years: number;
  size: { average_years: number; floor_usd: number };
  growth: { cagr_weight: number; momentum_weight: number; floor_percent: number; ceiling_percent: number };
  stability: { minimum_rates: number; ceiling_pp: number };
  foothold: { share_weight: number; trend_weight: number; zero_share_score: number; full_share_percent: number; trend_floor_pp_per_year: number; trend_ceiling_pp_per_year: number; minimum_trend_points: number };
  prices: { neutral_ratio: number; full_ratio: number; minimum_suppliers_with_quantity: number; outlier_iqr_multiple: number };
  openness: { supplier_coverage_min: number; supplier_coverage_max: number };
  /**
   * `official_minimum_confidence`: the evidence confidence (percent) an official tariff row needs,
   * the deep assessment's own minimum (`country_truth.phase_1h` tariff policy).
   */
  duty: { ceiling_percent: number; comprehensive_agreement_factor: number; partial_agreement_factor: number; primary_hs_chapters_through: number; official_minimum_confidence: number };
  distance: { minimum_weight_covered: number };
  logistics: { lpi_min: number; lpi_max: number };
  /**
   * D-021 (R-20): a World Bank value older than `max_age_years` on the run's date counts as missing.
   * Applies to the logistics index and both tariff averages, which countries report irregularly.
   */
  world_bank: { max_age_years: number };
  /**
   * Markets in a customs union whose common external tariff stands in for a World Bank average the
   * market lacks: the estimate uses `reference_market`'s average, for `hs_chapters` only when the
   * union covers part of the tariff. Each entry names its legal basis.
   */
  customs_unions: Record<string, { union: string; reference_market: string; hs_chapters?: [number, number]; basis: string }>;
  risk: { grade_scores: Record<string, number>; restricted_group_i_cap: number; restricted_group_ii_cap: number };
  volume: { full_share: number; zero_share: number; minimum_quantity_coverage: number };
  ranking: { minimum_live_points: number; required_metrics: MetricKey[]; handoff_count: number };
  confidence: { recency_decay_per_year: number };
  /** §5.3: a newest-year change beyond this factor either way is treated as a provisional-data error. */
  chain_link: { max_change_ratio: number };
  quality: { baci_market_reported: number; baci_partner_only: number; comtrade_fallback: number; chain_linked: number; duty_estimate: number; logistics_lpi: number; official: number };
  hs_revision: { max_total_divergence: number };
  labels: { big_size_score: number; big_growth_score: number; india_sells_share_percent: number; pays_above_ratio: number; low_duty_percent: number; hub_reexport_ratio: number };
  /** Markets excluded outright (D-016): comprehensive UN sanctions. */
  excluded_markets: Record<string, string>;
}

export const DEMAND_DISCOVERY_V5_DEFAULT_POLICY: DemandDiscoveryV5Policy = {
  // v2 (13 Oct 2026): adds duty.official_minimum_confidence for Customs Atlas duty. No run used v1.
  // v3 (14 Oct 2026): adds world_bank.max_age_years = 10 (D-021, R-20).
  // v4 (14 Oct 2026): adds customs_unions — duty estimates from a union's common external tariff.
  policy_version: 'demand-discovery-v5-policy-v4',
  model_version: DEMAND_DISCOVERY_V5_MODEL,
  points: {
    market_size: 20, growth: 10, stability: 5,
    india_foothold: 10, price_headroom: 10, openness: 5,
    duty: 10, distance_fit: 5, logistics: 5,
    country_risk: 10,
    price_fit: 5, volume_fit: 5,
  },
  parts: {
    demand: ['market_size', 'growth', 'stability'],
    india_opportunity: ['india_foothold', 'price_headroom', 'openness'],
    access: ['duty', 'distance_fit', 'logistics'],
    risk: ['country_risk'],
    exporter_fit: ['price_fit', 'volume_fit'],
  },
  window_years: 6,
  size: { average_years: 3, floor_usd: 100_000 },
  growth: { cagr_weight: 70, momentum_weight: 30, floor_percent: -20, ceiling_percent: 20 },
  stability: { minimum_rates: 4, ceiling_pp: 50 },
  foothold: { share_weight: 70, trend_weight: 30, zero_share_score: 40, full_share_percent: 10, trend_floor_pp_per_year: -5, trend_ceiling_pp_per_year: 5, minimum_trend_points: 3 },
  prices: { neutral_ratio: 1, full_ratio: 1.5, minimum_suppliers_with_quantity: 3, outlier_iqr_multiple: 1.5 },
  openness: { supplier_coverage_min: 0.95, supplier_coverage_max: 1.05 },
  duty: { ceiling_percent: 25, comprehensive_agreement_factor: 0.5, partial_agreement_factor: 0.8, primary_hs_chapters_through: 27, official_minimum_confidence: 50 },
  distance: { minimum_weight_covered: 0.8 },
  logistics: { lpi_min: 1, lpi_max: 5 },
  world_bank: { max_age_years: 10 },
  // Every EU member carries the same World Bank value for the common external tariff; Germany's stands in.
  customs_unions: {
    LU: { union: 'EU', reference_market: 'DE', basis: 'EU member state: the common customs tariff applies (Council Regulation (EEC) No 2658/87).' },
    MQ: { union: 'EU', reference_market: 'DE', basis: 'French overseas department, inside the Union customs territory (Regulation (EU) No 952/2013, Art. 4).' },
    SM: { union: 'EU', reference_market: 'DE', basis: 'Customs union with the EU (Agreement on Cooperation and Customs Union, in force 1 April 2002).' },
    AD: { union: 'EU', reference_market: 'DE', hs_chapters: [25, 97], basis: 'Customs union with the EU for HS chapters 25–97 only (EEC–Andorra Agreement, 1990).' },
  },
  risk: { grade_scores: { A1: 100, A2: 85, B1: 70, B2: 55, C1: 40, C2: 20, D: 0 }, restricted_group_i_cap: 40, restricted_group_ii_cap: 20 },
  volume: { full_share: 0.02, zero_share: 0.25, minimum_quantity_coverage: 0.8 },
  ranking: { minimum_live_points: 60, required_metrics: ['market_size', 'growth'], handoff_count: 10 },
  confidence: { recency_decay_per_year: 0.8 },
  chain_link: { max_change_ratio: 10 },
  quality: { baci_market_reported: 1, baci_partner_only: 0.85, comtrade_fallback: 0.9, chain_linked: 0.95, duty_estimate: 0.5, logistics_lpi: 0.9, official: 1 },
  hs_revision: { max_total_divergence: 0.02 },
  labels: { big_size_score: 70, big_growth_score: 60, india_sells_share_percent: 1, pays_above_ratio: 1.2, low_duty_percent: 5, hub_reexport_ratio: 0.5 },
  excluded_markets: { KP: 'Comprehensive UN Security Council sanctions (resolution 1718 and successors)' },
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function policyHash(policy: DemandDiscoveryV5Policy): string {
  return createHash('sha256').update(JSON.stringify(canonical(policy))).digest('hex');
}

/** Structural checks a policy must pass before any run uses it. */
export function assertPolicy(policy: DemandDiscoveryV5Policy) {
  const total = Object.values(policy.points).reduce((sum, points) => sum + points, 0);
  if (Math.abs(total - 100) > 1e-9) throw new Error(`v5 points sum to ${total}, not 100.`);
  const inParts = Object.values(policy.parts).flat();
  const keys = Object.keys(policy.points) as MetricKey[];
  if (inParts.length !== keys.length || keys.some((key) => !inParts.includes(key))) throw new Error('Every metric must belong to exactly one part.');
  if (policy.growth.cagr_weight + policy.growth.momentum_weight !== 100) throw new Error('Growth weights must sum to 100.');
  if (policy.foothold.share_weight + policy.foothold.trend_weight !== 100) throw new Error('Foothold weights must sum to 100.');
  if (!(policy.prices.full_ratio > policy.prices.neutral_ratio)) throw new Error('The full price ratio must exceed the neutral ratio.');
  if (!(policy.volume.full_share < policy.volume.zero_share)) throw new Error('Volume full share must be below the zero share.');
  if (!(policy.chain_link.max_change_ratio > 1)) throw new Error('The chain-link change limit must exceed 1.');
  if (!(policy.ranking.minimum_live_points > 0 && policy.ranking.minimum_live_points <= 100)) throw new Error('Minimum live points must be in (0, 100].');
  if (policy.ranking.required_metrics.some((key) => !(key in policy.points))) throw new Error('Required metrics must be policy metrics.');
  if (!(policy.window_years >= 2)) throw new Error('The window needs at least two years.');
  if (!(policy.duty.official_minimum_confidence >= 0 && policy.duty.official_minimum_confidence <= 100)) throw new Error('The official duty confidence minimum must be a percentage.');
  if (!(Number.isInteger(policy.world_bank.max_age_years) && policy.world_bank.max_age_years >= 0)) throw new Error('The World Bank age limit must be a whole number of years.');
  for (const [market, entry] of Object.entries(policy.customs_unions)) {
    if (entry.reference_market === market) throw new Error(`${market}'s customs-union reference must be another market.`);
    if (entry.hs_chapters && !(entry.hs_chapters[0] >= 1 && entry.hs_chapters[0] <= entry.hs_chapters[1] && entry.hs_chapters[1] <= 99)) throw new Error(`${market}'s customs-union chapters are not a valid range.`);
  }
}
