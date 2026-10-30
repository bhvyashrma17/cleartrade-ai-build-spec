import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, OrgTier, type Prisma, ProductClassificationMethod, UserRole } from '@prisma/client';
import type { MetricResult } from '@/lib/demand-discovery-v5/metrics';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as V5, DEMAND_DISCOVERY_V5_MODEL, policyHash, type MetricKey } from '@/lib/demand-discovery-v5/policy';
import { rankMarkets, scoreMarket, type MarketScoreInput } from '@/lib/demand-discovery-v5/score';
import {
  assertValidPhase1GatePolicy,
  evaluatePhase1Gate,
  phase1GateExitCode,
  stableJson,
  type GateArchetypeEvidence,
  type GateCalibrationEvidence,
  type GateEnvironment,
  type GateMarketEvidence,
  type GateNegativeProbe,
  type Phase1GateInput,
  type Phase1GateReport,
} from '@/lib/phase-1-gate/evaluate';
import { loadPhase1GateArchetypeEvidence, parseGateSelector, withReadOnlySnapshot } from '@/lib/phase-1-gate/load';
import {
  PHASE_1_GATE_DECISION_KEYS,
  PHASE_1_GATE_POLICY_V2,
  phase1GatePolicyApproved,
  phase1GatePolicyHash,
  unapprovedPhase1GateDecisions,
  type GateDecision,
  type Phase1GatePolicy,
} from '@/lib/phase-1-gate/policy';
import { confirmClassification, proposeClassification } from '@/lib/product-classification';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/**
 * The Phase 1 gate, policy v2 (docs/34): Demand Discovery v5 runs only (D-036). The evaluator cases
 * use synthetic runs scored by v5's own scorer, so the stored values are exactly what a real run
 * stores and the scoring replay has something true to reproduce. The from-scratch case — a real run
 * through the job handler, read back through the loader — is in demand-discovery-v5-run.test.ts.
 */
const HASH = policyHash(V5);
const KEYS = Object.keys(V5.points) as MetricKey[];
/** 218 two-letter market codes, AA…IJ. */
const CODES = Array.from({ length: 218 }, (_, index) => String.fromCharCode(65 + Math.floor(index / 26)) + String.fromCharCode(65 + (index % 26)));
const EVALUATED_AT = new Date('2026-11-02T09:00:00Z');
const STAGING: GateEnvironment = { app_env: 'staging', database_environment: 'staging', database_fingerprint_prefix: '62587019d354', git_commit: 'abc1234' };
const PROBES: GateNegativeProbe[] = PHASE_1_GATE_POLICY_V2.failure_semantics.value.required_negative_probes.map((id) => ({
  id, method: 'ci_test', reference: `CI run 123: ${id}`, observed_at: '2026-10-30T10:00:00Z', outcome: 'refused', recorded_by: 'engineering_owner',
}));

/** Every market's metrics: all live (with official, estimated and connectivity-estimated duties and logistics), or only country risk. */
function metricsFor(index: number, live: 'all' | 'risk_only'): MetricResult[] {
  return KEYS.map((key, k): MetricResult => {
    if (live === 'risk_only' && key !== 'country_risk') return { key, score: null, quality: 0, reason: 'No trade dataset covers this market.', inputs: {} };
    // Markets 200–209 (HS…IB) lead the ranking in a known order, 99 down to 90; the rest score 89 at most.
    const score = index >= 200 && index < 210 ? 99 - (index - 200) : 20 + ((index * 37 + k * 11) % 70);
    if (key === 'duty') {
      return index % 4 === 0
        ? { key, score, quality: 1, reason: null, inputs: { basis: 'official', duty_percent: 5, source: 'fixture tariff' } }
        : { key, score, quality: 0.5, reason: null, estimated: true, inputs: { basis: 'estimate', duty_percent: 7.5, agreement_scope: 'none' } };
    }
    if (key === 'logistics' && index % 5 === 0) return { key, score, quality: 0.6, reason: null, estimated: true, inputs: { basis: 'lsci_estimate', predicted_lpi: 3.1 } };
    return { key, score, quality: 0.9, reason: null, inputs: {} };
  });
}

