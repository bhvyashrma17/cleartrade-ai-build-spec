import { createHash, randomUUID } from 'node:crypto';
import { getNumericCodes } from 'i18n-iso-countries';
import {
  EvidenceCompletenessStatus,
  EvidenceOrigin,
  JobStatus,
  JobType,
  MarketAccessEvidenceStatus,
  MarketAccessRuleType,
  OrgTier,
  Prisma,
  ProductClassificationMethod,
  TradeSourceMode,
  UserRole,
} from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '@/lib/comtrade';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '@/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION } from '@/lib/comtrade/normalization';
import { CONFIG_DEFAULTS, type CountryScreeningPolicy } from '@/lib/config';
import { createGlobalCountryScreeningRun, executeGlobalCountryScreeningRun } from '@/lib/country-screening/service';
import { requestDeepCountryTruthFromScreening } from '@/lib/country-truth-deep-request';
import { calculateMarketAccessV2 } from '@/lib/country-truth/phase-1h-calculations';
import { scoreCountryTruthV4, type CountryTruthMetricPayload } from '@/lib/discovery/country-truth-scoring-v4';
import { registerAllJobHandlers } from '@/lib/job-handlers';
import { runClaimedJob } from '@/lib/jobs';
import { TARIC_PROVIDER } from '@/lib/market-access/taric/parser';
import {
  assertValidPhase1GatePolicy,
  evaluatePhase1Gate,
  GATE_TARIC_PROVIDER,
  phase1GateExitCode,
  stableJson,
  type GateArchetypeEvidence,
  type GateComponentEvidence,
  type GateEnvironment,
  type GateMarketEvidence,
  type GateNegativeProbe,
  type Phase1GateInput,
} from '@/lib/phase-1-gate/evaluate';
import { loadPhase1GateArchetypeEvidence, parseGateSelector, withReadOnlySnapshot } from '@/lib/phase-1-gate/load';
import {
  normalizeHsRevision,
  phase1GatePolicyApproved,
  phase1GatePolicyHash,
  PHASE_1_GATE_DECISION_KEYS,
  PHASE_1_GATE_POLICY_V1,
  unapprovedPhase1GateDecisions,
  type GateDecision,
  type Phase1GatePolicy,
} from '@/lib/phase-1-gate/policy';
import { confirmClassification, proposeClassification } from '@/lib/product-classification';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

// ---------------------------------------------------------------------------
// Pure-evaluator fixtures
// ---------------------------------------------------------------------------

const CLOCK = '2026-10-01T00:00:00.000Z';
const EVALUATED_AT = new Date('2026-10-05T00:00:00.000Z');
const REPORTERS: Record<string, string> = { DE: '276', GB: '826', JP: '392', SA: '682', US: '842', AE: '784' };

const available = (score = 60): GateComponentEvidence => ({ available: true, score, exclusion_reason: null });
const unavailable = (reason: string | null = 'no_usable_evidence'): GateComponentEvidence => ({ available: false, score: null, exclusion_reason: reason });

function market(country: string, overrides: Partial<GateMarketEvidence> = {}): GateMarketEvidence {
  return {
    assessment_id: `assessment-${country}`,
    country_code: country,
    reporter_code: REPORTERS[country],
    assessment_state: 'rankable',
    eligibility_status: 'eligible',
    overall_score: 55,
    confidence_score: 48,
    period_lag: 0,
    latest_common_year: 2025,
    classification_current: true,
    assessment_checksum: `assessment-${country}`,
    assessment_identity: `identity-${country}`,
    components: {
      demand_strength: available(),
      growth_momentum: available(),
      competitive_opportunity: available(),
      market_access: unavailable('tariff: India preference applicability is unknown; ordinary duty cannot be assumed.'),
      export_economics: unavailable('insufficient_exporter_data'),
      exporter_market_fit: unavailable('insufficient_exporter_data'),
      logistics_feasibility: unavailable('no_usable_evidence'),
      risk_resilience: available(70),
    },
    market_access: { tariff_rate_percent: null, tariff_basis: null, used_tariff_fact_ids: [], excluded_facts: [] },
    tariff_clock: CLOCK,
    tariff_evidence: [],
    rejected_tariff_rows: [],
    integrity: {
      country_trade_metrics_id: `metrics-${country}`,
      metrics_checksum: `metrics-${country}`,
      assessment_metrics_checksum: `metrics-${country}`,
      metrics_payload_manifest_checksum: 'manifest',
      manifest_checksum: 'manifest',
      assessment_manifest_checksum: 'manifest',
      fact_snapshot_id: `facts-${country}`,
      fact_snapshot_checksum: `facts-${country}`,
      fact_snapshot_checksum_recomputed: `facts-${country}`,
      assessment_fact_snapshot_checksum: `facts-${country}`,
    },
    ...overrides,
  };
}

