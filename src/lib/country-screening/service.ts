/**
 * Stage A global country screening — persistence, resolution, quota planning and execution.
 *
 * The pipeline this feeds is unchanged: a screening shortlist becomes the candidate reporter
 * set of the EXISTING `CountryEvidencePlanner`, which is what actually acquires five-year
 * histories, supplier distributions and everything the deep phases need. Nothing here computes
 * a metric, an HHI, an India share or a country score. Stage A answers one question — which
 * markets justify spending deep quota — and hands the answer to Phase 1B–1E untouched.
 *
 * Cheapness is structural, not a convention: the plan holds exactly one item per country, for
 * one partner (World), for one annual period. There is no code path here that can request a
 * history, a supplier distribution or a second period.
 *
 * Evidence flows through the same architecture as everything else in Country Truth —
 * SourceEvidence → parser → comtrade-normalization-v2 → immutable NormalizedTradeObservation —
 * and screening reuses whatever compatible authenticated evidence the deep pipeline already
 * acquired, because the request fingerprints are identical. Fixture and preview evidence can
 * never satisfy an authenticated screen: the lookup is scoped by evidence origin, which is
 * derived from the run's frozen source mode.
 */

import { Prisma, TradeSourceMode } from '@prisma/client';
import { comtradeReporterRegistry, type ComtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { comtradeRequestFingerprint } from '@/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION, ensureCurrentComtradeNormalization } from '@/lib/comtrade/normalization';
import { getConfigWithVersion, type CountryScreeningPolicy } from '@/lib/config';
import { createCountryEvidencePlan } from '@/lib/country-evidence/service';
import { isRealWorkflowEnvironment, tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
import { runComtradeIngest } from '@/lib/job-handlers/comtrade';
import { prisma } from '@/lib/prisma';
import { requireCountryTruthClassification } from '@/lib/product-classification';
import { availableProviderRequestAllowance } from '@/lib/provider-quota';
import type { PlannedSourceMode } from '@/lib/country-evidence/planner';
import { ACQUIRABLE_SCREENING_STATUSES, buildCountryScreeningPlan, RETRYABLE_SCREENING_STATUSES, screeningComtradeRequest, SCREENING_CUSTOMS_CODE, SCREENING_MODE_OF_SUPPLY, SCREENING_PARTNER2_CODE, type CountryScreeningStatus, type PlannedScreeningItem } from './planner';
import { rankScreeningCandidates, shortlistSize } from './ranking';

type ScreeningRun = Prisma.CountryScreeningRunGetPayload<{ include: { results: true } }>;
type ScreeningResult = Prisma.CountryScreeningResultGetPayload<object>;

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Statuses after which a run is finished history and every row beneath it is frozen. */
const COMPLETED = 'completed';

/**
 * Did another execution complete this run while we were working on it?
 *
 * The database is the authority here, not a lock: the immutability triggers added in
 * `20260826130000_global_country_screening` refuse the write, and this recognises their refusal
 * by the exact message they raise. A duplicate execution losing that race has not failed — the
 * winner's run IS the result — so it must return that run rather than surface a raw database
 * error as a failed job. Nothing is corrupted either way; the trigger is what guarantees that.
 */
function lostToCompletedRun(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Completed country screening runs are immutable|Country screening results are immutable once their run completes/.test(message);
}

export interface GlobalCountryScreeningQuotaEstimate {
  schema_version: 'country-screening-quota-v1';
  total_countries_considered: number;
  evidence_reusable: number;
  requires_acquisition: number;
  no_acquisition_required: number;
  acquisition_attempts_exhausted: number;
  estimated_logical_requests: number;
  estimated_physical_calls: number;
  /** Null when the configured client is unmetered (fixture/mock), never a fabricated number. */
  available_quota: number | null;
  can_execute_full_screen: boolean;
  executable_now: number;
  remaining_if_partial: number;
}

function policyOf(run: { policy_snapshot: Prisma.JsonValue }): CountryScreeningPolicy {
  return run.policy_snapshot as unknown as CountryScreeningPolicy;
}

/**
 * Narrow a stored source mode to one a plan may actually be built from. Warehouse modes such as
 * `public_real` or `legacy_unknown` describe rows that were never acquired through this request
 * contract, so they are refused rather than silently treated as authenticated evidence.
 */
function plannedSourceMode(mode: TradeSourceMode): PlannedSourceMode {
  if (mode === TradeSourceMode.authenticated || mode === TradeSourceMode.fixture || mode === TradeSourceMode.mock) return mode;
  throw new Error(`Country screening does not support ${mode} evidence.`);
}

// ---------------------------------------------------------------------------
// Run creation
// ---------------------------------------------------------------------------

/**
 * Freeze a screening run, or return the identical one that already exists.
 *
 * The run key covers the classification, the period, the universe checksum, the policy hash and
 * the ranking identity, so re-requesting the same screen is a no-op and a policy change produces
 * a NEW run instead of mutating a historical one. That is what keeps a resumed run from silently
 * changing the rules underneath itself: execution reads the frozen snapshot, never live config.
 */
export async function createGlobalCountryScreeningRun(input: { product_classification_id: string; as_of_date: Date; source_mode: TradeSourceMode; allow_partial_execution?: boolean; reporter_registry?: ComtradeReporterRegistry }) {
  if (isRealWorkflowEnvironment() && input.source_mode !== TradeSourceMode.authenticated) throw new Error('Staging/production country screening runs require authenticated source mode.');
  const sourceMode = plannedSourceMode(input.source_mode);
  const classification = await requireCountryTruthClassification(input.product_classification_id);
  const configured = await getConfigWithVersion('country_screening.policy');
  const built = buildCountryScreeningPlan({
    product_classification_id: input.product_classification_id,
    hs_code: classification.hs6_code, hs_revision: classification.nomenclature_version,
    as_of_date: input.as_of_date, source_mode: sourceMode,
    policy: configured.value, policy_config_version: configured.version, reporter_registry: input.reporter_registry,
  });
  const existing = await prisma.countryScreeningRun.findUnique({ where: { run_key: built.run_key }, include: { results: true } });
  if (existing) return existing;
  try {
    return await writeScreeningRun(input, classification, configured, built, sourceMode);
  } catch (error) {
    // Two workers can reach this at once — a retried job, or a duplicate execution racing its
    // own predecessor. The unique run key is what actually prevents a second run; losing the
    // race must return the winner's run, not fail work that is already correctly under way.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const raced = await prisma.countryScreeningRun.findUnique({ where: { run_key: built.run_key }, include: { results: true } });
      if (raced) return raced;
    }
    throw error;
  }
}

async function writeScreeningRun(
  input: { product_classification_id: string; as_of_date: Date; source_mode: TradeSourceMode; allow_partial_execution?: boolean; reporter_registry?: ComtradeReporterRegistry },
  classification: { hs6_code: string; nomenclature_version: string },
  configured: { value: CountryScreeningPolicy; version: number },
  built: ReturnType<typeof buildCountryScreeningPlan>,
  sourceMode: PlannedSourceMode,
) {
  const created = await prisma.countryScreeningRun.create({
    data: {
      run_key: built.run_key, product_classification_id: input.product_classification_id,
      hs_code: classification.hs6_code, hs_revision: classification.nomenclature_version,
      as_of_date: input.as_of_date, screening_period: built.screening_period, source_mode: input.source_mode,
      policy_version: configured.value.policy_version, policy_hash: built.policy_hash,
      policy_snapshot: json({ ...configured.value, config_version: configured.version, frozen_definition: built.frozen_definition }),
      universe_version: built.universe.version, universe_checksum: built.universe.checksum, universe_size: built.universe.size,
      reporter_registry_version: built.universe.reporter_registry_version, reporter_registry_checksum: built.universe.reporter_registry_checksum,
      universe_snapshot: json({ schema_version: 'country-screening-universe-snapshot-v2', version: built.universe.version, checksum: built.universe.checksum, size: built.universe.size, reporter_identity_strategy: built.universe.reporter_identity_strategy, reporter_registry_version: built.universe.reporter_registry_version, reporter_registry_checksum: built.universe.reporter_registry_checksum, reporter_reference_source: (input.reporter_registry ?? comtradeReporterRegistry()).source, entries: built.universe.entries, exclusions: built.universe.exclusions, unmatched_reporters: built.universe.unmatched_reporters }),
      screening_algorithm_version: configured.value.screening_algorithm_version,
      parser_version: COMTRADE_PARSER_VERSION, normalization_version: COMTRADE_NORMALIZATION_VERSION,
      shortlist_target_size: configured.value.shortlist_target_size, max_shortlist_size: configured.value.max_shortlist_size,
      estimated_call_cost: built.items.length,
      allow_partial_execution: input.allow_partial_execution ?? configured.value.allow_partial_execution,
      results: { create: built.items.map((item: PlannedScreeningItem) => ({
        result_key: item.item_key, reporter_code: item.reporter_code, country_code: item.country_code,
        iso_numeric: item.iso_numeric, country_name: item.country_name,
        request_fingerprint: comtradeRequestFingerprint(screeningComtradeRequest({ reporter_code: item.reporter_code, partner_code: item.partner_code, period: item.period, hs_code: classification.hs6_code, hs_revision: classification.nomenclature_version, source_mode: sourceMode })),
        provenance: json({ schema_version: 'country-screening-result-provenance-v2', universe_version: built.universe.version, universe_checksum: built.universe.checksum, reporter_registry_version: built.universe.reporter_registry_version, reporter_registry_checksum: built.universe.reporter_registry_checksum, iso_numeric: item.iso_numeric, iso3: item.iso3, reporter_text: item.reporter_text, reporter_note: item.reporter_note, provider_area_aliases: item.provider_area_aliases, partner_code: item.partner_code, requested_period: item.period, customs_code: SCREENING_CUSTOMS_CODE, mode_of_supply: SCREENING_MODE_OF_SUPPLY, partner2_code: SCREENING_PARTNER2_CODE }),
      })) },
    },
    include: { results: true },
  });
  return created;
}

// ---------------------------------------------------------------------------
// Resolution — cache only, never a provider call
// ---------------------------------------------------------------------------

interface ResolvedScreening {
  screening_status: CountryScreeningStatus;
  import_value: number | null;
  import_value_status: string | null;
  observation_period: number | null;
  freshness_state: 'fresh' | 'stale' | 'unknown';
  source_evidence_id: string | null;
  observation_id: string | null;
  evidence_retrieved_at: Date | null;
  decision_reason: string;
  evidence: Record<string, unknown>;
}

/**
 * Decide one country's screening state from persisted evidence alone.
 *
 * Every branch that fails to produce a usable number produces a DIFFERENT status. A complete
 * response with no World row for the period is `insufficient_evidence` with `absence_is_not_zero`
 * recorded, an explicitly suppressed cell is `suppressed`, and an observed zero is a real
 * observation reported as `below_minimum_demand` with its value intact. None of them becomes 0.
 */
async function resolveScreeningResult(run: ScreeningRun, result: ScreeningResult, policy: CountryScreeningPolicy): Promise<ResolvedScreening> {
  const origin = tradeSourceModeToEvidenceOrigin(run.source_mode);
  const evidence = await prisma.sourceEvidence.findMany({
    where: { request_fingerprint: result.request_fingerprint, source_origin: origin, parser_version: policy.required_parser_version, status: { in: ['accepted', 'partial'] } },
    include: { observations: true }, orderBy: { retrieved_at: 'desc' }, take: 5,
  });
  const candidate = evidence.find(row => row.completeness === 'COMPLETE' && row.status === 'accepted');
  if (!candidate) {
    if (evidence.length) return { screening_status: 'insufficient_evidence', import_value: null, import_value_status: null, observation_period: null, freshness_state: 'unknown', source_evidence_id: null, observation_id: null, evidence_retrieved_at: null, decision_reason: 'no_complete_provider_response', evidence: { incomplete_evidence_ids: evidence.map(row => row.id) } };
    const incompatible = await prisma.normalizedTradeObservation.findFirst({
      where: { source_origin: origin, reporter_code: result.reporter_code, hs_code: run.hs_code, ref_year: run.screening_period, flow_direction: 'import', partner_code: policy.world_partner_code, NOT: { hs_revision: run.hs_revision } },
      select: { id: true, hs_revision: true, source_evidence_id: true },
    });
    if (incompatible) return { screening_status: 'incompatible', import_value: null, import_value_status: null, observation_period: null, freshness_state: 'unknown', source_evidence_id: null, observation_id: null, evidence_retrieved_at: null, decision_reason: 'hs_revision_mismatch', evidence: { found_revision: incompatible.hs_revision, observation_id: incompatible.id, source_evidence_id: incompatible.source_evidence_id } };
    return { screening_status: 'unavailable', import_value: null, import_value_status: null, observation_period: null, freshness_state: 'unknown', source_evidence_id: null, observation_id: null, evidence_retrieved_at: null, decision_reason: 'no_compatible_authenticated_evidence', evidence: {} };
  }
  if (candidate.retrieved_at < new Date(Date.now() - policy.latest_period_freshness_days * 86_400_000)) {
    return { screening_status: 'stale', import_value: null, import_value_status: null, observation_period: null, freshness_state: 'stale', source_evidence_id: candidate.id, observation_id: null, evidence_retrieved_at: candidate.retrieved_at, decision_reason: 'evidence_older_than_freshness_requirement', evidence: { stale_evidence_id: candidate.id, retrieved_at: candidate.retrieved_at.toISOString() } };
  }
  const normalized = await ensureCurrentComtradeNormalization(candidate);
  const cell = normalized.find(row => row.normalization_version === policy.required_normalization_version && row.reporter_code === result.reporter_code && row.hs_code === run.hs_code && row.hs_revision === run.hs_revision && row.ref_year === run.screening_period && row.flow_direction === 'import' && row.partner_code === policy.world_partner_code);
  const base = { source_evidence_id: candidate.id, evidence_retrieved_at: candidate.retrieved_at, freshness_state: 'fresh' as const };
  if (!cell) return { ...base, screening_status: 'insufficient_evidence', import_value: null, import_value_status: null, observation_period: null, observation_id: null, decision_reason: 'complete_response_has_no_world_row', evidence: { absence_is_not_zero: true, source_evidence_id: candidate.id } };
  if (cell.trade_value_status === 'suppressed') return { ...base, screening_status: 'suppressed', import_value: null, import_value_status: cell.trade_value_status, observation_period: cell.ref_year, observation_id: cell.id, decision_reason: 'provider_suppressed_world_import_value', evidence: { observation_id: cell.id, source_evidence_id: candidate.id } };
  if (!['observed', 'observed_zero'].includes(cell.trade_value_status) || cell.trade_value == null) return { ...base, screening_status: 'insufficient_evidence', import_value: null, import_value_status: cell.trade_value_status, observation_period: cell.ref_year, observation_id: cell.id, decision_reason: `world_import_value_${cell.trade_value_status}`, evidence: { observation_id: cell.id, source_evidence_id: candidate.id, absence_is_not_zero: true } };
  const value = Number(cell.trade_value);
  if (!Number.isFinite(value) || value < 0) return { ...base, screening_status: 'insufficient_evidence', import_value: null, import_value_status: 'invalid', observation_period: cell.ref_year, observation_id: cell.id, decision_reason: 'world_import_value_not_a_usable_number', evidence: { observation_id: cell.id, source_evidence_id: candidate.id } };
  const meetsMinimum = value >= policy.minimum_import_value_usd;
  return { ...base, screening_status: meetsMinimum ? 'eligible' : 'below_minimum_demand', import_value: value, import_value_status: cell.trade_value_status, observation_period: cell.ref_year, observation_id: cell.id, decision_reason: meetsMinimum ? 'observed_world_import_value' : 'observed_world_import_value_below_minimum', evidence: { observation_id: cell.id, source_evidence_id: candidate.id, normalization_version: cell.normalization_version, observed_status: cell.trade_value_status } };
}

/** Rank the eligible results and mark the shortlist. Deterministic; ties never depend on order. */
function applyRanking(results: Array<ScreeningResult & { resolved: ResolvedScreening }>, policy: CountryScreeningPolicy) {
  const eligible = results.filter(row => row.resolved.screening_status === 'eligible');
  const ranked = rankScreeningCandidates(eligible.map(row => ({ reporter_code: row.reporter_code, import_value: row.resolved.import_value as number })), policy);
  const size = shortlistSize(ranked.length, policy);
  const byReporter = new Map(ranked.map(row => [row.reporter_code, row]));
  return results.map(row => {
    const rank = byReporter.get(row.reporter_code);
    const shortlisted = rank != null && rank.screening_rank <= size;
    return {
      ...row,
      screening_score: rank?.screening_score ?? null,
      screening_rank: rank?.screening_rank ?? null,
      shortlisted,
      decision_reason: rank == null ? `not_shortlisted_${row.resolved.screening_status}` : shortlisted ? 'shortlisted_top_screening_rank' : `not_shortlisted_rank_${rank.screening_rank}_beyond_target_${size}`,
    };
  });
}

/**
 * Re-derive every country's status from persisted evidence. Reads only — no provider call is
 * possible from this path, which is what makes a dry global screen safe to run against staging.
 */
export async function resolveGlobalCountryScreeningRun(runId: string) {
  const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: { orderBy: { reporter_code: 'asc' } } } });
  if (run.status === COMPLETED) return run;
  try {
    return await writeResolvedScreening(run);
  } catch (error) {
    if (!lostToCompletedRun(error)) throw error;
    return prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: { orderBy: [{ screening_rank: 'asc' }, { reporter_code: 'asc' }] } } });
  }
}