/** One run's 218 markets as writeV5Results stores them: 1 excluded, 5 without demand, 4 not ranked, 208 ranked. */
function storedMarkets(classificationId: string): GateMarketEvidence[] {
  const partnerOnly = (index: number) => index % 7 === 3;
  const inputs: MarketScoreInput[] = CODES.map((code, index) => ({
    market: code,
    gate: { excluded_reason: index === 0 ? 'Comprehensive UN sanctions (fixture).' : null, no_recorded_demand: index >= 1 && index <= 5, flag_reasons: index === 12 ? ['ECGC cover is restricted (Group II)'] : [] },
    metrics: index <= 5 ? [] : metricsFor(index, index <= 9 ? 'risk_only' : 'all'),
    data_year: index >= 6 && index <= 9 ? null : index % 9 === 0 ? 2023 : 2024,
  }));
  return rankMarkets(inputs.map((input) => scoreMarket(input, V5)), V5).map((market, index) => {
    const scored = market.status === 'ranked' || market.status === 'not_enough_data';
    return {
      assessment_id: `${classificationId}-${market.market}`,
      country_code: market.market,
      model_version: DEMAND_DISCOVERY_V5_MODEL,
      classification_id: classificationId,
      scoring_policy_hash: HASH,
      market_status: market.status,
      rank: market.rank,
      overall_score: market.overall,
      live_points: scored ? market.live_points : null,
      data_year: market.data_year,
      confidence_score: market.confidence == null ? 0 : Math.round(market.confidence * 100),
      handed_off: market.handed_off,
      excluded_reason: market.excluded_reason,
      flag_reasons: market.flag_reasons,
      label_keys: scored && partnerOnly(index) ? ['estimated_from_partners'] : [],
      breakdown: {
        overall_exact: market.overall_exact, quality: market.quality, confidence: market.confidence, lag: market.lag, has_shortfall: market.shortfall != null,
        partner_only: scored && partnerOnly(index),
        metrics: market.metrics.map((metric) => ({ key: metric.key, score: metric.score, quality: metric.quality, reason: metric.reason, estimated: metric.estimated === true, inputs: { ...metric.inputs } })),
      },
    };
  });
}

/** India's top 10: eight of the run's top 10 and two markets ranked further down. */
function calibrationFor(markets: GateMarketEvidence[]): GateCalibrationEvidence {
  const ranked = markets.filter((market) => market.rank != null).sort((a, b) => a.rank! - b.rank!);
  const top = ranked.slice(0, 10);
  const others = ranked.slice(10, 12);
  const india = [...top.slice(0, 8), ...others];
  return {
    status: 'computed', error: null, baci_release_id: 'baci-hs22', years: [2022, 2023, 2024], top: 10,
    india_top: india.map((market, index) => ({ market: market.country_code, usd: 9_000_000 - index * 100_000, status: market.market_status, rank: market.rank })),
    run_top: top.map((market) => ({ market: market.country_code, rank: market.rank! })),
    overlap: 8,
    missed: others.map((market) => ({ market: market.country_code, status: market.market_status, rank: market.rank })),
  };
}

function archetypeEvidence(key: string, hs6: string): GateArchetypeEvidence {
  const classificationId = `${key}-classification`;
  const markets = storedMarkets(classificationId);
  return {
    archetype_key: key,
    selector: `product:${key}-product`,
    selection_note: 'newest completed/partial v5 run for classification revision 1 (1 candidate(s) considered)',
    load_errors: [],
    product: { id: `${key}-product`, exporter_org_id: 'org-archetypes', hs_code: hs6 },
    classification: {
      id: classificationId, revision: 1, hs6_code: hs6, nomenclature_version: '2022', status: 'confirmed', confirmed_by_id: 'agent-1', confirmed_by_role: 'agent',
      confirmed_at: '2026-10-29T08:00:00.000Z', superseded_at: null, confirmation_audit_event_ids: [`audit-${key}`],
    },
    run: {
      id: `${key}-run`, model_version: DEMAND_DISCOVERY_V5_MODEL, status: 'completed', trigger: 'classification_confirmed', classification_id: classificationId, input_hs6: hs6,
      job_id: `${key}-job`, job_status: 'completed', as_of_date: '2026-10-29T08:00:01.000Z', created_at: '2026-10-29T08:00:01.000Z', started_at: '2026-10-29T08:00:05.000Z',
      completed_at: '2026-10-29T08:06:00.000Z', scoring_policy_hash: HASH, scoring_policy_snapshot: structuredClone(V5),
      frozen: {
        schema_version: 'fixture-inputs', policy_version: V5.policy_version, policy_hash: HASH, universe_version: 'fixture-universe', universe_size: 218,
        baci_release_id: 'baci-hs22', base_years: [2019, 2020, 2021, 2022, 2023, 2024],
      },
      notes: [],
      summary_markets: 218,
    },
    markets,
    calibration: calibrationFor(markets),
  };
}

const fullEvidence = () => PHASE_1_GATE_POLICY_V2.archetypes.value.map((archetype) => archetypeEvidence(archetype.key, archetype.hs6));
const evaluate = (overrides: Partial<Phase1GateInput> = {}) =>
  evaluatePhase1Gate({ policy: PHASE_1_GATE_POLICY_V2, evidence: fullEvidence(), negative_probes: PROBES, evaluated_at: EVALUATED_AT, environment: STAGING, ...overrides });
/** Evaluate with the rice run changed by `change`; the other two archetypes stay as they were. */
function evaluateRice(change: (rice: GateArchetypeEvidence) => void) {
  const evidence = fullEvidence();
  change(evidence[0]);
  return evaluate({ evidence });
}
const checkOf = (report: Phase1GateReport, id: string, archetype = 'rice') => report.archetypes.find((item) => item.archetype_key === archetype)!.checks.find((item) => item.id === id)!;
const marketAt = (rice: GateArchetypeEvidence, rank: number) => rice.markets.find((market) => market.rank === rank)!;

