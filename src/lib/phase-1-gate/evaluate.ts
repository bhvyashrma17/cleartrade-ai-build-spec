/**
 * Phase 1 acceptance gate — the pure evaluator (docs/34).
 *
 * Takes evidence that `load.ts` read from a completed staging run (plain JSON — no Prisma types,
 * no clock reads, no IO) and decides, per archetype and overall, whether the gate passes. The same
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
 */
import { canonicalHash } from '@/lib/country-evidence/planner';
import {
  normalizeHsRevision,
  phase1GatePolicyApproved,
  phase1GatePolicyHash,
  unapprovedPhase1GateDecisions,
  type Phase1GateArchetype,
  type Phase1GateDecisionKey,
  type Phase1GatePolicy,
} from './policy';

/**
 * Provider key the EU TARIC adapter writes on every snapshot. Mirrors `TARIC_PROVIDER` in
 * `market-access/taric/parser.ts`; it is restated rather than imported so this pure module does not
 * load the TARIC parsing stack, and a test pins the two together.
 */
export const GATE_TARIC_PROVIDER = 'eu_taric';

export const PHASE_1_GATE_COMPONENTS = [
  'demand_strength',
  'growth_momentum',
  'competitive_opportunity',
  'market_access',
  'export_economics',
  'exporter_market_fit',
  'logistics_feasibility',
  'risk_resilience',
] as const;
export type GateComponentKey = (typeof PHASE_1_GATE_COMPONENTS)[number];

// ---------------------------------------------------------------------------
// Evidence (what the loader reads)
// ---------------------------------------------------------------------------

export interface GateComponentEvidence {
  available: boolean;
  score: number | null;
  exclusion_reason: string | null;
}

export interface GateTariffEvidenceRow {
  evidence_id: string;
  rule_type: string;
  evidence_origin: string;
  retrieved_at: string;
  tariff_rate_percent: number | null;
  preference_applicability: string | null;
  snapshot: {
    id: string;
    provider: string;
    source_authority: string;
    source_version: string | null;
    authority_release_id: string | null;
    evidence_origin: string;
    retrieved_at: string;
    source_run_id: string | null;
  } | null;
}

export interface GateMarketEvidence {
  assessment_id: string;
  country_code: string;
  reporter_code: string | null;
  assessment_state: string | null;
  eligibility_status: string;
  overall_score: number | null;
  confidence_score: number;
  period_lag: number | null;
  latest_common_year: number | null;
  classification_current: boolean;
  assessment_checksum: string | null;
  assessment_identity: string | null;
  components: Record<GateComponentKey, GateComponentEvidence | null>;
  market_access: {
    tariff_rate_percent: number | null;
    tariff_basis: string | null;
    /** Fact ids of the form `market_access_tariff:<MarketAccessEvidence.id>` the calculation used. */
    used_tariff_fact_ids: string[];
    excluded_facts: Array<{ fact_id: string; reason: string }>;
  };
  /** The clock tariff evidence was admitted against (ISO). */
  tariff_clock: string | null;
  /** One row per resolvable used tariff fact. */
  tariff_evidence: GateTariffEvidenceRow[];
  /** Market-access evidence rows the fact selection rejected, with the reason. */
  rejected_tariff_rows: Array<{ row_id: string; reason: string }>;
  integrity: {
    country_trade_metrics_id: string | null;
    metrics_checksum: string | null;
    assessment_metrics_checksum: string | null;
    metrics_payload_manifest_checksum: string | null;
    manifest_checksum: string | null;
    assessment_manifest_checksum: string | null;
    fact_snapshot_id: string | null;
    fact_snapshot_checksum: string | null;
    fact_snapshot_checksum_recomputed: string | null;
    assessment_fact_snapshot_checksum: string | null;
  };
}

