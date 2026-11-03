/**
 * Phase 1 acceptance gate — the pure evaluator (docs/34), policy v2: Demand Discovery v5 runs only.
 *
 * Takes evidence that `load.ts` read from finished staging runs (plain JSON — no Prisma types, no
 * clock reads, no IO) and decides, per archetype and overall, whether the gate passes. The same
 * input always yields a byte-identical report: `evaluated_at` is an argument, every collection is
 * ordered, and `stableJson` sorts keys.
 *
 * Three rules shape every check here:
 *   1. **Fail closed, with a named reason.** Evidence that cannot be found, read or matched is a
 *      failure that says what was missing — never a skip and never a silent pass.
 *   2. **Unverifiable is not passing.** Anything the data cannot establish (an operator-attested
 *      probe that was not supplied, for example) is `unverified`, and an unverified check makes
 *      the whole gate INCOMPLETE rather than PASS.
 *   3. **A machine verdict never freezes Phase 1.** `phase_1_frozen` is always false; freezing
 *      needs approved thresholds AND named human sign-off recorded outside this module.
 *
 * A run from any engine but v5 fails `engine.v5_only` and is not evaluated further (D-036).
 */
import { canonicalHash } from '@/lib/country-evidence/planner';
import { dutyBasisOf, DUTY_BASES, type DutyBasis } from '@/lib/demand-discovery-v5/duty-basis';
import type { MetricResult } from '@/lib/demand-discovery-v5/metrics';
import { MISS_EXPLANATION_TEXT, type MissExplanation } from '@/lib/demand-discovery-v5/calibration';
import { policyHash, type DemandDiscoveryV5Policy, type MetricKey } from '@/lib/demand-discovery-v5/policy';
import { rankMarkets, scoreMarket, type MarketScoreInput, type ScoredMarket } from '@/lib/demand-discovery-v5/score';
import {
  normalizeHsRevision,
  phase1GatePolicyApproved,
  phase1GatePolicyHash,
  unapprovedPhase1GateDecisions,
  type Phase1GateArchetype,
  type Phase1GateDecisionKey,
  type Phase1GatePolicy,
} from './policy';

/** The four statuses a v5 assessment can carry (docs/36 §5). */
export const V5_MARKET_STATUSES = ['ranked', 'not_enough_data', 'no_recorded_demand', 'excluded'] as const;
const SCORED_STATUSES: readonly string[] = ['ranked', 'not_enough_data'];
/** Metric bases that are estimates (metrics.ts): a duty from tariff averages, logistics from shipping connectivity. */
export const ESTIMATE_BASES: readonly string[] = ['estimate', 'lsci_estimate'];
/** The label a market measured only from its partners' figures carries (explain.ts). */
export const PARTNER_FIGURES_LABEL = 'estimated_from_partners';

// ---------------------------------------------------------------------------
// Evidence — what load.ts reads from one run
// ---------------------------------------------------------------------------

export interface GateMetricEvidence {
  key: string;
  score: number | null;
  quality: number;
  reason: string | null;
  estimated: boolean;
  inputs: Record<string, unknown>;
}

export interface GateMarketEvidence {
  assessment_id: string;
  country_code: string;
  model_version: string;
  classification_id: string | null;
  scoring_policy_hash: string | null;
  market_status: string | null;
  rank: number | null;
  overall_score: number | null;
  live_points: number | null;
  data_year: number | null;
  confidence_score: number;
  handed_off: boolean;
  /** Why the market is excluded, from `eligibility_reasons`; null when it is not. */
  excluded_reason: string | null;
  flag_reasons: string[];
  label_keys: string[];
  /** `score_breakdown` as stored, read defensively; null when the row has none. */
  breakdown: {
    overall_exact: number | null;
    quality: number | null;
    confidence: number | null;
    lag: number | null;
    has_shortfall: boolean;
    partner_only: boolean | null;
    metrics: GateMetricEvidence[];
  } | null;
}

/** The docs/36 §8 comparison of the run's top with India's own largest destinations. */
export interface GateCalibrationEvidence {
  status: 'computed' | 'error';
  error: string | null;
  baci_release_id: string | null;
  years: number[];
  top: number;
  india_top: { market: string; usd: number; status: string | null; rank: number | null }[];
  run_top: { market: string; rank: number }[];
  overlap: number;
  /** E-045: each miss carries why the run may rightly rank it low, when it may. */
  missed: { market: string; status: string | null; rank: number | null; explained_by?: MissExplanation | null }[];
}

export interface GateRunEvidence {
  id: string;
  model_version: string | null;
  status: string;
  trigger: string | null;
  classification_id: string | null;
  /** The HS6 frozen into the run's input snapshot. */
  input_hs6: string | null;
  job_id: string | null;
  job_status: string | null;
  as_of_date: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  scoring_policy_hash: string | null;
  /** The v5 policy the run stored (`scoring_policy_snapshot`), exactly as read. */
  scoring_policy_snapshot: unknown;
  frozen: {
    schema_version: string | null;
    policy_version: string | null;
    policy_hash: string | null;
    universe_version: string | null;
    universe_size: number | null;
    baci_release_id: string | null;
    base_years: number[];
  };
  /** What the run said is missing or degraded (`summary.notes`). */
  notes: string[];
  summary_markets: number | null;
}

export interface GateArchetypeEvidence {
  archetype_key: string;
  /** `product:<id>` or `run:<id>`. */
  selector: string;
  selection_note: string;
  load_errors: string[];
  product: { id: string; exporter_org_id: string; hs_code: string | null } | null;
  classification: {
    id: string;
    revision: number;
    hs6_code: string;
    nomenclature_version: string;
    status: string;
    confirmed_by_id: string | null;
    confirmed_by_role: string | null;
    confirmed_at: string | null;
    superseded_at: string | null;
    confirmation_audit_event_ids: string[];
  } | null;
  run: GateRunEvidence | null;
  markets: GateMarketEvidence[];
  calibration: GateCalibrationEvidence | null;
}