function withTariff(base: GateMarketEvidence, options: { provider?: string; retrieved_at?: string; origin?: string } = {}): GateMarketEvidence {
  const retrieved = options.retrieved_at ?? '2026-09-20T00:00:00.000Z';
  const origin = options.origin ?? 'public_real';
  const snapshot = {
    id: `snapshot-${base.country_code}`, provider: options.provider ?? 'usitc_hts', source_authority: 'Authority', source_version: '2026-rev1',
    authority_release_id: null, evidence_origin: origin, retrieved_at: retrieved, source_run_id: 'job-atlas',
  };
  return {
    ...base,
    components: { ...base.components, market_access: available(80) },
    market_access: {
      tariff_rate_percent: 5,
      tariff_basis: 'ordinary_after_explicit_non_applicability',
      used_tariff_fact_ids: [`market_access_tariff:mfn-${base.country_code}`, `market_access_tariff:pref-${base.country_code}`],
      excluded_facts: [],
    },
    tariff_evidence: [
      { evidence_id: `mfn-${base.country_code}`, rule_type: 'destination_tariff', evidence_origin: origin, retrieved_at: retrieved, tariff_rate_percent: 5, preference_applicability: null, snapshot },
      { evidence_id: `pref-${base.country_code}`, rule_type: 'preferential_tariff_india', evidence_origin: origin, retrieved_at: retrieved, tariff_rate_percent: null, preference_applicability: 'not_applicable', snapshot },
    ],
  };
}

function archetypeEvidence(key: string, hs6: string, countries = ['DE', 'GB', 'JP', 'SA', 'US']): GateArchetypeEvidence {
  const shortlist = countries.map((country) => REPORTERS[country]).sort();
  return {
    archetype_key: key,
    selector: `product:product-${key}`,
    selection_note: 'fixture',
    load_errors: [],
    product: { id: `product-${key}`, exporter_org_id: 'org', hs_code: hs6, hs_classification_status: 'confirmed', hs_classification_revision: 1 },
    classification: {
      id: `classification-${key}`, revision: 1, hs6_code: hs6, nomenclature_version: '2022', status: 'confirmed', method: 'manually_verified',
      confirmed_by_id: 'agent-1', confirmed_by_role: 'agent', confirmed_at: '2026-09-01T00:00:00.000Z', superseded_at: null,
      confirmation_audit_event_ids: ['audit-1'],
    },
    job: {
      id: `job-${key}`, status: 'completed', attempts: 1, created_at: '2026-10-01T00:00:00.000Z', started_at: '2026-10-01T00:00:05.000Z',
      completed_at: '2026-10-01T00:10:00.000Z', requested_at: CLOCK, payload_schema_version: 'country-truth-discovery-job-v3',
      payload_classification_id: `classification-${key}`, physical_calls: 55, evidence_status: 'metric_ready', error_code: null,
    },
    screening: {
      provenance_present: true, screening_run_id: `screen-${key}`, run_key: `screen-key-${key}`, status: 'completed', as_of_date: CLOCK,
      policy_version: 'country-screening-v1', policy_hash: 'screen-hash', universe_version: 'universe-v1', eligible_count: 150,
      shortlist_size: countries.length, physical_call_count: 218, completed_at: '2026-09-30T00:00:00.000Z', shortlist_reporters: shortlist,
    },
    plan: {
      id: `plan-${key}`, plan_key: `plan-key-${key}`, status: 'manifest_ready', screening_run_id: `screen-${key}`, as_of_date: CLOCK,
      period_set: [2021, 2022, 2023, 2024, 2025], latest_common_year: 2025, policy_version: 'country-evidence-v1', policy_hash: 'plan-hash',
      candidate_reporters: shortlist,
    },
    manifest: { id: `manifest-${key}`, checksum: 'manifest', evaluation_state: 'metric_ready', created_at: CLOCK },
    discovery_run: {
      id: `run-${key}`, status: 'completed', as_of_date: CLOCK, started_at: CLOCK, completed_at: '2026-10-01T00:10:00.000Z',
      scoring_policy_version: 1, scoring_policy_hash: 'scoring-hash',
    },
    // The last market carries an Atlas-backed tariff; the rest are trade-only.
    markets: countries.map((country, index) => (index === countries.length - 1 ? withTariff(market(country)) : market(country))),
  };
}

const PROBES: GateNegativeProbe[] = PHASE_1_GATE_POLICY_V1.failure_semantics.value.required_negative_probes.map((id) => ({
  id, method: 'ci_test', reference: `tests/phase-1-gate.test.ts#${id}`, observed_at: '2026-10-02T00:00:00.000Z', outcome: 'refused', recorded_by: 'engineering_owner',
}));
const STAGING: GateEnvironment = { app_env: 'staging', database_environment: 'staging', database_fingerprint_prefix: 'abcdef012345', git_commit: 'f29fcf52' };

const fullEvidence = () => PHASE_1_GATE_POLICY_V1.archetypes.value.map((archetype) => archetypeEvidence(archetype.key, archetype.hs6));
const evaluate = (overrides: Partial<Phase1GateInput> = {}) =>
  evaluatePhase1Gate({ policy: PHASE_1_GATE_POLICY_V1, evidence: fullEvidence(), negative_probes: PROBES, evaluated_at: EVALUATED_AT, environment: STAGING, ...overrides });

function approvedPolicy(): Phase1GatePolicy {
  const policy = structuredClone(PHASE_1_GATE_POLICY_V1);
  policy.approval = { approved_by: 'product owner', approved_at: '2026-10-03T00:00:00.000Z', decision_reference: 'docs/35#test' };
  for (const key of PHASE_1_GATE_DECISION_KEYS) (policy[key] as GateDecision<unknown>).status = 'approved';
  return policy;
}

function editArchetype(key: string, edit: (evidence: GateArchetypeEvidence) => void) {
  const evidence = fullEvidence();
  edit(evidence.find((item) => item.archetype_key === key)!);
  return evidence;
}

const archetypeCheck = (report: ReturnType<typeof evaluate>, key: string, id: string) =>
  report.archetypes.find((archetype) => archetype.archetype_key === key)!.checks.find((item) => item.id === id)!;

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