export interface GateArchetypeEvidence {
  archetype_key: string;
  /** `product:<id>` or `job:<id>`, exactly as requested. */
  selector: string;
  /** How a product selector was resolved to one run. */
  selection_note: string;
  load_errors: string[];
  product: {
    id: string;
    exporter_org_id: string;
    hs_code: string | null;
    hs_classification_status: string | null;
    hs_classification_revision: number;
  } | null;
  classification: {
    id: string;
    revision: number;
    hs6_code: string;
    nomenclature_version: string;
    status: string;
    method: string;
    confirmed_by_id: string | null;
    confirmed_by_role: string | null;
    confirmed_at: string | null;
    superseded_at: string | null;
    confirmation_audit_event_ids: string[];
  } | null;
  job: {
    id: string;
    status: string;
    attempts: number;
    created_at: string;
    started_at: string | null;
    completed_at: string | null;
    /** The frozen scoring clock (`payload.requested_at`). */
    requested_at: string | null;
    payload_schema_version: string | null;
    payload_classification_id: string | null;
    physical_calls: number | null;
    evidence_status: string | null;
    error_code: string | null;
  } | null;
  screening: {
    provenance_present: boolean;
    screening_run_id: string | null;
    run_key: string | null;
    status: string | null;
    as_of_date: string | null;
    policy_version: string | null;
    policy_hash: string | null;
    universe_version: string | null;
    eligible_count: number | null;
    shortlist_size: number | null;
    physical_call_count: number | null;
    completed_at: string | null;
    shortlist_reporters: string[];
  } | null;
  plan: {
    id: string;
    plan_key: string;
    status: string;
    screening_run_id: string | null;
    as_of_date: string;
    period_set: number[];
    latest_common_year: number;
    policy_version: string;
    policy_hash: string;
    candidate_reporters: string[];
  } | null;
  manifest: { id: string; checksum: string; evaluation_state: string; created_at: string } | null;
  discovery_run: {
    id: string;
    status: string;
    as_of_date: string | null;
    started_at: string | null;
    completed_at: string | null;
    scoring_policy_version: number | null;
    scoring_policy_hash: string | null;
  } | null;
  markets: GateMarketEvidence[];
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
  qualifies: boolean;
  disqualifiers: string[];
  assessment_state: string | null;
  eligibility_status: string;
  overall_score: number | null;
  confidence_score: number;
  period_lag: number | null;
  unavailable_components: Array<{ component: GateComponentKey; reason: string | null }>;
  tariff: {
    atlas_tariff_signal: boolean;
    rate_percent: number | null;
    basis: string | null;
    cited_evidence_ids: string[];
    cited_snapshot_ids: string[];
    providers: string[];
    authority_versions: string[];
    oldest_evidence_age_days: number | null;
    reasons: string[];
  };
  checksums: {
    assessment_checksum: string | null;
    metrics_checksum: string | null;
    manifest_checksum: string | null;
    fact_snapshot_checksum: string | null;
  };
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
    job_id: string | null;
    screening_run_id: string | null;
    screening_policy_version: string | null;
    screening_policy_hash: string | null;
    country_evidence_plan_id: string | null;
    country_evidence_plan_key: string | null;
    country_evidence_manifest_id: string | null;
    country_evidence_manifest_checksum: string | null;
    discovery_run_id: string | null;
    scoring_policy_version: number | null;
    scoring_policy_hash: string | null;
  };
  run: {
    scoring_clock: string | null;
    job_status: string | null;
    created_at: string | null;
    completed_at: string | null;
    elapsed_seconds: number | null;
    attempts: number | null;
    deep_run_provider_calls: number | null;
    screening_provider_calls: number | null;
    evidence_status: string | null;
    period_set: number[];
  };
  counts: {
    assessed_markets: number;
    rankable_markets: number;
    qualifying_markets: number;
    qualifying_markets_with_atlas_tariff_signal: number;
  };
  checks: GateCheck[];
  markets: GateMarketReport[];
}

