/**
 * Labels and reasons for a scored market (docs/36 §6). Pure templates over the numbers the metrics
 * already computed: nothing here changes a score, and every sentence states an observed value —
 * never a projection of what the exporter will earn (docs/14 §3a framing rule).
 */
import type { DemandDiscoveryV5Policy, MetricKey } from './policy';
import type { EcgcCover, MetricResult } from './metrics';
import type { ScoredMarket } from './score';

export type LabelKey =
  | 'big_and_growing'
  | 'india_already_sells'
  | 'pays_above_india_price'
  | 'low_duty_for_india'
  | 'trading_hub'
  | 'ecgc_cover_restricted'
  | 'estimated_from_partners'
  | 'newer_data_used'
  | 'short_history'
  | 'comtrade_figures';

export interface MarketLabel {
  key: LabelKey;
  text: string;
  tone: 'positive' | 'caution' | 'info';
  estimated?: boolean;
}

/** Facts about a market's evidence that the metric results do not carry. */
export interface MarketFacts {
  /** The market did not report its latest year; its figures come from its partners' records. */
  partner_only: boolean;
  newest_year_linked: boolean;
  short_history: boolean;
  comtrade_fallback: boolean;
  /** The market's exports of the product over its imports, in the structure year. */
  hub_ratio: number | null;
  ecgc_cover: EcgcCover | null;
  /** The market's window, for the no-recorded-demand sentence. */
  window: readonly number[];
}

export interface MarketReason {
  metric: MetricKey | null;
  effect: 'adds' | 'costs' | 'status';
  text: string;
}

const METRIC_NAMES: Record<MetricKey, string> = {
  market_size: 'market size', growth: 'growth', stability: 'stability',
  india_foothold: "India's foothold", price_headroom: 'price headroom', openness: 'openness',
  duty: 'duty', distance_fit: 'distance', logistics: 'logistics',
  country_risk: 'country risk', price_fit: 'price fit', volume_fit: 'volume fit',
};

// --- formatting -------------------------------------------------------------------------------

export function formatUsd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)} billion`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)} million`;
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

export function formatPercent(value: number): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  return `${Number(value.toFixed(digits))}%`;
}

const formatKm = (km: number) => `${(Math.round(km / 10) * 10).toLocaleString('en-US')} km`;
const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

// --- labels -----------------------------------------------------------------------------------

export function marketLabels(market: ScoredMarket, facts: MarketFacts, policy: DemandDiscoveryV5Policy): MarketLabel[] {
  if (market.status !== 'ranked' && market.status !== 'not_enough_data') return [];
  const metric = (key: MetricKey) => market.metrics.find((result) => result.key === key);
  const labels: MarketLabel[] = [];
  const size = metric('market_size')?.score;
  const growth = metric('growth')?.score;
  if (size != null && growth != null && size >= policy.labels.big_size_score && growth >= policy.labels.big_growth_score) {
    labels.push({ key: 'big_and_growing', text: 'Big and growing', tone: 'positive' });
  }
  const share = num(metric('india_foothold')?.inputs.india_share_percent);
  if (share != null && share >= policy.labels.india_sells_share_percent) labels.push({ key: 'india_already_sells', text: 'India already sells here', tone: 'positive' });
  const headroom = metric('price_headroom');
  const ratio = headroom?.score != null ? num(headroom.inputs.ratio) : null;
  if (ratio != null && ratio >= policy.labels.pays_above_ratio) labels.push({ key: 'pays_above_india_price', text: "Pays above India's price", tone: 'positive' });
  const duty = metric('duty');
  const dutyPercent = duty?.score != null ? num(duty.inputs.duty_percent) : null;
  if (dutyPercent != null && dutyPercent <= policy.labels.low_duty_percent) {
    labels.push(duty!.estimated
      ? { key: 'low_duty_for_india', text: 'Low duty for India (estimated)', tone: 'positive', estimated: true }
      : { key: 'low_duty_for_india', text: 'Low duty for India', tone: 'positive' });
  }
  if (facts.hub_ratio != null && facts.hub_ratio >= policy.labels.hub_reexport_ratio) labels.push({ key: 'trading_hub', text: 'Trading hub', tone: 'info' });
  if (facts.ecgc_cover && facts.ecgc_cover !== 'open') {
    labels.push({ key: 'ecgc_cover_restricted', text: facts.ecgc_cover === 'off_cover' ? 'No ECGC cover' : 'ECGC cover restricted', tone: 'caution' });
  }
  if (facts.partner_only) labels.push({ key: 'estimated_from_partners', text: "Estimated from partners' figures", tone: 'info' });
  if (facts.newest_year_linked) labels.push({ key: 'newer_data_used', text: 'Newer data used', tone: 'info' });
  if (facts.short_history) labels.push({ key: 'short_history', text: 'Short history', tone: 'info' });
  if (facts.comtrade_fallback) labels.push({ key: 'comtrade_figures', text: "From the market's own customs reports", tone: 'info' });
  return labels;
}