async function writeResolvedScreening(run: ScreeningRun) {
  const policy = policyOf(run);
  const resolved: Array<ScreeningResult & { resolved: ResolvedScreening }> = [];
  for (const result of [...run.results].sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code))) {
    resolved.push({ ...result, resolved: await resolveScreeningResult(run, result, policy) });
  }
  const ranked = applyRanking(resolved, policy);
  for (const row of ranked) {
    await prisma.countryScreeningResult.update({
      where: { id: row.id },
      data: {
        screening_status: row.resolved.screening_status, screening_score: row.screening_score, screening_rank: row.screening_rank,
        import_value: row.resolved.import_value == null ? null : new Prisma.Decimal(row.resolved.import_value),
        import_value_status: row.resolved.import_value_status, observation_period: row.resolved.observation_period,
        freshness_state: row.resolved.freshness_state, source_evidence_id: row.resolved.source_evidence_id,
        observation_id: row.resolved.observation_id, evidence_retrieved_at: row.resolved.evidence_retrieved_at,
        shortlisted: row.shortlisted, decision_reason: row.decision_reason,
        provenance: json({ ...((row.provenance as Record<string, unknown> | null) ?? {}), resolution_reason: row.resolved.decision_reason, resolution_evidence: row.resolved.evidence, normalization_version: policy.required_normalization_version, parser_version: policy.required_parser_version, screening_algorithm_version: policy.screening_algorithm_version }),
      },
    });
  }
  const eligible = ranked.filter(row => row.resolved.screening_status === 'eligible').length;
  await prisma.countryScreeningRun.update({ where: { id: run.id }, data: { resolved_count: ranked.filter(row => row.resolved.screening_status !== 'pending_acquisition').length, eligible_count: eligible, shortlist_size: ranked.filter(row => row.shortlisted).length } });
  return prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: run.id }, include: { results: { orderBy: [{ screening_rank: 'asc' }, { reporter_code: 'asc' }] } } });
}

