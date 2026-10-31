/**
 * Phase 1 acceptance gate policy (docs/34-phase-1-acceptance-gate.md).
 *
 * The gate answers one question: has Country Demand Discovery shown, on staging and from scratch,
 * the evidence a supervised launch needs? Since 30 Oct 2026 Demand Discovery means v5 only (D-036):
 * this policy evaluates `market-opportunity-v5` runs and nothing else. Policy v1, which evaluated
 * Country Truth v4 deep runs, is retired with that engine; git history keeps it.
 *
 * Every threshold below is an OWNER decision, not an engineering default. A value the owner has not
 * approved is recorded as `proposed`, and the evaluator caps its verdict at
 * `PASS_UNDER_PROPOSED_POLICY` while any value is unapproved: a machine pass under thresholds nobody
 * signed for is not a release pass.
 *
 * Changing a value is a versioned decision. Bump `policy_version`, record the decision in docs/34
 * and the programme evidence ledger (docs/35), and never edit an approved version in place — a gate
 * report cites the policy hash it was evaluated under, and that hash must keep meaning the same
 * thresholds.
 *
 * Where a value mirrors a Demand Discovery v5 setting, `basis` names it so the gate and the engine
 * cannot quietly drift apart.
 */
import { canonicalHash } from '@/lib/country-evidence/planner';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import type { DutyBasis } from '@/lib/demand-discovery-v5/duty-basis';
import type { MissExplanation } from '@/lib/demand-discovery-v5/calibration';

export type GateDecisionStatus = 'approved' | 'proposed';

/** One owner decision: its value, whether the owner has approved it, and why it is this value. */
export interface GateDecision<T> {
  value: T;
  status: GateDecisionStatus;
  basis: string;
}

export interface Phase1GateArchetype {
  /** Stable key used on the command line and in reports, e.g. `rice`. */
  key: string;
  label: string;
  /** Exact HS6 the archetype's staging product must be human-confirmed under. */
  hs6: string;
  /**
   * HS revision the confirmation must carry, e.g. `HS2022`. A classification may spell the same
   * revision `2022` or `HS2022` (product-classification.ts SUPPORTED_NOMENCLATURES), so comparisons
   * go through `normalizeHsRevision`.
   */
  hs_revision: string;
}

/** `2022` and `HS2022` name the same revision; compare them as `HS2022`. */
export function normalizeHsRevision(value: string): string {
  const upper = value.trim().toUpperCase();
  return /^\d{4}$/.test(upper) ? `HS${upper}` : upper;
}

export interface Phase1GatePolicy {
  schema_version: 'phase-1-gate-policy-v2';
  policy_version: string;
  /** Set only by an owner-approved change. Null means the policy as a whole is unapproved. */
  approval: { approved_by: string; approved_at: string; decision_reference: string } | null;
  release_posture: GateDecision<'exporter_facing_v5_starts_on_confirmed_hs'>;
  evidence_environment: GateDecision<{ required_environment: string }>;
  archetypes: GateDecision<Phase1GateArchetype[]>;
  engine: GateDecision<{ model_version: string }>;
  classification: GateDecision<{ require_human_confirmation: boolean; allowed_confirmer_roles: string[] }>;
  coverage: GateDecision<{ require_every_universe_market: boolean }>;
  market_count: GateDecision<{ minimum_ranked_markets: number }>;
  calibration: GateDecision<{ top: number; minimum_overlap_share: number; explained_misses: MissExplanation[] }>;
  evidence_labels: GateDecision<{ unscored_metric_requires_reason: boolean; estimates_must_be_labelled: boolean }>;
  duty_evidence: GateDecision<{
    forbidden_bases: DutyBasis[];
    official_bases: DutyBasis[];
    top: number;
    minimum_official_in_top: number;
  }>;
  freshness: GateDecision<{ maximum_run_age_days: number; maximum_base_data_lag_years: number }>;
  repeatability: GateDecision<{ verify_policy_hash: boolean; replay_scoring: boolean }>;
  failure_semantics: GateDecision<{
    accepted_run_statuses: string[];
    partial_requires_notes: boolean;
    require_negative_probe_record: boolean;
    required_negative_probes: string[];
  }>;
  sign_off: GateDecision<{ roles: string[] }>;
}

