/**
 * Stage A screening rank.
 *
 * This is a market-size transformation and nothing else. It answers "does this country import
 * enough of this HS6 to be worth spending deep Country Truth quota on?", and it is deliberately
 * NOT the Country Truth v4 attractiveness score: it sees no growth, no competition, no market
 * access, no export economics, no logistics and no risk, so presenting it as an overall ranking
 * would be a false claim. Those components arrive downstream, from the deep pipeline.
 *
 * The transformation is the same log10 band the v4 demand component uses (`absolute_log10_usd_v1`),
 * because the property wanted here is the same one: import value spans nine orders of magnitude,
 * so a linear scale would collapse every mid-size market into a rounding error against the largest.
 * Nothing is fitted, learned or model-derived — the score is a pure function of one persisted
 * observation and two policy constants, so every selected country is explainable from evidence.
 */

import type { CountryScreeningPolicy } from '@/lib/config';

/** Ranking identity. A change to the formula or the tie-break order requires a new version. */
export const COUNTRY_SCREENING_ALGORITHM_VERSION = 'country-screening-rank-v1';

export interface ScreeningRankCandidate {
  reporter_code: string;
  /** Observed World import value in USD. Only eligible candidates are ranked. */
  import_value: number;
}

export interface ScreeningRankResult extends ScreeningRankCandidate {
  screening_score: number;
  screening_rank: number;
}

/** Six decimal places: enough to separate real differences, few enough to be reproducible. */
function round6(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

export function screeningScore(importValue: number, policy: CountryScreeningPolicy): number {
  const { floor_usd: floor, ceiling_usd: ceiling, method } = policy.demand_signal;
  if (method !== 'world_import_value_log10_v1') throw new Error(`Unsupported screening demand method ${method}.`);
  if (!(floor > 0) || !(ceiling > floor)) throw new Error('Screening demand signal requires 0 < floor_usd < ceiling_usd.');
  if (!Number.isFinite(importValue)) throw new Error('Screening score requires a finite observed import value.');
  const clamped = Math.min(Math.max(importValue, floor), ceiling);
  return round6(Math.min(100, Math.max(0, ((Math.log10(clamped) - Math.log10(floor)) / (Math.log10(ceiling) - Math.log10(floor))) * 100)));
}

/**
 * Rank eligible candidates, most demand first.
 *
 * Tie-breaking is total and never depends on input order: equal scores fall back to the exact
 * observed value, and equal values fall back to the numeric reporter code, which is unique
 * within a universe. Two runs over the same evidence therefore produce byte-identical ranks.
 */
export function rankScreeningCandidates(candidates: readonly ScreeningRankCandidate[], policy: CountryScreeningPolicy): ScreeningRankResult[] {
  if (policy.tie_breaker !== 'screening_score_desc_then_import_value_desc_then_reporter_code_asc_v1') throw new Error(`Unsupported screening tie breaker ${policy.tie_breaker}.`);
  if (policy.screening_algorithm_version !== COUNTRY_SCREENING_ALGORITHM_VERSION) throw new Error(`Unsupported screening algorithm version ${policy.screening_algorithm_version}.`);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.reporter_code)) throw new Error(`Duplicate screening candidate reporter ${candidate.reporter_code}.`);
    seen.add(candidate.reporter_code);
  }
  return candidates
    .map(candidate => ({ ...candidate, screening_score: screeningScore(candidate.import_value, policy) }))
    .sort((a, b) => b.screening_score - a.screening_score || b.import_value - a.import_value || Number(a.reporter_code) - Number(b.reporter_code))
    .map((candidate, index) => ({ ...candidate, screening_rank: index + 1 }));
}

/** How many of the ranked markets survive to deep analysis. Fewer eligible means a shorter list. */
export function shortlistSize(eligibleCount: number, policy: CountryScreeningPolicy): number {
  if (!Number.isInteger(policy.shortlist_target_size) || policy.shortlist_target_size <= 0) throw new Error('Screening shortlist target must be a positive integer.');
  if (!Number.isInteger(policy.max_shortlist_size) || policy.max_shortlist_size < policy.shortlist_target_size) throw new Error('Screening shortlist maximum must be an integer no smaller than the target.');
  return Math.min(eligibleCount, policy.shortlist_target_size, policy.max_shortlist_size);
}