// ---------------------------------------------------------------------------
// Quota planning
// ---------------------------------------------------------------------------

function acquisitionCandidates(run: ScreeningRun, policy: CountryScreeningPolicy) {
  const required: ScreeningResult[] = [], exhausted: ScreeningResult[] = [];
  for (const result of [...run.results].sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code))) {
    if (!ACQUIRABLE_SCREENING_STATUSES.includes(result.screening_status as CountryScreeningStatus)) continue;
    if (result.attempts >= policy.max_acquisition_attempts_per_country) exhausted.push(result);
    else required.push(result);
  }
  return { required, exhausted };
}

/**
 * What a screen would cost and whether it can run — answerable before any provider is touched.
 *
 * One logical request per country needing acquisition, and one physical authenticated call per
 * logical request: reporter, period and HS6 are all pinned, so there is nothing to batch and the
 * two numbers are equal by construction rather than by estimate.
 */
export async function estimateGlobalCountryScreeningQuota(runId: string): Promise<GlobalCountryScreeningQuotaEstimate> {
  const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  const policy = policyOf(run);
  const { required, exhausted } = acquisitionCandidates(run, policy);
  const allowance = await availableProviderRequestAllowance(run.source_mode);
  const unmetered = allowance === Number.MAX_SAFE_INTEGER;
  const executable = Math.min(required.length, allowance);
  return {
    schema_version: 'country-screening-quota-v1',
    total_countries_considered: run.results.length,
    evidence_reusable: run.results.filter(row => row.source_evidence_id != null && !ACQUIRABLE_SCREENING_STATUSES.includes(row.screening_status as CountryScreeningStatus)).length,
    requires_acquisition: required.length,
    no_acquisition_required: run.results.length - required.length - exhausted.length,
    acquisition_attempts_exhausted: exhausted.length,
    estimated_logical_requests: required.length,
    estimated_physical_calls: required.length,
    available_quota: unmetered ? null : allowance,
    can_execute_full_screen: unmetered || required.length <= allowance,
    executable_now: executable,
    remaining_if_partial: required.length - executable,
  };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface GlobalCountryScreeningExecution {
  run_id: string;
  status: string;
  quota: GlobalCountryScreeningQuotaEstimate;
  /** Physical provider calls made by THIS execution. Zero on a resume that reused everything. */
  physical_calls: number;
  /** Every physical call this run has ever cost, across all of its executions. */
  total_physical_calls: number;
  eligible_count: number;
  shortlist_size: number;
}

async function summarize(runId: string, physicalCalls: number): Promise<GlobalCountryScreeningExecution> {
  const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId } });
  return { run_id: run.id, status: run.status, quota: await estimateGlobalCountryScreeningQuota(run.id), physical_calls: physicalCalls, total_physical_calls: run.physical_call_count, eligible_count: run.eligible_count, shortlist_size: run.shortlist_size };
}

