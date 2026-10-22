/**
 * The thirteen v5 metrics (docs/36 §4; India's sales from policy v8). Pure functions: each takes the figures it needs and returns a
 * 0–100 score with the inputs behind it, or `score: null` with the reason. A metric without its
 * inputs is unavailable — it is never scored as zero.
 */
import type { DemandDiscoveryV5Policy, MetricKey } from './policy';
import type { LogisticsEstimate } from './logistics-fallback';
import { tooOldReason } from './world-bank';
import { importsIn, INDIA, type MarketSeries, type UnitValuePoint } from './series';

export interface MetricResult {
  key: MetricKey;
  score: number | null;
  /** Evidence quality of the inputs, 0–1 (docs/36 §5.2). Meaningful only when the score is live. */
  quality: number;
  reason: string | null;
  inputs: Record<string, number | string | boolean | null>;
  estimated?: boolean;
}

export const clamp = (value: number, low = 0, high = 100) => Math.min(high, Math.max(low, value));

/** Maps `value` linearly from [floor, ceiling] onto [0, 100], clamped. */
export const linearScore = (value: number, floor: number, ceiling: number) => clamp(((value - floor) / (ceiling - floor)) * 100);

function unavailable(key: MetricKey, reason: string, inputs: MetricResult['inputs'] = {}): MetricResult {
  return { key, score: null, quality: 0, reason, inputs };
}

function round(value: number, digits = 6) {
  return Number(value.toFixed(digits));
}

// --- statistics -------------------------------------------------------------------------------

/** Quantity-weighted median of unit values. */
export function weightedMedian(points: readonly UnitValuePoint[]): number {
  const sorted = [...points].sort((a, b) => a.unit_value - b.unit_value);
  const total = sorted.reduce((sum, point) => sum + point.quantity_kg, 0);
  let running = 0;
  for (const point of sorted) {
    running += point.quantity_kg;
    if (running >= total / 2) return point.unit_value;
  }
  return sorted[sorted.length - 1].unit_value;
}

function percentile(sorted: readonly number[], p: number) {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

/** Drops unit values outside Tukey's fences (Q1 − k·IQR, Q3 + k·IQR). */
export function tukeyFilter(points: readonly UnitValuePoint[], k: number): UnitValuePoint[] {
  if (points.length < 4) return [...points];
  const sorted = points.map((point) => point.unit_value).sort((a, b) => a - b);
  const q1 = percentile(sorted, 0.25);
  const q3 = percentile(sorted, 0.75);
  const spread = q3 - q1;
  return points.filter((point) => point.unit_value >= q1 - k * spread && point.unit_value <= q3 + k * spread);
}

export function olsSlope(points: readonly { x: number; y: number }[]): number {
  const n = points.length;
  const meanX = points.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = points.reduce((sum, point) => sum + point.y, 0) / n;
  const numerator = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
  const denominator = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);
  return denominator === 0 ? 0 : numerator / denominator;
}

/** Great-circle distance in km between two points given in degrees. */
export function greatCircleKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(b.lat - a.lat);
  const dLon = radians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// --- 1–3 demand -------------------------------------------------------------------------------

