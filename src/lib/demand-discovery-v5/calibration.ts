/**
 * The calibration check of docs/36 §8: does a run's top 10 reflect where India already sells the
 * product? A top 10 that ignores most of India's own largest destinations is a calibration
 * failure, not a pass. Pure: India's export flows and the run's stored markets in, a comparison out.
 *
 * India's destinations are summed over the same recent years the market-size metric averages, and
 * only screening markets count (a provider aggregate such as `cepii_baci:490` is not a market).
 */
import type { TradeFlowInput } from './series';

/**
 * A reason the calibration accepts a market India sells to outside the top (owner, 31 Oct 2026, E-045).
 * No or restricted ECGC cover caps the payment-risk measure, so such markets rank lower by design. A
 * sanctions flag never changes a score (docs/36 §5.2): a flagged market is accepted outside the top because it is
 * not one to steer a first-time exporter to, not because the score ranked it lower. The policy lists
 * which reasons it accepts (`explained_misses`); the results page shows them as notes, never as causes.
 */
export type MissExplanation = 'ecgc_off_cover' | 'ecgc_restricted' | 'sanctions';
export const MISS_EXPLANATION_TEXT: Readonly<Record<MissExplanation, string>> = {
  ecgc_off_cover: 'ECGC offers no cover', ecgc_restricted: 'ECGC cover is restricted', sanctions: 'a sanctions programme is flagged',
};
const SANCTIONS_FLAG = /^(UN|US|EU|UK): /;

/** From a market's measures and flags, stored or in memory: its ECGC cover, then any sanctions flag. */
export function riskExplanation(args: { metrics?: readonly { key: string; inputs?: Record<string, unknown> | null }[] | null; flag_reasons?: readonly string[] | null }): MissExplanation | null {
  const cover = args.metrics?.find((metric) => metric.key === 'country_risk')?.inputs?.cover;
  if (cover === 'off_cover') return 'ecgc_off_cover';
  if (cover === 'restricted_group_i' || cover === 'restricted_group_ii') return 'ecgc_restricted';
  return args.flag_reasons?.some((flag) => SANCTIONS_FLAG.test(flag)) ? 'sanctions' : null;
}

export interface CalibrationMarket {
  market: string;
  status: string;
  rank: number | null;
  overall: number | null;
  reasons: string[];
  /** E-045: why the market may rightly rank low, when it may. */
  explained_by?: MissExplanation | null;
}