/**
 * Resolve, acquire what is missing, re-resolve, rank, and record the outcome.
 *
 * Resumable and idempotent by construction. Every country that already has compatible evidence
 * is skipped without a provider call, so a restarted worker, a retried job or a duplicate
 * execution re-costs nothing. Quota exhaustion is a first-class outcome rather than a failure:
 * the affected countries are marked `deferred_quota`, the run stays open at `deferred_quota` or
 * `partial`, and a later execution picks up exactly where this one stopped.
 */
export async function executeGlobalCountryScreeningRun(runId: string, options: { allow_partial_execution?: boolean } = {}): Promise<GlobalCountryScreeningExecution> {
  const initial = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId } });
  if (initial.status === COMPLETED) return summarize(initial.id, 0);
  const spent = { physical_calls: 0 };
  try {
    return await acquireAndRankScreening(runId, options, spent);
  } catch (error) {
    if (!lostToCompletedRun(error)) throw error;
    return summarize(runId, spent.physical_calls);
  }
}

async function acquireAndRankScreening(runId: string, options: { allow_partial_execution?: boolean }, spent: { physical_calls: number }): Promise<GlobalCountryScreeningExecution> {
  await resolveGlobalCountryScreeningRun(runId);
  let run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  const policy = policyOf(run);
  const { required } = acquisitionCandidates(run, policy);
  const allowance = await availableProviderRequestAllowance(run.source_mode);
  const partial = options.allow_partial_execution ?? run.allow_partial_execution;

  if (required.length > allowance && !partial) {
    for (const result of required) await prisma.countryScreeningResult.update({ where: { id: result.id }, data: { screening_status: 'deferred_quota', decision_reason: 'not_shortlisted_deferred_quota', shortlisted: false, screening_rank: null, screening_score: null } });
    await prisma.countryScreeningRun.update({ where: { id: run.id }, data: { status: 'deferred_quota', quota_snapshot: json(await estimateGlobalCountryScreeningQuota(run.id)) } });
    return summarize(run.id, 0);
  }

  await prisma.countryScreeningRun.update({ where: { id: run.id }, data: { status: 'executing' } });
  const executable = required.slice(0, partial ? allowance : required.length);
  const deferred = required.slice(executable.length);
  const failures = new Map<string, string>();
  for (const result of executable) {
    await prisma.countryScreeningResult.update({ where: { id: result.id }, data: { attempts: { increment: 1 }, last_attempted_at: new Date(), error: null } });
    const outcome = await runComtradeIngest({
      job_id: `country-screening:${result.id}`, attempt_no: result.attempts + 1,
      payload: { hs_chapter: run.hs_code.slice(0, 2), hs_codes: [run.hs_code], reporter: result.reporter_code, partner: policy.world_partner_code, year: run.screening_period, flow_direction: 'import', hs_revision: run.hs_revision, frequency: 'A', partner2: SCREENING_PARTNER2_CODE, customs_code: SCREENING_CUSTOMS_CODE, mode_of_supply: SCREENING_MODE_OF_SUPPLY, purpose: 'country_truth' },
      exporter_org_id: null, target_id: run.id, correlation_id: `country-screening:${run.id}`, reportProgress: async () => undefined,
    });
    const payload = outcome.result as Record<string, unknown>;
    const ingestId = typeof payload.ingest_run_id === 'string' ? payload.ingest_run_id : null;
    if (ingestId) { const ingest = await prisma.ingestRun.findUnique({ where: { id: ingestId }, select: { request_count: true } }); spent.physical_calls += ingest?.request_count ?? 0; }
    if (outcome.status === 'failed') failures.set(result.id, String(payload.error ?? 'Provider acquisition failed.').slice(0, 1000));
  }

  await prisma.countryScreeningRun.update({ where: { id: run.id }, data: { physical_call_count: { increment: spent.physical_calls } } });
  // Re-resolve from evidence FIRST, then re-apply the two states evidence cannot express.
  // A provider error and an unspent quota slot are facts about this execution, not about the
  // warehouse: resolving over them would quietly downgrade both to a terminal `unavailable`
  // and let the run complete — and freeze — with work that was never actually attempted.
  await resolveGlobalCountryScreeningRun(runId);
  const usable = new Set<string>(['eligible', 'below_minimum_demand']);
  for (const result of deferred) await prisma.countryScreeningResult.update({ where: { id: result.id }, data: { screening_status: 'deferred_quota', decision_reason: 'not_shortlisted_deferred_quota', shortlisted: false, screening_rank: null, screening_score: null } });
  for (const [resultId, error] of failures) {
    const current = await prisma.countryScreeningResult.findUniqueOrThrow({ where: { id: resultId } });
    if (usable.has(current.screening_status)) { await prisma.countryScreeningResult.update({ where: { id: resultId }, data: { error } }); continue; }
    await prisma.countryScreeningResult.update({ where: { id: resultId }, data: { screening_status: 'failed', decision_reason: 'not_shortlisted_failed', shortlisted: false, screening_rank: null, screening_score: null, error } });
  }

  run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  const openStatuses = new Set<string>(RETRYABLE_SCREENING_STATUSES);
  const open = run.results.filter(row => openStatuses.has(row.screening_status) && row.attempts < policy.max_acquisition_attempts_per_country);
  const stillDeferred = run.results.some(row => row.screening_status === 'deferred_quota');
  const status = open.length === 0 ? COMPLETED : stillDeferred ? 'deferred_quota' : 'partial';
  await prisma.countryScreeningRun.update({
    where: { id: run.id },
    data: {
      status,
      resolved_count: run.results.filter(row => row.screening_status !== 'pending_acquisition').length,
      eligible_count: run.results.filter(row => row.screening_status === 'eligible').length,
      shortlist_size: run.results.filter(row => row.shortlisted).length,
      quota_snapshot: json(await estimateGlobalCountryScreeningQuota(run.id)),
      ...(status === COMPLETED ? { completed_at: new Date() } : {}),
    },
  });
  return summarize(run.id, spent.physical_calls);
}