describe('Phase 1 gate policy', () => {
  test('v1 records every decision as proposed and validates', () => {
    expect(PHASE_1_GATE_POLICY_V1.approval).toBeNull();
    expect(unapprovedPhase1GateDecisions(PHASE_1_GATE_POLICY_V1)).toEqual([...PHASE_1_GATE_DECISION_KEYS]);
    expect(phase1GatePolicyApproved(PHASE_1_GATE_POLICY_V1)).toBe(false);
    expect(() => assertValidPhase1GatePolicy(PHASE_1_GATE_POLICY_V1)).not.toThrow();
    expect(phase1GatePolicyHash(PHASE_1_GATE_POLICY_V1)).toMatch(/^[a-f0-9]{64}$/);
    expect(phase1GatePolicyHash(approvedPolicy())).not.toBe(phase1GatePolicyHash(PHASE_1_GATE_POLICY_V1));
    expect(PHASE_1_GATE_POLICY_V1.archetypes.value.map((archetype) => [archetype.key, archetype.hs6])).toEqual([['rice', '100630'], ['brassware', '741810'], ['carpets', '570110']]);
  });

  test('a policy naming an unknown component is rejected rather than misread', () => {
    const policy = structuredClone(PHASE_1_GATE_POLICY_V1);
    policy.evidence_completeness.value.required_components = ['demand'];
    expect(() => assertValidPhase1GatePolicy(policy)).toThrow(/unknown components: demand/);
  });

  test('2022 and HS2022 name the same HS revision', () => {
    expect(normalizeHsRevision('2022')).toBe('HS2022');
    expect(normalizeHsRevision(' hs2022 ')).toBe('HS2022');
  });

  test('the TARIC provider key matches the adapter', () => {
    expect(GATE_TARIC_PROVIDER).toBe(TARIC_PROVIDER);
  });

  test('the proposed confidence floor rationale matches the scoring model (docs/34)', () => {
    const policy = CONFIG_DEFAULTS['country_truth.scoring_v4'];
    const complete = (value: unknown) => ({ value, unit: null, status: 'complete' as const, periods_used: [2025], calculation_method: 'fixture', exclusion_reason: null, evidence: [] });
    const metrics = {
      market_size: complete(5_000_000), cagr: complete(4), recent_momentum: complete(3), india_import_value: complete(1_000_000),
      india_market_share: complete(20), india_share_trend: complete({ endpoint_change_pp: 1, slope_pp_per_year: 0.5, yearly_shares: {} }),
      supplier_hhi: complete(0.3), volatility: complete(10), unit_value: complete({ median: 1, low: 1, high: 1, observation_count: 5, basis: 'net_weight_kg' }),
    } as unknown as CountryTruthMetricPayload;
    const scope = { exporter_org_id: 'org', country_code: 'US', hs6: '100630', hs_revision: 'HS2022', as_of_date: CLOCK };
    const fact = (id: string, value: Record<string, unknown>) => ({
      id, state: 'present', scope: { ...scope, origin_country_code: 'IN' }, confidence: 100,
      provenance: { assertion_class: 'authoritative_public', source: 'fixture', source_reference: id, retrieved_at: '2026-09-30T00:00:00.000Z' },
      value: { origin_country: 'IN', effective_from: '2026-01-01T00:00:00.000Z', effective_to: null, ...value },
    });
    const access = calculateMarketAccessV2(
      { scope, tariffs: [fact('market_access_tariff:pref', { tariff_type: 'india_preference', rate_percent: null, preference_applicability: 'not_applicable' }), fact('market_access_tariff:mfn', { tariff_type: 'ordinary', rate_percent: 5 })], requirements: [] } as never,
      CONFIG_DEFAULTS['country_truth.phase_1h'].market_access,
    );
    const confidence = (lag: number, withTariff: boolean) => scoreCountryTruthV4({
      country_trade_metrics_id: 'm', metrics_checksum: 'c', manifest_id: 'mf', manifest_checksum: 'mc', metrics_policy_version: 'v', metrics_policy_hash: 'h',
      reporter_code: '842', country_code: 'US', hs_code: '100630', hs_revision: 'HS2022', period_set: [2021, 2022, 2023, 2024, 2025], as_of_date: CLOCK,
      period_lag: lag, metrics, policy,
      non_trade: withTariff ? { market_access: { status: 'available', score: access.score, confidence: access.confidence, provenance: {} } } : {},
    }).confidence_score;
    expect([0, 1, 2].map((lag) => confidence(lag, false))).toEqual([48, 38, 31]);
    expect([0, 1, 2].map((lag) => confidence(lag, true))).toEqual([54, 43, 35]);
  });
});

// ---------------------------------------------------------------------------
// Pure evaluator
// ---------------------------------------------------------------------------