/** The dimensions an owner must approve, in report order. */
export const PHASE_1_GATE_DECISION_KEYS = [
  'release_posture',
  'evidence_environment',
  'archetypes',
  'engine',
  'classification',
  'coverage',
  'market_count',
  'calibration',
  'evidence_labels',
  'duty_evidence',
  'freshness',
  'repeatability',
  'failure_semantics',
  'sign_off',
] as const satisfies readonly (keyof Phase1GatePolicy)[];

export type Phase1GateDecisionKey = (typeof PHASE_1_GATE_DECISION_KEYS)[number];

/**
 * Phase 1 gate policy v2 — Demand Discovery v5 runs only (D-036), every value PROPOSED.
 *
 * The archetypes, the staging-only rule, the staff confirmation and the sign-off roles carry over
 * from v1 (accepted on 12 Oct 2026 as proposals to build against). Everything v5-specific was
 * proposed on 30 Oct 2026 while building this version, with its reasoning in `basis` and docs/34.
 */
export const PHASE_1_GATE_POLICY_V3: Phase1GatePolicy = {
  schema_version: 'phase-1-gate-policy-v2',
  policy_version: 'phase-1-gate-v3',
  approval: null,
  release_posture: {
    value: 'exporter_facing_v5_starts_on_confirmed_hs',
    status: 'proposed',
    basis: 'D-018: confirming a product’s HS code starts v5 for a paid tenant, and the exporter reads the results under Markets. The gate’s own evidence is made by staff (see classification).',
  },
  evidence_environment: {
    value: { required_environment: 'staging' },
    status: 'proposed',
    basis: 'Unchanged from v1. The gate certifies staging evidence; a report read from a development or test database must not be mistaken for it.',
  },
  archetypes: {
    value: [
      { key: 'rice', label: 'Rice, semi-milled or wholly milled', hs6: '100630', hs_revision: 'HS2022' },
      { key: 'brassware', label: 'Household articles of copper/brass', hs6: '741810', hs_revision: 'HS2022' },
      { key: 'carpets', label: 'Hand-knotted carpets of wool or fine animal hair', hs6: '570110', hs_revision: 'HS2022' },
    ],
    status: 'proposed',
    basis: 'Unchanged from v1 (audit default, D-003): rice 100630 plus brassware 741810 and carpets 570110; 830629 is the alternative brassware line. scripts/dd5-archetype-runs.ts makes the staging products and starts their v5 runs.',
  },
  engine: {
    value: { model_version: DEMAND_DISCOVERY_V5_MODEL },
    status: 'proposed',
    basis: 'Owner, 30 Oct 2026 (D-036): the acceptance gates do not run old v4s. A run from any other engine fails and is not evaluated further.',
  },
  classification: {
    value: { require_human_confirmation: true, allowed_confirmer_roles: ['agent', 'ops_supervisor', 'admin'] },
    status: 'proposed',
    basis: 'Unchanged from v1. Staff propose and confirm each archetype’s code (scripts/dd5-archetype-runs.ts start), and the confirmation writes the AuditEvent the gate requires. An exporter confirming its own code still starts v5 in the portal, but that run is not gate evidence.',
  },
  coverage: {
    value: { require_every_universe_market: true },
    status: 'proposed',
    basis: 'docs/36: v5 scores every product in every market of the screening universe (218), and the run freezes the universe it used (frozen_inputs.universe). Fewer assessments than that universe is an incomplete run.',
  },
  market_count: {
    value: { minimum_ranked_markets: 10 },
    status: 'proposed',
    basis: 'The top 10 is what v5 hands to regional and buyer discovery (ranking.handoff_count) and what the calibration compares, so a run needs ten ranked markets. Staging runs on 19 Oct ranked 188–214 (ledger E-026).',
  },
  calibration: {
    value: { top: 10, minimum_overlap_share: 0.5, explained_misses: ['ecgc_off_cover', 'ecgc_restricted', 'sanctions'] },
    status: 'proposed',
    basis: 'docs/36 §8: a top 10 that leaves out more than half of India’s own ten largest destinations for the product (in the BACI release and years the run used) is a calibration failure. On 19 Oct staging rice (3/10) and brassware (4/10) failed and carpets (8/10) passed (E-026); on 31 Oct under v8 rice 4/10, brassware 7/10, carpets 9/10 (E-044). Owner, 31 Oct 2026 (E-045): a miss outside the top 10 with restricted or no ECGC cover, or a sanctions flag, counts towards the share. Restricted or no cover caps the payment-risk measure, so those markets rank lower by design; a flag never changes a score, and a flagged market is accepted as one not to steer a first-time exporter to. The results page lists India’s own markets with the run’s reason for each. Across India’s top 100 exports, 88 passed before this rule (E-044).',
  },
  evidence_labels: {
    value: { unscored_metric_requires_reason: true, estimates_must_be_labelled: true },
    status: 'proposed',
    basis: 'Owner, 30 Oct 2026 (D-037): Demand Discovery shows actual data or labelled estimates. A metric without data has no score and says why — never a zero; a duty estimated from tariff averages and a logistics score estimated from shipping connectivity carry the estimate mark; a market measured only from its partners’ figures carries that label.',
  },
  duty_evidence: {
    value: { forbidden_bases: ['agent_recorded'], official_bases: ['official', 'common_tariff', 'schedule_read'], top: 10, minimum_official_in_top: 1 },
    status: 'proposed',
    basis: 'D-037: no duty an agent read by hand. At least one of the top 10 must carry an official tariff read automatically (a connected source, a customs union’s common tariff or a retained schedule), so the official path is shown working on the markets that matter. Staging runs had 19–47 official markets each (E-026).',
  },
  freshness: {
    value: { maximum_run_age_days: 30, maximum_base_data_lag_years: 2 },
    status: 'proposed',
    basis: 'Run age as v1. CEPII publishes BACI yearly with data to two years earlier (the 2026 release ends in 2024), so a run whose newest base year is more than two years before the run used an old release. Between New Year and the new release’s import this fails, by design.',
  },
  repeatability: {
    value: { verify_policy_hash: true, replay_scoring: true },
    status: 'proposed',
    basis: 'A v5 run freezes its policy and hash (docs/36 §7). The gate re-hashes the stored policy, then recomputes every market’s status, score, confidence and rank from its stored metrics under that policy (score.ts). Recomputing the metrics from the source datasets is not proposed: frozen_inputs pins each release by checksum.',
  },
  failure_semantics: {
    value: {
      accepted_run_statuses: ['completed', 'partial'],
      partial_requires_notes: true,
      require_negative_probe_record: true,
      required_negative_probes: [
        'unconfirmed_classification_refused',
        'earlier_engine_refused',
        'provider_failure_left_partial',
        'missing_duty_never_zero',
        'agent_tariff_refused',
      ],
    },
    status: 'proposed',
    basis: 'A partial run (a provider step failed) is acceptable only with notes saying what is missing. The five negative probes are operator-attested records, each pointing at a staging observation or a CI test (docs/34 §6.3); two cover the owner’s 30 Oct decisions (D-036, D-037).',
  },
  sign_off: {
    value: { roles: ['product_owner', 'engineering_owner'] },
    status: 'proposed',
    basis: 'Unchanged from v1 (roadmap WP1 review roles). Sign-off is recorded outside the evaluator; a machine verdict never freezes Phase 1 on its own.',
  },
};

/** True only when the policy as a whole AND every individual decision has been approved. */
export function phase1GatePolicyApproved(policy: Phase1GatePolicy): boolean {
  return policy.approval != null && unapprovedPhase1GateDecisions(policy).length === 0;
}

export function unapprovedPhase1GateDecisions(policy: Phase1GatePolicy): Phase1GateDecisionKey[] {
  return PHASE_1_GATE_DECISION_KEYS.filter((key) => policy[key].status !== 'approved');
}

/** The identity a report cites. Any change to any value — or to its approval — changes it. */
export function phase1GatePolicyHash(policy: Phase1GatePolicy): string {
  return canonicalHash(policy);
}
