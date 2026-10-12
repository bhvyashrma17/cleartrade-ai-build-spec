/**
 * Phase 1 acceptance gate policy (docs/34-phase-1-acceptance-gate.md).
 *
 * The gate answers one question: has Country Demand Discovery demonstrated, on staging and from
 * scratch, the evidence a bounded supervised launch needs? Every threshold below is an OWNER
 * decision, not an engineering default. A value the owner has not approved is recorded as
 * `proposed`, and the evaluator caps its verdict at `PASS_UNDER_PROPOSED_POLICY` while any value
 * is unapproved: a machine pass under thresholds nobody signed for is not a release pass.
 *
 * Changing a value is a versioned decision. Bump `policy_version`, record the decision in docs/34
 * and the programme evidence ledger (docs/35), and never edit an approved version in place — a
 * gate report cites the policy hash it was evaluated under, and that hash must keep meaning the
 * same thresholds.
 *
 * Where a value mirrors an existing repository constant, `basis` names that constant so the gate
 * and the pipeline cannot quietly drift apart.
 */
import { canonicalHash } from '@/lib/country-evidence/planner';

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
  schema_version: 'phase-1-gate-policy-v1';
  policy_version: string;
  /** Set only by an owner-approved change. Null means the policy as a whole is unapproved. */
  approval: { approved_by: string; approved_at: string; decision_reference: string } | null;
  release_posture: GateDecision<'supervised_exporter_facing_agents_run_screens'>;
  evidence_environment: GateDecision<{ required_environment: string }>;
  archetypes: GateDecision<Phase1GateArchetype[]>;
  classification: GateDecision<{ require_human_confirmation: boolean; allowed_confirmer_roles: string[] }>;
  destination_set: GateDecision<{ require_completed_global_screen: boolean }>;
  market_count: GateDecision<{ minimum_qualifying_markets_per_archetype: number }>;
  confidence: GateDecision<{ minimum_confidence_score: number }>;
  freshness: GateDecision<{
    maximum_period_lag_years: number;
    maximum_run_age_days: number;
    maximum_tariff_evidence_age_days: number;
    maximum_taric_evidence_age_days: number;
  }>;
  evidence_completeness: GateDecision<{
    required_components: string[];
    required_any_of: string[][];
    unavailable_components_require_reason: boolean;
  }>;
  tariff_evidence: GateDecision<{
    minimum_qualifying_markets_with_atlas_tariff_signal: number;
    atlas_evidence_origins: string[];
  }>;
  repeatability: GateDecision<{ verify_stored_checksums: boolean; require_replay_comparison: boolean }>;
  failure_semantics: GateDecision<{
    accepted_run_statuses: string[];
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
  'classification',
  'destination_set',
  'market_count',
  'confidence',
  'freshness',
  'evidence_completeness',
  'tariff_evidence',
  'repeatability',
  'failure_semantics',
  'sign_off',
] as const satisfies readonly (keyof Phase1GatePolicy)[];

export type Phase1GateDecisionKey = (typeof PHASE_1_GATE_DECISION_KEYS)[number];

/**
 * Phase 1 gate policy v1 — every value PROPOSED.
 *
 * Archetypes, the five-market minimum, the per-archetype Atlas tariff requirement and the
 * supervised posture come from the 11 October 2026 audit and were accepted on 12 October 2026 as
 * proposals to build against, not as approved release thresholds. Everything else is a proposal
 * made while building the gate, with its reasoning in `basis` and in docs/34.
 */