describe('Phase 1 gate evaluator', () => {
  test('complete evidence under the proposed policy passes only as PASS_UNDER_PROPOSED_POLICY', () => {
    const report = evaluate();
    expect(report.verdict).toBe('PASS_UNDER_PROPOSED_POLICY');
    expect(phase1GateExitCode(report.verdict)).toBe(10);
    expect(report.phase_1_frozen).toBe(false);
    expect(report.summary).toMatchObject({ archetypes_required: 3, archetypes_passed: 3, failed_checks: [], unverified_checks: [] });
    expect(report.policy.unapproved_decisions).toHaveLength(PHASE_1_GATE_DECISION_KEYS.length);
    const rice = report.archetypes[0];
    expect(rice.counts).toEqual({ assessed_markets: 5, rankable_markets: 5, qualifying_markets: 5, qualifying_markets_with_atlas_tariff_signal: 1 });
    expect(rice.markets.find((item) => item.country_code === 'US')!.tariff).toMatchObject({
      atlas_tariff_signal: true, rate_percent: 5, cited_snapshot_ids: ['snapshot-US'], providers: ['usitc_hts'], oldest_evidence_age_days: 11, reasons: [],
    });
    expect(rice.identities).toMatchObject({ job_id: 'job-rice', screening_run_id: 'screen-rice', country_evidence_manifest_checksum: 'manifest' });
    expect(rice.run).toMatchObject({ elapsed_seconds: 600, deep_run_provider_calls: 55, screening_provider_calls: 218 });
    expect(report.programme_checks.find((item) => item.id === 'sign_off.recorded_outside_evaluator')!.status).toBe('manual');
  });

  test('the same evidence under an approved policy is a PASS and exits 0', () => {
    const report = evaluate({ policy: approvedPolicy() });
    expect(report.verdict).toBe('PASS');
    expect(phase1GateExitCode(report.verdict)).toBe(0);
    expect(report.phase_1_frozen).toBe(false);
  });

  test('reports are byte-identical for the same input and independent of input order', () => {
    const first = stableJson(evaluate());
    const shuffled = fullEvidence().reverse().map((item) => ({ ...item, markets: [...item.markets].reverse() }));
    expect(stableJson(evaluate())).toBe(first);
    expect(stableJson(evaluate({ evidence: shuffled }))).toBe(first);
    expect(evaluate().report_checksum).toBe(evaluate({ evidence: shuffled }).report_checksum);
  });

  test('a missing archetype fails closed with a named reason', () => {
    const report = evaluate({ evidence: fullEvidence().filter((item) => item.archetype_key !== 'carpets') });
    expect(report.verdict).toBe('FAIL');
    expect(archetypeCheck(report, 'carpets', 'archetype.evidence_supplied').reasons).toEqual(['archetype_evidence_not_supplied:carpets']);
  });

  test('too few qualifying markets fails and says why each market did not count', () => {
    const report = evaluate({
      evidence: editArchetype('rice', (rice) => {
        // Lag 2 is still inside the proposed window (maximum 2); 3 is the first lag outside it.
        rice.markets[0] = market('DE', { confidence_score: 31, period_lag: 3 });
        rice.markets[1] = market('GB', { assessment_state: 'partial' });
        rice.markets[2] = market('JP', { eligibility_status: 'ineligible', components: { ...market('JP').components, demand_strength: unavailable('Market size unavailable.') } });
      }),
    });
    expect(report.verdict).toBe('FAIL');
    const count = archetypeCheck(report, 'rice', 'market_count.minimum');
    expect(count.status).toBe('fail');
    expect(count.detail).toContain('2 qualifying market(s) of 5 assessed; 5 required');
    expect(count.reasons).toEqual(expect.arrayContaining(['confidence_below_floor: 1', 'period_lag_exceeds_policy: 1', 'assessment_state_partial: 1', 'ineligible_under_hard_blocker: 1', 'required_component_unavailable:demand_strength: 1']));
  });

  test('an unconfirmed classification, a non-staff confirmer or a missing audit event fails', () => {
    const report = evaluate({
      evidence: editArchetype('brassware', (brass) => {
        brass.classification!.status = 'needs_review';
        brass.classification!.confirmed_by_role = 'exporter_owner';
        brass.classification!.confirmation_audit_event_ids = [];
      }),
    });
    expect(report.verdict).toBe('FAIL');
    expect(archetypeCheck(report, 'brassware', 'classification.confirmed').reasons).toEqual(['classification_status_needs_review']);
    expect(archetypeCheck(report, 'brassware', 'classification.confirmer_role').reasons).toEqual(['classification_confirmer_role_exporter_owner']);
    expect(archetypeCheck(report, 'brassware', 'classification.audit_event').status).toBe('fail');
  });

  test('a run for a different HS6 does not count for the archetype, while HS2022 spelling does', () => {
    const wrong = evaluate({ evidence: editArchetype('carpets', (carpets) => { carpets.classification!.hs6_code = '570231'; }) });
    expect(archetypeCheck(wrong, 'carpets', 'classification.matches_archetype').reasons).toEqual(['classification_hs6_570231_is_not_archetype_570110']);
    const spelled = evaluate({ evidence: editArchetype('carpets', (carpets) => { carpets.classification!.nomenclature_version = 'HS2022'; }) });
    expect(archetypeCheck(spelled, 'carpets', 'classification.matches_archetype').status).toBe('pass');
  });

  test('a missing negative-probe record makes the gate INCOMPLETE, never PASS', () => {
    const report = evaluate({ negative_probes: null });
    expect(report.verdict).toBe('INCOMPLETE');
    expect(phase1GateExitCode(report.verdict)).toBe(2);
    expect(report.summary.unverified_checks).toEqual(['programme:failure_semantics.negative_probes']);
    const partial = evaluate({ negative_probes: PROBES.slice(1) });
    expect(partial.verdict).toBe('INCOMPLETE');
    expect(partial.programme_checks.find((item) => item.id === 'failure_semantics.negative_probes')!.reasons).toEqual([`negative_probe_missing:${PROBES[0].id}`]);
  });

  test('a negative probe that did not fail closed fails the gate', () => {
    const probes = PROBES.map((probe, index) => (index === 0 ? { ...probe, outcome: 'accepted' as unknown as GateNegativeProbe['outcome'] } : probe));
    const report = evaluate({ negative_probes: probes });
    expect(report.verdict).toBe('FAIL');
    expect(report.programme_checks.find((item) => item.id === 'failure_semantics.negative_probes')!.reasons).toEqual([`negative_probe_did_not_fail_closed:${PROBES[0].id}`]);
  });

  test('stale TARIC evidence does not count as an Atlas tariff signal', () => {
    const report = evaluate({
      evidence: editArchetype('rice', (rice) => {
        rice.markets[4] = withTariff(market('US'), { provider: GATE_TARIC_PROVIDER, retrieved_at: '2026-08-01T00:00:00.000Z' });
      }),
    });
    const us = report.archetypes[0].markets.find((item) => item.country_code === 'US')!;
    expect(us.tariff).toMatchObject({ atlas_tariff_signal: false, oldest_evidence_age_days: 61, reasons: ['tariff_evidence_older_than_policy_or_undated'] });
    expect(archetypeCheck(report, 'rice', 'tariff_evidence.atlas_signal').status).toBe('fail');
    // The same age is within the general Atlas limit, so a non-TARIC source would still count.
    const general = evaluate({ evidence: editArchetype('rice', (rice) => { rice.markets[4] = withTariff(market('US'), { retrieved_at: '2026-08-01T00:00:00.000Z' }); }) });
    expect(archetypeCheck(general, 'rice', 'tariff_evidence.atlas_signal').status).toBe('pass');
  });

  test('a tariff that is not Atlas-backed, or that cites no evidence, does not count', () => {
    const manual = evaluate({ evidence: editArchetype('rice', (rice) => { rice.markets[4] = withTariff(market('US'), { origin: 'manually_entered_real' }); }) });
    expect(manual.archetypes[0].markets.find((item) => item.country_code === 'US')!.tariff.reasons).toEqual(['tariff_evidence_not_atlas_backed']);
    const orphan = evaluate({ evidence: editArchetype('rice', (rice) => { rice.markets[4] = { ...withTariff(market('US')), tariff_evidence: [] }; }) });
    expect(orphan.archetypes[0].markets.find((item) => item.country_code === 'US')!.tariff.reasons).toEqual(['used_tariff_fact_not_resolvable_to_evidence', 'tariff_signal_cites_no_evidence']);
    expect(orphan.verdict).toBe('FAIL');
  });

  test('a score without evidence, or an unavailable component without a reason, fails', () => {
    const report = evaluate({
      evidence: editArchetype('rice', (rice) => {
        rice.markets[0] = market('DE', { components: { ...market('DE').components, export_economics: { available: true, score: null, exclusion_reason: null }, logistics_feasibility: unavailable(null) } });
        rice.markets[1] = market('GB', { components: { ...market('GB').components, market_access: available(80) } });
      }),
    });
    expect(report.verdict).toBe('FAIL');
    expect(archetypeCheck(report, 'rice', 'failure_semantics.no_silent_zero').reasons).toEqual(['DE:export_economics_available_without_score', 'GB:market_access_scored_without_cited_tariff']);
    expect(archetypeCheck(report, 'rice', 'evidence_completeness.unavailable_has_reason').reasons).toEqual(['DE:logistics_feasibility_unavailable_without_reason']);
  });

  test('a stored checksum that does not re-verify fails repeatability', () => {
    const report = evaluate({ evidence: editArchetype('rice', (rice) => { rice.markets[2].integrity.fact_snapshot_checksum_recomputed = 'tampered'; }) });
    expect(archetypeCheck(report, 'rice', 'repeatability.stored_checksums').reasons).toEqual(['JP:fact_snapshot_checksum_mismatch']);
    expect(report.verdict).toBe('FAIL');
  });

  test('evidence read from a non-staging database fails the environment rule', () => {
    const report = evaluate({ environment: { ...STAGING, app_env: 'development', database_environment: null } });
    expect(report.verdict).toBe('FAIL');
    expect(report.programme_checks[0].reasons).toEqual(['app_env_development_is_not_staging']);
  });

  test('a deep run that did not come from a completed screen fails the destination-set rule', () => {
    const report = evaluate({ evidence: editArchetype('rice', (rice) => { rice.screening = { ...rice.screening!, provenance_present: false, screening_run_id: null, shortlist_reporters: [] }; }) });
    expect(archetypeCheck(report, 'rice', 'destination_set.completed_screen').reasons).toEqual(['deep_run_has_no_screening_provenance']);
    const skipped = evaluate({ evidence: editArchetype('rice', (rice) => { rice.markets = rice.markets.filter((item) => item.country_code !== 'SA'); }) });
    expect(archetypeCheck(skipped, 'rice', 'destination_set.shortlist_assessed').reasons).toEqual(['shortlisted_reporters_not_assessed:682']);
  });

  test('a partial run is accepted when its gap is explicit, but not when job and run disagree', () => {
    const partial = evaluate({
      evidence: editArchetype('rice', (rice) => {
        rice.job!.status = 'partial';
        rice.discovery_run!.status = 'partial';
        rice.markets.push(market('AE', { assessment_state: 'not_rankable', overall_score: null }));
        rice.screening!.shortlist_reporters = [...rice.screening!.shortlist_reporters, '784'].sort();
      }),
    });
    expect(archetypeCheck(partial, 'rice', 'failure_semantics.run_status').status).toBe('pass');
    expect(partial.verdict).toBe('PASS_UNDER_PROPOSED_POLICY');
    const disagree = evaluate({ evidence: editArchetype('rice', (rice) => { rice.discovery_run!.status = 'processing'; }) });
    expect(archetypeCheck(disagree, 'rice', 'failure_semantics.run_status').reasons).toEqual(['discovery_run_status_processing', 'job_and_discovery_run_status_disagree']);
  });

  test('a run older than the policy window fails freshness', () => {
    const report = evaluate({ evaluated_at: new Date('2026-11-15T00:00:00.000Z') });
    expect(archetypeCheck(report, 'rice', 'freshness.run_age').reasons).toEqual(['run_completed_44_days_before_evaluation']);
  });

  test('evidence for an archetype the policy does not define is refused', () => {
    expect(() => evaluate({ evidence: [...fullEvidence(), archetypeEvidence('glassware', '701349')] })).toThrow(/does not define: glassware/);
  });

  test('selectors are validated', () => {
    expect(parseGateSelector('product:abc_123')).toEqual({ kind: 'product', id: 'abc_123' });
    expect(parseGateSelector('job:c1')).toEqual({ kind: 'job', id: 'c1' });
    expect(() => parseGateSelector('run:1')).toThrow(/expected product:<id> or job:<id>/);
  });
});