/** The size input, S: mean yearly imports over the window's last years; null when all are zero. */
export function averageImportsUsd(series: MarketSeries, window: readonly number[], policy: DemandDiscoveryV5Policy): number | null {
  const years = window.slice(-policy.size.average_years);
  const values = years.map((year) => importsIn(series, year));
  if (!values.some((value) => value > 0)) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * India's own sales to the market (v8, D-032): India's exports averaged over the same years as market
 * size. A real zero — India sold nothing there — is a value, not a gap; only a market with no recorded
 * imports at all has none.
 */
export function averageIndiaSalesUsd(series: MarketSeries, window: readonly number[], policy: DemandDiscoveryV5Policy): number | null {
  const years = window.slice(-policy.size.average_years);
  if (!years.some((year) => importsIn(series, year) > 0)) return null;
  return years.reduce((sum, year) => sum + (series.years.get(year)?.india_usd ?? 0), 0) / years.length;
}

/** Scored like market size, on a log scale from `india_sales.floor_usd` to India's largest market for the product. */
export function scoreIndiaSales(average: number | null, largest: number | null, quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  if (average == null || largest == null) return unavailable('india_sales', 'No recorded imports in the last three years.');
  const floor = Math.log10(policy.india_sales.floor_usd);
  const top = Math.log10(Math.max(largest, policy.india_sales.floor_usd * 10));
  const score = average <= policy.india_sales.floor_usd ? 0 : clamp(((Math.log10(average) - floor) / (top - floor)) * 100);
  return { key: 'india_sales', score: round(score, 4), quality, reason: null, inputs: { average_india_exports_usd: round(average, 2), largest_india_market_usd: round(largest, 2) } };
}

export function scoreMarketSize(average: number | null, largest: number | null, quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  if (average == null || largest == null) return unavailable('market_size', 'No recorded imports in the last three years.');
  const floor = Math.log10(policy.size.floor_usd);
  const top = Math.log10(Math.max(largest, policy.size.floor_usd * 10));
  const score = clamp(((Math.log10(Math.max(average, 1)) - floor) / (top - floor)) * 100);
  return { key: 'market_size', score: round(score, 4), quality, reason: null, inputs: { average_imports_usd: round(average, 2), largest_market_usd: round(largest, 2) } };
}

/**
 * Growth over the window. A zero at either end leaves CAGR without a geometric value
 * (`not_calculable`, as in v4); momentum needs only a positive year before the last, so a market
 * whose imports stopped scores a real −100%, not a missing value.
 */
export function scoreGrowth(series: MarketSeries, window: readonly number[], quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  if (window.length < 2) return unavailable('growth', 'Needs at least two years of data.', { cagr: null, momentum: null });
  const first = window[0];
  const last = window[window.length - 1];
  const start = importsIn(series, first);
  const end = importsIn(series, last);
  const previous = importsIn(series, window[window.length - 2]);
  const cagr = start > 0 && end > 0 ? (end / start) ** (1 / (window.length - 1)) - 1 : null;
  const momentum = previous > 0 ? end / previous - 1 : null;
  if (cagr == null && momentum == null) return unavailable('growth', 'Needs imports in the year before the last, or at both ends of the window.', { cagr: null, momentum: null });
  const { floor_percent: floor, ceiling_percent: ceiling, cagr_weight: cagrWeight, momentum_weight: momentumWeight } = policy.growth;
  const cagrScore = cagr == null ? null : linearScore(cagr * 100, floor, ceiling);
  const momentumScore = momentum == null ? null : linearScore(momentum * 100, floor, ceiling);
  const score = cagrScore != null && momentumScore != null
    ? (cagrScore * cagrWeight + momentumScore * momentumWeight) / (cagrWeight + momentumWeight)
    : (cagrScore ?? momentumScore)!;
  return {
    key: 'growth', score: round(score, 4), quality, reason: null,
    inputs: { cagr_percent: cagr == null ? null : round(cagr * 100, 4), momentum_percent: momentum == null ? null : round(momentum * 100, 4), cagr_years: window.length - 1, cagr_status: cagr == null ? 'not_calculable' : 'complete' },
  };
}

export function scoreStability(series: MarketSeries, window: readonly number[], quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  const rates: number[] = [];
  for (let index = 1; index < window.length; index += 1) {
    const before = importsIn(series, window[index - 1]);
    const after = importsIn(series, window[index]);
    if (before > 0 && after > 0) rates.push((after / before - 1) * 100);
  }
  if (rates.length < policy.stability.minimum_rates) return unavailable('stability', `Needs ${policy.stability.minimum_rates} yearly growth rates; ${rates.length} available.`, { rates: rates.length });
  const mean = rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  const sd = Math.sqrt(rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / rates.length);
  const score = 100 * (1 - Math.min(sd, policy.stability.ceiling_pp) / policy.stability.ceiling_pp);
  return { key: 'stability', score: round(score, 4), quality, reason: null, inputs: { growth_sd_pp: round(sd, 4), rates: rates.length } };
}

// --- 4–6 India's opportunity ------------------------------------------------------------------

export function scoreIndiaFoothold(series: MarketSeries, window: readonly number[], quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  const last = window[window.length - 1];
  const latest = series.years.get(last);
  if (!latest || latest.total_usd <= 0) return unavailable('india_foothold', `No recorded imports in ${last}.`);
  const share = (latest.india_usd / latest.total_usd) * 100;
  const { zero_share_score: zero, full_share_percent: full, share_weight: shareWeight, trend_weight: trendWeight } = policy.foothold;
  const shareScore = zero + (100 - zero) * Math.min(1, Math.log10(1 + share) / Math.log10(1 + full));
  const points = window
    .map((year) => ({ year, data: series.years.get(year) }))
    .filter((point) => point.data && point.data.total_usd > 0)
    .map((point) => ({ x: point.year, y: (point.data!.india_usd / point.data!.total_usd) * 100 }));
  const slope = points.length >= policy.foothold.minimum_trend_points ? olsSlope(points) : null;
  const trendScore = slope == null ? null : linearScore(slope, policy.foothold.trend_floor_pp_per_year, policy.foothold.trend_ceiling_pp_per_year);
  const score = trendScore == null ? shareScore : (shareScore * shareWeight + trendScore * trendWeight) / (shareWeight + trendWeight);
  return {
    key: 'india_foothold', score: round(score, 4), quality, reason: null,
    inputs: { india_share_percent: round(share, 4), share_trend_pp_per_year: slope == null ? null : round(slope, 4), trend_points: points.length },
  };
}

/** Maps a price ratio to 0–100: the neutral ratio scores 50, the full ratio 100, its inverse 0. */
export function priceRatioScore(ratio: number, policy: DemandDiscoveryV5Policy): number {
  return clamp(50 + 50 * (Math.log(ratio / policy.prices.neutral_ratio) / Math.log(policy.prices.full_ratio / policy.prices.neutral_ratio)));
}

/** The market's typical price per kg (USD), or null with too few suppliers that report quantities. */
export function marketMedianUnitValue(points: readonly UnitValuePoint[], policy: DemandDiscoveryV5Policy): number | null {
  const kept = tukeyFilter(points, policy.prices.outlier_iqr_multiple);
  return kept.length >= policy.prices.minimum_suppliers_with_quantity ? weightedMedian(kept) : null;
}

export function scorePriceHeadroom(marketUv: number | null, indiaUv: number | null, quality: number, policy: DemandDiscoveryV5Policy, indiaSharePercent: number | null = null): MetricResult {
  if (marketUv == null) return unavailable('price_headroom', `Fewer than ${policy.prices.minimum_suppliers_with_quantity} suppliers report quantities.`);
  if (indiaUv == null) return unavailable('price_headroom', "India's export price for this product cannot be measured.");
  const ratio = marketUv / indiaUv;
  const raw = priceRatioScore(ratio, policy);
  // v8 (D-032): India already selling a real share here at these prices shows the price is no bar.
  const proven = indiaSharePercent != null && indiaSharePercent >= policy.prices.proven_share_percent && raw < 50;
  return {
    key: 'price_headroom', score: round(proven ? 50 : raw, 4), quality, reason: null,
    inputs: { market_usd_per_kg: round(marketUv, 6), india_usd_per_kg: round(indiaUv, 6), ratio: round(ratio, 6), ...(proven ? { india_share_percent: round(indiaSharePercent, 4), not_counted_against: 'yes' } : {}) },
  };
}

export function scoreOpenness(series: MarketSeries, year: number, quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  const latest = series.years.get(year);
  if (!latest || latest.total_usd <= 0) return unavailable('openness', `No recorded imports in ${year}.`);
  const supplierSum = [...latest.suppliers.values()].reduce((sum, supplier) => sum + supplier.value_usd, 0);
  const coverage = supplierSum / latest.total_usd;
  if (coverage < policy.openness.supplier_coverage_min || coverage > policy.openness.supplier_coverage_max) {
    return unavailable('openness', `Supplier breakdown covers ${round(coverage * 100, 1)}% of imports.`, { coverage: round(coverage, 4) });
  }
  const hhi = [...latest.suppliers.values()].reduce((sum, supplier) => sum + (supplier.value_usd / supplierSum) ** 2, 0);
  if (!policy.openness.exclude_india) return { key: 'openness', score: round(100 * (1 - hhi), 4), quality, reason: null, inputs: { hhi: round(hhi, 6), suppliers: latest.suppliers.size } };
  // v8 (D-032): concentration among India's competitors; India supplying most of a market is not a closed market for India.
  const rivals = [...latest.suppliers.entries()].filter(([code]) => code !== INDIA).map(([, supplier]) => supplier.value_usd);
  const rivalSum = rivals.reduce((sum, value) => sum + value, 0);
  const indiaShare = ((latest.suppliers.get(INDIA)?.value_usd ?? 0) / supplierSum) * 100;
  const rivalHhi = rivalSum > 0 ? rivals.reduce((sum, value) => sum + (value / rivalSum) ** 2, 0) : 0;
  return {
    key: 'openness', score: round(100 * (1 - rivalHhi), 4), quality, reason: null,
    inputs: { rival_hhi: round(rivalHhi, 6), rivals: rivals.length, india_share_percent: round(indiaShare, 4), all_suppliers_hhi: round(hhi, 6), suppliers: latest.suppliers.size },
  };
}

// --- 7–9 access -------------------------------------------------------------------------------

/** A preference published for Indian goods. D-026 (policy v6): scored when it is not a tariff quota; a quota is only shown. */
export interface DutyPreferenceNote { applicability: string; duty_expression: string | null; percent: number | null; quota?: boolean }

/** D-026: the ordinary (MFN) rate that a scored preference stands in for, as published. */
export interface StandardDutyNote { duty_percent: number | null; expression: string | null }

/** Which rate an official duty carries: India's published preference, or the ordinary rate. */
type OfficialRate = { rate_basis?: 'india_preference' | 'standard'; standard?: StandardDutyNote | null; common_tariff?: { union: string; label: string }; schedule_read?: { schedule: string; label: string } };

/** §4.7: the sector average times the agreement factor. `official_note` says why an official duty was not usable. */
export interface EstimatedDuty {
  kind: 'estimate';
  sector_average_percent: number;
  agreement_scope: 'comprehensive' | 'partial' | 'none';
  agreement_name: string | null;
  official_note?: string | null;
  /** The customs union whose common external tariff stood in for the market's own average. */
  customs_union?: string | null;
}

export type DutyInput =
  | ({ kind: 'official'; duty_percent: number; source: string; preference?: DutyPreferenceNote | null; recorded_by_agent?: boolean } & OfficialRate)
  /** A specific duty per kilogram, in USD; the score divides it by the market's unit value. */
  | ({ kind: 'official_specific'; usd_per_kg: number; expression: string; source: string; preference?: DutyPreferenceNote | null; estimate: EstimatedDuty | null; recorded_by_agent?: boolean } & OfficialRate)
  | EstimatedDuty
  /** A published rule fixes the duty for every good it covers (policy `rule_rates`): a free port's zero, or one rate for all goods. */
  | { kind: 'rule'; duty_percent: number; rule: string; basis: string; source_url: string }
  /** Official evidence exists but yields no rate, and nothing to estimate from. */
  | { kind: 'unusable'; reason: string }
  | null;

function scoreEstimatedDuty(input: EstimatedDuty, policy: DemandDiscoveryV5Policy, quality: number, officialNote: string | null): MetricResult {
  const ceiling = policy.duty.ceiling_percent;
  const factor = input.agreement_scope === 'comprehensive' ? policy.duty.comprehensive_agreement_factor : input.agreement_scope === 'partial' ? policy.duty.partial_agreement_factor : 1;
  const estimate = input.sector_average_percent * factor;
  return {
    key: 'duty', score: round(100 * (1 - Math.min(estimate, ceiling) / ceiling), 4), quality, reason: null, estimated: true,
    inputs: {
      duty_percent: round(estimate, 4), basis: 'estimate', sector_average_percent: round(input.sector_average_percent, 4), agreement_scope: input.agreement_scope, agreement: input.agreement_name,
      ...(input.customs_union ? { customs_union: input.customs_union } : {}),
      ...(officialNote ? { official_note: officialNote } : {}),
    },
  };
}

/**
 * Duty on Indian goods. `marketUsdPerKg` — the market's median supplier unit value — turns an
 * official specific duty into its ad-valorem equivalent; without it that duty falls back to the
 * estimate, saying so.
 */
export function scoreDuty(input: DutyInput, policy: DemandDiscoveryV5Policy, quality: { official: number; estimate: number; agent_recorded?: number; common_tariff?: number; schedule_read?: number }, marketUsdPerKg: number | null = null): MetricResult {
  if (!input) return unavailable('duty', 'No official tariff source and no sector average to estimate from.');
  if (input.kind === 'unusable') return unavailable('duty', input.reason);
  const ceiling = policy.duty.ceiling_percent;
  // D-024: a line an agent read from the official tariff keeps its own (policy) quality and says so.
  const byAgent = (input.kind === 'official' || input.kind === 'official_specific') && input.recorded_by_agent === true;
  // D-026: a scored preference says so and keeps the ordinary rate it stands in for.
  const preferred = (input.kind === 'official' || input.kind === 'official_specific') && input.rate_basis === 'india_preference';
  const standardNote = preferred && input.standard ? input.standard : null;
  // D-028: a customs union's common external tariff scores below a national one and names itself.
  const union = (input.kind === 'official' || input.kind === 'official_specific') ? input.common_tariff ?? null : null;
  // D-031: a market's own tariff read from a retained schedule scores like an agent's reading and names itself.
  const schedule = (input.kind === 'official' || input.kind === 'official_specific') ? input.schedule_read ?? null : null;
  const officialQuality = byAgent ? quality.agent_recorded ?? quality.official : union ? quality.common_tariff ?? quality.official : schedule ? quality.schedule_read ?? quality.official : quality.official;
  const official = (percent: number, extra: Record<string, string | number>, preference: DutyPreferenceNote | null | undefined): MetricResult => ({
    key: 'duty', score: round(100 * (1 - Math.min(percent, ceiling) / ceiling), 4), quality: officialQuality, reason: null,
    inputs: {
      duty_percent: round(percent, 4), basis: 'official', ...extra, ...(byAgent ? { recorded_by_agent: 'yes' } : {}), ...(union ? { common_tariff: union.label } : {}), ...(schedule ? { schedule_read: schedule.label } : {}),
      ...(preferred ? { rate: 'india_preference', standard_percent: standardNote?.duty_percent == null ? null : round(standardNote.duty_percent, 4), standard_duty: standardNote?.expression ?? null } : {}),
      ...(preference ? { preference_applicability: preference.applicability, preference_duty: preference.duty_expression, preference_percent: preference.percent == null ? null : round(preference.percent, 4), ...(preference.quota ? { preference_quota: 'yes' } : {}) } : {}),
    },
  });
  if (input.kind === 'official') return official(input.duty_percent, { source: input.source }, input.preference);
  if (input.kind === 'rule') {
    return {
      key: 'duty', score: round(100 * (1 - Math.min(input.duty_percent, ceiling) / ceiling), 4), quality: quality.official, reason: null,
      inputs: { duty_percent: round(input.duty_percent, 4), basis: 'rule', rule: input.rule, source: input.basis, source_url: input.source_url },
    };
  }
  if (input.kind === 'official_specific') {
    if (marketUsdPerKg != null && marketUsdPerKg > 0) {
      return official((input.usd_per_kg / marketUsdPerKg) * 100, { source: input.source, duty_expression: input.expression, duty_usd_per_kg: round(input.usd_per_kg, 6), market_usd_per_kg: round(marketUsdPerKg, 6) }, input.preference);
    }
    const note = `The official duty (${input.expression}) is charged per kilogram and this market's unit value is unknown, so it cannot be turned into a percentage.`;
    return input.estimate ? scoreEstimatedDuty(input.estimate, policy, quality.estimate, note) : unavailable('duty', note);
  }
  return scoreEstimatedDuty(input, policy, quality.estimate, input.official_note ?? null);
}

export function scoreDistanceFit(
  series: MarketSeries, year: number, coordinates: ReadonlyMap<string, { lat: number; lon: number }>, quality: number, policy: DemandDiscoveryV5Policy,
): MetricResult {
  const latest = series.years.get(year);
  const marketPoint = coordinates.get(series.market);
  const indiaPoint = coordinates.get('IN');
  if (!latest || latest.total_usd <= 0) return unavailable('distance_fit', `No recorded imports in ${year}.`);
  if (!marketPoint || !indiaPoint) return unavailable('distance_fit', 'No coordinates for this market or for India.');
  let covered = 0;
  let weighted = 0;
  for (const [supplier, data] of latest.suppliers) {
    const point = coordinates.get(supplier);
    if (!point) continue;
    const km = Math.max(greatCircleKm(point, marketPoint), 1);
    covered += data.value_usd;
    weighted += data.value_usd * Math.log(km);
  }
  const coveredShare = covered / latest.total_usd;
  if (coveredShare < policy.distance.minimum_weight_covered) return unavailable('distance_fit', `Only ${round(coveredShare * 100, 1)}% of supply has known coordinates.`, { covered_share: round(coveredShare, 4) });
  const averageLog = weighted / covered;
  const indiaKm = greatCircleKm(indiaPoint, marketPoint);
  const delta = Math.log(Math.max(indiaKm, 1)) - averageLog;
  const score = delta <= 0 ? 100 : 100 * Math.exp(-delta);
  return { key: 'distance_fit', score: round(score, 4), quality, reason: null, inputs: { india_km: round(indiaKm, 1), usual_supplier_km: round(Math.exp(averageLog), 1), covered_share: round(coveredShare, 4) } };
}

/**
 * Logistics from the World Bank LPI; where none is usable (v5), the LPI that shipping connectivity
 * predicts (`logistics-fallback.ts`), labelled as an estimate with its own quality.
 */
export function scoreLogistics(lpi: number | null, quality: number, policy: DemandDiscoveryV5Policy, tooOldYear: number | null = null, estimate: (LogisticsEstimate & { quality: number }) | null = null): MetricResult {
  if (lpi == null && estimate) {
    return {
      key: 'logistics', score: round(linearScore(estimate.predicted_lpi, policy.logistics.lpi_min, policy.logistics.lpi_max), 4), quality: estimate.quality, reason: null, estimated: true,
      inputs: {
        basis: 'lsci_estimate', predicted_lpi: round(estimate.predicted_lpi, 2), lsci: round(estimate.lsci, 2), lsci_year: estimate.lsci_year,
        fit_pairs: estimate.fit.pairs, fit_r2: round(estimate.fit.r2, 3), ...(tooOldYear != null ? { lpi_too_old_year: tooOldYear } : {}),
      },
    };
  }
  if (lpi == null) return unavailable('logistics', tooOldYear != null ? tooOldReason('logistics score', tooOldYear, policy) : 'No logistics performance score for this market.');
  return { key: 'logistics', score: round(linearScore(lpi, policy.logistics.lpi_min, policy.logistics.lpi_max), 4), quality, reason: null, inputs: { lpi } };
}

// --- 10 risk ----------------------------------------------------------------------------------

export type EcgcCover = 'open' | 'restricted_group_i' | 'restricted_group_ii' | 'off_cover';
export interface EcgcRating { grade: string; cover: EcgcCover }

export function scoreCountryRisk(rating: EcgcRating | null, quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  if (!rating) return unavailable('country_risk', 'Not on the ECGC country list.');
  const base = policy.risk.grade_scores[rating.grade];
  if (base == null) return unavailable('country_risk', `Unknown ECGC grade ${rating.grade}.`, { grade: rating.grade });
  const score = rating.cover === 'off_cover' ? 0
    : rating.cover === 'restricted_group_ii' ? Math.min(base, policy.risk.restricted_group_ii_cap)
      : rating.cover === 'restricted_group_i' ? Math.min(base, policy.risk.restricted_group_i_cap)
        : base;
  return { key: 'country_risk', score, quality, reason: null, inputs: { grade: rating.grade, cover: rating.cover } };
}

// --- 11–12 exporter fit -----------------------------------------------------------------------

export function scorePriceFit(marketUv: number | null, exporterUsdPerKg: number | null, quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  if (exporterUsdPerKg == null) return unavailable('price_fit', 'Your FOB price per kg is not on the product form yet.');
  if (marketUv == null) return unavailable('price_fit', `Fewer than ${policy.prices.minimum_suppliers_with_quantity} suppliers report quantities.`);
  const ratio = marketUv / exporterUsdPerKg;
  return { key: 'price_fit', score: round(priceRatioScore(ratio, policy), 4), quality, reason: null, inputs: { market_usd_per_kg: round(marketUv, 6), your_usd_per_kg: round(exporterUsdPerKg, 6), ratio: round(ratio, 6) } };
}

export function scoreVolumeFit(series: MarketSeries, year: number, exporterYearlyKg: number | null, quality: number, policy: DemandDiscoveryV5Policy): MetricResult {
  if (exporterYearlyKg == null || !(exporterYearlyKg > 0)) return unavailable('volume_fit', 'Your monthly capacity in a weight unit is not on the product form yet.');
  const latest = series.years.get(year);
  if (!latest || latest.total_usd <= 0) return unavailable('volume_fit', `No recorded imports in ${year}.`);
  const coverage = latest.value_with_quantity_usd / latest.total_usd;
  if (coverage < policy.volume.minimum_quantity_coverage) return unavailable('volume_fit', `Quantities cover only ${round(coverage * 100, 1)}% of imports.`, { quantity_coverage: round(coverage, 4) });
  const marketKg = latest.quantity_kg_reported / coverage;
  const share = exporterYearlyKg / marketKg;
  const { full_share: full, zero_share: zero } = policy.volume;
  const score = share <= full ? 100 : share >= zero ? 0 : (100 * (Math.log(zero) - Math.log(share))) / (Math.log(zero) - Math.log(full));
  return { key: 'volume_fit', score: round(score, 4), quality, reason: null, inputs: { your_share_of_market: round(share, 6), market_tonnes: round(marketKg / 1000, 3) } };
}
