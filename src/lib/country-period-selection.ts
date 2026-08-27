/**
 * Latest-usable-period selection — Phase 1G.
 *
 * ClearTrade used to ask "does this country have the globally newest year's data?", which
 * systematically favoured reporters that file early. A 2025-only global screen excluded the
 * UAE, Iraq, Iran, Oman, Qatar and Yemen — several of the largest markets for the product being
 * screened — not because they lack demand but because they had not filed yet. This module asks
 * the better question instead: what is the latest sufficiently recent, authoritative, usable
 * annual evidence this country actually has?
 *
 * It is a provider-backed walk backwards, never a fabrication. Nothing here interpolates,
 * forward-fills, or invents a value; it only chooses WHICH real observation to use, and records
 * how old that choice is so downstream consumers can weigh it honestly.
 *
 * Four semantics are load-bearing and each is a separate branch:
 *
 *   - An **observed zero terminates the walk.** A country that genuinely imported nothing has
 *     been measured, and searching backwards until a non-zero year appears would manufacture
 *     demand that does not exist.
 *   - **Suppression is not absence.** The provider is telling us a value exists and is withheld.
 *     Walking back would leak information about the suppressed cell by proxy, so by default it
 *     stops the walk and is reported as suppressed.
 *   - **A provider failure is not absence.** An HTTP or network failure means we never got an
 *     answer. Falling back would treat our own outage as a statement about the country, so it
 *     stops the walk and stays retryable.
 *   - **An unprobed year is not an absent year.** The walk pauses and names the next year to
 *     probe, which is what lets acquisition happen in incremental waves rather than fetching
 *     every fallback year for every market up front.
 *
 * Pure: no database, no network, no clock beyond the as-of date handed in.
 */

import type { CountryPeriodSelectionPolicy } from '@/lib/config';

/** What the provider told us about one country at one annual period. */
export type PeriodProbeOutcome =
  | 'observed'
  | 'observed_zero'
  | 'absent'
  | 'suppressed'
  | 'incompatible'
  | 'failed'
  | 'not_probed';

export type PeriodFreshnessState = 'current' | 'recent' | 'aged' | 'stale' | 'unknown';

export type PeriodSelectionDecision =
  | 'selected'
  | 'needs_probe'
  | 'exhausted'
  | 'blocked_suppressed'
  | 'blocked_provider_failure'
  | 'blocked_incompatible';

export interface CountryPeriodSelection {
  preferred_period: number;
  /** The year whose observation should be used, once one has been found. */
  selected_period: number | null;
  /** Years between the preferred period and the selected one. 0 means current. */
  period_lag: number | null;
  freshness_state: PeriodFreshnessState;
  /** Multiplicative evidence weight for the lag. Never applied to a raw trade value. */
  evidence_confidence: number | null;
  decision: PeriodSelectionDecision;
  /** The next year acquisition should ask about, when the walk is waiting on evidence. */
  next_probe_period: number | null;
  reason: string;
  /** Every year inspected and what it said — the audit trail for the decision. */
  considered: Array<{ period: number; lag: number; outcome: PeriodProbeOutcome }>;
}

/** The annual period a screen prefers, given the provider's release lag. */
export function selectPreferredPeriod(asOf: Date, policy: CountryPeriodSelectionPolicy): number {
  if (Number.isNaN(asOf.getTime())) throw new Error('Preferred period selection requires a valid as-of date.');
  const releaseReached = asOf.getUTCMonth() + 1 >= policy.annual_release_month_utc;
  return asOf.getUTCFullYear() - (releaseReached ? 1 : 2);
}

/** Round to four places so a confidence weight is reproducible across processes. */
const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * Evidence weight for a lag, derived from `discovery.scoring.recency_decay_per_year` rather
 * than invented: the repository already expresses "a year older is worth less" as 0.8/year.
 */
export function freshnessForLag(lag: number, policy: CountryPeriodSelectionPolicy): { state: PeriodFreshnessState; evidence_confidence: number } {
  if (lag < 0 || lag > policy.max_fallback_lookback_years) return { state: policy.beyond_lookback_state as PeriodFreshnessState, evidence_confidence: 0 };
  const state = (policy.freshness_states_by_lag[lag] ?? policy.beyond_lookback_state) as PeriodFreshnessState;
  return { state, evidence_confidence: round4(policy.recency_decay_per_year ** lag) };
}

