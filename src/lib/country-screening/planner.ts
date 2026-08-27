/**
 * Frozen Stage A screening intent.
 *
 * Pure: it decides which countries are considered, which single provider fact is needed for
 * each of them, and what the run's identity is. It performs no I/O, so a dry global screen
 * costs nothing and a historical run can be recomputed from its persisted definition alone.
 *
 * The screening request is deliberately identical to the deep pipeline's latest-year
 * `WORLD_IMPORT_HISTORY` item for the same reporter and period — same partner, partner2,
 * customs code, mode of supply, frequency and purpose — so it produces the same
 * `request_fingerprint`. Evidence acquired by a screen therefore satisfies the deep plan
 * item outright, and evidence the deep pipeline already holds is reused by a screen without
 * a provider call. That shared fingerprint is what keeps Stage A from becoming a second
 * evidence architecture.
 */

import type { CountryScreeningPolicy } from '@/lib/config';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION } from '@/lib/comtrade/normalization';
import { canonicalComtradeRequest, type CanonicalComtradeRequest } from '@/lib/comtrade/request';
import type { ComtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { canonicalHash } from '@/lib/country-evidence/planner';
import type { PlannedSourceMode } from '@/lib/country-evidence/planner';
import { rankScreeningCandidates, screeningScore, shortlistSize } from './ranking';
import { buildCountryScreeningUniverse, type CountryScreeningUniverse, type CountryScreeningUniverseEntry } from './universe';

/**
 * Screening result vocabulary. Every state is explicit: nothing here ever collapses a missing,
 * suppressed, unavailable or incompatible cell into a zero. `below_minimum_demand` exists for
 * exactly that reason — an observed zero, or an observed value under the policy minimum, is a
 * real fact about the market and is reported as one, not as an absence.
 */
export const COUNTRY_SCREENING_STATUSES = [
  'pending_acquisition',
  'eligible',
  'below_minimum_demand',
  'insufficient_evidence',
  'suppressed',
  'unavailable',
  'stale',
  'incompatible',
  'deferred_quota',
  'failed',
] as const;
export type CountryScreeningStatus = (typeof COUNTRY_SCREENING_STATUSES)[number];

/** States that a later attempt could still resolve, and that therefore keep a run open. */
export const RETRYABLE_SCREENING_STATUSES: readonly CountryScreeningStatus[] = ['pending_acquisition', 'deferred_quota', 'failed'];
/** States whose fix is one provider request for the frozen screening period. */
export const ACQUIRABLE_SCREENING_STATUSES: readonly CountryScreeningStatus[] = ['pending_acquisition', 'unavailable', 'stale', 'incompatible', 'deferred_quota', 'failed'];

export interface CountryScreeningPlanInput {
  product_classification_id: string;
  hs_code: string;
  hs_revision: string;
  as_of_date: Date;
  source_mode: PlannedSourceMode;
  policy: CountryScreeningPolicy;
  policy_config_version: number;
  /** Test seam. Production always resolves the frozen provider reporter snapshot. */
  reporter_registry?: ComtradeReporterRegistry;
}

export interface PlannedScreeningItem {
  item_key: string;
  reporter_code: string;
  country_code: string;
  iso_numeric: string;
  iso3: string;
  country_name: string;
  reporter_text: string;
  reporter_note: string | null;
  provider_area_aliases: string[];
  partner_code: string;
  period: number;
  estimated_call_cost: 1;
}

export interface FrozenCountryScreeningPlan {
  run_key: string;
  policy_hash: string;
  screening_period: number;
  universe: CountryScreeningUniverse;
  items: PlannedScreeningItem[];
  frozen_definition: Record<string, unknown>;
}

function validate(input: CountryScreeningPlanInput) {
  if (!/^[0-9]{6}$/.test(input.hs_code)) throw new Error('Country screening requires a validated HS6 code.');
  if (!input.hs_revision.trim() || input.hs_revision === 'unknown') throw new Error('Country screening requires an explicit HS revision.');
  if (input.source_mode === 'preview') throw new Error('Preview evidence is not valid for a country screening run.');
  if (Number.isNaN(input.as_of_date.getTime())) throw new Error('Country screening requires a valid as-of date.');
  if (input.policy.screening_stage !== 'stage_a_global_demand_v1') throw new Error(`Unsupported country screening stage ${input.policy.screening_stage}.`);
  if (input.policy.required_parser_version !== COMTRADE_PARSER_VERSION) throw new Error('Country screening policy requires the current Comtrade parser version.');
  if (input.policy.required_normalization_version !== COMTRADE_NORMALIZATION_VERSION) throw new Error('Country screening policy requires comtrade-normalization-v2.');
  // v1 screens on complete responses only. Reading a demand signal out of a truncated page is
  // a different evidence contract, and it would arrive as a new policy version, not a flag.
  if (!input.policy.require_complete_evidence) throw new Error('Country screening policy v1 requires complete provider evidence.');
  // Phase 1G owns the per-country latest-usable-period walk. Phase 1F fails closed rather than
  // inventing a fallback that would change what a frozen screening period means.
  if (input.policy.period_fallback_lookback_years !== 0) throw new Error('Per-country screening period fallback is not implemented in country-screening-policy-v1.');
  if (!Number.isFinite(input.policy.minimum_import_value_usd) || input.policy.minimum_import_value_usd < 0) throw new Error('Country screening minimum import value must be a non-negative number.');
  if (!Number.isInteger(input.policy.latest_period_freshness_days) || input.policy.latest_period_freshness_days <= 0) throw new Error('Country screening freshness requirement must be a positive number of days.');
  // Ranking and shortlist arithmetic is validated HERE rather than when it first runs. Both are
  // reached part-way through resolving a run, so an invalid policy discovered there would abort
  // a half-written run; discovered here it simply refuses to create one.
  screeningScore(input.policy.minimum_import_value_usd, input.policy);
  shortlistSize(0, input.policy);
  rankScreeningCandidates([], input.policy);
}

/**
 * The single annual period a Phase 1F screen evaluates.
 *
 * Same release rule as `country_evidence.policy` so the screening request lands on the same
 * period — and therefore the same evidence — as the deep plan's latest year. A country that
 * has not reported that year yet resolves to an explicit status; it is never back-filled with
 * an older year, because choosing per-country periods is Phase 1G's decision to make.
 */
export function selectScreeningPeriod(asOf: Date, policy: CountryScreeningPolicy): number {
  const releaseReached = asOf.getUTCMonth() + 1 >= policy.annual_release_month_utc;
  return asOf.getUTCFullYear() - (releaseReached ? 1 : 2);
}

export function buildCountryScreeningPlan(input: CountryScreeningPlanInput): FrozenCountryScreeningPlan {
  validate(input);
  const universe = buildCountryScreeningUniverse({
    universe_version: input.policy.universe_version,
    reporter_identity_strategy: input.policy.reporter_identity_strategy,
    reporter_registry_version: input.policy.reporter_registry_version,
    excluded_iso2_codes: input.policy.excluded_iso2_codes,
    exclude_origin_country: input.policy.exclude_origin_country,
    origin_country_iso2: input.policy.origin_country_iso2,
    registry: input.reporter_registry,
  });
  if (universe.size === 0) throw new Error('Country screening universe resolved to no countries.');
  if (universe.size > input.policy.max_countries_per_run) throw new Error(`Country screening universe of ${universe.size} exceeds the configured maximum of ${input.policy.max_countries_per_run}.`);
  const period = selectScreeningPeriod(input.as_of_date, input.policy);
  const policyHash = canonicalHash({ ...input.policy, config_version: input.policy_config_version });
  const definition = {
    schema_version: 'country-screening-run-definition-v1',
    product_classification_id: input.product_classification_id,
    hs_code: input.hs_code,
    hs_revision: input.hs_revision,
    as_of_date: input.as_of_date.toISOString(),
    screening_period: period,
    source_mode: input.source_mode,
    policy_version: input.policy.policy_version,
    policy_config_version: input.policy_config_version,
    policy_hash: policyHash,
    universe_version: universe.version,
    universe_checksum: universe.checksum,
    universe_size: universe.size,
    // The reporter registry is part of the run's identity, not decoration. A refreshed provider
    // reference that moves any reporter code produces a new run rather than reinterpreting an
    // old one — and, because reporter code is inside the canonical request, a new fingerprint.
    reporter_registry_version: universe.reporter_registry_version,
    reporter_registry_checksum: universe.reporter_registry_checksum,
    screening_algorithm_version: input.policy.screening_algorithm_version,
    parser_version: COMTRADE_PARSER_VERSION,
    normalization_version: COMTRADE_NORMALIZATION_VERSION,
    world_partner_code: input.policy.world_partner_code,
    shortlist_target_size: input.policy.shortlist_target_size,
    max_shortlist_size: input.policy.max_shortlist_size,
  };
  const items = universe.entries.map((entry: CountryScreeningUniverseEntry): PlannedScreeningItem => ({
    item_key: canonicalHash({ ...definition, reporter: entry.reporter_code, partner: input.policy.world_partner_code, period }),
    reporter_code: entry.reporter_code,
    country_code: entry.iso2,
    iso_numeric: entry.iso_numeric,
    iso3: entry.iso3,
    country_name: entry.country_name,
    reporter_text: entry.reporter_text,
    reporter_note: entry.reporter_note,
    provider_area_aliases: entry.provider_area_aliases,
    partner_code: input.policy.world_partner_code,
    period,
    estimated_call_cost: 1,
  }));
  return { run_key: canonicalHash(definition), policy_hash: policyHash, screening_period: period, universe, items, frozen_definition: definition };
}

/**
 * Request-shape constants shared with the deep Country Evidence plan.
 *
 * These are not screening preferences — they are the other half of the fingerprint that makes
 * screening evidence and deep evidence the same row. `tests/country-screening.test.ts` asserts
 * the two fingerprints are byte-identical, so a drift here fails loudly rather than quietly
 * doubling the platform's Comtrade bill.
 */
export const SCREENING_PARTNER2_CODE = '0';
export const SCREENING_CUSTOMS_CODE = 'C00';
export const SCREENING_MODE_OF_SUPPLY = '0';

export function screeningComtradeRequest(input: { reporter_code: string; partner_code: string; period: number; hs_code: string; hs_revision: string; source_mode: PlannedSourceMode }): CanonicalComtradeRequest {
  return canonicalComtradeRequest({
    provider: 'un_comtrade', dataset: 'goods-trade', source_mode: input.source_mode, purpose: 'country_truth',
    reporter_code: input.reporter_code, partner_code: input.partner_code, partner2_code: SCREENING_PARTNER2_CODE,
    flow_direction: 'import', frequency: 'A', period: String(input.period), hs_codes: [input.hs_code],
    hs_revision: input.hs_revision, customs_code: SCREENING_CUSTOMS_CODE, mode_of_supply: SCREENING_MODE_OF_SUPPLY,
  });
}
