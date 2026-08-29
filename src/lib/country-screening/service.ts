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
import { analysisWindowFor, selectCountryPeriod, type PeriodProbeOutcome } from '@/lib/country-period-selection';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION, ensureCurrentComtradeNormalization } from '@/lib/comtrade/normalization';
import { getConfig, getConfigWithVersion, type CountryPeriodSelectionPolicy, type CountryScreeningPolicy } from '@/lib/config';
import { createCountryEvidencePlan } from '@/lib/country-evidence/service';
import { appEnvironment, isRealWorkflowEnvironment, tradeSourceModeToEvidenceOrigin } from '@/lib/evidence-environment';
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

/** Execution always reads the run's frozen period policy, never live config. */
function periodPolicyOf(run: { period_selection_policy_snapshot: Prisma.JsonValue }): CountryPeriodSelectionPolicy {
  return run.period_selection_policy_snapshot as unknown as CountryPeriodSelectionPolicy;
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
  const periodConfigured = await getConfigWithVersion('country_period_selection.policy');
  const built = buildCountryScreeningPlan({
    product_classification_id: input.product_classification_id,
    hs_code: classification.hs6_code, hs_revision: classification.nomenclature_version,
    as_of_date: input.as_of_date, source_mode: sourceMode,
    policy: configured.value, policy_config_version: configured.version,
    period_selection_policy: periodConfigured.value, period_selection_policy_config_version: periodConfigured.version,
    reporter_registry: input.reporter_registry,
  });
  const existing = await prisma.countryScreeningRun.findUnique({ where: { run_key: built.run_key }, include: { results: true } });
  if (existing) return existing;
  try {
    return await writeScreeningRun(input, classification, configured, periodConfigured, built, sourceMode);
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
  periodConfigured: { value: CountryPeriodSelectionPolicy; version: number },
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
      period_selection_policy_version: periodConfigured.value.policy_version, period_selection_policy_hash: built.period_selection_policy_hash,
      period_selection_policy_snapshot: json({ ...periodConfigured.value, config_version: periodConfigured.version }),
      max_fallback_lookback_years: periodConfigured.value.max_fallback_lookback_years,
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
        preferred_period: built.screening_period,
        provenance: json({ schema_version: 'country-screening-result-provenance-v3', universe_version: built.universe.version, universe_checksum: built.universe.checksum, reporter_registry_version: built.universe.reporter_registry_version, reporter_registry_checksum: built.universe.reporter_registry_checksum, iso_numeric: item.iso_numeric, iso3: item.iso3, reporter_text: item.reporter_text, reporter_note: item.reporter_note, provider_area_aliases: item.provider_area_aliases, partner_code: item.partner_code, requested_period: item.period, customs_code: SCREENING_CUSTOMS_CODE, mode_of_supply: SCREENING_MODE_OF_SUPPLY, partner2_code: SCREENING_PARTNER2_CODE }),
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
  preferred_period: number;
  period_lag: number | null;
  evidence_confidence: number | null;
  freshness_state: string;
  source_evidence_id: string | null;
  observation_id: string | null;
  evidence_retrieved_at: Date | null;
  decision_reason: string;
  next_probe_period: number | null;
  evidence: Record<string, unknown>;
}

interface PeriodProbe {
  outcome: PeriodProbeOutcome;
  evidence_id: string | null;
  observation_id: string | null;
  retrieved_at: Date | null;
  value: number | null;
  cell_status: string | null;
  detail: Record<string, unknown>;
}

/**
 * Ask one country about one year, from persisted evidence alone.
 *
 * Every branch produces a DIFFERENT outcome, because the period walk above depends on telling
 * them apart: `absent` means the provider answered and had no row (walk on), `suppressed` means
 * it withheld a value that exists (stop), `not_probed` means nobody asked yet (pause and
 * acquire). Collapsing any pair would either fabricate demand or hide a real market.
 */
async function probePeriod(run: ScreeningRun, result: ScreeningResult, period: number, policy: CountryScreeningPolicy, periodPolicy: CountryPeriodSelectionPolicy): Promise<PeriodProbe> {
  const empty: PeriodProbe = { outcome: 'not_probed', evidence_id: null, observation_id: null, retrieved_at: null, value: null, cell_status: null, detail: {} };
  const origin = tradeSourceModeToEvidenceOrigin(run.source_mode);
  // The preferred period's fingerprint is the frozen one on the row; older years are derived.
  const fingerprint = period === run.screening_period ? result.request_fingerprint : comtradeRequestFingerprint(screeningComtradeRequest({ reporter_code: result.reporter_code, partner_code: policy.world_partner_code, period, hs_code: run.hs_code, hs_revision: run.hs_revision, source_mode: plannedSourceMode(run.source_mode) }));
  const evidence = await prisma.sourceEvidence.findMany({
    where: { request_fingerprint: fingerprint, source_origin: origin, environment: appEnvironment(), parser_version: policy.required_parser_version, status: { in: ['accepted', 'partial'] } },
    include: { observations: true }, orderBy: { retrieved_at: 'desc' }, take: 5,
  });
  const candidate = evidence.find(row => row.completeness === 'COMPLETE' && row.status === 'accepted');
  if (!candidate) {
    // Incomplete responses are not an answer about the country; nobody has really asked yet.
    if (evidence.length) return { ...empty, detail: { reason: 'no_complete_provider_response', incomplete_evidence_ids: evidence.map(row => row.id) } };
    const incompatible = await prisma.normalizedTradeObservation.findFirst({
      where: { source_origin: origin, reporter_code: result.reporter_code, hs_code: run.hs_code, ref_year: period, flow_direction: 'import', partner_code: policy.world_partner_code, NOT: { hs_revision: run.hs_revision } },
      select: { id: true, hs_revision: true, source_evidence_id: true },
    });
    if (incompatible) return { ...empty, outcome: 'incompatible', detail: { reason: 'hs_revision_mismatch', found_revision: incompatible.hs_revision, observation_id: incompatible.id, source_evidence_id: incompatible.source_evidence_id } };
    return empty;
  }
  // A closed year cannot change, so it keeps its own long reuse window. Applying the preferred
  // period's 90-day clock to closed years would re-buy the same immutable fact forever, and would
  // do it precisely to the lagging countries this phase exists to serve.
  const freshnessDays = period === run.screening_period ? policy.latest_period_freshness_days : periodPolicy.closed_period_freshness_days;
  if (candidate.retrieved_at < new Date(Date.now() - freshnessDays * 86_400_000)) return { ...empty, detail: { reason: 'evidence_older_than_freshness_requirement', stale_evidence_id: candidate.id, retrieved_at: candidate.retrieved_at.toISOString() } };

  // Re-normalization fails closed on evidence it cannot re-derive. That is right for the row,
  // but it must not abort every other country's resolution, so it degrades this probe only.
  let normalized;
  try { normalized = await ensureCurrentComtradeNormalization(candidate); }
  catch (error) { return { ...empty, outcome: 'incompatible', evidence_id: candidate.id, retrieved_at: candidate.retrieved_at, detail: { reason: 'evidence_cannot_be_renormalized', error: error instanceof Error ? error.message : String(error) } }; }
  const cell = normalized.find(row => row.normalization_version === policy.required_normalization_version && row.reporter_code === result.reporter_code && row.hs_code === run.hs_code && row.hs_revision === run.hs_revision && row.ref_year === period && row.flow_direction === 'import' && row.partner_code === policy.world_partner_code);
  const base = { evidence_id: candidate.id, retrieved_at: candidate.retrieved_at, observation_id: null, value: null, cell_status: null };
  // A complete response with no World row is the provider confirming absence — not a zero.
  if (!cell) return { ...empty, ...base, outcome: 'absent', detail: { reason: 'complete_response_has_no_world_row', absence_is_not_zero: true } };
  if (cell.trade_value_status === 'suppressed') return { ...empty, ...base, outcome: 'suppressed', observation_id: cell.id, cell_status: cell.trade_value_status, detail: { reason: 'provider_suppressed_world_import_value' } };
  if (!periodPolicy.usable_cell_statuses.includes(cell.trade_value_status) || cell.trade_value == null) return { ...empty, ...base, outcome: 'absent', observation_id: cell.id, cell_status: cell.trade_value_status, detail: { reason: `world_import_value_${cell.trade_value_status}`, absence_is_not_zero: true } };
  const value = Number(cell.trade_value);
  if (!Number.isFinite(value) || value < 0) return { ...empty, ...base, outcome: 'absent', observation_id: cell.id, cell_status: 'invalid', detail: { reason: 'world_import_value_not_a_usable_number' } };
  return { ...empty, ...base, outcome: value === 0 ? 'observed_zero' : 'observed', observation_id: cell.id, cell_status: cell.trade_value_status, value, detail: { reason: 'observed_world_import_value' } };
}

/** Statuses the period walk's decisions map onto, so acquisition and run state stay coherent. */
const DECISION_STATUS: Record<string, CountryScreeningStatus> = {
  needs_probe: 'pending_fallback',
  exhausted: 'insufficient_evidence',
  blocked_suppressed: 'suppressed',
  blocked_provider_failure: 'failed',
  blocked_incompatible: 'incompatible',
};

/**
 * Decide one country's period and status from persisted evidence alone.
 *
 * The walk itself lives in `selectCountryPeriod`; this function only supplies what each year
 * said and translates the verdict into a screening status. Keeping the two apart is what makes
 * the semantics unit-testable without a database.
 */
async function resolveScreeningResult(run: ScreeningRun, result: ScreeningResult, policy: CountryScreeningPolicy, periodPolicy: CountryPeriodSelectionPolicy): Promise<ResolvedScreening> {
  const preferred = run.screening_period;
  const probes: Record<number, PeriodProbeOutcome> = {};
  const detail: Record<number, PeriodProbe> = {};
  for (let lag = 0; lag <= periodPolicy.max_fallback_lookback_years; lag++) {
    const period = preferred - lag;
    // A provider failure is a fact about THIS execution, not the warehouse, so it is re-asserted
    // rather than re-derived away as absence. It is asserted at the year that ACTUALLY failed —
    // `next_probe_period` — because a failure can occur at any year in the walk, and pinning it
    // to the preferred year would lose the walk's position and re-buy a known-absent year.
    if (result.screening_status === 'failed' && result.error && period === (result.next_probe_period ?? preferred)) { probes[period] = 'failed'; detail[period] = { outcome: 'failed', evidence_id: null, observation_id: null, retrieved_at: null, value: null, cell_status: null, detail: { reason: 'provider_acquisition_failed', error: result.error } }; break; }
    const probe = await probePeriod(run, result, period, policy, periodPolicy);
    probes[period] = probe.outcome;
    detail[period] = probe;
    if (probe.outcome !== 'absent' && probe.outcome !== 'incompatible') break;
  }

  const selection = selectCountryPeriod({ preferred_period: preferred, probes, policy: periodPolicy });
  const chosen = selection.selected_period == null ? null : detail[selection.selected_period] ?? null;
  const shared = {
    preferred_period: preferred,
    period_lag: selection.period_lag,
    evidence_confidence: selection.evidence_confidence,
    freshness_state: selection.freshness_state,
    next_probe_period: selection.next_probe_period,
    evidence: { period_probes: selection.considered.map(row => ({ ...row, ...detail[row.period]?.detail, evidence_id: detail[row.period]?.evidence_id ?? null })), selection_reason: selection.reason, decision: selection.decision },
  };

  if (selection.decision === 'selected' && chosen) {
    const meetsMinimum = (chosen.value ?? 0) >= policy.minimum_import_value_usd;
    return { ...shared, screening_status: meetsMinimum ? 'eligible' : 'below_minimum_demand', import_value: chosen.value, import_value_status: chosen.cell_status, observation_period: selection.selected_period, source_evidence_id: chosen.evidence_id, observation_id: chosen.observation_id, evidence_retrieved_at: chosen.retrieved_at, decision_reason: meetsMinimum ? selection.reason : `${selection.reason}_below_minimum` };
  }
  const blocking = selection.considered.at(-1);
  const blockingProbe = blocking ? detail[blocking.period] : null;
  // A year we hold but consider too old to trust keeps its own signal rather than collapsing
  // into the generic "waiting on evidence" state; both are acquirable, but only one says why.
  const blockedReason = (blockingProbe?.detail as { reason?: string } | undefined)?.reason;
  const status = selection.decision === 'needs_probe' && blockedReason === 'evidence_older_than_freshness_requirement' ? 'stale' as const : DECISION_STATUS[selection.decision] ?? 'unavailable';
  return { ...shared, screening_status: status, import_value: null, import_value_status: blockingProbe?.cell_status ?? null, observation_period: null, source_evidence_id: blockingProbe?.evidence_id ?? null, observation_id: null, evidence_retrieved_at: blockingProbe?.retrieved_at ?? null, decision_reason: selection.reason };
}

/** Rank the eligible results and mark the shortlist. Deterministic; ties never depend on order. */
function applyRanking(results: Array<ScreeningResult & { resolved: ResolvedScreening }>, policy: CountryScreeningPolicy) {
  const eligible = results.filter(row => row.resolved.screening_status === 'eligible');
  const ranked = rankScreeningCandidates(eligible.map(row => ({ reporter_code: row.reporter_code, import_value: row.resolved.import_value as number, evidence_confidence: row.resolved.evidence_confidence ?? 1, period_lag: row.resolved.period_lag ?? 0 })), policy);
  const size = shortlistSize(ranked.length, policy);
  const byReporter = new Map(ranked.map(row => [row.reporter_code, row]));
  return results.map(row => {
    const rank = byReporter.get(row.reporter_code);
    const shortlisted = rank != null && rank.screening_rank <= size;
    return {
      ...row,
      screening_score: rank?.screening_score ?? null,
      selection_score: rank?.selection_score ?? null,
      screening_rank: rank?.screening_rank ?? null,
      shortlisted,
      decision_reason: rank == null ? `not_shortlisted_${row.resolved.screening_status}` : shortlisted ? 'shortlisted_top_screening_rank' : `not_shortlisted_rank_${rank.screening_rank}_beyond_target_${size}`,
    };
  });
}

/**
 * Re-derive every country's status from persisted evidence. No provider call is possible from
 * this path, which is what makes a dry global screen safe to run against staging. It is not
 * strictly read-only: materializing current-version observations for evidence that predates the
 * normalization version writes new immutable rows (it never mutates existing ones).
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
  const policy = policyOf(run), periodPolicy = periodPolicyOf(run);
  const resolved: Array<ScreeningResult & { resolved: ResolvedScreening }> = [];
  for (const result of [...run.results].sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code))) {
    resolved.push({ ...result, resolved: await resolveScreeningResult(run, result, policy, periodPolicy) });
  }
  const ranked = applyRanking(resolved, policy);
  for (const row of ranked) {
    await prisma.countryScreeningResult.update({
      where: { id: row.id },
      data: {
        screening_status: row.resolved.screening_status, screening_score: row.screening_score, selection_score: row.selection_score, screening_rank: row.screening_rank,
        import_value: row.resolved.import_value == null ? null : new Prisma.Decimal(row.resolved.import_value),
        import_value_status: row.resolved.import_value_status, observation_period: row.resolved.observation_period,
        preferred_period: row.resolved.preferred_period, period_lag: row.resolved.period_lag,
        evidence_confidence: row.resolved.evidence_confidence, next_probe_period: row.resolved.next_probe_period,
        freshness_state: row.resolved.freshness_state, source_evidence_id: row.resolved.source_evidence_id,
        observation_id: row.resolved.observation_id, evidence_retrieved_at: row.resolved.evidence_retrieved_at,
        shortlisted: row.shortlisted, decision_reason: row.decision_reason,
        provenance: json({ ...((row.provenance as Record<string, unknown> | null) ?? {}), resolution_reason: row.resolved.decision_reason, resolution_evidence: row.resolved.evidence, normalization_version: policy.required_normalization_version, parser_version: policy.required_parser_version, screening_algorithm_version: policy.screening_algorithm_version, period_selection_policy_version: periodPolicy.policy_version, preferred_period: row.resolved.preferred_period, selected_period: row.resolved.observation_period, period_lag: row.resolved.period_lag, evidence_confidence: row.resolved.evidence_confidence }),
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

/**
 * The attempt budget is per country PER CANDIDATE PERIOD.
 *
 * A fallback walk spends one attempt per year it inspects, so a flat per-country cap would
 * exhaust a lagging market before it ever reached the year it actually reported — which is the
 * exact failure Phase 1G exists to remove.
 */
function attemptBudget(policy: CountryScreeningPolicy, periodPolicy: CountryPeriodSelectionPolicy) {
  return policy.max_acquisition_attempts_per_country * (periodPolicy.max_fallback_lookback_years + 1);
}

function acquisitionCandidates(run: ScreeningRun, policy: CountryScreeningPolicy, periodPolicy: CountryPeriodSelectionPolicy) {
  const budget = attemptBudget(policy, periodPolicy);
  const required: ScreeningResult[] = [], exhausted: ScreeningResult[] = [];
  for (const result of [...run.results].sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code))) {
    if (!ACQUIRABLE_SCREENING_STATUSES.includes(result.screening_status as CountryScreeningStatus)) continue;
    if (result.attempts >= budget) exhausted.push(result);
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
  const { required, exhausted } = acquisitionCandidates(run, policy, periodPolicyOf(run));
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
  const initial = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId } });
  const periodPolicy = periodPolicyOf(initial);
  // One wave per candidate period. A market drops out of the next wave the moment it has a
  // usable answer, so the preferred year is asked of everyone and each fallback year is asked
  // only of the markets still unresolved — never of all 218.
  const maxWaves = periodPolicy.max_fallback_lookback_years + 1;
  let deferredOnQuota = false;
  // Carried across waves and re-applied AFTER the final resolve. Re-resolving over them would
  // silently downgrade unattempted and failed work to a terminal state and let the run freeze.
  const deferredIds = new Set<string>(), failures = new Map<string, string>();

  for (let wave = 0; wave < maxWaves; wave++) {
    await resolveGlobalCountryScreeningRun(runId);
    const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
    const policy = policyOf(run);
    // A market that already failed in THIS execution is not retried by a later wave: a failure
    // blocks the period walk rather than advancing it, so asking again would burn the market's
    // whole attempt budget inside one run instead of leaving it retryable.
    const { required: allRequired } = acquisitionCandidates(run, policy, periodPolicy);
    const required = allRequired.filter(result => !failures.has(result.id));
    if (!required.length) break;
    const allowance = await availableProviderRequestAllowance(run.source_mode);
    const partial = options.allow_partial_execution ?? run.allow_partial_execution;

    if (required.length > allowance && !partial) {
      for (const result of required) await prisma.countryScreeningResult.update({ where: { id: result.id }, data: { screening_status: 'deferred_quota', decision_reason: 'not_shortlisted_deferred_quota', shortlisted: false, screening_rank: null, screening_score: null, selection_score: null } });
      await prisma.countryScreeningRun.update({ where: { id: run.id }, data: { status: 'deferred_quota', quota_snapshot: json(await estimateGlobalCountryScreeningQuota(run.id)) } });
      return summarize(run.id, spent.physical_calls);
    }

    if (run.status !== 'executing') await prisma.countryScreeningRun.update({ where: { id: run.id }, data: { status: 'executing' } });
    const executable = required.slice(0, partial ? allowance : required.length);
    const deferred = required.slice(executable.length);
    if (!executable.length) { deferredOnQuota = true; for (const result of deferred) deferredIds.add(result.id); break; }

    for (const result of executable) {
      await prisma.countryScreeningResult.update({ where: { id: result.id }, data: { attempts: { increment: 1 }, last_attempted_at: new Date(), error: null } });
      const outcome = await runComtradeIngest({
        job_id: `country-screening:${result.id}:${result.next_probe_period ?? run.screening_period}`, attempt_no: result.attempts + 1,
        // The year the period walk is waiting on — NOT the run-wide preferred period. Fetching
        // one year and resolving against another writes evidence under a fingerprint nothing
        // reads, burning quota and leaving the market permanently unresolved.
        payload: { hs_chapter: run.hs_code.slice(0, 2), hs_codes: [run.hs_code], reporter: result.reporter_code, partner: policy.world_partner_code, year: result.next_probe_period ?? run.screening_period, flow_direction: 'import', hs_revision: run.hs_revision, frequency: 'A', partner2: SCREENING_PARTNER2_CODE, customs_code: SCREENING_CUSTOMS_CODE, mode_of_supply: SCREENING_MODE_OF_SUPPLY, purpose: 'country_truth' },
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
    if (deferred.length) { deferredOnQuota = true; for (const result of deferred) deferredIds.add(result.id); }
    if (deferredOnQuota) break;

    spent.physical_calls = 0; // already folded into the run counter for this wave
  }

  await resolveGlobalCountryScreeningRun(runId);
  const usable = new Set<string>(['eligible', 'below_minimum_demand']);
  for (const resultId of deferredIds) await prisma.countryScreeningResult.update({ where: { id: resultId }, data: { screening_status: 'deferred_quota', decision_reason: 'not_shortlisted_deferred_quota', shortlisted: false, screening_rank: null, screening_score: null, selection_score: null } });
  for (const [resultId, error] of failures) {
    const current = await prisma.countryScreeningResult.findUniqueOrThrow({ where: { id: resultId } });
    if (usable.has(current.screening_status)) { await prisma.countryScreeningResult.update({ where: { id: resultId }, data: { error } }); continue; }
    await prisma.countryScreeningResult.update({ where: { id: resultId }, data: { screening_status: 'failed', decision_reason: 'not_shortlisted_failed', shortlisted: false, screening_rank: null, screening_score: null, selection_score: null, error } });
  }
  const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, include: { results: true } });
  const policy = policyOf(run);
  const openStatuses = new Set<string>(RETRYABLE_SCREENING_STATUSES);
  const open = run.results.filter(row => openStatuses.has(row.screening_status) && row.attempts < attemptBudget(policy, periodPolicy));
  const stillDeferred = run.results.some(row => row.screening_status === 'deferred_quota');
  const status = open.length === 0 ? COMPLETED : stillDeferred ? 'deferred_quota' : 'partial';
  const totals = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId }, select: { physical_call_count: true } });
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
  spent.physical_calls = totals.physical_call_count - initial.physical_call_count;
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
  /** Screening score discounted by evidence age — what the ranking actually ordered on. */
  selection_score: string;
  import_value: string;
  /** The year this market's value came from. May differ per market. */
  observation_period: number | null;
  preferred_period: number | null;
  period_lag: number | null;
  freshness_state: string;
  evidence_confidence: string | null;
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
    selection_score: row.selection_score?.toString() ?? '0',
    import_value: row.import_value?.toString() ?? '0', observation_period: row.observation_period,
    preferred_period: row.preferred_period, period_lag: row.period_lag, freshness_state: row.freshness_state,
    evidence_confidence: row.evidence_confidence?.toString() ?? null,
    source_evidence_id: row.source_evidence_id, observation_id: row.observation_id,
  }));
}