function approvedPolicy(): Phase1GatePolicy {
  const policy = structuredClone(PHASE_1_GATE_POLICY_V2);
  policy.approval = { approved_by: 'owner@test', approved_at: '2026-11-01T00:00:00Z', decision_reference: 'docs/35 D-0xx' };
  for (const key of PHASE_1_GATE_DECISION_KEYS) (policy[key] as GateDecision<unknown>).status = 'approved';
  return policy;
}

describe('policy v2', () => {
  test('every decision is proposed, the engine is v5, and the archetypes are unchanged', () => {
    expect(PHASE_1_GATE_POLICY_V2.policy_version).toBe('phase-1-gate-v2');
    expect(PHASE_1_GATE_POLICY_V2.approval).toBeNull();
    expect(unapprovedPhase1GateDecisions(PHASE_1_GATE_POLICY_V2)).toEqual([...PHASE_1_GATE_DECISION_KEYS]);
    expect(phase1GatePolicyApproved(PHASE_1_GATE_POLICY_V2)).toBe(false);
    expect(PHASE_1_GATE_POLICY_V2.engine.value.model_version).toBe(DEMAND_DISCOVERY_V5_MODEL);
    expect(PHASE_1_GATE_POLICY_V2.archetypes.value.map((archetype) => [archetype.key, archetype.hs6, archetype.hs_revision])).toEqual([['rice', '100630', 'HS2022'], ['brassware', '741810', 'HS2022'], ['carpets', '570110', 'HS2022']]);
    expect(PHASE_1_GATE_POLICY_V2.calibration.value.top).toBe(V5.ranking.handoff_count);
    expect(phase1GatePolicyHash(PHASE_1_GATE_POLICY_V2)).toMatch(/^[a-f0-9]{64}$/);
    expect(phase1GatePolicyHash(approvedPolicy())).not.toBe(phase1GatePolicyHash(PHASE_1_GATE_POLICY_V2));
    expect(() => assertValidPhase1GatePolicy(PHASE_1_GATE_POLICY_V2)).not.toThrow();
  });

  test('a policy the evaluator would misread is refused', () => {
    const share = structuredClone(PHASE_1_GATE_POLICY_V2);
    share.calibration.value.minimum_overlap_share = 1.5;
    expect(() => assertValidPhase1GatePolicy(share)).toThrow(/overlap share/);
    const both = structuredClone(PHASE_1_GATE_POLICY_V2);
    both.duty_evidence.value.forbidden_bases = ['agent_recorded', 'official'];
    expect(() => assertValidPhase1GatePolicy(both)).toThrow(/both official and forbidden/);
    const unknown = structuredClone(PHASE_1_GATE_POLICY_V2);
    (unknown.duty_evidence.value.official_bases as string[]).push('typed_by_hand');
    expect(() => assertValidPhase1GatePolicy(unknown)).toThrow(/unknown duty bases: typed_by_hand/);
    const v1 = structuredClone(PHASE_1_GATE_POLICY_V2) as unknown as { schema_version: string };
    v1.schema_version = 'phase-1-gate-policy-v1';
    expect(() => assertValidPhase1GatePolicy(v1 as unknown as Phase1GatePolicy)).toThrow(/is not phase-1-gate-policy-v2/);
  });
});

