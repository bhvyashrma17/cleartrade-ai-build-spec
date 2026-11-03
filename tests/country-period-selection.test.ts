/**
 * Phase 1G period selection.
 *
 * Every branch here encodes a distinction that, if collapsed, would silently fabricate demand
 * or hide a real market: measured-zero vs no-row, withheld vs absent, our-outage vs their-absence,
 * and not-yet-asked vs asked-and-empty.
 */
import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS, type CountryPeriodSelectionPolicy } from '../src/lib/config';
import { analysisWindowFor, freshnessForLag, selectCountryPeriod, selectPreferredPeriod, validateCountryPeriodSelectionPolicy, type PeriodProbeOutcome } from '../src/lib/country-period-selection';

const POLICY = CONFIG_DEFAULTS['country_period_selection.policy'];
const walk = (probes: Record<number, PeriodProbeOutcome>, policy: CountryPeriodSelectionPolicy = POLICY) => selectCountryPeriod({ preferred_period: 2025, probes, policy });

describe('the preferred period follows the provider release lag', () => {
  test('waits for the release month before advancing a year', () => {
    expect(selectPreferredPeriod(new Date('2026-08-27T00:00:00Z'), POLICY)).toBe(2025);
    expect(selectPreferredPeriod(new Date('2026-07-31T23:59:59Z'), POLICY)).toBe(2024);
    expect(selectPreferredPeriod(new Date('2026-08-01T00:00:00Z'), POLICY)).toBe(2025);
    expect(() => selectPreferredPeriod(new Date('nonsense'), POLICY)).toThrow(/valid as-of date/);
  });
});

describe('the walk stops at the first year that answers the question', () => {
  test('uses the preferred period when it is usable', () => {
    expect(walk({ 2025: 'observed' })).toMatchObject({ selected_period: 2025, period_lag: 0, freshness_state: 'current', evidence_confidence: 1, decision: 'selected', reason: 'observed_at_preferred_period' });
  });

  test('falls back one year when the preferred period has no row', () => {
    expect(walk({ 2025: 'absent', 2024: 'observed' })).toMatchObject({ selected_period: 2024, period_lag: 1, freshness_state: 'recent', evidence_confidence: 0.8, decision: 'selected', reason: 'observed_after_1_year_fallback' });
  });

  test('falls back two years — the UAE shape', () => {
    const selection = walk({ 2025: 'absent', 2024: 'absent', 2023: 'observed' });
    expect(selection).toMatchObject({ selected_period: 2023, period_lag: 2, freshness_state: 'aged', evidence_confidence: 0.64, decision: 'selected' });
    expect(selection.considered).toEqual([
      { period: 2025, lag: 0, outcome: 'absent' },
      { period: 2024, lag: 1, outcome: 'absent' },
      { period: 2023, lag: 2, outcome: 'observed' },
    ]);
  });

  test('goes stale rather than reaching past the configured lookback', () => {
    const selection = walk({ 2025: 'absent', 2024: 'absent', 2023: 'absent', 2022: 'observed' });
    expect(selection).toMatchObject({ selected_period: null, period_lag: null, evidence_confidence: null, freshness_state: 'stale', decision: 'exhausted', reason: 'no_usable_evidence_within_2_year_lookback' });
    // 2022 was never even inspected; the walk is bounded, not exhaustive.
    expect(selection.considered.map(row => row.period)).toEqual([2025, 2024, 2023]);
  });
});

describe('an observed zero is an answer, not an absence', () => {
  test('a measured zero terminates the walk at the preferred period', () => {
    const selection = walk({ 2025: 'observed_zero', 2024: 'observed', 2023: 'observed' });
    // Searching past a real zero would manufacture demand that the provider says is not there.
    expect(selection).toMatchObject({ selected_period: 2025, period_lag: 0, decision: 'selected', reason: 'observed_zero_at_preferred_period' });
  });

  test('a measured zero terminates the walk mid-fallback too', () => {
    expect(walk({ 2025: 'absent', 2024: 'observed_zero', 2023: 'observed' })).toMatchObject({ selected_period: 2024, period_lag: 1, decision: 'selected', reason: 'observed_zero_after_1_year_fallback' });
  });

  test('a policy that would search past a measured zero is refused', () => {
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, observed_zero_terminates_selection: false })).toThrow(/must terminate period selection/);
  });
});