// --- reasons ----------------------------------------------------------------------------------

/** ECGC's seven grades in plain words: payment risk, low to high. */
const RISK_WORDS: Record<string, string> = { A1: 'Low', A2: 'Low', B1: 'Moderate', B2: 'Moderate', C1: 'High', C2: 'High', D: 'Very high' };

/**
 * One factual sentence about a live metric. `effect` only changes emphasis — "only", "a modest",
 * "a small market" — when the metric is the one costing most; the numbers are the same either way.
 */
export function metricSentence(result: MetricResult, effect: 'adds' | 'costs' = 'adds'): string {
  const inputs = result.inputs;
  const costs = effect === 'costs';
  switch (result.key) {
    case 'market_size': {
      const sentence = `imports averaged ${formatUsd(num(inputs.average_imports_usd) ?? 0)} a year over the last three years.`;
      return costs ? `It is a small market: ${sentence}` : `I${sentence.slice(1)}`;
    }
    case 'growth': {
      const cagr = num(inputs.cagr_percent);
      const momentum = num(inputs.momentum_percent);
      if (cagr != null) {
        if (Math.abs(cagr) < 0.5) return `Imports have been flat over ${inputs.cagr_years} years.`;
        if (cagr < 0) return `Imports fell ${formatPercent(-cagr)} a year over ${inputs.cagr_years} years.`;
        return `Imports grew ${costs ? 'a modest ' : ''}${formatPercent(cagr)} a year over ${inputs.cagr_years} years.`;
      }
      if (momentum! <= -100) return 'Imports stopped in the latest year.';
      return `Imports ${momentum! >= 0 ? 'grew' : 'fell'} ${formatPercent(Math.abs(momentum!))} in the latest year.`;
    }
    case 'stability': {
      const sd = num(inputs.growth_sd_pp) ?? 0;
      return result.score! >= 60 ? 'Imports are steady from year to year.' : `Imports swing a lot from year to year (yearly growth varies by about ${Math.round(sd)} points).`;
    }
    case 'india_foothold': {
      const share = num(inputs.india_share_percent) ?? 0;
      const trend = num(inputs.share_trend_pp_per_year);
      const direction = trend == null || Math.abs(trend) < 0.1 ? '' : trend > 0 ? ', and its share is rising' : ', and its share is falling';
      if (share === 0) return `India does not supply this market yet${direction}.`;
      return costs && share < 1 ? `India supplies only ${formatPercent(share)} of imports so far${direction}.` : `India supplies ${formatPercent(share)} of imports${direction}.`;
    }
    case 'price_headroom': {
      const ratio = num(inputs.ratio) ?? 1;
      if (Math.abs(ratio - 1) < 0.005) return "Buyers here pay about the same as India's usual export price.";
      return ratio > 1
        ? `Buyers here pay ${costs ? 'only ' : ''}about ${formatPercent((ratio - 1) * 100)} more than India's usual export price.`
        : `Buyers here pay about ${formatPercent((1 - ratio) * 100)} less than India's usual export price.`;
    }
    case 'openness':
      return result.score! >= 60 ? `Supply is spread across ${inputs.suppliers} countries; no one dominates.` : 'A few countries supply most of the imports.';
    case 'duty': {
      const duty = num(inputs.duty_percent) ?? 0;
      const estimated = result.estimated ? ' (estimated)' : '';
      return duty === 0 ? `Indian goods enter duty-free${estimated}.` : `Duty on Indian goods is ${formatPercent(duty)}${estimated}.`;
    }
    case 'distance_fit':
      return result.score === 100
        ? 'India is no farther away than its usual suppliers.'
        : `India is farther away than its usual suppliers (${formatKm(num(inputs.india_km) ?? 0)} against ${formatKm(num(inputs.usual_supplier_km) ?? 0)}).`;
    case 'logistics':
      return `Logistics performance is rated ${(num(inputs.lpi) ?? 0).toFixed(1)} out of 5 (World Bank).`;
    case 'country_risk': {
      const grade = String(inputs.grade);
      const cover = inputs.cover === 'open' ? '' : inputs.cover === 'off_cover' ? ', with no ECGC cover' : ', with restricted ECGC cover';
      return `${RISK_WORDS[grade] ?? 'Rated'} payment risk: ECGC rates the country ${grade}${cover}.`;
    }
    case 'price_fit': {
      const ratio = num(inputs.ratio) ?? 1;
      if (Math.abs(ratio - 1) < 0.005) return 'Your price matches what this market usually pays.';
      return ratio > 1
        ? `Your price is about ${formatPercent((1 - 1 / ratio) * 100)} below what this market usually pays.`
        : `Your price is about ${formatPercent((1 / ratio - 1) * 100)} above what this market usually pays.`;
    }
    case 'volume_fit': {
      const share = (num(inputs.your_share_of_market) ?? 0) * 100;
      return share <= 2 ? `Your capacity is a small share of this market (${formatPercent(share)} by weight).` : `Your capacity would be ${formatPercent(share)} of this market's imports by weight.`;
    }
  }
}