export function validateCountryPeriodSelectionPolicy(policy: CountryPeriodSelectionPolicy) {
  if (policy.selection_rule !== 'first_usable_walking_back_v1') throw new Error(`Unsupported period selection rule ${policy.selection_rule}.`);
  if (!Number.isInteger(policy.max_fallback_lookback_years) || policy.max_fallback_lookback_years < 0) throw new Error('Period fallback lookback must be a non-negative integer.');
  if (!Number.isInteger(policy.annual_release_month_utc) || policy.annual_release_month_utc < 1 || policy.annual_release_month_utc > 12) throw new Error('Annual release month must be a UTC month number.');
  if (!(policy.recency_decay_per_year > 0) || policy.recency_decay_per_year > 1) throw new Error('Recency decay per year must be within (0, 1].');
  if (policy.freshness_states_by_lag.length < policy.max_fallback_lookback_years + 1) throw new Error('Period selection policy needs a freshness state for every permitted lag.');
  if (!policy.usable_cell_statuses.includes('observed')) throw new Error('Period selection requires observed values to be usable.');
  if (!policy.observed_zero_terminates_selection) throw new Error('An observed zero must terminate period selection; searching past it would manufacture demand.');
  // `observed_zero_terminates_selection` is only meaningful if a measured zero is actually
  // USABLE: the walk terminates by selecting it. Dropping it from `usable_cell_statuses` would
  // reclassify a measured zero as absence and let the walk find an older non-zero year, turning
  // a real zero into demand. The two settings must agree.
  if (policy.observed_zero_terminates_selection && !policy.usable_cell_statuses.includes('observed_zero')) throw new Error('An observed zero must be a usable cell status, or terminating on it cannot work.');
  // Our own outage is never evidence about a country, so this one is not configurable.
  if (policy.provider_failure_permits_fallback) throw new Error('A provider failure must never permit fallback; it is our outage, not the country\'s absence.');
  return policy;
}

/**
 * Walk back from the preferred period to the first usable observation.
 *
 * The walk stops at the first year that answers the question — including a year that answers
 * "zero" — and pauses at the first year nobody has asked about yet.
 */
export function selectCountryPeriod(input: {
  preferred_period: number;
  /** Outcome per annual period. Absent keys mean nobody has probed that year. */
  probes: Readonly<Record<number, PeriodProbeOutcome>>;
  policy: CountryPeriodSelectionPolicy;
}): CountryPeriodSelection {
  const { policy, preferred_period: preferred } = input;
  validateCountryPeriodSelectionPolicy(policy);
  const considered: CountryPeriodSelection['considered'] = [];
  const base = { preferred_period: preferred, selected_period: null, period_lag: null, evidence_confidence: null, next_probe_period: null, considered } as const;

  for (let lag = 0; lag <= policy.max_fallback_lookback_years; lag++) {
    const period = preferred - lag;
    const outcome = input.probes[period] ?? 'not_probed';
    considered.push({ period, lag, outcome });

    if (outcome === 'not_probed') return { ...base, freshness_state: 'unknown', decision: 'needs_probe', next_probe_period: period, reason: `awaiting_evidence_for_${period}` };
    if (outcome === 'observed' || outcome === 'observed_zero') {
      const freshness = freshnessForLag(lag, policy);
      return { ...base, selected_period: period, period_lag: lag, freshness_state: freshness.state, evidence_confidence: freshness.evidence_confidence, decision: 'selected', reason: lag === 0 ? `${outcome}_at_preferred_period` : `${outcome}_after_${lag}_year_fallback` };
    }
    // A blocking outcome keeps the blocking YEAR as the next thing to ask about. Nulling it
    // would lose the walk's position, and acquisition would silently fall back to the preferred
    // period — re-buying a year already known absent while the real blocker is never retried.
    if (outcome === 'suppressed' && !policy.suppressed_permits_fallback) return { ...base, freshness_state: 'unknown', decision: 'blocked_suppressed', next_probe_period: null, reason: `provider_suppressed_${period}` };
    if (outcome === 'failed' && !policy.provider_failure_permits_fallback) return { ...base, freshness_state: 'unknown', decision: 'blocked_provider_failure', next_probe_period: period, reason: `provider_failure_at_${period}` };
    if (outcome === 'incompatible' && !policy.incompatible_permits_fallback) return { ...base, freshness_state: 'unknown', decision: 'blocked_incompatible', next_probe_period: null, reason: `incompatible_evidence_at_${period}` };
    // `absent`, and any blocked outcome the policy permits walking past, continue the walk.
  }

  return { ...base, freshness_state: policy.beyond_lookback_state as PeriodFreshnessState, decision: 'exhausted', reason: `no_usable_evidence_within_${policy.max_fallback_lookback_years}_year_lookback` };
}

/**
 * The consecutive analysis window a reporter's deep history should cover, ending at its own
 * selected year. Derived, never hardcoded: Germany selected 2025 gets 2021-2025, a reporter
 * selected on 2023 gets 2019-2023.
 */
export function analysisWindowFor(selectedPeriod: number, historyYears: number): number[] {
  if (!Number.isInteger(selectedPeriod)) throw new Error('An analysis window requires an integer selected period.');
  if (!Number.isInteger(historyYears) || historyYears < 1) throw new Error('An analysis window requires a positive history length.');
  return Array.from({ length: historyYears }, (_, offset) => selectedPeriod - historyYears + 1 + offset);
}