describe('suppression, failure and incompatibility are each distinct from absence', () => {
  test('suppressed evidence stops the walk and is reported as suppressed', () => {
    const selection = walk({ 2025: 'suppressed', 2024: 'observed' });
    expect(selection).toMatchObject({ selected_period: null, decision: 'blocked_suppressed', reason: 'provider_suppressed_2025' });
    // The older year exists and is usable — we still refuse, and we never expose the withheld cell.
    expect(selection.evidence_confidence).toBeNull();
  });

  test('a provider failure never becomes a fallback', () => {
    expect(walk({ 2025: 'failed', 2024: 'observed' })).toMatchObject({ selected_period: null, decision: 'blocked_provider_failure', reason: 'provider_failure_at_2025' });
  });

  test('an HS-revision incompatibility does permit an older year', () => {
    expect(walk({ 2025: 'incompatible', 2024: 'observed' })).toMatchObject({ selected_period: 2024, period_lag: 1, decision: 'selected' });
    expect(walk({ 2025: 'incompatible', 2024: 'observed' }, { ...POLICY, incompatible_permits_fallback: false })).toMatchObject({ decision: 'blocked_incompatible' });
  });

  test('policy can permit walking past suppression, and says so explicitly', () => {
    expect(walk({ 2025: 'suppressed', 2024: 'observed' }, { ...POLICY, suppressed_permits_fallback: true })).toMatchObject({ selected_period: 2024, decision: 'selected' });
  });
});

describe('an unprobed year pauses the walk instead of assuming absence', () => {
  test('names the next year acquisition must ask about', () => {
    expect(walk({})).toMatchObject({ decision: 'needs_probe', next_probe_period: 2025, selected_period: null, freshness_state: 'unknown', reason: 'awaiting_evidence_for_2025' });
    expect(walk({ 2025: 'absent' })).toMatchObject({ decision: 'needs_probe', next_probe_period: 2024 });
    expect(walk({ 2025: 'absent', 2024: 'absent' })).toMatchObject({ decision: 'needs_probe', next_probe_period: 2023 });
  });

  test('a resolved market never asks for another year — this is what bounds fallback cost', () => {
    for (const probes of [{ 2025: 'observed' }, { 2025: 'observed_zero' }, { 2025: 'suppressed' }] as Array<Record<number, PeriodProbeOutcome>>) {
      expect(walk(probes).next_probe_period, JSON.stringify(probes)).toBeNull();
    }
  });

  test('a failure names the year that failed, so the retry targets it and not the preferred one', () => {
    // Nulling this lost the walk's position: acquisition silently fell back to the preferred
    // period, re-buying a year already known absent while the real blocker was never retried.
    expect(walk({ 2025: 'failed' })).toMatchObject({ decision: 'blocked_provider_failure', next_probe_period: 2025 });
    expect(walk({ 2025: 'absent', 2024: 'failed' })).toMatchObject({ decision: 'blocked_provider_failure', next_probe_period: 2024 });
  });
});

describe('freshness weighting is derived, bounded and deterministic', () => {
  test('decays at the repository recency rate and stops at the lookback', () => {
    expect(freshnessForLag(0, POLICY)).toEqual({ state: 'current', evidence_confidence: 1 });
    expect(freshnessForLag(1, POLICY)).toEqual({ state: 'recent', evidence_confidence: 0.8 });
    expect(freshnessForLag(2, POLICY)).toEqual({ state: 'aged', evidence_confidence: 0.64 });
    expect(freshnessForLag(3, POLICY)).toEqual({ state: 'stale', evidence_confidence: 0 });
    expect(POLICY.recency_decay_per_year).toBe(CONFIG_DEFAULTS['discovery.scoring'].recency_decay_per_year);
    expect(POLICY.max_fallback_lookback_years).toBe(CONFIG_DEFAULTS['discovery.scoring'].confidence.accepted_reporting_lag_years);
  });

  test('is a pure function of the probes — same input, same answer', () => {
    const probes = { 2025: 'absent', 2024: 'observed' } as Record<number, PeriodProbeOutcome>;
    expect(walk(probes)).toEqual(walk(probes));
  });

  test('refuses a policy whose knobs are incoherent', () => {
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, selection_rule: 'vibes' as CountryPeriodSelectionPolicy['selection_rule'] })).toThrow(/Unsupported period selection rule/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, max_fallback_lookback_years: -1 })).toThrow(/non-negative integer/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, recency_decay_per_year: 0 })).toThrow(/within \(0, 1\]/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, recency_decay_per_year: 1.5 })).toThrow(/within \(0, 1\]/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, annual_release_month_utc: 13 })).toThrow(/UTC month/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, freshness_states_by_lag: ['current'] })).toThrow(/freshness state for every permitted lag/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...POLICY, usable_cell_statuses: ['observed_zero'] })).toThrow(/observed values to be usable/);
  });
});

describe('deep analysis windows are derived from the reporter’s own selected year', () => {
  test('a lagging reporter gets an older but equally long consecutive window', () => {
    expect(analysisWindowFor(2025, 5)).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(analysisWindowFor(2023, 5)).toEqual([2019, 2020, 2021, 2022, 2023]);
    expect(analysisWindowFor(2024, 5)).toEqual([2020, 2021, 2022, 2023, 2024]);
    // Consecutive by construction — the metrics layer depends on this and never checks it itself.
    const window = analysisWindowFor(2023, 5);
    expect(window.every((year, index) => index === 0 || year - window[index - 1]! === 1)).toBe(true);
  });

  test('refuses a nonsensical window request', () => {
    expect(() => analysisWindowFor(2023.5, 5)).toThrow(/integer selected period/);
    expect(() => analysisWindowFor(2023, 0)).toThrow(/positive history length/);
  });
});