// ---------------------------------------------------------------------------
// Deep Country Truth handoff
// ---------------------------------------------------------------------------

export interface ScreeningShortlistCandidate {
  country_code: string;
  country_name: string;
  reporter_code: string;
  screening_rank: number;
  screening_score: string;
  import_value: string;
  observation_period: number | null;
  source_evidence_id: string | null;
  observation_id: string | null;
}

/**
 * The shortlist, in exactly the shape the deep pipeline already consumes.
 *
 * `country_code` / `country_name` / `reporter_code` is the candidate shape of
 * `country-truth-discovery-job-v1`, so a screened market flows into the existing Country Truth
 * job with no manual reporter entry and no translation step. Ordered by screening rank.
 */
export async function globalCountryScreeningShortlist(runId: string): Promise<ScreeningShortlistCandidate[]> {
  const results = await prisma.countryScreeningResult.findMany({ where: { run_id: runId, shortlisted: true }, orderBy: [{ screening_rank: 'asc' }, { reporter_code: 'asc' }] });
  return results.map(row => ({
    country_code: row.country_code, country_name: row.country_name, reporter_code: row.reporter_code,
    screening_rank: row.screening_rank ?? 0, screening_score: row.screening_score?.toString() ?? '0',
    import_value: row.import_value?.toString() ?? '0', observation_period: row.observation_period,
    source_evidence_id: row.source_evidence_id, observation_id: row.observation_id,
  }));
}