export const PHASE_1_GATE_POLICY_V1: Phase1GatePolicy = {
  schema_version: 'phase-1-gate-policy-v1',
  policy_version: 'phase-1-gate-v1',
  approval: null,
  release_posture: {
    value: 'supervised_exporter_facing_agents_run_screens',
    status: 'proposed',
    basis: 'Audit default: agents run screens and deep runs; exporters see persisted results. Matches the staff-only deep request in country-truth-deep-request.ts.',
  },
  evidence_environment: {
    value: { required_environment: 'staging' },
    status: 'proposed',
    basis: 'The gate certifies staging evidence. A report read from a development or test database must not be mistaken for it.',
  },
  archetypes: {
    value: [
      { key: 'rice', label: 'Rice, semi-milled or wholly milled', hs6: '100630', hs_revision: 'HS2022' },
      { key: 'brassware', label: 'Household articles of copper/brass', hs6: '741810', hs_revision: 'HS2022' },
      { key: 'carpets', label: 'Hand-knotted carpets of wool or fine animal hair', hs6: '570110', hs_revision: 'HS2022' },
    ],
    status: 'proposed',
    basis: 'Audit default: rice 100630 plus two non-rice archetypes (brassware and carpets). HS6 codes for the non-rice archetypes were proposed while building the gate; 830629 (base-metal ornaments) is the alternative brassware line.',
  },
  classification: {
    value: { require_human_confirmation: true, allowed_confirmer_roles: ['agent', 'ops_supervisor', 'admin'] },
    status: 'proposed',
    basis: 'requireCountryTruthClassification already refuses an unconfirmed classification; the gate additionally requires a staff confirmer and the confirming AuditEvent.',
  },
  destination_set: {
    value: { require_completed_global_screen: true },
    status: 'proposed',
    basis: 'The destination set is the frozen shortlist of a completed global screen (docs/31); a pilot run over hand-named countries cannot evidence global discovery.',
  },
  market_count: {
    value: { minimum_qualifying_markets_per_archetype: 5 },
    status: 'proposed',
    basis: 'Audit default: at least five rankable destination markets per archetype.',
  },
  confidence: {
    value: { minimum_confidence_score: 40 },
    status: 'proposed',
    basis: 'Computed with scoreCountryTruthV4 under default policies (pinned in tests/phase-1-gate.test.ts): a market with complete trade statistics only scores 48 / 38 / 31 confidence at 0 / 1 / 2 years of period lag, and 54 / 43 / 35 with an available tariff. A floor of 40 admits current trade-only markets and one-year-lagged markets that carry a tariff.',
  },
  freshness: {
    value: {
      maximum_period_lag_years: 2,
      maximum_run_age_days: 30,
      maximum_tariff_evidence_age_days: 180,
      maximum_taric_evidence_age_days: 45,
    },
    status: 'proposed',
    basis: 'Period lag mirrors discovery.scoring.confidence.accepted_reporting_lag_years (2) and country_period_selection max_fallback_lookback_years (2). Run age, tariff age and TARIC age are new proposals: TARIC is published monthly, so 45 days allows one missed edition plus two weeks.',
  },
  evidence_completeness: {
    value: {
      required_components: ['demand_strength'],
      required_any_of: [['growth_momentum', 'competitive_opportunity']],
      unavailable_components_require_reason: true,
    },
    status: 'proposed',
    basis: 'Mirrors country_truth.scoring_v4 ranking.require_demand and require_growth_or_competition. Every other pillar may be unavailable, but never without a stated reason.',
  },
  tariff_evidence: {
    value: {
      minimum_qualifying_markets_with_atlas_tariff_signal: 1,
      atlas_evidence_origins: ['public_real', 'imported_real'],
    },
    status: 'proposed',
    basis: 'Audit default: at least one Atlas-backed destination tariff per archetype. Requiring it for every qualifying market was considered and not proposed: many destinations publish a preference that needs origin proof, which correctly leaves the tariff signal unavailable.',
  },
  repeatability: {
    value: { verify_stored_checksums: true, require_replay_comparison: false },
    status: 'proposed',
    basis: 'The gate re-verifies every stored checksum link (metrics, manifest, fact manifest). A full re-execution replay is not proposed for the first gate; the report keeps every identity a later replay needs.',
  },
  failure_semantics: {
    value: {
      accepted_run_statuses: ['completed', 'partial'],
      require_negative_probe_record: true,
      required_negative_probes: [
        'unconfirmed_classification_refused',
        'incomplete_screen_refused',
        'provider_failure_not_minted_complete',
        'missing_tariff_reported_unavailable',
      ],
    },
    status: 'proposed',
    basis: 'Roadmap §8 failure cases. A partial run is acceptable only with explicit gaps; the negative probes are operator-attested records, each pointing at a staging observation or a CI test.',
  },
  sign_off: {
    value: { roles: ['product_owner', 'engineering_owner'] },
    status: 'proposed',
    basis: 'Roadmap WP1 review roles. Sign-off is recorded outside the evaluator; a machine verdict never freezes Phase 1 on its own.',
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
