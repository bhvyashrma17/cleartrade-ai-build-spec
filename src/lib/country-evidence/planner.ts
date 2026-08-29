import { createHash } from 'node:crypto';
import type { CountryEvidencePolicy } from '@/lib/config';
import { COMTRADE_NORMALIZATION_VERSION } from '@/lib/comtrade/normalization';

export type EvidencePurpose = 'WORLD_IMPORT_HISTORY' | 'INDIA_IMPORT_HISTORY' | 'LATEST_SUPPLIER_DISTRIBUTION';
export type PlannedSourceMode = 'authenticated' | 'fixture' | 'mock' | 'preview';

export interface CountryEvidencePlanInput {
  product_classification_id: string;
  hs_code: string;
  hs_revision: string;
  as_of_date: Date;
  candidate_reporters: string[];
  source_mode: PlannedSourceMode;
  policy: CountryEvidencePolicy;
  policy_config_version: number;
  /** Optional provider-availability snapshot. Keys are annual periods, values are reporters with usable World facts. */
  available_reporters_by_year?: Record<number, string[]>;
  /**
   * Phase 1G: each reporter's own consecutive analysis window, ending at the latest year that
   * reporter actually has usable evidence for. Supplied by Stage A's period selection.
   *
   * When absent the plan keeps its original single-common-period behaviour, so historical plans
   * and the pilot path remain exactly readable. When present, a reporter that last reported in
   * 2023 is planned across 2019-2023 instead of being asked for years it never filed — which is
   * what stopped lagging markets from ever becoming rankable.
   */
  reporter_period_windows?: Record<string, number[]>;
  /**
   * The period the screen PREFERRED. Lag is measured against this, so a reporter's freshness is
   * a property of the reporter — not of whichever other market happened to file most recently.
   */
  preferred_period?: number;
}

export interface PlannedEvidenceItem {
  item_key: string;
  purpose: EvidencePurpose;
  reporter_code: string;
  partner_scope: 'world' | 'india' | 'all_suppliers';
  partner_code: string;
  period: number;
  priority: number;
  freshness_days: number;
  estimated_call_cost: 1;
}

export interface FrozenCountryEvidencePlan {
  plan_key: string;
  policy_hash: string;
  /** The newest year any reporter in this plan is analysed through. */
  latest_common_year: number;
  /** Union of every reporter's window, so the plan still describes its whole period footprint. */
  period_set: number[];
  actual_history_years: number;
  candidate_reporters: string[];
  /** Per-reporter consecutive windows. Always populated, even in single-period mode. */
  reporter_period_windows: Record<string, number[]>;
  items: PlannedEvidenceItem[];
  frozen_definition: Record<string, unknown>;
}

