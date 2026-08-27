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
export const COUNTRY_SCREENING_ALGORITHM_VERSION = 'country-screening-rank-v2';

export interface ScreeningRankCandidate {
  reporter_code: string;
  /** Observed World import value in USD, exactly as the provider reported it. */
  import_value: number;
  /**
   * Evidence weight for how old the selected observation is (1.0 current, 0.8 one year back,
   * 0.64 two years back). Never applied to `import_value` — see `selection_score`.
   */
  evidence_confidence: number;
  /** Years between the run's preferred period and the one this value came from. */
  period_lag: number;
}

export interface ScreeningRankResult extends ScreeningRankCandidate {
  /** Raw demand magnitude. A pure function of the observed value; comparable across runs. */
  screening_score: number;
  /** What ordering actually uses: demand discounted by how old the evidence is. */
  selection_score: number;
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
 * Rank eligible candidates, most demand first, without pretending stale and current evidence
 * are equally good.
 *
 * Once some markets are selected on 2025 data and others on 2023 data, comparing raw values
 * alone would let a lagging market outrank a current one purely because of growth or inflation
 * between the two years. So two numbers are kept and both are persisted:
 *
 *   - `screening_score` is the raw demand magnitude and stays a pure function of the observed
 *     value. It is the number to compare across runs, and it is never discounted.
 *   - `selection_score` is that score weighted by evidence confidence, and it is the only thing
 *     ordering and shortlist selection use.
 *
 * The provider's value itself is never altered. A market on two-year-old evidence still reports
 * exactly what the provider said it imported in that year.
 *
 * Tie-breaking is total and never depends on input order: equal selection scores fall back to
 * raw score, then the exact observed value, then the fresher evidence, then the numeric reporter
 * code, which is unique within a universe.
 */
export function rankScreeningCandidates(candidates: readonly ScreeningRankCandidate[], policy: CountryScreeningPolicy): ScreeningRankResult[] {
  if (policy.tie_breaker !== 'selection_score_desc_then_screening_score_desc_then_import_value_desc_then_period_lag_asc_then_reporter_code_asc_v2') throw new Error(`Unsupported screening tie breaker ${policy.tie_breaker}.`);
  if (policy.screening_algorithm_version !== COUNTRY_SCREENING_ALGORITHM_VERSION) throw new Error(`Unsupported screening algorithm version ${policy.screening_algorithm_version}.`);
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.reporter_code)) throw new Error(`Duplicate screening candidate reporter ${candidate.reporter_code}.`);
    if (!(candidate.evidence_confidence > 0) || candidate.evidence_confidence > 1) throw new Error(`Screening candidate ${candidate.reporter_code} has an out-of-range evidence confidence.`);
    if (!Number.isInteger(candidate.period_lag) || candidate.period_lag < 0) throw new Error(`Screening candidate ${candidate.reporter_code} has an invalid period lag.`);
    seen.add(candidate.reporter_code);
  }
  return candidates
    .map(candidate => {
      const screening_score = screeningScore(candidate.import_value, policy);
      return { ...candidate, screening_score, selection_score: round6(screening_score * candidate.evidence_confidence) };
    })
    .sort((a, b) => b.selection_score - a.selection_score || b.screening_score - a.screening_score || b.import_value - a.import_value || a.period_lag - b.period_lag || Number(a.reporter_code) - Number(b.reporter_code))
    .map((candidate, index) => ({ ...candidate, screening_rank: index + 1 }));
}

/** How many of the ranked markets survive to deep analysis. Fewer eligible means a shorter list. */
export function shortlistSize(eligibleCount: number, policy: CountryScreeningPolicy): number {
  if (!Number.isInteger(policy.shortlist_target_size) || policy.shortlist_target_size <= 0) throw new Error('Screening shortlist target must be a positive integer.');
  if (!Number.isInteger(policy.max_shortlist_size) || policy.max_shortlist_size < policy.shortlist_target_size) throw new Error('Screening shortlist maximum must be an integer no smaller than the target.');
  return Math.min(eligibleCount, policy.shortlist_target_size, policy.max_shortlist_size);
}