export interface Phase1GateReport {
  schema_version: 'phase-1-gate-report-v1';
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

function check(
  id: string,
  dimension: GateCheck['dimension'],
  status: GateCheckStatus,
  detail: string,
  reasons: string[] = [],
): GateCheck {
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

/** "reason: n" lines, most frequent first, for summarising why markets did not qualify. */
function tally(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([value, count]) => `${value}: ${count}`);
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

// ---------------------------------------------------------------------------
// Market-level evaluation
// ---------------------------------------------------------------------------

function marketDisqualifiers(market: GateMarketEvidence, policy: Phase1GatePolicy): string[] {
  const reasons: string[] = [];
  if (market.assessment_state !== 'rankable') reasons.push(`assessment_state_${market.assessment_state ?? 'missing'}`);
  if (market.eligibility_status !== 'eligible') reasons.push('ineligible_under_hard_blocker');
  if (market.confidence_score < policy.confidence.value.minimum_confidence_score) reasons.push('confidence_below_floor');
  if (market.period_lag == null) reasons.push('period_lag_unknown');
  else if (market.period_lag > policy.freshness.value.maximum_period_lag_years) reasons.push('period_lag_exceeds_policy');
  for (const component of policy.evidence_completeness.value.required_components) {
    if (!market.components[component as GateComponentKey]?.available) reasons.push(`required_component_unavailable:${component}`);
  }
  for (const group of policy.evidence_completeness.value.required_any_of) {
    if (!group.some((component) => market.components[component as GateComponentKey]?.available)) {
      reasons.push(`required_one_of_unavailable:${group.join('|')}`);
    }
  }
  if (!market.classification_current) reasons.push('classification_no_longer_current');
  return reasons;
}

function tariffAssessment(market: GateMarketEvidence, policy: Phase1GatePolicy): GateMarketReport['tariff'] {
  const reasons: string[] = [];
  const component = market.components.market_access;
  const signal = Boolean(component?.available) && market.market_access.tariff_rate_percent != null;
  if (!signal) reasons.push(component?.exclusion_reason ?? 'market_access_component_missing');

  const rows = [...market.tariff_evidence].sort((left, right) => left.evidence_id.localeCompare(right.evidence_id));
  if (signal && rows.length !== market.market_access.used_tariff_fact_ids.length) reasons.push('used_tariff_fact_not_resolvable_to_evidence');
  if (signal && rows.length === 0) reasons.push('tariff_signal_cites_no_evidence');

  const origins = policy.tariff_evidence.value.atlas_evidence_origins;
  const nonAtlas = rows.filter(
    (row) => !row.snapshot || !origins.includes(row.snapshot.evidence_origin) || !origins.includes(row.evidence_origin),
  );
  if (signal && nonAtlas.length) reasons.push('tariff_evidence_not_atlas_backed');

  let oldest: number | null = null;
  let stale = false;
  for (const row of rows) {
    const age = ageDays(market.tariff_clock, row.retrieved_at);
    if (age == null) {
      stale = true;
      continue;
    }
    oldest = oldest == null ? age : Math.max(oldest, age);
    const limit = row.snapshot?.provider === GATE_TARIC_PROVIDER
      ? policy.freshness.value.maximum_taric_evidence_age_days
      : policy.freshness.value.maximum_tariff_evidence_age_days;
    if (age > limit) stale = true;
  }
  if (signal && stale) reasons.push('tariff_evidence_older_than_policy_or_undated');

  return {
    atlas_tariff_signal: signal && reasons.length === 0,
    rate_percent: market.market_access.tariff_rate_percent,
    basis: market.market_access.tariff_basis,
    cited_evidence_ids: rows.map((row) => row.evidence_id),
    cited_snapshot_ids: sortedUnique(rows.flatMap((row) => (row.snapshot ? [row.snapshot.id] : []))),
    providers: sortedUnique(rows.flatMap((row) => (row.snapshot ? [row.snapshot.provider] : []))),
    authority_versions: sortedUnique(
      rows.flatMap((row) => (row.snapshot?.source_version ? [`${row.snapshot.provider}@${row.snapshot.source_version}`] : [])),
    ),
    oldest_evidence_age_days: oldest,
    reasons,
  };
}

function integrityProblems(market: GateMarketEvidence): string[] {
  const i = market.integrity;
  const problems: string[] = [];
  const link = (name: string, values: Array<string | null>) => {
    if (values.some((value) => !value)) problems.push(`${market.country_code}:${name}_missing`);
    else if (new Set(values).size !== 1) problems.push(`${market.country_code}:${name}_mismatch`);
  };
  link('metrics_checksum', [i.metrics_checksum, i.assessment_metrics_checksum]);
  link('manifest_checksum', [i.manifest_checksum, i.metrics_payload_manifest_checksum, i.assessment_manifest_checksum]);
  link('fact_snapshot_checksum', [i.fact_snapshot_checksum, i.fact_snapshot_checksum_recomputed, i.assessment_fact_snapshot_checksum]);
  return problems;
}

function evaluateMarket(market: GateMarketEvidence, policy: Phase1GatePolicy): GateMarketReport {
  const disqualifiers = marketDisqualifiers(market, policy);
  return {
    country_code: market.country_code,
    assessment_id: market.assessment_id,
    qualifies: disqualifiers.length === 0,
    disqualifiers,
    assessment_state: market.assessment_state,
    eligibility_status: market.eligibility_status,
    overall_score: market.overall_score,
    confidence_score: market.confidence_score,
    period_lag: market.period_lag,
    unavailable_components: PHASE_1_GATE_COMPONENTS.flatMap((component) => {
      const value = market.components[component];
      return value?.available ? [] : [{ component, reason: value?.exclusion_reason ?? null }];
    }),
    tariff: tariffAssessment(market, policy),
    checksums: {
      assessment_checksum: market.assessment_checksum,
      metrics_checksum: market.integrity.metrics_checksum,
      manifest_checksum: market.integrity.manifest_checksum,
      fact_snapshot_checksum: market.integrity.fact_snapshot_checksum,
    },
  };
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
  if (evidence.job && evidence.job.payload_classification_id !== c.id) match.push('run_was_not_produced_for_this_classification');
  return [
    passOrFail('classification.confirmed', 'classification', confirmed, `Revision ${c.revision} confirmed at ${c.confirmed_at}.`, 'The classification is not a current human confirmation.'),
    passOrFail('classification.confirmer_role', 'classification', role, `Confirmed by a ${c.confirmed_by_role}.`, 'The confirming user is not a permitted staff role.'),
    passOrFail('classification.audit_event', 'classification', audit, `${c.confirmation_audit_event_ids.length} confirming AuditEvent(s).`, 'No AuditEvent records the confirmation.'),
    passOrFail('classification.matches_archetype', 'archetypes', match, `HS ${c.hs6_code} (${c.nomenclature_version}) matches the archetype and the run.`, 'The classification does not match the archetype or the run.'),
  ];
}

function destinationChecks(evidence: GateArchetypeEvidence, policy: Phase1GatePolicy): GateCheck[] {
  if (!policy.destination_set.value.require_completed_global_screen) {
    return [check('destination_set.completed_screen', 'destination_set', 'not_required', 'Policy does not require a global screen.')];
  }
  const s = evidence.screening;
  const screen: string[] = [];
  if (!s?.provenance_present) screen.push('deep_run_has_no_screening_provenance');
  else {
    if (s.status !== 'completed') screen.push(`screening_run_status_${s.status ?? 'missing'}`);
    if (!evidence.plan || evidence.plan.screening_run_id !== s.screening_run_id) screen.push('evidence_plan_not_bound_to_screening_run');
  }
  const assessed = sortedUnique(evidence.markets.flatMap((market) => (market.reporter_code ? [market.reporter_code] : [])));
  const shortlist = sortedUnique(s?.shortlist_reporters ?? []);
  const coverage: string[] = [];
  if (s?.provenance_present) {
    const missing = shortlist.filter((reporter) => !assessed.includes(reporter));
    const extra = assessed.filter((reporter) => !shortlist.includes(reporter));
    if (missing.length) coverage.push(`shortlisted_reporters_not_assessed:${missing.join(',')}`);
    if (extra.length) coverage.push(`assessed_reporters_not_shortlisted:${extra.join(',')}`);
    if (evidence.markets.some((market) => !market.reporter_code)) coverage.push('assessment_without_reporter_identity');
  }
  return [
    passOrFail('destination_set.completed_screen', 'destination_set', screen, `Deep run derived from completed screen ${s?.screening_run_id}.`, 'The deep run is not traceable to a completed global screen.'),
    s?.provenance_present
      ? passOrFail('destination_set.shortlist_assessed', 'destination_set', coverage, `All ${shortlist.length} shortlisted markets were assessed.`, 'Assessed markets differ from the frozen shortlist.')
      : check('destination_set.shortlist_assessed', 'destination_set', 'fail', 'No frozen shortlist to compare against.', ['deep_run_has_no_screening_provenance']),
  ];
}

function failureSemanticsChecks(evidence: GateArchetypeEvidence, policy: Phase1GatePolicy): GateCheck[] {
  const accepted = policy.failure_semantics.value.accepted_run_statuses;
  const status: string[] = [];
  if (!evidence.job) status.push('job_missing');
  else if (!accepted.includes(evidence.job.status)) status.push(`job_status_${evidence.job.status}`);
  if (!evidence.discovery_run) status.push('discovery_run_missing');
  else {
    if (!accepted.includes(evidence.discovery_run.status)) status.push(`discovery_run_status_${evidence.discovery_run.status}`);
    if (evidence.job && evidence.discovery_run.status !== evidence.job.status) status.push('job_and_discovery_run_status_disagree');
  }
  if (evidence.job && evidence.job.status === 'partial' && evidence.job.evidence_status === 'metric_ready' && evidence.markets.every((market) => market.assessment_state === 'rankable')) {
    // A partial run must say what is partial. If evidence is complete and every market ranks,
    // `partial` is unexplained — exactly the "masquerading" state the gate must not accept.
    status.push('partial_run_without_recorded_gap');
  }
  if (evidence.markets.length === 0) status.push('run_produced_no_assessments');

  const reasons: string[] = [];
  const zeros: string[] = [];
  for (const market of evidence.markets) {
    for (const component of PHASE_1_GATE_COMPONENTS) {
      const value = market.components[component];
      if (!value) {
        reasons.push(`${market.country_code}:${component}_missing_from_provenance`);
        continue;
      }
      if (!value.available && policy.evidence_completeness.value.unavailable_components_require_reason && !value.exclusion_reason?.trim()) {
        reasons.push(`${market.country_code}:${component}_unavailable_without_reason`);
      }
      if (value.available && value.score == null) zeros.push(`${market.country_code}:${component}_available_without_score`);
      if (!value.available && value.score != null) zeros.push(`${market.country_code}:${component}_unavailable_but_scored`);
    }
    const access = market.components.market_access;
    if (access?.available && (market.market_access.tariff_rate_percent == null || market.market_access.used_tariff_fact_ids.length === 0)) {
      zeros.push(`${market.country_code}:market_access_scored_without_cited_tariff`);
    }
  }
  return [
    passOrFail('failure_semantics.run_status', 'failure_semantics', status, `Job ${evidence.job?.status}; run ${evidence.discovery_run?.status}.`, 'The run did not finish in an accepted, explained state.'),
    passOrFail('evidence_completeness.unavailable_has_reason', 'evidence_completeness', reasons, 'Every unavailable component states why.', 'Some components are unavailable without a stated reason.'),
    passOrFail('failure_semantics.no_silent_zero', 'failure_semantics', zeros, 'No component is scored without evidence or scored while unavailable.', 'A component score is not backed by its evidence.'),
  ];
}

function evaluateArchetype(
  archetype: Phase1GateArchetype,
  evidence: GateArchetypeEvidence | undefined,
  policy: Phase1GatePolicy,
  evaluatedAt: string,
): GateArchetypeReport {
  const base = {
    archetype_key: archetype.key,
    label: archetype.label,
    hs6: archetype.hs6,
  };
  if (!evidence) {
    return {
      ...base,
      selector: null,
      selection_note: null,
      result: 'fail',
      identities: {
        product_id: null, classification_id: null, classification_revision: null, classification_confirmed_by_role: null,
        classification_confirmed_at: null, job_id: null, screening_run_id: null, screening_policy_version: null,
        screening_policy_hash: null, country_evidence_plan_id: null, country_evidence_plan_key: null,
        country_evidence_manifest_id: null, country_evidence_manifest_checksum: null, discovery_run_id: null,
        scoring_policy_version: null, scoring_policy_hash: null,
      },
      run: {
        scoring_clock: null, job_status: null, created_at: null, completed_at: null, elapsed_seconds: null, attempts: null,
        deep_run_provider_calls: null, screening_provider_calls: null, evidence_status: null, period_set: [],
      },
      counts: { assessed_markets: 0, rankable_markets: 0, qualifying_markets: 0, qualifying_markets_with_atlas_tariff_signal: 0 },
      checks: [check('archetype.evidence_supplied', 'archetypes', 'fail', 'No staging run was named for this archetype.', [`archetype_evidence_not_supplied:${archetype.key}`])],
      markets: [],
    };
  }

  const markets = [...evidence.markets]
    .sort((left, right) => left.country_code.localeCompare(right.country_code) || left.assessment_id.localeCompare(right.assessment_id))
    .map((market) => evaluateMarket(market, policy));
  const qualifying = markets.filter((market) => market.qualifies);
  const withTariff = qualifying.filter((market) => market.tariff.atlas_tariff_signal);

  const checks: GateCheck[] = [];
  checks.push(passOrFail('evidence_load.complete', 'evidence_load', [...evidence.load_errors].sort(), 'All run evidence was found.', 'Some run evidence could not be found or read.'));
  checks.push(...classificationChecks(evidence, archetype, policy));
  checks.push(...destinationChecks(evidence, policy));
  checks.push(...failureSemanticsChecks(evidence, policy));

  const runAge = ageDays(evaluatedAt, evidence.job?.completed_at ?? null);
  checks.push(passOrFail(
    'freshness.run_age',
    'freshness',
    runAge == null ? ['run_completion_time_unknown'] : runAge > policy.freshness.value.maximum_run_age_days ? [`run_completed_${runAge}_days_before_evaluation`] : [],
    `Run completed ${runAge} day(s) before evaluation (limit ${policy.freshness.value.maximum_run_age_days}).`,
    `The run is older than ${policy.freshness.value.maximum_run_age_days} days.`,
  ));

  if (policy.repeatability.value.verify_stored_checksums) {
    const problems = evidence.markets.flatMap(integrityProblems);
    if (evidence.manifest && evidence.markets.some((market) => market.integrity.manifest_checksum && market.integrity.manifest_checksum !== evidence.manifest!.checksum)) {
      problems.push('assessment_metrics_belong_to_a_different_manifest');
    }
    checks.push(passOrFail('repeatability.stored_checksums', 'repeatability', problems.sort(), 'Every metrics, manifest and fact-manifest checksum link re-verifies.', 'A stored checksum link does not re-verify.'));
  } else {
    checks.push(check('repeatability.stored_checksums', 'repeatability', 'not_required', 'Policy does not require checksum re-verification.'));
  }
  checks.push(policy.repeatability.value.require_replay_comparison
    ? check('repeatability.replay', 'repeatability', 'unverified', 'Replay comparison is required but this evaluator does not re-execute runs; attach a replay record.', ['replay_comparison_not_performed'])
    : check('repeatability.replay', 'repeatability', 'not_required', 'Policy does not require a replay comparison for this gate version.'));

  const minimum = policy.market_count.value.minimum_qualifying_markets_per_archetype;
  checks.push(qualifying.length >= minimum
    ? check('market_count.minimum', 'market_count', 'pass', `${qualifying.length} qualifying market(s) of ${markets.length} assessed (minimum ${minimum}).`)
    : check('market_count.minimum', 'market_count', 'fail', `${qualifying.length} qualifying market(s) of ${markets.length} assessed; ${minimum} required.`, tally(markets.flatMap((market) => market.disqualifiers))));

  const tariffMinimum = policy.tariff_evidence.value.minimum_qualifying_markets_with_atlas_tariff_signal;
  checks.push(withTariff.length >= tariffMinimum
    ? check('tariff_evidence.atlas_signal', 'tariff_evidence', 'pass', `${withTariff.length} qualifying market(s) carry an Atlas-backed tariff signal (minimum ${tariffMinimum}).`)
    : check('tariff_evidence.atlas_signal', 'tariff_evidence', 'fail', `${withTariff.length} qualifying market(s) carry an Atlas-backed tariff signal; ${tariffMinimum} required.`, tally(qualifying.flatMap((market) => market.tariff.reasons))));

  const result: GateArchetypeReport['result'] = checks.some((item) => item.status === 'fail')
    ? 'fail'
    : checks.some((item) => item.status === 'unverified')
      ? 'unverified'
      : 'pass';
  const elapsed = validIso(evidence.job?.created_at) && validIso(evidence.job?.completed_at)
    ? Math.round((Date.parse(evidence.job!.completed_at!) - Date.parse(evidence.job!.created_at)) / 1000)
    : null;

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
      job_id: evidence.job?.id ?? null,
      screening_run_id: evidence.screening?.screening_run_id ?? null,
      screening_policy_version: evidence.screening?.policy_version ?? null,
      screening_policy_hash: evidence.screening?.policy_hash ?? null,
      country_evidence_plan_id: evidence.plan?.id ?? null,
      country_evidence_plan_key: evidence.plan?.plan_key ?? null,
      country_evidence_manifest_id: evidence.manifest?.id ?? null,
      country_evidence_manifest_checksum: evidence.manifest?.checksum ?? null,
      discovery_run_id: evidence.discovery_run?.id ?? null,
      scoring_policy_version: evidence.discovery_run?.scoring_policy_version ?? null,
      scoring_policy_hash: evidence.discovery_run?.scoring_policy_hash ?? null,
    },
    run: {
      scoring_clock: evidence.job?.requested_at ?? null,
      job_status: evidence.job?.status ?? null,
      created_at: evidence.job?.created_at ?? null,
      completed_at: evidence.job?.completed_at ?? null,
      elapsed_seconds: elapsed,
      attempts: evidence.job?.attempts ?? null,
      deep_run_provider_calls: evidence.job?.physical_calls ?? null,
      screening_provider_calls: evidence.screening?.physical_call_count ?? null,
      evidence_status: evidence.job?.evidence_status ?? null,
      period_set: evidence.plan?.period_set ?? [],
    },
    counts: {
      assessed_markets: markets.length,
      rankable_markets: markets.filter((market) => market.assessment_state === 'rankable').length,
      qualifying_markets: qualifying.length,
      qualifying_markets_with_atlas_tariff_signal: withTariff.length,
    },
    checks,
    markets,
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
  if (!probes) {
    return check('failure_semantics.negative_probes', 'failure_semantics', 'unverified', 'No negative-probe record was supplied.', ['negative_probe_record_not_supplied']);
  }
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

/**
 * Reject a policy the evaluator would otherwise misread. A misspelt component name would make every
 * market look as though a required pillar were missing — a FAIL with the wrong explanation.
 */
export function assertValidPhase1GatePolicy(policy: Phase1GatePolicy): void {
  const known = new Set<string>(PHASE_1_GATE_COMPONENTS);
  const named = [
    ...policy.evidence_completeness.value.required_components,
    ...policy.evidence_completeness.value.required_any_of.flat(),
  ];
  const unknown = named.filter((component) => !known.has(component));
  if (unknown.length) throw new Error(`Phase 1 gate policy names unknown components: ${sortedUnique(unknown).join(', ')}.`);
  if (policy.evidence_completeness.value.required_any_of.some((group) => group.length === 0)) {
    throw new Error('Phase 1 gate policy has an empty required_any_of group.');
  }
  const keys = policy.archetypes.value.map((archetype) => archetype.key);
  if (!keys.length) throw new Error('Phase 1 gate policy defines no archetypes.');
  if (new Set(keys).size !== keys.length) throw new Error('Phase 1 gate policy repeats an archetype key.');
  if (policy.archetypes.value.some((archetype) => !/^\d{6}$/.test(archetype.hs6))) throw new Error('Every Phase 1 gate archetype needs an exact HS6.');
  if (policy.archetypes.value.some((archetype) => !/^HS\d{4}$/.test(normalizeHsRevision(archetype.hs_revision)))) {
    throw new Error('Every Phase 1 gate archetype needs an HS revision such as HS2022.');
  }
  const numbers = [
    policy.market_count.value.minimum_qualifying_markets_per_archetype,
    policy.confidence.value.minimum_confidence_score,
    policy.freshness.value.maximum_period_lag_years,
    policy.freshness.value.maximum_run_age_days,
    policy.freshness.value.maximum_tariff_evidence_age_days,
    policy.freshness.value.maximum_taric_evidence_age_days,
    policy.tariff_evidence.value.minimum_qualifying_markets_with_atlas_tariff_signal,
  ];
  if (numbers.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Phase 1 gate policy thresholds must be finite and non-negative.');
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
    schema_version: 'phase-1-gate-report-v1',
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