// ---------------------------------------------------------------------------
// From-scratch path: product → confirmed classification → completed screen → deep run → gate
// ---------------------------------------------------------------------------

const AS_OF = new Date('2026-08-26T00:00:00Z');
const PERIOD = 2025;
const TARIFF_RETRIEVED_AT = new Date('2026-08-23T00:00:00Z');
/** A collision-free HS6 band for this file — see the note in country-truth-discovery-handler.test.ts. */
let hsCounter = 0;
const nextHs6 = () => String(950_000 + (hsCounter += 1)).padStart(6, '0');
const activated: string[] = [];

async function activateConfig(key: string, value: unknown) {
  const latest = await prisma.configSetting.findFirst({ where: { key }, orderBy: { version: 'desc' }, select: { version: true } });
  const row = await prisma.configSetting.create({ data: { key, version: (latest?.version ?? 0) + 1, value: value as Prisma.InputJsonValue, is_active: true } });
  activated.push(row.id);
}

async function activateScreeningPolicy(keep: string[]) {
  const excluded = Object.fromEntries(Object.values(getNumericCodes()).filter((iso2) => !keep.includes(iso2)).map((iso2) => [iso2, 'no_resident_population']));
  const base = CONFIG_DEFAULTS['country_screening.policy'] as CountryScreeningPolicy;
  await activateConfig('country_screening.policy', { ...base, excluded_iso2_codes: { ...base.excluded_iso2_codes, ...excluded } });
}

