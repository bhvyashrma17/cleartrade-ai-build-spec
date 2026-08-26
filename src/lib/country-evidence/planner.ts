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
  latest_common_year: number;
  period_set: number[];
  actual_history_years: number;
  candidate_reporters: string[];
  items: PlannedEvidenceItem[];
  frozen_definition: Record<string, unknown>;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
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
  const { latest, periods } = selectCommonAnnualPeriod(normalizedInput);
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
    period_set: periods,
    latest_common_year: latest,
    candidate_strategy: input.policy.candidate_strategy,
  };
  const items: PlannedEvidenceItem[] = [];
  for (const reporter of reporters) {
    for (const period of [...periods].reverse()) {
      const latestPeriod = period === latest;
      const freshness = latestPeriod ? input.policy.latest_period_freshness_days : input.policy.closed_period_freshness_days;
      for (const spec of [
        { purpose: 'WORLD_IMPORT_HISTORY' as const, scope: 'world' as const, partner: input.policy.world_partner_code, priority: latestPeriod ? 10 : 20 },
        { purpose: 'INDIA_IMPORT_HISTORY' as const, scope: 'india' as const, partner: input.policy.india_partner_code, priority: latestPeriod ? 30 : 40 },
      ]) {
        const identity = { ...definition, purpose: spec.purpose, reporter, partner: spec.partner, period };
        items.push({ item_key: canonicalHash(identity), purpose: spec.purpose, reporter_code: reporter, partner_scope: spec.scope, partner_code: spec.partner, period, priority: spec.priority, freshness_days: freshness, estimated_call_cost: 1 });
      }
    }
    const identity = { ...definition, purpose: 'LATEST_SUPPLIER_DISTRIBUTION', reporter, partner: input.policy.all_suppliers_partner_code, period: latest };
    items.push({ item_key: canonicalHash(identity), purpose: 'LATEST_SUPPLIER_DISTRIBUTION', reporter_code: reporter, partner_scope: 'all_suppliers', partner_code: input.policy.all_suppliers_partner_code, period: latest, priority: 50, freshness_days: input.policy.supplier_distribution_freshness_days, estimated_call_cost: 1 });
  }
  items.sort((a, b) => a.priority - b.priority || Number(a.reporter_code) - Number(b.reporter_code) || b.period - a.period || a.purpose.localeCompare(b.purpose));
  return { plan_key: canonicalHash(definition), policy_hash: policyHash, latest_common_year: latest, period_set: periods, actual_history_years: periods.length, candidate_reporters: reporters, items, frozen_definition: definition };
}