/**
 * Up to three sentences: the two metrics adding most points and the one costing most. A market
 * that is not ranked leads with why.
 */
export function marketReasons(market: ScoredMarket, facts: MarketFacts, policy: DemandDiscoveryV5Policy): MarketReason[] {
  if (market.status === 'excluded') return [{ metric: null, effect: 'status', text: `Excluded: ${market.excluded_reason}.` }];
  if (market.status === 'no_recorded_demand') {
    const span = facts.window.length ? `${facts.window[0]}–${facts.window[facts.window.length - 1]}` : 'the period checked';
    return [{ metric: null, effect: 'status', text: `No imports of this product were recorded in ${span}.` }];
  }
  const live = market.metrics.filter((result) => result.score != null);
  if (!live.length) return [{ metric: null, effect: 'status', text: 'Not ranked: none of the measures has data for this market.' }];
  const reasons: MarketReason[] = [];
  let adds = 2;
  if (market.status === 'not_enough_data' && market.shortfall) {
    const missing = market.shortfall.missing_required.map((key) => METRIC_NAMES[key]);
    reasons.push({
      metric: null, effect: 'status',
      text: missing.length
        ? `Not ranked: ${missing.join(' and ')} ${missing.length > 1 ? 'have' : 'has'} no data.`
        : `Not ranked: only ${market.live_points} of 100 points have data; ranking needs ${market.shortfall.minimum_live_points}.`,
    });
    adds = 1;
  }
  const contribution = (result: MetricResult) => (result.score! * policy.points[result.key]) / market.live_points;
  const cost = (result: MetricResult) => ((100 - result.score!) * policy.points[result.key]) / market.live_points;
  const byKey = (a: MetricResult, b: MetricResult) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const adding = [...live].sort((a, b) => contribution(b) - contribution(a) || byKey(a, b)).slice(0, adds);
  for (const result of adding) reasons.push({ metric: result.key, effect: 'adds', text: metricSentence(result, 'adds') });
  const costing = [...live].filter((result) => !adding.includes(result) && cost(result) > 0).sort((a, b) => cost(b) - cost(a) || byKey(a, b))[0];
  if (costing) reasons.push({ metric: costing.key, effect: 'costs', text: metricSentence(costing, 'costs') });
  return reasons;
}