/** Candidate reporter codes for `CountryEvidencePlanner`, deterministically ordered. */
export async function screeningShortlistReporters(runId: string): Promise<string[]> {
  return (await globalCountryScreeningShortlist(runId)).map(candidate => candidate.reporter_code);
}

/**
 * Hand the shortlist to the EXISTING deep planner.
 *
 * Deliberately a two-line function: there is no second deep-analysis implementation to choose
 * between. Stage A's only output is a candidate reporter set, and `createCountryEvidencePlan`
 * does everything after that exactly as it already does for Germany, UAE and the USA.
 */
export async function planDeepCountryTruthFromScreening(runId: string, options: { as_of_date?: Date; allow_provisional_shortlist?: boolean } = {}) {
  const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId } });
  // Deep analysis costs roughly eleven provider calls per market. Handing it a shortlist that
  // is still moving would spend that budget on an answer the next execution may change, which
  // is the exact waste Stage A exists to prevent — so an incomplete screen must say so out loud.
  if (run.status !== COMPLETED && !options.allow_provisional_shortlist) throw new Error(`Country screening run ${runId} is ${run.status}; deep Country Truth needs a completed screen, or an explicit provisional handoff.`);
  const reporters = await screeningShortlistReporters(runId);
  if (!reporters.length) throw new Error(`Country screening run ${runId} shortlisted no markets; deep Country Truth has nothing to acquire.`);
  return createCountryEvidencePlan({ product_classification_id: run.product_classification_id, as_of_date: options.as_of_date ?? run.as_of_date, candidate_reporters: reporters, source_mode: plannedSourceMode(run.source_mode) });
}