describe('evaluating v5 runs', () => {
  test('three complete runs pass under the proposed policy; only an approved policy gives PASS', () => {
    const report = evaluate();
    expect(report.summary).toEqual({ archetypes_required: 3, archetypes_passed: 3, failed_checks: [], unverified_checks: [] });
    expect(report.verdict).toBe('PASS_UNDER_PROPOSED_POLICY');
    expect(phase1GateExitCode(report.verdict)).toBe(10);
    expect(report.phase_1_frozen).toBe(false);
    expect(report.schema_version).toBe('phase-1-gate-report-v2');
    expect(report.policy.unapproved_decisions).toHaveLength(PHASE_1_GATE_DECISION_KEYS.length);
    const rice = report.archetypes[0];
    expect(rice.checks.map((item) => [item.id, item.status])).toEqual([
      ['evidence_load.complete', 'pass'], ['engine.v5_only', 'pass'], ['classification.confirmed', 'pass'], ['classification.confirmer_role', 'pass'],
      ['classification.audit_event', 'pass'], ['classification.matches_archetype', 'pass'], ['failure_semantics.run_status', 'pass'], ['coverage.every_market', 'pass'],
      ['market_count.minimum_ranked', 'pass'], ['calibration.india_top_overlap', 'pass'], ['evidence_labels.no_silent_zero', 'pass'], ['evidence_labels.estimates_labelled', 'pass'],
      ['duty_evidence.no_forbidden_basis', 'pass'], ['duty_evidence.official_in_top', 'pass'], ['freshness.run_age', 'pass'], ['freshness.base_data_lag', 'pass'],
      ['repeatability.policy_hash', 'pass'], ['repeatability.scoring_replay', 'pass'],
    ]);
    expect(rice.counts).toMatchObject({ universe_markets: 218, assessed_markets: 218, ranked: 208, not_enough_data: 4, no_recorded_demand: 5, excluded: 1 });
    expect(rice.counts.official_duty_in_top).toBeGreaterThanOrEqual(1);
    expect(rice.calibration).toMatchObject({ top: 10, overlap: 8, years: [2022, 2023, 2024] });
    expect(checkOf(report, 'calibration.india_top_overlap').detail).toBe('8 of India’s 10 largest destinations (2022, 2023, 2024) are in the run’s top 10 (at least 5 needed).');
    expect(rice.identities).toMatchObject({ discovery_run_id: 'rice-run', model_version: DEMAND_DISCOVERY_V5_MODEL, scoring_policy_version: V5.policy_version, scoring_policy_hash: HASH, baci_release_id: 'baci-hs22' });
    // The report says what each market rests on, without anyone opening the database.
    const excluded = rice.markets.find((market) => market.market_status === 'excluded')!;
    expect(excluded).toMatchObject({ country_code: 'AA', overall_score: null, rank: null, duty_basis: 'none', problems: [] });
    const notRanked = rice.markets.find((market) => market.country_code === 'AG')!;
    expect(notRanked).toMatchObject({ market_status: 'not_enough_data', live_points: 10 });
    expect(notRanked.unscored).toHaveLength(12);
    expect(notRanked.unscored[0]).toEqual({ metric: 'distance_fit', reason: 'No trade dataset covers this market.' });
    expect(rice.markets.find((market) => market.country_code === 'AK')!.estimated).toEqual(['duty', 'logistics', 'partner_figures']);

    const approved = evaluate({ policy: approvedPolicy() });
    expect(approved.verdict).toBe('PASS');
    expect(phase1GateExitCode(approved.verdict)).toBe(0);
  });

  test('the report is deterministic, and its checksum covers the evaluation time', () => {
    expect(stableJson(evaluate())).toBe(stableJson(evaluate()));
    expect(evaluate().report_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(evaluate({ evaluated_at: new Date('2026-11-03T09:00:00Z') }).report_checksum).not.toBe(evaluate().report_checksum);
  });

  test('a run from a retired engine fails and is not evaluated further (D-036)', () => {
    for (const model of ['country-truth-v4', null]) {
      const report = evaluateRice((rice) => {
        rice.run!.model_version = model;
        rice.markets = [];
        rice.calibration = null;
      });
      expect(report.verdict).toBe('FAIL');
      expect(report.summary.failed_checks).toEqual(['rice:engine.v5_only']);
      expect(checkOf(report, 'engine.v5_only')).toMatchObject({ status: 'fail', reasons: [`run_engine_${model ?? 'unrecorded'}_is_not_market-opportunity-v5`] });
      expect(report.archetypes[0].checks.map((item) => item.id)).toEqual([
        'evidence_load.complete', 'engine.v5_only', 'classification.confirmed', 'classification.confirmer_role', 'classification.audit_event', 'classification.matches_archetype',
      ]);
    }
    const mixed = evaluateRice((rice) => {
      rice.markets[20].model_version = 'country-truth-v4';
    });
    expect(checkOf(mixed, 'engine.v5_only').reasons).toEqual(['1_assessment(s)_from_another_engine']);
  });

  test('without the negative-probe record the gate is INCOMPLETE; a probe that did not fail closed fails it', () => {
    const none = evaluate({ negative_probes: null });
    expect(none.verdict).toBe('INCOMPLETE');
    expect(phase1GateExitCode(none.verdict)).toBe(2);
    expect(none.summary.unverified_checks).toEqual(['programme:failure_semantics.negative_probes']);
    expect(evaluate({ negative_probes: PROBES.slice(1) }).programme_checks[1]).toMatchObject({ status: 'unverified', reasons: ['negative_probe_missing:unconfirmed_classification_refused'] });
    const open = evaluate({ negative_probes: PROBES.map((probe) => (probe.id === 'agent_tariff_refused' ? { ...probe, outcome: 'accepted' as GateNegativeProbe['outcome'] } : probe)) });
    expect(open.verdict).toBe('FAIL');
    expect(open.programme_checks[1]).toMatchObject({ status: 'fail', reasons: ['negative_probe_did_not_fail_closed:agent_tariff_refused'] });
  });

  test('evidence not read from staging fails', () => {
    const report = evaluate({ environment: { ...STAGING, app_env: 'development', database_environment: 'development' } });
    expect(report.programme_checks[0]).toMatchObject({ status: 'fail', reasons: ['app_env_development_is_not_staging', 'database_environment_development_is_not_staging'] });
  });

  test('a run must finish completed, or partial with its notes, and agree with its job', () => {
    expect(checkOf(evaluateRice((rice) => { rice.run!.status = 'failed'; rice.run!.job_status = 'failed'; }), 'failure_semantics.run_status').reasons).toEqual(['run_status_failed']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.job_status = 'processing'; }), 'failure_semantics.run_status').reasons).toEqual(['job_status_processing_disagrees_with_run_status_completed']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.status = 'partial'; rice.run!.job_status = 'partial'; }), 'failure_semantics.run_status').reasons).toEqual(['partial_run_without_notes']);
    const explained = evaluateRice((rice) => {
      rice.run!.status = 'partial';
      rice.run!.job_status = 'partial';
      rice.run!.notes = ["The official tariff look-up failed for AD, so that market's duty is not the official rate this run."];
    });
    expect(checkOf(explained, 'failure_semantics.run_status')).toMatchObject({ status: 'pass', detail: 'Run partial with 1 note(s).' });
  });

  test('classification: a current staff confirmation with its audit event, for the archetype’s code, that the run scored', () => {
    expect(checkOf(evaluateRice((rice) => { rice.classification!.confirmed_by_role = 'exporter_owner'; }), 'classification.confirmer_role').reasons).toEqual(['classification_confirmer_role_exporter_owner']);
    const unconfirmed = evaluateRice((rice) => {
      rice.classification!.status = 'candidate';
      rice.classification!.confirmed_by_id = null;
      rice.classification!.confirmed_at = null;
    });
    expect(checkOf(unconfirmed, 'classification.confirmed').reasons).toEqual(['classification_status_candidate', 'classification_not_human_confirmed']);
    expect(checkOf(evaluateRice((rice) => { rice.classification!.confirmation_audit_event_ids = []; }), 'classification.audit_event').reasons).toEqual(['classification_confirmation_audit_event_missing']);
    expect(checkOf(evaluateRice((rice) => { rice.classification!.nomenclature_version = '2017'; }), 'classification.matches_archetype').reasons).toEqual(['classification_revision_2017_is_not_HS2022']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.input_hs6 = '100640'; }), 'classification.matches_archetype').reasons).toEqual(['run_scored_hs6_100640_not_100630']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.classification_id = 'another-classification'; }), 'classification.matches_archetype').reasons).toEqual(['run_was_not_produced_for_this_classification']);
    expect(checkOf(evaluateRice((rice) => { rice.classification = null; }), 'classification.present')).toMatchObject({ status: 'fail', reasons: ['classification_missing'] });
  });

  test('coverage: every market of the frozen universe, once, for the run’s classification', () => {
    // A market without demand leaves the ranking untouched, so only coverage notices it is gone.
    const missing = evaluateRice((rice) => { rice.markets.splice(3, 1); });
    expect(checkOf(missing, 'coverage.every_market').reasons).toEqual(['assessed_217_of_218_universe_markets', 'run_summary_counts_218_markets']);
    expect(missing.summary.failed_checks).toEqual(['rice:coverage.every_market']);
    const twice = evaluateRice((rice) => { rice.markets[3] = { ...rice.markets[4], assessment_id: 'copy' }; });
    expect(checkOf(twice, 'coverage.every_market').reasons).toEqual(['AE:assessed_2_times']);
    expect(checkOf(evaluateRice((rice) => { rice.markets[50].classification_id = 'another'; }), 'coverage.every_market').reasons).toEqual(['1_assessment(s)_for_another_classification']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.frozen.universe_size = null; }), 'coverage.every_market').reasons).toEqual(['frozen_universe_size_unknown']);
  });

  test('fewer ranked markets than the policy needs fails, tallying why the rest are not ranked', () => {
    const policy = structuredClone(PHASE_1_GATE_POLICY_V2);
    policy.market_count.value.minimum_ranked_markets = 209;
    expect(checkOf(evaluate({ policy }), 'market_count.minimum_ranked')).toMatchObject({
      status: 'fail', detail: '208 ranked market(s) of 218; 209 required.', reasons: ['no_recorded_demand: 5', 'not_enough_data: 4', 'excluded: 1'],
    });
  });

  test('calibration: a top 10 that leaves out most of India’s own destinations fails and names them (docs/36 §8)', () => {
    const missed = evaluateRice((rice) => {
      Object.assign(rice.calibration!, { overlap: 4, missed: [{ market: 'IR', status: 'ranked', rank: 112 }, { market: 'GN', status: 'not_enough_data', rank: null }, { market: 'ZZ', status: null, rank: null }] });
    });
    expect(checkOf(missed, 'calibration.india_top_overlap')).toMatchObject({
      status: 'fail', detail: '4 of India’s 10 largest destinations (2022, 2023, 2024) are in the run’s top 10; at least 5 needed.', reasons: ['missed:IR:rank_112', 'missed:GN:not_enough_data', 'missed:ZZ:not_assessed'],
    });
    const error = evaluateRice((rice) => { Object.assign(rice.calibration!, { status: 'error', error: 'Run r has not finished: no frozen BACI release or HS6.' }); });
    expect(checkOf(error, 'calibration.india_top_overlap').reasons).toEqual(['calibration_unavailable:Run r has not finished: no frozen BACI release or HS6.']);
    expect(checkOf(evaluateRice((rice) => { Object.assign(rice.calibration!, { india_top: [], overlap: 0, missed: [] }); }), 'calibration.india_top_overlap').reasons).toEqual(['no_india_exports_to_compare']);
    expect(checkOf(evaluateRice((rice) => { rice.calibration = null; }), 'calibration.india_top_overlap').reasons).toEqual(['calibration_not_run']);
    // With fewer than ten destinations, half of them, rounded up.
    const few = evaluateRice((rice) => { Object.assign(rice.calibration!, { india_top: rice.calibration!.india_top.slice(0, 3), overlap: 2, missed: [] }); });
    expect(checkOf(few, 'calibration.india_top_overlap')).toMatchObject({ status: 'pass', detail: expect.stringContaining('(at least 2 needed)') });
  });

  test('no silent zeros: every value rests on evidence or says why there is none', () => {
    let top = '';
    const report = evaluateRice((rice) => {
      rice.markets.find((market) => market.country_code === 'AG')!.breakdown!.metrics.find((metric) => metric.key === 'market_size')!.reason = '  ';
      const first = marketAt(rice, 1);
      top = first.country_code;
      first.breakdown!.metrics = first.breakdown!.metrics.filter((metric) => metric.key !== 'volume_fit');
      rice.markets[0].overall_score = 0;
      rice.markets.find((market) => market.country_code === 'AH')!.breakdown!.has_shortfall = false;
    });
    const silent = checkOf(report, 'evidence_labels.no_silent_zero');
    expect(silent.status).toBe('fail');
    expect(silent.reasons).toEqual(expect.arrayContaining(['AA:excluded_market_scored', 'AG:market_size_unscored_without_reason', 'AH:not_enough_data_without_shortfall', `${top}:volume_fit_missing`]));
    expect(report.archetypes[0].markets.find((market) => market.country_code === 'AG')!.problems).toEqual(['AG:market_size_unscored_without_reason']);
  });

  test('an estimate shown without its label fails (D-037)', () => {
    let duty = '';
    let partner = '';
    const report = evaluateRice((rice) => {
      const estimated = rice.markets.find((market) => market.market_status === 'ranked' && market.breakdown!.metrics.some((metric) => metric.key === 'duty' && metric.inputs.basis === 'estimate'))!;
      duty = estimated.country_code;
      estimated.breakdown!.metrics.find((metric) => metric.key === 'duty')!.estimated = false;
      const fromPartners = rice.markets.find((market) => market.breakdown?.partner_only && market.country_code !== duty)!;
      partner = fromPartners.country_code;
      fromPartners.label_keys = [];
    });
    expect(checkOf(report, 'evidence_labels.estimates_labelled').reasons.sort()).toEqual([`${duty}:duty_estimate_not_labelled`, `${partner}:partner_figures_not_labelled`].sort());
    // Neither change touches a score, so the replay still reproduces every one.
    expect(checkOf(report, 'repeatability.scoring_replay').status).toBe('pass');
  });

  test('a duty an agent read by hand fails (D-037); so does a top 10 without an official duty', () => {
    let code = '';
    const agent = evaluateRice((rice) => {
      const market = marketAt(rice, 3);
      code = market.country_code;
      Object.assign(market.breakdown!.metrics.find((metric) => metric.key === 'duty')!, { estimated: false, inputs: { basis: 'official', duty_percent: 5, recorded_by_agent: 'yes' } });
    });
    expect(checkOf(agent, 'duty_evidence.no_forbidden_basis').reasons).toEqual([`${code}:duty_basis_agent_recorded`]);
    const noOfficial = evaluateRice((rice) => {
      for (const metric of rice.markets.flatMap((market) => market.breakdown?.metrics ?? [])) {
        if (metric.key === 'duty' && metric.inputs.basis === 'official') Object.assign(metric, { estimated: true, inputs: { basis: 'estimate', duty_percent: 7.5 } });
      }
    });
    const official = checkOf(noOfficial, 'duty_evidence.official_in_top');
    expect(official).toMatchObject({ status: 'fail', detail: '0 of the top 10 carry an official duty; 1 required.' });
    expect(official.reasons).toHaveLength(10);
    expect(official.reasons[0]).toMatch(/^rank_1:[A-Z]{2}:estimate$/);
  });

  test('freshness: how long ago the run finished and how old its trade data was', () => {
    expect(checkOf(evaluate({ evaluated_at: new Date('2026-12-15T09:00:00Z') }), 'freshness.run_age').reasons).toEqual(['run_completed_47_days_before_evaluation']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.frozen.base_years = [2018, 2019, 2020, 2021, 2022, 2023]; }), 'freshness.base_data_lag').reasons).toEqual(['newest_base_year_2023_is_3_years_before_the_run']);
    expect(checkOf(evaluateRice((rice) => { rice.run!.frozen.base_years = []; }), 'freshness.base_data_lag').reasons).toEqual(['frozen_base_years_unknown']);
  });

  test('repeatability: the stored policy re-hashes, and every status, score, confidence and rank recomputes from the stored metrics', () => {
    let sixth = '';
    const edited = evaluateRice((rice) => {
      sixth = marketAt(rice, 6).country_code;
      (rice.run!.scoring_policy_snapshot as { ranking: { handoff_count: number } }).ranking.handoff_count = 5;
    });
    expect(checkOf(edited, 'repeatability.policy_hash').reasons).toEqual([
      'run_policy_hash_does_not_match_its_stored_policy', 'frozen_inputs_policy_hash_does_not_match_the_stored_policy', '218_assessment(s)_carry_another_policy_hash',
    ]);
    expect(checkOf(edited, 'repeatability.scoring_replay').reasons).toContain(`${sixth}:handed_off_replays_as_false_stored_true`);

    let first = '';
    let second = '';
    const swapped = evaluateRice((rice) => {
      const one = marketAt(rice, 1);
      const two = marketAt(rice, 2);
      [first, second] = [one.country_code, two.country_code];
      [one.rank, two.rank] = [2, 1];
    });
    expect(checkOf(swapped, 'repeatability.scoring_replay').reasons.sort()).toEqual([`${first}:rank_replays_as_1_stored_2`, `${second}:rank_replays_as_2_stored_1`].sort());

    let inflated = { code: '', overall: 0 };
    const nudged = evaluateRice((rice) => {
      const market = marketAt(rice, 4);
      inflated = { code: market.country_code, overall: market.overall_score! };
      market.overall_score! += 1;
    });
    expect(checkOf(nudged, 'repeatability.scoring_replay').reasons).toEqual([`${inflated.code}:overall_replays_as_${inflated.overall}_stored_${inflated.overall + 1}`]);

    let outOfRange = '';
    const broken = evaluateRice((rice) => {
      const market = marketAt(rice, 7);
      outOfRange = market.country_code;
      market.breakdown!.metrics.find((metric) => metric.key === 'growth')!.score = 140;
    });
    expect(checkOf(broken, 'repeatability.scoring_replay').reasons).toEqual([
      `${outOfRange}:replay_error:Metric growth for ${outOfRange} scored 140, outside 0–100.`, 'ranks_not_replayed_because_some_markets_could_not_be_scored',
    ]);
    expect(checkOf(broken, 'evidence_labels.no_silent_zero').reasons).toEqual([`${outOfRange}:growth_score_outside_0_100`]);

    const noSnapshot = evaluateRice((rice) => { rice.run!.scoring_policy_snapshot = null; });
    expect(checkOf(noSnapshot, 'repeatability.policy_hash').reasons).toEqual(['stored_policy_snapshot_missing_or_unreadable']);
    expect(checkOf(noSnapshot, 'repeatability.scoring_replay').reasons).toEqual(['stored_policy_snapshot_missing_or_unreadable']);
  });

  test('an archetype without evidence fails; evidence the policy cannot place is refused', () => {
    const report = evaluate({ evidence: fullEvidence().slice(1) });
    expect(report.archetypes[0].checks).toEqual([expect.objectContaining({ id: 'archetype.evidence_supplied', status: 'fail', reasons: ['archetype_evidence_not_supplied:rice'] })]);
    expect(() => evaluate({ evidence: [...fullEvidence(), archetypeEvidence('textiles', '520100')] })).toThrow(/does not define: textiles/);
    expect(() => evaluate({ evidence: [...fullEvidence(), archetypeEvidence('rice', '100630')] })).toThrow(/more than once: rice/);
  });

  test('selectors name a product or a v5 run; a job selector is refused with the reason', () => {
    expect(parseGateSelector('product:abc')).toEqual({ kind: 'product', id: 'abc' });
    expect(parseGateSelector(' run:cmveszorv000eue640z3rbw2v ')).toEqual({ kind: 'run', id: 'cmveszorv000eue640z3rbw2v' });
    expect(() => parseGateSelector('job:abc')).toThrow(/v5 runs only \(D-036\)/);
    expect(() => parseGateSelector('market:abc')).toThrow(/expected product:<id> or run:<id>/);
  });
});