async function seedWorldEvidence(reporter: string, value: number, hs6: string) {
  const request = canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: reporter, partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), hs_codes: [hs6], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' });
  const raw = JSON.stringify({ count: 1, data: [{ reporterCode: Number(reporter), partnerCode: 0, cmdCode: hs6, refYear: PERIOD, primaryValue: value }] });
  const retrieved = new Date(AS_OF.getTime() - 86_400_000);
  await prisma.sourceEvidence.create({
    data: {
      provider: 'un_comtrade', dataset: 'goods-trade', dataset_version: 'v1', source_origin: EvidenceOrigin.authenticated_real, environment: 'test',
      request_fingerprint: comtradeRequestFingerprint(request), request_parameters: request as unknown as Prisma.InputJsonValue,
      redacted_request: 'comtrade://seed', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw,
      retrieved_at: retrieved, provider_row_count: 1, returned_row_count: 1, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted',
      observations: { create: [{ observation_key: `gate-${randomUUID()}`, reporter_code: reporter, partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), ref_year: PERIOD, hs_code: hs6, hs_level: 6, hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0', trade_value: value, trade_value_status: 'observed', quantity_status: 'missing', normalization_version: COMTRADE_NORMALIZATION_VERSION, retrieved_at: retrieved, source_origin: EvidenceOrigin.authenticated_real }] },
    },
  });
}

/** In-process authenticated Comtrade double — the same shape the handler tests use. No network. */
function authenticatedClient() {
  const calls = vi.fn();
  const client = {
    name: 'gate-mocked-authenticated-comtrade',
    identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: `gate-${randomUUID()}`, source_dataset: 'un-comtrade-api', source_dataset_version: 'mock-v1' },
    async resolveChapter() { throw new Error('Explicit HS6 must bypass reference data.'); },
    async fetchChapter(params: ComtradeFetchParams) {
      calls(params);
      const values = params.partner === 'all' ? [['156', 60], ['699', 40]] : params.partner === '699' ? [['699', 40]] : [['0', 100]];
      const rows = values.map(([partner, value]) => ({ reporter: params.reporter, partner: String(partner), partner2: '0', hs_code: params.hs_codes[0], year: params.year, period: String(params.year), value: Number(value), value_status: 'observed' as const, quantity: 10, quantity_status: 'observed' as const, unit: 'kg', net_weight: 10, flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }));
      const raw = JSON.stringify({ count: rows.length, data: rows });
      const retrieved = new Date('2026-08-26T01:00:00.000Z');
      return { rows, request_count: 1, retrieved_at: retrieved, source_dataset_version: 'mock-v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'https://comtradeapi.un.org/redacted', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { provider_count: rows.length, response_rows: rows.length, accepted_rows: rows.length, rejected_rows: 0, truncated: false, pagination_supported: false, parser_version: 'comtrade-parser-v2' }, quota_metadata: null, retrieved_at: retrieved }] };
    },
  };
  return { client, calls };
}

/** Germany's tariff as Customs Atlas persists it: an explicit non-applicable India preference plus a 5% ordinary duty. */
async function publishGermanTaricTariff(hs6: string) {
  const snapshot = await prisma.marketAccessEvidenceSnapshot.create({
    data: {
      jurisdiction: 'EU', country_code: 'DE', hs_code_scope: hs6, hs6_code: hs6, source_authority: 'European Commission — TARIC',
      source_reference: `https://example.test/taric/${randomUUID()}`, source_version: '2026-08', retrieved_at: TARIFF_RETRIEVED_AT,
      completeness_status: EvidenceCompletenessStatus.PARTIAL, tariff_coverage: true, regulatory_coverage: false, parser_version: 'fixture-v1',
      evidence_origin: EvidenceOrigin.public_real, provider: GATE_TARIC_PROVIDER, raw_evidence: {},
    },
  });
  const common = {
    snapshot_id: snapshot.id, jurisdiction: 'EU', country_code: 'DE', hs_code_scope: hs6, source_authority: 'European Commission — TARIC',
    source_reference: snapshot.source_reference, retrieved_at: TARIFF_RETRIEVED_AT, effective_at: new Date('2026-01-01T00:00:00.000Z'),
    evidence_origin: EvidenceOrigin.public_real, national_tariff_code: `${hs6}0000`, raw_evidence: {},
  };
  await prisma.marketAccessEvidence.createMany({
    data: [
      { ...common, rule_type: MarketAccessRuleType.destination_tariff, status: MarketAccessEvidenceStatus.verified, confidence: new Prisma.Decimal(1), tariff_rate_percent: new Prisma.Decimal(5), duty_expression: '5.0 %', duty_kind: 'ad_valorem' },
      { ...common, rule_type: MarketAccessRuleType.preferential_tariff_india, status: MarketAccessEvidenceStatus.not_applicable, confidence: new Prisma.Decimal(0.5), preference_applicability: 'not_applicable', preference_basis: 'fixture' },
    ],
  });
  return snapshot;
}

/** Claim THIS job atomically — never another test's leftover queued job — exactly as claimNextJob does. */
async function claimJob(id: string) {
  const claimed = await prisma.job.updateMany({ where: { id, status: JobStatus.queued }, data: { status: JobStatus.processing, started_at: new Date(), progress: 0 } });
  expect(claimed.count).toBe(1);
  const job = await prisma.job.findUniqueOrThrow({ where: { id } });
  const attemptNo = job.attempts + 1;
  await prisma.$transaction([
    prisma.job.update({ where: { id }, data: { attempts: attemptNo } }),
    prisma.jobAttempt.create({ data: { job_id: id, attempt_no: attemptNo, status: JobStatus.processing } }),
  ]);
  return { ...job, attempts: attemptNo, attempt_no: attemptNo };
}

async function fromScratchRun() {
  const hs6 = nextHs6();
  const marker = `gate-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid, country: 'IN' } });
  const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Gate fixture product', evidence_origin: EvidenceOrigin.authenticated_real } });
  const actor: Principal = { id: agent.id, email: agent.email, name: agent.name, role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };

  // The classification is proposed and confirmed through the product's own functions, so the
  // confirming AuditEvent the gate requires is the one production writes — not a hand-placed row.
  const proposed = await proposeClassification({ product_id: product.id, hs6_code: hs6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.manually_verified, evidence: { source: 'gate-test' }, rationale: 'Gate fixture classification.', confidence: 0.99 }, actor, randomUUID());
  const classification = await confirmClassification({ classification_id: proposed.id, product_id: product.id }, actor, randomUUID());

  await activateScreeningPolicy(['DE', 'US', 'JP']);
  for (const [reporter, value] of [['276', 9e9], ['842', 7e9], ['392', 2e9]] as const) await seedWorldEvidence(reporter, value, hs6);
  const screen = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
  expect((await executeGlobalCountryScreeningRun(screen.id)).status).toBe('completed');

  const tariff = await publishGermanTaricTariff(hs6);
  const requested = await requestDeepCountryTruthFromScreening({ actor, exporter_org_id: org.id, product_id: product.id, screening_run_id: screen.id, correlation_id: randomUUID() });
  expect(requested.created).toBe(true);

  const provider = authenticatedClient();
  setComtradeClient(provider.client);
  registerAllJobHandlers();
  await runClaimedJob(await claimJob(requested.job.id));
  const job = await prisma.job.findUniqueOrThrow({ where: { id: requested.job.id } });
  expect([JobStatus.completed, JobStatus.partial]).toContain(job.status);
  return { hs6, org, product, classification, screen, tariff, job };
}

function fixturePolicy(hs6: string): Phase1GatePolicy {
  const policy = structuredClone(PHASE_1_GATE_POLICY_V1);
  policy.archetypes.value = [{ key: 'fixture', label: 'Gate fixture product', hs6, hs_revision: 'HS2022' }];
  policy.evidence_environment.value = { required_environment: 'test' };
  policy.market_count.value = { minimum_qualifying_markets_per_archetype: 1 };
  return policy;
}

const TEST_ENVIRONMENT: GateEnvironment = { app_env: 'test', database_environment: null, database_fingerprint_prefix: null, git_commit: null };

describe('Phase 1 gate on a from-scratch run', () => {
  beforeEach(() => setComtradeClient(null));
  afterEach(async () => {
    setComtradeClient(null);
    if (activated.length) await prisma.configSetting.updateMany({ where: { id: { in: activated.splice(0) } }, data: { is_active: false } });
  });
  afterAll(() => prisma.$disconnect());

  test('loads a screen-derived deep run read-only and evaluates it end to end', async () => {
    const run = await fromScratchRun();
    const before = { audit: await prisma.auditEvent.count(), jobs: await prisma.job.count(), assessments: await prisma.marketAssessment.count() };

    const [byJob, byProduct] = await withReadOnlySnapshot(prisma, async (db) => [
      await loadPhase1GateArchetypeEvidence(db, 'fixture', { kind: 'job', id: run.job.id }),
      await loadPhase1GateArchetypeEvidence(db, 'fixture', { kind: 'product', id: run.product.id }),
    ]);
    expect({ audit: await prisma.auditEvent.count(), jobs: await prisma.job.count(), assessments: await prisma.marketAssessment.count() }).toEqual(before);

    // Both selectors resolve the same run; only the selector and how it was chosen differ.
    expect(byProduct.job!.id).toBe(run.job.id);
    expect({ ...byProduct, selector: null, selection_note: null }).toEqual({ ...byJob, selector: null, selection_note: null });
    expect(byJob.load_errors).toEqual([]);
    expect(byJob.classification).toMatchObject({ id: run.classification.id, status: 'confirmed', confirmed_by_role: 'agent' });
    expect(byJob.classification!.confirmation_audit_event_ids).toHaveLength(1);
    expect(byJob.screening).toMatchObject({ provenance_present: true, screening_run_id: run.screen.id, status: 'completed', shortlist_reporters: ['276', '392', '842'] });
    expect(byJob.markets.map((item) => item.country_code)).toEqual(['DE', 'JP', 'US']);

    // The stored fact-manifest checksum re-derives from the JSON read back out of PostgreSQL.
    for (const item of byJob.markets) {
      expect(item.integrity.fact_snapshot_checksum).toBeTruthy();
      expect(item.integrity.fact_snapshot_checksum_recomputed).toBe(item.integrity.fact_snapshot_checksum);
    }
    const germany = byJob.markets.find((item) => item.country_code === 'DE')!;
    expect(germany.tariff_evidence.map((row) => row.snapshot?.id)).toEqual([run.tariff.id, run.tariff.id]);
    expect(germany.market_access).toMatchObject({ tariff_rate_percent: 5, tariff_basis: 'ordinary_after_explicit_non_applicability' });

    const report = evaluatePhase1Gate({
      policy: fixturePolicy(run.hs6),
      evidence: [byJob],
      negative_probes: PROBES,
      evaluated_at: new Date(run.job.completed_at!.getTime() + 86_400_000),
      environment: TEST_ENVIRONMENT,
    });
    expect(report.summary.failed_checks).toEqual([]);
    expect(report.verdict).toBe('PASS_UNDER_PROPOSED_POLICY');
    const archetype = report.archetypes[0];
    expect(archetype.counts.assessed_markets).toBe(3);
    expect(archetype.counts.qualifying_markets_with_atlas_tariff_signal).toBeGreaterThanOrEqual(1);
    expect(archetype.markets.find((item) => item.country_code === 'DE')!.tariff).toMatchObject({
      atlas_tariff_signal: true, providers: [GATE_TARIC_PROVIDER], cited_snapshot_ids: [run.tariff.id], oldest_evidence_age_days: 3,
    });
    expect(stableJson(report)).toBe(stableJson(evaluatePhase1Gate({
      policy: fixturePolicy(run.hs6), evidence: [byProduct].map((item) => ({ ...item, selector: byJob.selector, selection_note: byJob.selection_note })),
      negative_probes: PROBES, evaluated_at: new Date(run.job.completed_at!.getTime() + 86_400_000), environment: TEST_ENVIRONMENT,
    })));
  }, 60_000);

  test('the evidence snapshot rejects writes at the database', async () => {
    const marker = `gate-readonly-${randomUUID()}`;
    await expect(withReadOnlySnapshot(prisma, async (db) => db.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.free } }))).rejects.toThrow(/read-only/i);
    expect(await prisma.exporterOrg.count({ where: { display_name: marker } })).toBe(0);
  });

  test('a product with no screen-derived run is reported, not silently skipped', async () => {
    const marker = `gate-empty-${randomUUID()}`;
    const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
    const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Unclassified', evidence_origin: EvidenceOrigin.fixture } });
    const evidence = await withReadOnlySnapshot(prisma, (db) => loadPhase1GateArchetypeEvidence(db, 'fixture', { kind: 'product', id: product.id }));
    expect(evidence.load_errors).toEqual(['no_current_confirmed_classification']);
    const report = evaluatePhase1Gate({ policy: fixturePolicy('950999'), evidence: [evidence], negative_probes: PROBES, evaluated_at: EVALUATED_AT, environment: TEST_ENVIRONMENT });
    expect(report.verdict).toBe('FAIL');
    expect(report.archetypes[0].checks.find((item) => item.id === 'evidence_load.complete')!.reasons).toEqual(['no_current_confirmed_classification']);
    expect(await prisma.job.count({ where: { type: JobType.country_truth_discovery, exporter_org_id: org.id } })).toBe(0);
  });
});