/**
 * One operator-attested negative probe. The evaluator checks that the record is complete and that
 * the recorded outcome is a fail-closed one; it cannot check that the probe really happened, which
 * is why every probe names a staging observation or CI test someone else can re-read.
 */
export interface GateNegativeProbe {
  id: string;
  method: 'staging_observation' | 'ci_test';
  reference: string;
  observed_at: string;
  outcome: 'refused' | 'failed_closed' | 'reported_unavailable';
  recorded_by: string;
  notes?: string;
}

export interface GateEnvironment {
  app_env: string;
  database_environment: string | null;
  /** First 12 hex characters of the DATABASE_URL identity fingerprint — enough to tell databases apart, not the pin itself. */
  database_fingerprint_prefix: string | null;
  git_commit: string | null;
}

export interface Phase1GateInput {
  policy: Phase1GatePolicy;
  evidence: GateArchetypeEvidence[];
  negative_probes: GateNegativeProbe[] | null;
  evaluated_at: Date;
  environment: GateEnvironment;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type GateCheckStatus = 'pass' | 'fail' | 'unverified' | 'not_required' | 'manual';

export interface GateCheck {
  id: string;
  dimension: Phase1GateDecisionKey | 'evidence_load';
  status: GateCheckStatus;
  detail: string;
  reasons: string[];
}

export type GateVerdict = 'PASS' | 'PASS_UNDER_PROPOSED_POLICY' | 'FAIL' | 'INCOMPLETE';

export interface GateMarketReport {
  country_code: string;
  assessment_id: string;
  market_status: string | null;
  rank: number | null;
  overall_score: number | null;
  live_points: number | null;
  data_year: number | null;
  duty_basis: DutyBasis;
  /** Metrics scored from an estimate, and `partner_figures` for a market measured from its partners' reports. */
  estimated: string[];
  /** Metrics without a score, each with the reason the run gave. */
  unscored: { metric: string; reason: string | null }[];
  flag_reasons: string[];
  /** Every failed-check reason that names this market. */
  problems: string[];
}

export interface GateArchetypeReport {
  archetype_key: string;
  label: string;
  hs6: string;
  selector: string | null;
  selection_note: string | null;
  result: 'pass' | 'fail' | 'unverified';
  identities: {
    product_id: string | null;
    classification_id: string | null;
    classification_revision: number | null;
    classification_confirmed_by_role: string | null;
    classification_confirmed_at: string | null;
    discovery_run_id: string | null;
    job_id: string | null;
    model_version: string | null;
    scoring_policy_version: string | null;
    scoring_policy_hash: string | null;
    baci_release_id: string | null;
    universe_version: string | null;
  };
  run: {
    status: string | null;
    trigger: string | null;
    as_of_date: string | null;
    created_at: string | null;
    completed_at: string | null;
    elapsed_seconds: number | null;
    base_years: number[];
    notes: string[];
  };
  counts: {
    universe_markets: number | null;
    assessed_markets: number;
    ranked: number;
    not_enough_data: number;
    no_recorded_demand: number;
    excluded: number;
    official_duty_in_top: number;
  };
  calibration: {
    top: number;
    years: number[];
    india_top: string[];
    run_top: string[];
    overlap: number;
    missed: { market: string; status: string | null; rank: number | null; explained_by?: MissExplanation | null }[];
  } | null;
  checks: GateCheck[];
  markets: GateMarketReport[];
}

export interface Phase1GateReport {
  schema_version: 'phase-1-gate-report-v2';
  verdict: GateVerdict;
  /** Always false: a machine verdict never freezes Phase 1 on its own. */
  phase_1_frozen: false;
  evaluated_at: string;
  policy: {
    policy_version: string;
    policy_hash: string;
    approved: boolean;
    unapproved_decisions: Phase1GateDecisionKey[];
    approval: Phase1GatePolicy['approval'];
  };
  environment: GateEnvironment;
  summary: {
    archetypes_required: number;
    archetypes_passed: number;
    failed_checks: string[];
    unverified_checks: string[];
  };
  programme_checks: GateCheck[];
  archetypes: GateArchetypeReport[];
  report_checksum: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function check(id: string, dimension: GateCheck['dimension'], status: GateCheckStatus, detail: string, reasons: string[] = []): GateCheck {
  return { id, dimension, status, detail, reasons };
}

function passOrFail(id: string, dimension: GateCheck['dimension'], reasons: string[], passDetail: string, failDetail: string) {
  return reasons.length ? check(id, dimension, 'fail', failDetail, reasons) : check(id, dimension, 'pass', passDetail);
}

function validIso(value: string | null | undefined): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** Whole days from `earlier` to `later`, or null when either is not a valid timestamp. */
function ageDays(later: string | null, earlier: string | null): number | null {
  if (!validIso(later) || !validIso(earlier)) return null;
  return Math.floor((Date.parse(later) - Date.parse(earlier)) / DAY_MS);
}

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

/** "reason: n" lines, most frequent first, for summarising many markets at once. */
function tally(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => `${value}: ${count}`);
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Deterministic, human-readable JSON: keys sorted at every depth, two-space indent, trailing newline. */
export function stableJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>)
          .sort()
          .map((key) => [key, sort((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return `${JSON.stringify(sort(value), null, 2)}\n`;
}

const isScored = (market: GateMarketEvidence) => SCORED_STATUSES.includes(market.market_status ?? '');
const dutyOf = (market: GateMarketEvidence): DutyBasis => dutyBasisOf({ metrics: market.breakdown?.metrics ?? [] }).basis;
const byRank = (left: GateMarketEvidence, right: GateMarketEvidence) => (left.rank ?? Infinity) - (right.rank ?? Infinity) || left.country_code.localeCompare(right.country_code);

/** The stored v5 policy, or null when the run stored nothing usable. */
function storedPolicy(run: GateRunEvidence): DemandDiscoveryV5Policy | null {
  const snapshot = record(run.scoring_policy_snapshot);
  return snapshot && record(snapshot.points) && record(snapshot.parts) && record(snapshot.ranking) ? (snapshot as unknown as DemandDiscoveryV5Policy) : null;
}

// ---------------------------------------------------------------------------
// Market-level findings, each reason prefixed with the market's code
// ---------------------------------------------------------------------------

/** No silent zeros: every value either rests on evidence or states why there is none. */
function silentZeroProblems(market: GateMarketEvidence, expectedMetrics: string[], requireReason: boolean): string[] {
  const code = market.country_code;
  const problems: string[] = [];
  if (isScored(market)) {
    if (market.overall_score == null) problems.push(`${code}:scored_market_without_overall`);
    if (market.live_points == null) problems.push(`${code}:live_points_missing`);
    if (market.market_status === 'ranked' && market.rank == null) problems.push(`${code}:ranked_without_rank`);
    if (market.market_status === 'not_enough_data' && market.rank != null) problems.push(`${code}:unranked_market_has_rank`);
    if (!market.breakdown) return [...problems, `${code}:score_breakdown_missing`];
    if (market.market_status === 'not_enough_data' && !market.breakdown.has_shortfall) problems.push(`${code}:not_enough_data_without_shortfall`);
    const seen = new Map<string, number>();
    for (const metric of market.breakdown.metrics) {
      seen.set(metric.key, (seen.get(metric.key) ?? 0) + 1);
      if (expectedMetrics.length && !expectedMetrics.includes(metric.key)) problems.push(`${code}:${metric.key}_not_in_policy`);
      if (metric.score == null) {
        if (requireReason && !metric.reason?.trim()) problems.push(`${code}:${metric.key}_unscored_without_reason`);
      } else if (!(metric.score >= 0 && metric.score <= 100)) problems.push(`${code}:${metric.key}_score_outside_0_100`);
    }
    for (const key of expectedMetrics) {
      const count = seen.get(key) ?? 0;
      if (count === 0) problems.push(`${code}:${key}_missing`);
      else if (count > 1) problems.push(`${code}:${key}_appears_${count}_times`);
    }
    return problems;
  }
  if (market.overall_score != null) problems.push(`${code}:${market.market_status ?? 'unknown'}_market_scored`);
  if (market.rank != null) problems.push(`${code}:${market.market_status ?? 'unknown'}_market_ranked`);
  if (market.market_status === 'excluded' && !market.excluded_reason?.trim()) problems.push(`${code}:excluded_without_reason`);
  return problems;
}

/** Actual data or a labelled estimate (D-037). */
function labelProblems(market: GateMarketEvidence): string[] {
  if (!isScored(market) || !market.breakdown) return [];
  const problems: string[] = [];
  for (const metric of market.breakdown.metrics) {
    if (metric.score == null) continue;
    const basis = typeof metric.inputs.basis === 'string' ? metric.inputs.basis : null;
    if (basis && ESTIMATE_BASES.includes(basis) && !metric.estimated) problems.push(`${market.country_code}:${metric.key}_estimate_not_labelled`);
  }
  if (market.breakdown.partner_only === true && !market.label_keys.includes(PARTNER_FIGURES_LABEL)) problems.push(`${market.country_code}:partner_figures_not_labelled`);
  return problems;
}

function estimatedOf(market: GateMarketEvidence): string[] {
  const keys = (market.breakdown?.metrics ?? [])
    .filter((metric) => metric.score != null && (metric.estimated || (typeof metric.inputs.basis === 'string' && ESTIMATE_BASES.includes(metric.inputs.basis))))
    .map((metric) => metric.key);
  if (market.breakdown?.partner_only === true) keys.push('partner_figures');
  return sortedUnique(keys);
}

// ---------------------------------------------------------------------------
// Repeatability: the stored policy re-hashes; the stored metrics re-score
// ---------------------------------------------------------------------------

function policyHashProblems(run: GateRunEvidence, markets: GateMarketEvidence[], policy: DemandDiscoveryV5Policy | null): string[] {
  if (!policy) return ['stored_policy_snapshot_missing_or_unreadable'];
  let computed: string;
  try {
    computed = policyHash(policy);
  } catch {
    return ['stored_policy_snapshot_cannot_be_hashed'];
  }
  const problems: string[] = [];
  if (run.scoring_policy_hash !== computed) problems.push('run_policy_hash_does_not_match_its_stored_policy');
  if (run.frozen.policy_hash !== computed) problems.push('frozen_inputs_policy_hash_does_not_match_the_stored_policy');
  if (run.frozen.policy_version !== policy.policy_version) problems.push('frozen_inputs_policy_version_does_not_match_the_stored_policy');
  const others = markets.filter((market) => market.scoring_policy_hash !== computed).length;
  if (others) problems.push(`${others}_assessment(s)_carry_another_policy_hash`);
  return problems;
}

function replayInput(market: GateMarketEvidence): MarketScoreInput {
  const gate = { excluded_reason: null as string | null, no_recorded_demand: false, flag_reasons: market.flag_reasons };
  if (market.market_status === 'excluded') return { market: market.country_code, gate: { ...gate, excluded_reason: market.excluded_reason?.trim() || 'excluded' }, metrics: [], data_year: null };
  if (market.market_status === 'no_recorded_demand') return { market: market.country_code, gate: { ...gate, no_recorded_demand: true }, metrics: [], data_year: market.data_year };
  const metrics: MetricResult[] = (market.breakdown?.metrics ?? []).map((metric) => ({
    key: metric.key as MetricKey,
    score: metric.score,
    quality: metric.quality,
    reason: metric.reason,
    inputs: metric.inputs as MetricResult['inputs'],
    ...(metric.estimated ? { estimated: true } : {}),
  }));
  return { market: market.country_code, gate, metrics, data_year: market.data_year };
}

const same = (left: number | null, right: number | null) => (left == null ? right == null : right != null && left === right);

/** Re-scores every market from its stored metrics under the stored policy and names each difference. */
function replayProblems(markets: GateMarketEvidence[], policy: DemandDiscoveryV5Policy | null): string[] {
  if (!policy) return ['stored_policy_snapshot_missing_or_unreadable'];
  const problems: string[] = [];
  const scored: ScoredMarket[] = [];
  for (const market of markets) {
    if (!V5_MARKET_STATUSES.includes(market.market_status as (typeof V5_MARKET_STATUSES)[number])) {
      problems.push(`${market.country_code}:status_${market.market_status ?? 'missing'}_cannot_be_replayed`);
      continue;
    }
    try {
      scored.push(scoreMarket(replayInput(market), policy));
    } catch (error) {
      problems.push(`${market.country_code}:replay_error:${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problems.length) return [...problems, 'ranks_not_replayed_because_some_markets_could_not_be_scored'];
  let ranked: ScoredMarket[];
  try {
    ranked = rankMarkets(scored, policy);
  } catch (error) {
    return [`rank_replay_error:${error instanceof Error ? error.message : String(error)}`];
  }
  const replayed = new Map(ranked.map((market) => [market.market, market]));
  for (const market of markets) {
    const again = replayed.get(market.country_code);
    if (!again) continue;
    const code = market.country_code;
    const differ = (field: string, value: unknown, stored: unknown) => problems.push(`${code}:${field}_replays_as_${String(value)}_stored_${String(stored)}`);
    if (again.status !== market.market_status) differ('status', again.status, market.market_status);
    if (!same(again.overall, market.overall_score)) differ('overall', again.overall, market.overall_score);
    if (!same(again.rank, market.rank)) differ('rank', again.rank, market.rank);
    if (again.handed_off !== market.handed_off) differ('handed_off', again.handed_off, market.handed_off);
    const confidenceScore = again.confidence == null ? 0 : Math.round(again.confidence * 100);
    if (confidenceScore !== market.confidence_score) differ('confidence_score', confidenceScore, market.confidence_score);
    if (isScored(market)) {
      if (!same(again.live_points, market.live_points)) differ('live_points', again.live_points, market.live_points);
      if (!same(again.overall_exact, market.breakdown?.overall_exact ?? null)) differ('overall_exact', again.overall_exact, market.breakdown?.overall_exact ?? null);
      if (!same(again.confidence, market.breakdown?.confidence ?? null)) differ('confidence', again.confidence, market.breakdown?.confidence ?? null);
      if (!same(again.lag, market.breakdown?.lag ?? null)) differ('lag', again.lag, market.breakdown?.lag ?? null);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Archetype-level evaluation
// ---------------------------------------------------------------------------

function classificationChecks(evidence: GateArchetypeEvidence, archetype: Phase1GateArchetype, policy: Phase1GatePolicy): GateCheck[] {
  const c = evidence.classification;
  if (!c) return [check('classification.present', 'classification', 'fail', 'No classification could be resolved for this archetype.', ['classification_missing'])];
  const rules = policy.classification.value;
  const confirmed: string[] = [];
  if (c.status !== 'confirmed') confirmed.push(`classification_status_${c.status}`);
  if (rules.require_human_confirmation && (!c.confirmed_by_id || !validIso(c.confirmed_at))) confirmed.push('classification_not_human_confirmed');
  if (c.superseded_at) confirmed.push('classification_superseded');
  const role: string[] = [];
  if (!c.confirmed_by_role || !rules.allowed_confirmer_roles.includes(c.confirmed_by_role)) role.push(`classification_confirmer_role_${c.confirmed_by_role ?? 'unknown'}`);
  const audit = c.confirmation_audit_event_ids.length ? [] : ['classification_confirmation_audit_event_missing'];
  const match: string[] = [];
  if (c.hs6_code !== archetype.hs6) match.push(`classification_hs6_${c.hs6_code}_is_not_archetype_${archetype.hs6}`);
  if (normalizeHsRevision(c.nomenclature_version) !== normalizeHsRevision(archetype.hs_revision)) {
    match.push(`classification_revision_${c.nomenclature_version}_is_not_${archetype.hs_revision}`);
  }
  if (evidence.run && evidence.run.classification_id !== c.id) match.push('run_was_not_produced_for_this_classification');
  if (evidence.run && evidence.run.input_hs6 !== archetype.hs6) match.push(`run_scored_hs6_${evidence.run.input_hs6 ?? 'unknown'}_not_${archetype.hs6}`);
  return [
    passOrFail('classification.confirmed', 'classification', confirmed, `Revision ${c.revision} confirmed at ${c.confirmed_at}.`, 'The classification is not a current human confirmation.'),
    passOrFail('classification.confirmer_role', 'classification', role, `Confirmed by a ${c.confirmed_by_role}.`, 'The confirming user is not a permitted staff role.'),
    passOrFail('classification.audit_event', 'classification', audit, `${c.confirmation_audit_event_ids.length} confirming AuditEvent(s).`, 'No AuditEvent records the confirmation.'),
    passOrFail('classification.matches_archetype', 'archetypes', match, `HS ${c.hs6_code} (${c.nomenclature_version}) matches the archetype and the run.`, 'The classification does not match the archetype or the run.'),
  ];
}

const emptyIdentities = (): GateArchetypeReport['identities'] => ({
  product_id: null, classification_id: null, classification_revision: null, classification_confirmed_by_role: null, classification_confirmed_at: null,
  discovery_run_id: null, job_id: null, model_version: null, scoring_policy_version: null, scoring_policy_hash: null, baci_release_id: null, universe_version: null,
});

function evaluateArchetype(
  archetype: Phase1GateArchetype,
  evidence: GateArchetypeEvidence | undefined,
  policy: Phase1GatePolicy,
  evaluatedAt: string,
): GateArchetypeReport {
  const base = { archetype_key: archetype.key, label: archetype.label, hs6: archetype.hs6 };
  const emptyCounts = { universe_markets: null, assessed_markets: 0, ranked: 0, not_enough_data: 0, no_recorded_demand: 0, excluded: 0, official_duty_in_top: 0 };
  if (!evidence) {
    return {
      ...base, selector: null, selection_note: null, result: 'fail', identities: emptyIdentities(),
      run: { status: null, trigger: null, as_of_date: null, created_at: null, completed_at: null, elapsed_seconds: null, base_years: [], notes: [] },
      counts: emptyCounts, calibration: null,
      checks: [check('archetype.evidence_supplied', 'archetypes', 'fail', 'No staging run was named for this archetype.', [`archetype_evidence_not_supplied:${archetype.key}`])],
      markets: [],
    };
  }

  const run = evidence.run;
  const snapshot = run ? storedPolicy(run) : null;
  const markets = [...evidence.markets].sort((left, right) => left.country_code.localeCompare(right.country_code) || left.assessment_id.localeCompare(right.assessment_id));
  const checks: GateCheck[] = [];
  checks.push(passOrFail('evidence_load.complete', 'evidence_load', [...evidence.load_errors].sort(), 'All run evidence was found.', 'Some run evidence could not be found or read.'));

  const model = policy.engine.value.model_version;
  const engine: string[] = [];
  if (!run) engine.push('no_run_resolved');
  else if (run.model_version !== model) engine.push(`run_engine_${run.model_version ?? 'unrecorded'}_is_not_${model}`);
  const otherEngine = markets.filter((market) => market.model_version !== model).length;
  if (otherEngine) engine.push(`${otherEngine}_assessment(s)_from_another_engine`);
  checks.push(passOrFail('engine.v5_only', 'engine', engine, `The run and its assessments are ${model}.`, `Only ${model} runs are gate evidence; an earlier engine’s run is retired (D-036) and is not evaluated further.`));
  checks.push(...classificationChecks(evidence, archetype, policy));

  const marketReports = new Map<string, string[]>();
  const note = (reasons: string[]) => {
    for (const reason of reasons) {
      const code = /^([A-Z0-9]{2}):/.exec(reason)?.[1];
      if (code) marketReports.set(code, [...(marketReports.get(code) ?? []), reason]);
    }
    return reasons;
  };

  const ranked = markets.filter((market) => market.market_status === 'ranked').sort(byRank);
  const dutyTop = ranked.slice(0, policy.duty_evidence.value.top);
  const officialTop = dutyTop.filter((market) => policy.duty_evidence.value.official_bases.includes(dutyOf(market)));

  if (run && !engine.length) {
    // Run status and its explanation.
    const rules = policy.failure_semantics.value;
    const status: string[] = [];
    if (!rules.accepted_run_statuses.includes(run.status)) status.push(`run_status_${run.status}`);
    if (run.job_status != null && run.job_status !== run.status) status.push(`job_status_${run.job_status}_disagrees_with_run_status_${run.status}`);
    if (run.status === 'partial' && rules.partial_requires_notes && !run.notes.some((item) => item.trim())) status.push('partial_run_without_notes');
    checks.push(passOrFail('failure_semantics.run_status', 'failure_semantics', status, `Run ${run.status}${run.notes.length ? ` with ${run.notes.length} note(s)` : ''}.`, 'The run did not finish in an accepted, explained state.'));

    // Every market of the frozen universe, once, for this classification.
    if (policy.coverage.value.require_every_universe_market) {
      const coverage: string[] = [];
      const size = run.frozen.universe_size;
      if (size == null || size < 1) coverage.push('frozen_universe_size_unknown');
      else if (markets.length !== size) coverage.push(`assessed_${markets.length}_of_${size}_universe_markets`);
      const counts = new Map<string, number>();
      for (const market of markets) counts.set(market.country_code, (counts.get(market.country_code) ?? 0) + 1);
      for (const [code, count] of [...counts.entries()].sort()) if (count > 1) coverage.push(`${code}:assessed_${count}_times`);
      coverage.push(...tally(markets.filter((market) => !V5_MARKET_STATUSES.includes(market.market_status as (typeof V5_MARKET_STATUSES)[number])).map((market) => `market_status_${market.market_status ?? 'missing'}`)));
      const foreign = markets.filter((market) => market.classification_id !== run.classification_id).length;
      if (foreign) coverage.push(`${foreign}_assessment(s)_for_another_classification`);
      if (run.summary_markets != null && run.summary_markets !== markets.length) coverage.push(`run_summary_counts_${run.summary_markets}_markets`);
      checks.push(passOrFail('coverage.every_market', 'coverage', note(coverage), `All ${markets.length} markets of the frozen universe are assessed once.`, 'The run does not cover its frozen universe exactly once.'));
    } else {
      checks.push(check('coverage.every_market', 'coverage', 'not_required', 'Policy does not require every universe market.'));
    }

    const minimum = policy.market_count.value.minimum_ranked_markets;
    checks.push(ranked.length >= minimum
      ? check('market_count.minimum_ranked', 'market_count', 'pass', `${ranked.length} ranked market(s) of ${markets.length} (minimum ${minimum}).`)
      : check('market_count.minimum_ranked', 'market_count', 'fail', `${ranked.length} ranked market(s) of ${markets.length}; ${minimum} required.`, tally(markets.filter((market) => market.market_status !== 'ranked').map((market) => market.market_status ?? 'missing'))));

    // docs/36 §8: the top 10 against India's own largest destinations.
    const calibration = evidence.calibration;
    const top = policy.calibration.value.top;
    if (!calibration) checks.push(check('calibration.india_top_overlap', 'calibration', 'fail', 'No calibration comparison was made.', ['calibration_not_run']));
    else if (calibration.status === 'error') checks.push(check('calibration.india_top_overlap', 'calibration', 'fail', 'The calibration comparison could not be made.', [`calibration_unavailable:${calibration.error ?? 'unknown'}`]));
    else if (calibration.top !== top) checks.push(check('calibration.india_top_overlap', 'calibration', 'fail', `The comparison used a top ${calibration.top}, not the policy’s ${top}.`, ['calibration_top_differs_from_policy']));
    else if (!calibration.india_top.length) checks.push(check('calibration.india_top_overlap', 'calibration', 'fail', 'India has no recorded exports of the product to compare with.', ['no_india_exports_to_compare']));
    else {
      const needed = Math.ceil(calibration.india_top.length * policy.calibration.value.minimum_overlap_share);
      // E-045: a miss outside the top that carries a reason the policy accepts (restricted or no ECGC cover, sanctions) counts.
      const accepted = new Set<string>(policy.calibration.value.explained_misses ?? []);
      const explained = calibration.missed.filter((item) => item.explained_by != null && accepted.has(item.explained_by));
      const counted = calibration.overlap + explained.length;
      const byReason = new Map<MissExplanation, string[]>();
      for (const item of explained) byReason.set(item.explained_by!, [...(byReason.get(item.explained_by!) ?? []), item.market]);
      const reasons = [...byReason].map(([reason, markets]) => `${markets.join(', ')}: ${MISS_EXPLANATION_TEXT[reason]}`).join('; ');
      const summary = `${calibration.overlap} of India’s ${calibration.india_top.length} largest destinations (${calibration.years.join(', ')}) are in the run’s top ${top}`
        + (explained.length ? `, and ${explained.length} more outside it carry a reason the policy accepts (${reasons}): ${counted} counted` : '');
      checks.push(counted >= needed
        ? check('calibration.india_top_overlap', 'calibration', 'pass', `${summary} (at least ${needed} needed).`)
        : check('calibration.india_top_overlap', 'calibration', 'fail', `${summary}; at least ${needed} needed.`, calibration.missed.filter((item) => !explained.includes(item)).map((item) => `missed:${item.market}:${item.rank != null ? `rank_${item.rank}` : item.status ?? 'not_assessed'}`)));
    }

    // Actual data or labelled estimates; no silent zero (D-037).
    const expectedMetrics = snapshot ? Object.keys(snapshot.points).sort() : [];
    const silent = markets.flatMap((market) => silentZeroProblems(market, expectedMetrics, policy.evidence_labels.value.unscored_metric_requires_reason));
    if (!snapshot) silent.unshift('metric_set_unknown_without_the_stored_policy');
    checks.push(passOrFail('evidence_labels.no_silent_zero', 'evidence_labels', note(silent), 'Every metric is scored from data or unscored with its reason; unscored markets carry no score.', 'A value is missing its evidence or its reason.'));
    checks.push(policy.evidence_labels.value.estimates_must_be_labelled
      ? passOrFail('evidence_labels.estimates_labelled', 'evidence_labels', note(markets.flatMap(labelProblems)), 'Every estimate carries its label.', 'An estimate is shown without its label.')
      : check('evidence_labels.estimates_labelled', 'evidence_labels', 'not_required', 'Policy does not require estimate labels.'));

    // Duty: never an agent's reading; official duty among the markets that matter.
    const forbidden = markets
      .filter((market) => market.market_status !== 'excluded' && policy.duty_evidence.value.forbidden_bases.includes(dutyOf(market)))
      .map((market) => `${market.country_code}:duty_basis_${dutyOf(market)}`);
    checks.push(passOrFail('duty_evidence.no_forbidden_basis', 'duty_evidence', note(forbidden), `No market’s duty is ${policy.duty_evidence.value.forbidden_bases.join(' or ')}.`, 'A duty rests on a basis the policy forbids.'));
    const officialMinimum = policy.duty_evidence.value.minimum_official_in_top;
    checks.push(officialTop.length >= officialMinimum
      ? check('duty_evidence.official_in_top', 'duty_evidence', 'pass', `${officialTop.length} of the top ${dutyTop.length} carry an official duty (minimum ${officialMinimum}).`)
      : check('duty_evidence.official_in_top', 'duty_evidence', 'fail', `${officialTop.length} of the top ${dutyTop.length} carry an official duty; ${officialMinimum} required.`, dutyTop.map((market) => `rank_${market.rank}:${market.country_code}:${dutyOf(market)}`)));

    // Freshness.
    const runAge = ageDays(evaluatedAt, run.completed_at);
    const maxAge = policy.freshness.value.maximum_run_age_days;
    checks.push(passOrFail(
      'freshness.run_age', 'freshness',
      runAge == null ? ['run_completion_time_unknown'] : runAge > maxAge ? [`run_completed_${runAge}_days_before_evaluation`] : [],
      `Run completed ${runAge} day(s) before evaluation (limit ${maxAge}).`, `The run is older than ${maxAge} days.`,
    ));
    const newestBase = run.frozen.base_years.length ? Math.max(...run.frozen.base_years) : null;
    const runYear = validIso(run.as_of_date) ? new Date(run.as_of_date).getUTCFullYear() : null;
    const lag = newestBase != null && runYear != null ? runYear - newestBase : null;
    const maxLag = policy.freshness.value.maximum_base_data_lag_years;
    checks.push(passOrFail(
      'freshness.base_data_lag', 'freshness',
      newestBase == null ? ['frozen_base_years_unknown'] : runYear == null ? ['run_date_unknown'] : lag! > maxLag ? [`newest_base_year_${newestBase}_is_${lag}_years_before_the_run`] : [],
      `Newest base year ${newestBase}, ${lag} year(s) before the run (limit ${maxLag}).`, `The run used trade data more than ${maxLag} years old.`,
    ));

    // Repeatability.
    checks.push(policy.repeatability.value.verify_policy_hash
      ? passOrFail('repeatability.policy_hash', 'repeatability', policyHashProblems(run, markets, snapshot), 'The stored policy re-hashes to the hash the run and every assessment carry.', 'The stored policy does not re-hash to what the run recorded.')
      : check('repeatability.policy_hash', 'repeatability', 'not_required', 'Policy does not require the policy hash check.'));
    checks.push(policy.repeatability.value.replay_scoring
      ? passOrFail('repeatability.scoring_replay', 'repeatability', note(replayProblems(markets, snapshot)), `Every market’s status, score, confidence and rank recompute exactly from its stored metrics (${markets.length} markets).`, 'Recomputing from the stored metrics does not reproduce what the run stored.')
      : check('repeatability.scoring_replay', 'repeatability', 'not_required', 'Policy does not require the scoring replay.'));
  }

  const result: GateArchetypeReport['result'] = checks.some((item) => item.status === 'fail') ? 'fail' : checks.some((item) => item.status === 'unverified') ? 'unverified' : 'pass';
  const elapsed = run && validIso(run.created_at) && validIso(run.completed_at) ? Math.round((Date.parse(run.completed_at) - Date.parse(run.created_at)) / 1000) : null;
  const count = (status: string) => markets.filter((market) => market.market_status === status).length;
  const calibration = evidence.calibration?.status === 'computed' ? evidence.calibration : null;

  return {
    ...base,
    selector: evidence.selector,
    selection_note: evidence.selection_note,
    result,
    identities: {
      product_id: evidence.product?.id ?? null,
      classification_id: evidence.classification?.id ?? null,
      classification_revision: evidence.classification?.revision ?? null,
      classification_confirmed_by_role: evidence.classification?.confirmed_by_role ?? null,
      classification_confirmed_at: evidence.classification?.confirmed_at ?? null,
      discovery_run_id: run?.id ?? null,
      job_id: run?.job_id ?? null,
      model_version: run?.model_version ?? null,
      scoring_policy_version: run?.frozen.policy_version ?? null,
      scoring_policy_hash: run?.scoring_policy_hash ?? null,
      baci_release_id: run?.frozen.baci_release_id ?? null,
      universe_version: run?.frozen.universe_version ?? null,
    },
    run: {
      status: run?.status ?? null,
      trigger: run?.trigger ?? null,
      as_of_date: run?.as_of_date ?? null,
      created_at: run?.created_at ?? null,
      completed_at: run?.completed_at ?? null,
      elapsed_seconds: elapsed,
      base_years: run?.frozen.base_years ?? [],
      notes: run?.notes ?? [],
    },
    counts: {
      universe_markets: run?.frozen.universe_size ?? null,
      assessed_markets: markets.length,
      ranked: count('ranked'),
      not_enough_data: count('not_enough_data'),
      no_recorded_demand: count('no_recorded_demand'),
      excluded: count('excluded'),
      official_duty_in_top: officialTop.length,
    },
    calibration: calibration
      ? {
          top: calibration.top,
          years: calibration.years,
          india_top: calibration.india_top.map((item) => item.market),
          run_top: calibration.run_top.map((item) => item.market),
          overlap: calibration.overlap,
          missed: calibration.missed,
        }
      : null,
    checks,
    markets: markets.map((market) => ({
      country_code: market.country_code,
      assessment_id: market.assessment_id,
      market_status: market.market_status,
      rank: market.rank,
      overall_score: market.overall_score,
      live_points: market.live_points,
      data_year: market.data_year,
      duty_basis: dutyOf(market),
      estimated: estimatedOf(market),
      unscored: (market.breakdown?.metrics ?? []).filter((metric) => metric.score == null).map((metric) => ({ metric: metric.key, reason: metric.reason })).sort((left, right) => left.metric.localeCompare(right.metric)),
      flag_reasons: market.flag_reasons,
      problems: sortedUnique(marketReports.get(market.country_code) ?? []),
    })),
  };
}

// ---------------------------------------------------------------------------
// Programme-level evaluation
// ---------------------------------------------------------------------------

const FAIL_CLOSED_OUTCOMES: readonly GateNegativeProbe['outcome'][] = ['refused', 'failed_closed', 'reported_unavailable'];
const PROBE_METHODS: readonly GateNegativeProbe['method'][] = ['staging_observation', 'ci_test'];

function negativeProbeCheck(policy: Phase1GatePolicy, probes: GateNegativeProbe[] | null): GateCheck {
  const rules = policy.failure_semantics.value;
  if (!rules.require_negative_probe_record) return check('failure_semantics.negative_probes', 'failure_semantics', 'not_required', 'Policy does not require negative probes.');
  if (!probes) return check('failure_semantics.negative_probes', 'failure_semantics', 'unverified', 'No negative-probe record was supplied.', ['negative_probe_record_not_supplied']);
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const id of [...rules.required_negative_probes].sort()) {
    const probe = probes.find((item) => item.id === id);
    if (!probe) {
      missing.push(`negative_probe_missing:${id}`);
      continue;
    }
    if (!PROBE_METHODS.includes(probe.method)) invalid.push(`negative_probe_method_invalid:${id}`);
    if (!probe.reference?.trim()) invalid.push(`negative_probe_reference_missing:${id}`);
    if (!probe.recorded_by?.trim()) invalid.push(`negative_probe_recorder_missing:${id}`);
    if (!validIso(probe.observed_at)) invalid.push(`negative_probe_time_invalid:${id}`);
    if (!FAIL_CLOSED_OUTCOMES.includes(probe.outcome)) invalid.push(`negative_probe_did_not_fail_closed:${id}`);
  }
  if (invalid.length) return check('failure_semantics.negative_probes', 'failure_semantics', 'fail', 'A negative probe record is invalid or did not fail closed.', invalid);
  if (missing.length) return check('failure_semantics.negative_probes', 'failure_semantics', 'unverified', 'Required negative probes are not recorded.', missing);
  return check('failure_semantics.negative_probes', 'failure_semantics', 'pass', `${rules.required_negative_probes.length} operator-attested negative probe(s) recorded.`);
}

/** Reject a policy the evaluator would otherwise misread, rather than report a FAIL with the wrong explanation. */
export function assertValidPhase1GatePolicy(policy: Phase1GatePolicy): void {
  if (policy.schema_version !== 'phase-1-gate-policy-v2') throw new Error(`Phase 1 gate policy schema ${String(policy.schema_version)} is not phase-1-gate-policy-v2.`);
  const keys = policy.archetypes.value.map((archetype) => archetype.key);
  if (!keys.length) throw new Error('Phase 1 gate policy defines no archetypes.');
  if (new Set(keys).size !== keys.length) throw new Error('Phase 1 gate policy repeats an archetype key.');
  if (policy.archetypes.value.some((archetype) => !/^\d{6}$/.test(archetype.hs6))) throw new Error('Every Phase 1 gate archetype needs an exact HS6.');
  if (policy.archetypes.value.some((archetype) => !/^HS\d{4}$/.test(normalizeHsRevision(archetype.hs_revision)))) {
    throw new Error('Every Phase 1 gate archetype needs an HS revision such as HS2022.');
  }
  if (!policy.engine.value.model_version.trim()) throw new Error('Phase 1 gate policy names no engine.');
  const duty = policy.duty_evidence.value;
  const unknown = [...duty.forbidden_bases, ...duty.official_bases].filter((basis) => !DUTY_BASES.includes(basis));
  if (unknown.length) throw new Error(`Phase 1 gate policy names unknown duty bases: ${sortedUnique(unknown).join(', ')}.`);
  if (duty.official_bases.some((basis) => duty.forbidden_bases.includes(basis))) throw new Error('A duty basis cannot be both official and forbidden.');
  const share = policy.calibration.value.minimum_overlap_share;
  if (!(share > 0 && share <= 1)) throw new Error('The calibration overlap share must be above 0 and at most 1.');
  const whole = [policy.market_count.value.minimum_ranked_markets, policy.calibration.value.top, duty.top, duty.minimum_official_in_top, policy.freshness.value.maximum_run_age_days, policy.freshness.value.maximum_base_data_lag_years];
  if (whole.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('Phase 1 gate policy counts and limits must be whole, non-negative numbers.');
  if (policy.calibration.value.top < 1 || duty.top < 1) throw new Error('A top-N comparison needs N of at least 1.');
  if (duty.minimum_official_in_top > duty.top) throw new Error('The official-duty minimum cannot exceed the markets it is counted over.');
  if (!policy.failure_semantics.value.accepted_run_statuses.length) throw new Error('Phase 1 gate policy accepts no run status.');
}

/** Evaluate the gate. Pure: the same input yields a byte-identical `stableJson(report)`. */
export function evaluatePhase1Gate(input: Phase1GateInput): Phase1GateReport {
  const { policy } = input;
  assertValidPhase1GatePolicy(policy);
  if (Number.isNaN(input.evaluated_at.getTime())) throw new Error('Phase 1 gate evaluation requires a valid evaluated_at.');
  const evaluatedAt = input.evaluated_at.toISOString();

  const archetypeKeys = policy.archetypes.value.map((archetype) => archetype.key);
  const unknown = input.evidence.map((item) => item.archetype_key).filter((key) => !archetypeKeys.includes(key));
  if (unknown.length) throw new Error(`Evidence names archetypes the policy does not define: ${sortedUnique(unknown).join(', ')}.`);
  const duplicates = archetypeKeys.filter((key) => input.evidence.filter((item) => item.archetype_key === key).length > 1);
  if (duplicates.length) throw new Error(`Evidence names an archetype more than once: ${sortedUnique(duplicates).join(', ')}.`);

  const archetypes = policy.archetypes.value.map((archetype) =>
    evaluateArchetype(archetype, input.evidence.find((item) => item.archetype_key === archetype.key), policy, evaluatedAt),
  );

  const required = policy.evidence_environment.value.required_environment;
  const environmentReasons: string[] = [];
  if (input.environment.app_env !== required) environmentReasons.push(`app_env_${input.environment.app_env}_is_not_${required}`);
  if (input.environment.database_environment != null && input.environment.database_environment !== required) {
    environmentReasons.push(`database_environment_${input.environment.database_environment}_is_not_${required}`);
  }
  const programmeChecks: GateCheck[] = [
    passOrFail('evidence_environment.required', 'evidence_environment', environmentReasons, `Evidence read from ${required}.`, `Evidence was not read from ${required}.`),
    negativeProbeCheck(policy, input.negative_probes),
    check('sign_off.recorded_outside_evaluator', 'sign_off', 'manual', `Before Phase 1 is frozen, ${policy.sign_off.value.roles.join(' and ')} sign off this report by its report_checksum in docs/35.`),
  ];

  const allChecks = [
    ...programmeChecks.map((item) => ({ scope: 'programme', item })),
    ...archetypes.flatMap((archetype) => archetype.checks.map((item) => ({ scope: archetype.archetype_key, item }))),
  ];
  const failed = allChecks.filter(({ item }) => item.status === 'fail').map(({ scope, item }) => `${scope}:${item.id}`);
  const unverified = allChecks.filter(({ item }) => item.status === 'unverified').map(({ scope, item }) => `${scope}:${item.id}`);
  const approved = phase1GatePolicyApproved(policy);
  const verdict: GateVerdict = failed.length ? 'FAIL' : unverified.length ? 'INCOMPLETE' : approved ? 'PASS' : 'PASS_UNDER_PROPOSED_POLICY';

  const report: Omit<Phase1GateReport, 'report_checksum'> = {
    schema_version: 'phase-1-gate-report-v2',
    verdict,
    phase_1_frozen: false,
    evaluated_at: evaluatedAt,
    policy: {
      policy_version: policy.policy_version,
      policy_hash: phase1GatePolicyHash(policy),
      approved,
      unapproved_decisions: unapprovedPhase1GateDecisions(policy),
      approval: policy.approval,
    },
    environment: input.environment,
    summary: {
      archetypes_required: archetypes.length,
      archetypes_passed: archetypes.filter((archetype) => archetype.result === 'pass').length,
      failed_checks: failed,
      unverified_checks: unverified,
    },
    programme_checks: programmeChecks,
    archetypes,
  };
  return { ...report, report_checksum: canonicalHash(report) };
}

/** Process exit code for a verdict. Only an approved PASS exits 0. */
export function phase1GateExitCode(verdict: GateVerdict): number {
  switch (verdict) {
    case 'PASS':
      return 0;
    case 'FAIL':
      return 1;
    case 'INCOMPLETE':
      return 2;
    case 'PASS_UNDER_PROPOSED_POLICY':
      return 10;
  }
}