/** Candidate reporter codes for `CountryEvidencePlanner`, deterministically ordered. */
export async function screeningShortlistReporters(runId: string): Promise<string[]> {
  return (await globalCountryScreeningShortlist(runId)).map(candidate => candidate.reporter_code);
}

/**
 * Hand the shortlist to the EXISTING deep planner, carrying each market's own analysis window.
 *
 * There is still no second deep-analysis implementation to choose between; the only thing that
 * changed in Phase 1G is that Stage A now also knows WHICH YEAR each market should be analysed
 * through, and passes it. A market selected on 2023 evidence is planned across 2019-2023 rather
 * than being asked again for a 2025 it never filed — which is what previously guaranteed it
 * would fail deep analysis for exactly the reason it was shortlisted late.
 *
 * The Agent never chooses a period: the window is derived from the market's own selected year
 * and the deep policy's history length.
 */
export async function planDeepCountryTruthFromScreening(runId: string, options: { as_of_date?: Date; allow_provisional_shortlist?: boolean } = {}) {
  const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: runId } });
  // Deep analysis costs roughly eleven provider calls per market. Handing it a shortlist that
  // is still moving would spend that budget on an answer the next execution may change, which
  // is the exact waste Stage A exists to prevent — so an incomplete screen must say so out loud.
  if (run.status !== COMPLETED && !options.allow_provisional_shortlist) throw new Error(`Country screening run ${runId} is ${run.status}; deep Country Truth needs a completed screen, or an explicit provisional handoff.`);
  const shortlist = await globalCountryScreeningShortlist(runId);
  const reporters = shortlist.map(candidate => candidate.reporter_code);
  if (!reporters.length) throw new Error(`Country screening run ${runId} shortlisted no markets; deep Country Truth has nothing to acquire.`);
  const evidencePolicy = await getConfig('country_evidence.policy');
  const windows = Object.fromEntries(shortlist.map(candidate => {
    const selected = candidate.observation_period;
    if (selected == null) throw new Error(`Shortlisted market ${candidate.country_code} has no selected observation period; deep planning would have to guess one.`);
    return [candidate.reporter_code, analysisWindowFor(selected, evidencePolicy.history_years)];
  }));
  return createCountryEvidencePlan({ product_classification_id: run.product_classification_id, as_of_date: options.as_of_date ?? run.as_of_date, candidate_reporters: reporters, source_mode: plannedSourceMode(run.source_mode), reporter_period_windows: windows, preferred_period: run.screening_period });
}