function canonical(value: unknown, path = '$'): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Cannot hash a non-finite number at ${path}.`);
    // JSON.stringify collapses -0 to 0. Make that normalization explicit so callers do not
    // mistake a runtime quirk for an identity distinction.
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error(`Cannot hash an invalid Date at ${path}.`);
    return { $date: value.toISOString() };
  }
  if (Array.isArray(value)) return value.map((entry, index) => canonical(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    // Prisma Decimal and similar value objects expose a stable JSON scalar. Calling toJSON is
    // necessary because enumerating a Date/Decimal as a plain object used to turn both into `{}`
    // and created real cache-key collisions.
    const prototype = Object.getPrototypeOf(value);
    const serializable = value as { toJSON?: () => unknown };
    if (prototype !== Object.prototype && prototype !== null && typeof serializable.toJSON === 'function') {
      return canonical(serializable.toJSON(), `${path}.toJSON()`);
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => {
          if (entry === undefined) throw new Error(`Cannot hash undefined at ${path}.${key}; use an explicit null or omit the key.`);
          return [key, canonical(entry, `${path}.${key}`)];
        }),
    );
  }
  throw new Error(`Cannot hash ${typeof value} at ${path}.`);
}

export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function validate(input: CountryEvidencePlanInput) {
  if (!/^[0-9]{6}$/.test(input.hs_code)) throw new Error('Country Evidence planning requires a validated HS6 code.');
  if (!input.hs_revision.trim() || input.hs_revision === 'unknown') throw new Error('Country Evidence planning requires an explicit HS revision.');
  if (input.candidate_reporters.length === 0) throw new Error('At least one candidate reporter is required.');
  if (input.candidate_reporters.some(code => !/^[0-9]+$/.test(code))) throw new Error('Candidate reporters must use UN M49 numeric codes.');
  if (input.source_mode === 'preview') throw new Error('Preview evidence is not valid for a Country Evidence plan.');
  if (input.reporter_period_windows) {
    const candidates = new Set(input.candidate_reporters);
    for (const [reporter, periods] of Object.entries(input.reporter_period_windows)) {
      if (!candidates.has(reporter)) throw new Error(`Analysis window supplied for ${reporter}, which is not a candidate reporter.`);
      if (!periods.length) throw new Error(`Analysis window for ${reporter} is empty.`);
      // The metric layer computes CAGR, momentum, trend and volatility straight off this array
      // and does not itself verify continuity, so a gapped window would be silently labelled
      // "per year". Refuse it here, where the window is still a decision rather than a result.
      if (periods.some((year, index) => index > 0 && year - periods[index - 1]! !== 1)) throw new Error(`Analysis window for ${reporter} is not consecutive.`);
    }
    const missing = input.candidate_reporters.filter(reporter => !input.reporter_period_windows![reporter]);
    if (missing.length) throw new Error(`Analysis windows are missing for ${missing.join(', ')}.`);
  }
}

/**
 * Latest-period policy: annual data becomes eligible only in the configured UTC month.
 * If an availability snapshot is supplied, walk backwards until the configured share of
 * candidates has facts. This decision is frozen in the plan; it never follows wall clock later.
 */
export function selectCommonAnnualPeriod(input: CountryEvidencePlanInput): { latest: number; periods: number[] } {
  const { policy, as_of_date: asOf } = input;
  const releaseReached = asOf.getUTCMonth() + 1 >= policy.annual_release_month_utc;
  const maxEligible = asOf.getUTCFullYear() - (releaseReached ? 1 : 2);
  let latest = maxEligible;
  if (input.available_reporters_by_year) {
    const required = Math.ceil(input.candidate_reporters.length * policy.minimum_candidate_coverage_ratio);
    const candidates = new Set(input.candidate_reporters);
    let found: number | null = null;
    for (let year = maxEligible; year >= maxEligible - policy.history_years; year--) {
      const count = new Set(input.available_reporters_by_year[year] ?? []).size;
      const covered = [...new Set(input.available_reporters_by_year[year] ?? [])].filter(code => candidates.has(code)).length;
      if (count > 0 && covered >= required) { found = year; break; }
    }
    if (found == null) throw new Error('No common annual period meets the configured candidate coverage threshold.');
    latest = found;
  }
  const periods = Array.from({ length: policy.history_years }, (_, offset) => latest - policy.history_years + 1 + offset);
  return { latest, periods };
}

export function buildCountryEvidencePlan(input: CountryEvidencePlanInput): FrozenCountryEvidencePlan {
  validate(input);
  const reporters = [...new Set(input.candidate_reporters)].sort((a, b) => Number(a) - Number(b));
  const normalizedInput = { ...input, candidate_reporters: reporters };
  // With explicit per-reporter windows there is no common period to find, and the coverage walk
  // would throw for exactly the no-common-year case Phase 1G exists to serve.
  const { periods } = input.reporter_period_windows ? { periods: [] as number[] } : selectCommonAnnualPeriod(normalizedInput);
  // Each reporter's own window, defaulting to the common one when Stage A supplied none.
  const windows: Record<string, number[]> = Object.fromEntries(reporters.map(reporter => [reporter, [...(input.reporter_period_windows?.[reporter] ?? periods)].sort((a, b) => a - b)]));
  const unionPeriods = [...new Set(Object.values(windows).flat())].sort((a, b) => a - b);
  const newestYear = Math.max(...Object.values(windows).map(window => window.at(-1)!));
  const policyHash = canonicalHash(input.policy);
  const definition = {
    product_classification_id: input.product_classification_id,
    hs_code: input.hs_code,
    hs_revision: input.hs_revision,
    as_of_date: input.as_of_date.toISOString(),
    candidate_reporters: reporters,
    source_mode: input.source_mode,
    policy_version: input.policy.policy_version,
    policy_config_version: input.policy_config_version,
    policy_hash: policyHash,
    normalization_version: COMTRADE_NORMALIZATION_VERSION,
    period_set: unionPeriods,
    latest_common_year: newestYear,
    candidate_strategy: input.policy.candidate_strategy,
    ...(input.preferred_period == null ? {} : { preferred_period: input.preferred_period }),
    // Only present when Stage A actually varied the windows, so a single-period plan keeps its
    // original identity and historical plans stay reachable by their existing plan_key.
    ...(input.reporter_period_windows ? { reporter_period_windows: windows } : {}),
  };
  const items: PlannedEvidenceItem[] = [];
  for (const reporter of reporters) {
    const window = windows[reporter]!, reporterLatest = window.at(-1)!;
    // Item identity hashes the WHOLE plan definition, windows included. Narrowing it to this
    // reporter's own window made two different plans mint identical item keys whenever a
    // reporter's window happened to match — and `item_key` is globally unique, so the second
    // plan died on a constraint violation. Letting one reporter's fallback shift another's item
    // key costs nothing: evidence is reused by `request_fingerprint`, never by item key.
    const identityBase = definition;
    for (const period of [...window].reverse()) {
      // Freshness is about whether the PROVIDER may still revise the year, which depends on the
      // preferred period — not on where this reporter's own window happens to end. A closed year
      // cannot change, so billing it on the 90-day latest-period clock would re-buy the same
      // immutable fact forever, and would do it to exactly the lagging markets Phase 1G serves.
      const latestPeriod = period === (input.preferred_period ?? reporterLatest);
      const freshness = latestPeriod ? input.policy.latest_period_freshness_days : input.policy.closed_period_freshness_days;
      for (const spec of [
        { purpose: 'WORLD_IMPORT_HISTORY' as const, scope: 'world' as const, partner: input.policy.world_partner_code, priority: latestPeriod ? 10 : 20 },
        { purpose: 'INDIA_IMPORT_HISTORY' as const, scope: 'india' as const, partner: input.policy.india_partner_code, priority: latestPeriod ? 30 : 40 },
      ]) {
        const identity = { ...identityBase, purpose: spec.purpose, reporter, partner: spec.partner, period };
        items.push({ item_key: canonicalHash(identity), purpose: spec.purpose, reporter_code: reporter, partner_scope: spec.scope, partner_code: spec.partner, period, priority: spec.priority, freshness_days: freshness, estimated_call_cost: 1 });
      }
    }
    // The supplier distribution must belong to the SAME year as this reporter's own latest
    // World total, or HHI would divide one year's suppliers by another year's denominator.
    const identity = { ...identityBase, purpose: 'LATEST_SUPPLIER_DISTRIBUTION', reporter, partner: input.policy.all_suppliers_partner_code, period: reporterLatest };
    items.push({ item_key: canonicalHash(identity), purpose: 'LATEST_SUPPLIER_DISTRIBUTION', reporter_code: reporter, partner_scope: 'all_suppliers', partner_code: input.policy.all_suppliers_partner_code, period: reporterLatest, priority: 50, freshness_days: reporterLatest === (input.preferred_period ?? reporterLatest) ? input.policy.supplier_distribution_freshness_days : input.policy.closed_period_freshness_days, estimated_call_cost: 1 });
  }
  items.sort((a, b) => a.priority - b.priority || Number(a.reporter_code) - Number(b.reporter_code) || b.period - a.period || a.purpose.localeCompare(b.purpose));
  return { plan_key: canonicalHash(definition), policy_hash: policyHash, latest_common_year: newestYear, period_set: unionPeriods, actual_history_years: Math.max(...Object.values(windows).map(window => window.length)), candidate_reporters: reporters, reporter_period_windows: windows, items, frozen_definition: definition };
}