describe('the loader, on database rows', () => {
  async function fixture() {
    const marker = `gate-v2-${randomUUID()}`;
    const hs6 = String(960_000 + Math.floor(Math.random() * 9_000));
    // A free tenant: confirming its code must not start a real v5 run in this shared schema (D-018).
    const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.free, country: 'IN' } });
    const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
    await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
    const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Gate v2 fixture product', evidence_origin: EvidenceOrigin.fixture } });
    const actor: Principal = { id: agent.id, email: agent.email, name: agent.name, role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
    // Proposed and confirmed through the product's own functions, so the confirming AuditEvent is the one production writes.
    const proposed = await proposeClassification({ product_id: product.id, hs6_code: hs6, nomenclature: 'HS', nomenclature_version: '2022', method: ProductClassificationMethod.agent_supplied, evidence: { source: 'gate-test' }, rationale: 'Gate v2 fixture.', confidence: 1 }, actor, marker);
    const classification = await confirmClassification({ classification_id: proposed.id, product_id: product.id }, actor, marker);
    expect(await prisma.discoveryRun.count({ where: { product_id: product.id } })).toBe(0);

    const hour = 3_600_000;
    const run = (data: { model_version: string | null; status: JobStatus; completed_ago_hours: number | null }) => prisma.discoveryRun.create({
      data: {
        exporter_org_id: org.id, product_id: product.id, classification_id: classification.id, model_version: data.model_version, status: data.status,
        completed_at: data.completed_ago_hours == null ? null : new Date(Date.now() - data.completed_ago_hours * hour), as_of_date: new Date(Date.now() - 3 * hour),
        input_snapshot: { hs_code: hs6 }, scoring_policy_hash: HASH, scoring_policy_snapshot: structuredClone(V5) as unknown as Prisma.InputJsonValue,
        frozen_inputs: { policy_version: V5.policy_version, policy_hash: HASH, universe: { version: 'fixture', size: 2 } }, summary: { markets: 2, notes: [] },
      },
    });
    const older = await run({ model_version: DEMAND_DISCOVERY_V5_MODEL, status: JobStatus.completed, completed_ago_hours: 2 });
    const newer = await run({ model_version: DEMAND_DISCOVERY_V5_MODEL, status: JobStatus.partial, completed_ago_hours: 1 });
    await run({ model_version: DEMAND_DISCOVERY_V5_MODEL, status: JobStatus.processing, completed_ago_hours: null });
    const earlier = await run({ model_version: null, status: JobStatus.completed, completed_ago_hours: 0 });
    const assessment = { run_id: newer.id, product_id: product.id, model_version: DEMAND_DISCOVERY_V5_MODEL, weight_profile_key: V5.policy_version, weight_profile_version: 1, classification_id: classification.id, scoring_policy_hash: HASH };
    await prisma.marketAssessment.createMany({
      data: [
        { ...assessment, country_code: 'US', market_status: 'ranked', rank: 1, overall_score: 80, live_points: 100, confidence_score: 90, data_year: 2024, score_breakdown: { overall_exact: 80, metrics: [{ key: 'duty', score: 80, quality: 0.5, reason: null, estimated: true, inputs: { basis: 'estimate', duty_percent: 5 } }, { key: 'growth', score: 'high' }] }, labels: [{ key: 'big_and_growing' }] },
        { ...assessment, country_code: 'KP', market_status: 'excluded', confidence_score: 0, eligibility_status: 'ineligible', eligibility_reasons: [{ code: 'excluded_market', reason: 'UN sanctions.' }], score_breakdown: { overall_exact: null, metrics: [] } },
      ],
    });
    return { product, classification, older, newer, earlier, hs6 };
  }

  test('product: picks the newest finished v5 run for the current confirmed classification, never an earlier engine’s', async () => {
    const f = await fixture();
    const evidence = await withReadOnlySnapshot(prisma, (db) => loadPhase1GateArchetypeEvidence(db, 'fixture', { kind: 'product', id: f.product.id }, { calibration_top: 10 }));
    expect(evidence.selection_note).toBe(`newest completed/partial v5 run for classification revision ${f.classification.revision} (2 candidate(s) considered)`);
    expect(evidence.run).toMatchObject({ id: f.newer.id, model_version: DEMAND_DISCOVERY_V5_MODEL, status: 'partial', input_hs6: f.hs6, classification_id: f.classification.id, frozen: { universe_size: 2, policy_hash: HASH, base_years: [] } });
    expect(evidence.classification).toMatchObject({ id: f.classification.id, status: 'confirmed', confirmed_by_role: 'agent', hs6_code: f.hs6, confirmation_audit_event_ids: [expect.any(String)] });
    expect(evidence.markets.map((market) => [market.country_code, market.market_status])).toEqual([['KP', 'excluded'], ['US', 'ranked']]);
    expect(evidence.markets[0]).toMatchObject({ excluded_reason: 'UN sanctions.', breakdown: { metrics: [] } });
    expect(evidence.markets[1]).toMatchObject({ label_keys: ['big_and_growing'], breakdown: { overall_exact: 80, metrics: [{ key: 'duty', estimated: true, inputs: { basis: 'estimate' } }, { key: 'growth', score: null }] } });
    // A score that is not a number is a load error, never a quiet null.
    expect(evidence.load_errors).toEqual(['metric_score_unreadable:US:growth']);
    // The run froze no BACI release, so the comparison could not be made, and the evidence says why.
    expect(evidence.calibration).toMatchObject({ status: 'error', error: expect.stringMatching(/no frozen BACI release/) });
  });

  test('run: an earlier engine’s run is read only far enough to fail the engine check', async () => {
    const f = await fixture();
    const evidence = await withReadOnlySnapshot(prisma, (db) => loadPhase1GateArchetypeEvidence(db, 'fixture', { kind: 'run', id: f.earlier.id }, { calibration_top: 10 }));
    expect(evidence).toMatchObject({ selector: `run:${f.earlier.id}`, selection_note: 'run named explicitly', markets: [], calibration: null, run: { model_version: null } });
    const policy = structuredClone(PHASE_1_GATE_POLICY_V2);
    policy.archetypes.value = [{ key: 'fixture', label: 'Fixture', hs6: f.hs6, hs_revision: 'HS2022' }];
    const report = evaluatePhase1Gate({ policy, evidence: [evidence], negative_probes: PROBES, evaluated_at: new Date(), environment: { ...STAGING, app_env: 'staging' } });
    expect(report.summary.failed_checks).toEqual(['fixture:engine.v5_only']);
    const missing = await withReadOnlySnapshot(prisma, (db) => loadPhase1GateArchetypeEvidence(db, 'fixture', { kind: 'run', id: 'no-such-run' }, { calibration_top: 10 }));
    expect(missing).toMatchObject({ run: null, load_errors: ['run_not_found'] });
  });

  test('the evidence snapshot is read-only: PostgreSQL refuses a write inside it', async () => {
    await expect(withReadOnlySnapshot(prisma, async (db) => db.exporterOrg.create({ data: { display_name: `gate-v2-${randomUUID()}`, tier: OrgTier.free } }))).rejects.toThrow(/read-only/i);
  });
});