export interface CalibrationResult {
  hs6: string;
  years: number[];
  top: number;
  india_total_usd: number;
  india_top: { market: string; usd: number; share_percent: number; status: string | null; rank: number | null }[];
  run_top: { market: string; rank: number; overall: number | null; india_usd: number; india_rank: number | null }[];
  /** How many of India's top destinations are in the run's top. */
  overlap: number;
  /** India's top destinations the run's top leaves out, with what the run said about each. */
  missed: { market: string; usd: number; status: string | null; rank: number | null; reasons: string[]; explained_by: MissExplanation | null }[];
  /** E-045: misses explained by restricted or no ECGC cover, or sanctions; they count towards the pass. */
  explained: number;
  verdict: 'pass' | 'calibration_failure' | 'no_india_exports';
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

export function compareWithIndiaExports(args: { hs6: string; flows: readonly TradeFlowInput[]; years: readonly number[]; markets: readonly CalibrationMarket[]; top?: number }): CalibrationResult {
  const top = args.top ?? 10;
  const years = new Set(args.years);
  const byMarket = new Map(args.markets.map((market) => [market.market, market]));
  const exports = new Map<string, number>();
  for (const flow of args.flows) {
    if (flow.exporter !== 'IN' || !years.has(flow.year) || !byMarket.has(flow.importer)) continue;
    exports.set(flow.importer, (exports.get(flow.importer) ?? 0) + flow.value_usd);
  }
  const total = [...exports.values()].reduce((sum, value) => sum + value, 0);
  const ordered = [...exports.entries()].sort(([a, va], [b, vb]) => vb - va || a.localeCompare(b));
  const indiaRank = new Map(ordered.map(([market], index) => [market, index + 1]));
  const indiaTop = ordered.slice(0, top).map(([market, usd]) => ({
    market, usd: round(usd, 0), share_percent: total > 0 ? round((usd / total) * 100) : 0, status: byMarket.get(market)?.status ?? null, rank: byMarket.get(market)?.rank ?? null,
  }));
  const runTop = args.markets
    .filter((market): market is CalibrationMarket & { rank: number } => market.rank != null && market.rank <= top)
    .sort((a, b) => a.rank - b.rank)
    .map((market) => ({ market: market.market, rank: market.rank, overall: market.overall, india_usd: round(exports.get(market.market) ?? 0, 0), india_rank: indiaRank.get(market.market) ?? null }));
  const runTopSet = new Set(runTop.map((market) => market.market));
  const overlap = indiaTop.filter((item) => runTopSet.has(item.market)).length;
  const missed = indiaTop.filter((item) => !runTopSet.has(item.market)).map((item) => ({ market: item.market, usd: item.usd, status: item.status, rank: item.rank, reasons: byMarket.get(item.market)?.reasons ?? [], explained_by: byMarket.get(item.market)?.explained_by ?? null }));
  const explained = missed.filter((item) => item.explained_by != null).length;
  return {
    hs6: args.hs6,
    years: [...years].sort((a, b) => a - b),
    top,
    india_total_usd: round(total, 0),
    india_top: indiaTop,
    run_top: runTop,
    overlap,
    missed,
    explained,
    // "Ignores most of them": fewer than half of India's top destinations in the run's top, counting
    // a miss the run explains by restricted or no ECGC cover, or sanctions (E-045).
    verdict: !indiaTop.length ? 'no_india_exports' : (overlap + explained) * 2 >= indiaTop.length ? 'pass' : 'calibration_failure',
  };
}

/**
 * What every run stores about itself (owner-approved idea 2, E-042): the same comparison as above, made
 * at the end of each real run from the BACI flows it already read, so calibration grows with every
 * product users run instead of stopping at a test set. Kept small: market codes, not the figures.
 */
export interface RunCalibrationSummary {
  top: number;
  years: number[];
  overlap: number;
  /** E-045: misses explained by restricted or no ECGC cover, or sanctions. */
  explained: number;
  verdict: CalibrationResult['verdict'];
  india_top: string[];
  missed: { market: string; status: string | null; rank: number | null; explained_by?: MissExplanation | null }[];
}

export function summarizeRunCalibration(result: CalibrationResult): RunCalibrationSummary {
  return {
    top: result.top, years: result.years, overlap: result.overlap, explained: result.explained, verdict: result.verdict,
    india_top: result.india_top.map((entry) => entry.market),
    missed: result.missed.map((entry) => ({ market: entry.market, status: entry.status, rank: entry.rank, explained_by: entry.explained_by })),
  };
}

/** A stored run summary's calibration, read defensively; null for runs from before E-042. */
export function readRunCalibration(summary: unknown): RunCalibrationSummary | null {
  const value = (summary as { calibration?: unknown } | null)?.calibration as Partial<RunCalibrationSummary> | undefined;
  if (!value || typeof value.overlap !== 'number' || typeof value.top !== 'number' || typeof value.verdict !== 'string') return null;
  return {
    top: value.top, years: Array.isArray(value.years) ? value.years : [], overlap: value.overlap, explained: typeof value.explained === 'number' ? value.explained : 0, verdict: value.verdict as RunCalibrationSummary['verdict'],
    india_top: Array.isArray(value.india_top) ? value.india_top : [], missed: Array.isArray(value.missed) ? value.missed : [],
  };
}

export interface CalibrationAggregate {
  compared: number;
  pass: number;
  calibration_failure: number;
  no_india_exports: number;
  /** Over the runs whose product India exports; null when there are none. */
  median_overlap: number | null;
}

export function aggregateRunCalibration(items: readonly RunCalibrationSummary[]): CalibrationAggregate {
  const overlaps = items.filter((item) => item.verdict !== 'no_india_exports').map((item) => item.overlap).sort((a, b) => a - b);
  const middle = Math.floor(overlaps.length / 2);
  return {
    compared: items.length,
    pass: items.filter((item) => item.verdict === 'pass').length,
    calibration_failure: items.filter((item) => item.verdict === 'calibration_failure').length,
    no_india_exports: items.filter((item) => item.verdict === 'no_india_exports').length,
    median_overlap: !overlaps.length ? null : overlaps.length % 2 ? overlaps[middle]! : (overlaps[middle - 1]! + overlaps[middle]!) / 2,
  };
}
