/**
 * Phase 1H deterministic Country Truth calculations.
 *
 * This module deliberately owns no IO. Callers must select and freeze facts before invoking it.
 * Every fact carries the assessment scope it was selected for, an assertion class, and an
 * explicit presence state. A missing fact therefore has no numeric value that could accidentally
 * enter arithmetic as zero.
 */

export type AssertionClass =
  | 'authoritative_public'
  | 'exporter_declared'
  | 'agent_verified'
  | 'partner_quote'
  /** Computed by ClearTrade from its own versioned policy, e.g. the ClearTrade fee. */
  | 'system_derived'
  /**
   * Licensed commercial trade content attributing a fact to a customs authority ClearTrade did
   * not query directly. Admissible only under an approval in `market-access/licensed-providers`.
   */
  | 'licensed_authoritative_content'
  | 'unknown_legacy';

export type FactState = 'present' | 'missing' | 'unknown' | 'confirmed_absent';

export interface ExactFactScope {
  exporter_org_id?: string;
  country_code: string;
  hs6: string;
  hs_revision: string;
  /** Frozen calculation clock, serialized as an ISO-8601 instant. */
  as_of_date: string;
}

export interface FactProvenance {
  assertion_class: AssertionClass;
  source: string;
  source_reference: string;
  /** When ClearTrade knew this fact. Future knowledge is never admitted to an assessment. */
  retrieved_at: string;
}

interface ScopedFactBase {
  id: string;
  scope: ExactFactScope;
  provenance: FactProvenance;
  /** Evidence quality only. It never changes a fact's value or an attractiveness score. */
  confidence: number;
  /** Identifies the subject of a non-present fact, such as a certification code. */
  subject_key?: string;
}

export interface PresentScopedFact<T> extends ScopedFactBase {
  state: 'present';
  value: T;
}

export interface NonPresentScopedFact extends ScopedFactBase {
  state: 'missing' | 'unknown' | 'confirmed_absent';
  value?: never;
  reason: string;
}

export type ScopedFact<T> = PresentScopedFact<T> | NonPresentScopedFact;

export interface CalculationIdentity {
  formula_version: string;
  calculation_version: string;
}

export interface AssertionConfidencePolicy {
  assertion_class_multipliers: Record<AssertionClass, number>;
}

export interface ExcludedFact {
  fact_id: string;
  reason: string;
}

export interface CalculationProvenance {
  formula_version: string;
  calculation_version: string;
  scope: ExactFactScope;
  used_fact_ids: string[];
  assertion_classes: AssertionClass[];
  excluded_facts: ExcludedFact[];
  details: Record<string, unknown>;
}

export type CalculationStatus =
  | 'available'
  | 'partial'
  | 'unavailable'
  | 'blocked'
  /** The market side is known but ClearTrade holds no usable first-party exporter fact. */
  | 'insufficient_exporter_data';

const DAY_MS = 86_400_000;

const clamp = (value: number, minimum = 0, maximum = 100) =>
  Math.min(maximum, Math.max(minimum, value));

const round = (value: number, digits = 8) => Number(value.toFixed(digits));

function timestamp(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validIdentity(identity: CalculationIdentity) {
  if (!identity.formula_version.trim() || !identity.calculation_version.trim()) {
    throw new Error('Phase 1H policies require formula_version and calculation_version.');
  }
}

/**
 * The scope tariff selection runs in. Without a separate tariff clock it is the calculation scope
 * itself. With one, it must describe the same question at a later-or-equal instant — anything else
 * would let a tariff for another market, product or tenant through.
 */
function resolveTariffScope(scope: ExactFactScope, tariffScope: ExactFactScope | undefined): ExactFactScope {
  if (!tariffScope) return scope;
  const asOf = timestamp(scope.as_of_date);
  const tariffAsOf = timestamp(tariffScope.as_of_date);
  if (
    tariffScope.country_code !== scope.country_code ||
    tariffScope.hs6 !== scope.hs6 ||
    tariffScope.hs_revision !== scope.hs_revision ||
    (tariffScope.exporter_org_id ?? null) !== (scope.exporter_org_id ?? null) ||
    asOf == null ||
    tariffAsOf == null ||
    tariffAsOf < asOf
  ) {
    throw new Error('A tariff scope must match the calculation scope and must not precede its clock.');
  }
  return tariffScope;
}

function validScope(scope: ExactFactScope) {
  return (
    /^[A-Z]{2}$/.test(scope.country_code) &&
    /^\d{6}$/.test(scope.hs6) &&
    scope.hs_revision.trim().length > 0 &&
    timestamp(scope.as_of_date) != null &&
    (scope.exporter_org_id == null || scope.exporter_org_id.trim().length > 0)
  );
}

/**
 * Public facts may be globally scoped. Every private assertion must carry and exactly match the
 * exporter tenant, preventing partner quotes or exporter declarations from crossing tenants.
 */
export function exactScopeMatches(
  expected: ExactFactScope,
  actual: ExactFactScope,
  assertionClass: AssertionClass,
) {
  if (!validScope(expected) || !validScope(actual)) return false;
  if (
    expected.country_code !== actual.country_code ||
    expected.hs6 !== actual.hs6 ||
    expected.hs_revision !== actual.hs_revision ||
    timestamp(expected.as_of_date) !== timestamp(actual.as_of_date)
  ) {
    return false;
  }
  if (actual.exporter_org_id != null && actual.exporter_org_id !== expected.exporter_org_id) {
    return false;
  }
  if (assertionClass !== 'authoritative_public') {
    return Boolean(
      expected.exporter_org_id && actual.exporter_org_id === expected.exporter_org_id,
    );
  }
  return true;
}

function sortExclusions(excluded: ExcludedFact[]) {
  return [...excluded].sort(
    (left, right) =>
      left.fact_id.localeCompare(right.fact_id) || left.reason.localeCompare(right.reason),
  );
}

function provenance(
  identity: CalculationIdentity,
  scope: ExactFactScope,
  used: ScopedFact<unknown>[],
  excluded: ExcludedFact[],
  details: Record<string, unknown>,
): CalculationProvenance {
  return {
    formula_version: identity.formula_version,
    calculation_version: identity.calculation_version,
    scope: { ...scope },
    used_fact_ids: [...new Set(used.map((fact) => fact.id))].sort(),
    assertion_classes: [
      ...new Set(used.map((fact) => fact.provenance.assertion_class)),
    ].sort() as AssertionClass[],
    excluded_facts: sortExclusions(excluded),
    details,
  };
}

function factEnvelopeExclusion<T>(
  fact: ScopedFact<T>,
  scope: ExactFactScope,
  allowedClasses: readonly AssertionClass[],
): string | null {
  if (fact.provenance.assertion_class === 'unknown_legacy') {
    return 'unknown_legacy_assertion_is_not_usable';
  }
  if (!allowedClasses.includes(fact.provenance.assertion_class)) {
    return `assertion_class_${fact.provenance.assertion_class}_not_allowed`;
  }
  if (!exactScopeMatches(scope, fact.scope, fact.provenance.assertion_class)) {
    return 'scope_mismatch';
  }
  if (!Number.isFinite(fact.confidence) || fact.confidence < 0 || fact.confidence > 100) {
    return 'invalid_evidence_confidence';
  }
  const retrievedAt = timestamp(fact.provenance.retrieved_at);
  const asOf = timestamp(scope.as_of_date)!;
  if (retrievedAt == null) return 'invalid_retrieved_at';
  if (retrievedAt > asOf) return 'evidence_retrieved_after_assessment_clock';
  if (!fact.provenance.source.trim() || !fact.provenance.source_reference.trim()) {
    return 'incomplete_provenance';
  }
  return null;
}

function commonFactExclusion<T>(
  fact: ScopedFact<T>,
  scope: ExactFactScope,
  allowedClasses: readonly AssertionClass[],
): string | null {
  if (fact.state !== 'present') return `fact_state_${fact.state}`;
  return factEnvelopeExclusion(fact, scope, allowedClasses);
}

function currentAt(
  asOfDate: string,
  effectiveFrom: string,
  effectiveTo?: string | null,
) {
  const asOf = timestamp(asOfDate);
  const from = timestamp(effectiveFrom);
  const to = effectiveTo == null ? null : timestamp(effectiveTo);
  if (asOf == null || from == null || (effectiveTo != null && to == null)) return false;
  return from <= asOf && (to == null || to > asOf);
}

function ageDays(asOfDate: string, observedAt: string) {
  const asOf = timestamp(asOfDate);
  const observed = timestamp(observedAt);
  if (asOf == null || observed == null) return null;
  return (asOf - observed) / DAY_MS;
}

function withinAge(asOfDate: string, observedAt: string, maximumAgeDays: number) {
  const age = ageDays(asOfDate, observedAt);
  return age != null && age >= 0 && age <= maximumAgeDays;
}

function validCurrency(value: string) {
  return /^[A-Z]{3}$/.test(value);
}

function validUnit(value: string) {
  return value.trim().length > 0;
}

function effectiveConfidence(
  fact: ScopedFact<unknown>,
  policy: AssertionConfidencePolicy,
) {
  return clamp(
    fact.confidence * policy.assertion_class_multipliers[fact.provenance.assertion_class],
  );
}

function validateConfidencePolicy(policy: AssertionConfidencePolicy) {
  for (const assertionClass of [
    'authoritative_public',
    'exporter_declared',
    'agent_verified',
    'partner_quote',
    'system_derived',
    'unknown_legacy',
  ] as const) {
    const multiplier = policy.assertion_class_multipliers[assertionClass];
    if (!Number.isFinite(multiplier) || multiplier < 0 || multiplier > 1) {
      throw new Error(`Invalid confidence multiplier for ${assertionClass}.`);
    }
  }
  if (policy.assertion_class_multipliers.unknown_legacy !== 0) {
    throw new Error('unknown_legacy evidence must have a zero confidence multiplier.');
  }
  if (policy.assertion_class_multipliers.exporter_declared >= 1) {
    throw new Error('Exporter-declared evidence must carry an explicit confidence reduction.');
  }
}

function newestFirst<T extends { effective_from: string }>(
  facts: PresentScopedFact<T>[],
) {
  return [...facts].sort((left, right) => {
    const effective = timestamp(right.value.effective_from)! - timestamp(left.value.effective_from)!;
    if (effective) return effective;
    const retrieved =
      timestamp(right.provenance.retrieved_at)! - timestamp(left.provenance.retrieved_at)!;
    return retrieved || left.id.localeCompare(right.id);
  });
}

// ---------------------------------------------------------------------------
// Applicable India tariff
// ---------------------------------------------------------------------------

export type IndiaPreferenceApplicability = 'applicable' | 'not_applicable' | 'unknown';

export interface TariffFactValue {
  tariff_type: 'ordinary' | 'india_preference';
  /** The normalized origin to which this tariff determination applies. Must be IN. */
  origin_country: string;
  /** Null is allowed only on an explicit preference-not-applicable determination. */
  rate_percent: number | null;
  preference_applicability?: IndiaPreferenceApplicability;
  effective_from: string;
  effective_to?: string | null;
}

export interface TariffSelectionPolicyV2 extends CalculationIdentity {
  minimum_evidence_confidence: number;
}

export interface ApplicableIndiaTariffResult {
  status: 'available' | 'unavailable';
  rate_percent: number | null;
  tariff_basis: 'india_preference' | 'ordinary_after_explicit_non_applicability' | null;
  confidence: number;
  reasons: string[];
  provenance: CalculationProvenance;
}

export function selectApplicableIndiaTariff(
  scope: ExactFactScope,
  facts: readonly ScopedFact<TariffFactValue>[],
  policy: TariffSelectionPolicyV2,
): ApplicableIndiaTariffResult {
  validIdentity(policy);
  if (!validScope(scope)) throw new Error('Applicable tariff selection requires a valid exact scope.');
  if (
    !Number.isFinite(policy.minimum_evidence_confidence) ||
    policy.minimum_evidence_confidence < 0 ||
    policy.minimum_evidence_confidence > 100
  ) {
    throw new Error('Invalid tariff minimum_evidence_confidence.');
  }

  const excluded: ExcludedFact[] = [];
  const current: PresentScopedFact<TariffFactValue>[] = [];
  for (const fact of [...facts].sort((left, right) => left.id.localeCompare(right.id))) {
    const common = commonFactExclusion(fact, scope, ['authoritative_public']);
    if (common) {
      excluded.push({ fact_id: fact.id, reason: common });
      continue;
    }
    const present = fact as PresentScopedFact<TariffFactValue>;
    if (present.value.origin_country !== 'IN') {
      excluded.push({ fact_id: fact.id, reason: 'origin_country_is_not_IN' });
      continue;
    }
    if (
      !currentAt(
        scope.as_of_date,
        present.value.effective_from,
        present.value.effective_to,
      )
    ) {
      excluded.push({ fact_id: fact.id, reason: 'tariff_not_current_at_assessment_clock' });
      continue;
    }
    if (present.confidence < policy.minimum_evidence_confidence) {
      excluded.push({ fact_id: fact.id, reason: 'tariff_confidence_below_policy_minimum' });
      continue;
    }
    if (!['ordinary', 'india_preference'].includes(present.value.tariff_type)) {
      excluded.push({ fact_id: fact.id, reason: 'invalid_tariff_type' });
      continue;
    }
    current.push(present);
  }

  const preferences = newestFirst(
    current.filter((fact) => fact.value.tariff_type === 'india_preference'),
  );
  const preference = preferences[0];
  if (!preference) {
    return {
      status: 'unavailable',
      rate_percent: null,
      tariff_basis: null,
      confidence: 0,
      reasons: ['A current authoritative India-preference applicability determination is unavailable.'],
      provenance: provenance(policy, scope, [], excluded, {
        origin_country: 'IN',
        preference_applicability: 'unresolved',
      }),
    };
  }

  if (preference.value.preference_applicability === 'applicable') {
    if (
      preference.value.rate_percent == null ||
      !Number.isFinite(preference.value.rate_percent) ||
      preference.value.rate_percent < 0
    ) {
      excluded.push({ fact_id: preference.id, reason: 'applicable_preference_has_no_valid_rate' });
      return {
        status: 'unavailable',
        rate_percent: null,
        tariff_basis: null,
        confidence: 0,
        reasons: ['The applicable India preference has no valid ad-valorem rate.'],
        provenance: provenance(policy, scope, [], excluded, {
          origin_country: 'IN',
          preference_applicability: 'applicable',
        }),
      };
    }
    return {
      status: 'available',
      rate_percent: preference.value.rate_percent,
      tariff_basis: 'india_preference',
      confidence: round(preference.confidence, 4),
      reasons: [],
      provenance: provenance(policy, scope, [preference], excluded, {
        origin_country: 'IN',
        preference_applicability: 'applicable',
      }),
    };
  }

  if (preference.value.preference_applicability !== 'not_applicable') {
    return {
      status: 'unavailable',
      rate_percent: null,
      tariff_basis: null,
      confidence: 0,
      reasons: ['India preference applicability is unknown; ordinary duty cannot be assumed.'],
      provenance: provenance(policy, scope, [preference], excluded, {
        origin_country: 'IN',
        preference_applicability: preference.value.preference_applicability ?? 'unresolved',
      }),
    };
  }

  const ordinary = newestFirst(
    current.filter(
      (fact) =>
        fact.value.tariff_type === 'ordinary' &&
        fact.value.rate_percent != null &&
        Number.isFinite(fact.value.rate_percent) &&
        fact.value.rate_percent >= 0,
    ),
  )[0];
  if (!ordinary) {
    return {
      status: 'unavailable',
      rate_percent: null,
      tariff_basis: null,
      confidence: 0,
      reasons: ['Preference is explicitly not applicable, but no current ordinary tariff exists.'],
      provenance: provenance(policy, scope, [preference], excluded, {
        origin_country: 'IN',
        preference_applicability: 'not_applicable',
      }),
    };
  }
  return {
    status: 'available',
    rate_percent: ordinary.value.rate_percent,
    tariff_basis: 'ordinary_after_explicit_non_applicability',
    confidence: round(Math.min(preference.confidence, ordinary.confidence), 4),
    reasons: [],
    provenance: provenance(policy, scope, [preference, ordinary], excluded, {
      origin_country: 'IN',
      preference_applicability: 'not_applicable',
    }),
  };
}

// ---------------------------------------------------------------------------
// Shared money handling
// ---------------------------------------------------------------------------

export interface FxRateValue {
  base_currency: string;
  quote_currency: string;
  /** The only accepted direction: quote-currency units for one base-currency unit. */
  direction: 'quote_per_base';
  rate: number;
  rate_date: string;
}

export interface FxSelectionPolicy {
  allowed_fx_assertion_classes: AssertionClass[];
  maximum_fx_age_days: number;
}

type MoneyConversion =
  | { ok: true; amount: number; fx: PresentScopedFact<FxRateValue> | null }
  | { ok: false; reason: string };

/**
 * Converts an amount between currencies using an exact, dated, direction-explicit FX fact.
 *
 * A same-currency conversion consumes no FX fact at all, so an unrelated rate can never be
 * multiplied in. A cross-currency conversion without an exactly matching pair fails rather than
 * inverting or chaining rates, because an inverted mid-rate is a different economic quantity.
 */
function convertMoney(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  fxFacts: readonly ScopedFact<FxRateValue>[],
  scope: ExactFactScope,
  policy: FxSelectionPolicy,
  excluded: ExcludedFact[],
): MoneyConversion {
  if (!validCurrency(fromCurrency) || !validCurrency(toCurrency)) {
    return { ok: false, reason: 'invalid_currency_code' };
  }
  if (fromCurrency === toCurrency) return { ok: true, amount, fx: null };

  const candidates: PresentScopedFact<FxRateValue>[] = [];
  for (const fact of [...fxFacts].sort((left, right) => left.id.localeCompare(right.id))) {
    const common = commonFactExclusion(fact, scope, policy.allowed_fx_assertion_classes);
    if (common) {
      excluded.push({ fact_id: fact.id, reason: common });
      continue;
    }
    const present = fact as PresentScopedFact<FxRateValue>;
    if (
      present.value.base_currency !== fromCurrency ||
      present.value.quote_currency !== toCurrency ||
      present.value.direction !== 'quote_per_base'
    ) {
      excluded.push({ fact_id: present.id, reason: 'fx_pair_or_direction_mismatch' });
      continue;
    }
    if (!Number.isFinite(present.value.rate) || present.value.rate <= 0) {
      excluded.push({ fact_id: present.id, reason: 'fx_rate_invalid' });
      continue;
    }
    if (!withinAge(scope.as_of_date, present.value.rate_date, policy.maximum_fx_age_days)) {
      excluded.push({ fact_id: present.id, reason: 'fx_rate_outside_date_policy' });
      continue;
    }
    candidates.push(present);
  }
  const selected = [...candidates].sort((left, right) => {
    const dated = timestamp(right.value.rate_date)! - timestamp(left.value.rate_date)!;
    return dated || left.id.localeCompare(right.id);
  })[0];
  if (!selected) return { ok: false, reason: `fx_unavailable_${fromCurrency}_${toCurrency}` };
  return { ok: true, amount: amount * selected.value.rate, fx: selected };
}

function newestByObservation<T extends { observed_at: string }>(facts: PresentScopedFact<T>[]) {
  return [...facts].sort((left, right) => {
    const observed = timestamp(right.value.observed_at)! - timestamp(left.value.observed_at)!;
    if (observed) return observed;
    const retrieved =
      timestamp(right.provenance.retrieved_at)! - timestamp(left.provenance.retrieved_at)!;
    return retrieved || left.id.localeCompare(right.id);
  })[0];
}

function weightedConfidence(
  entries: Array<{ configured_weight: number; confidence: number }>,
): number {
  const total = entries.reduce((sum, entry) => sum + entry.configured_weight, 0);
  if (!total) return 0;
  return Math.round(
    (entries.reduce((sum, entry) => sum + entry.configured_weight * (entry.confidence / 100), 0) /
      total) *
      100,
  );
}

export interface SubSignal {
  score: number | null;
  confidence: number;
  configured_weight: number;
  effective_weight: number;
  status: 'available' | 'unavailable';
  reasons: string[];
  evidence_ids: string[];
}

function unavailableSignal(weight: number, reason: string): SubSignal {
  return {
    score: null,
    confidence: 0,
    configured_weight: weight,
    effective_weight: 0,
    status: 'unavailable',
    reasons: [reason],
    evidence_ids: [],
  };
}

function availableSignal(
  weight: number,
  score: number,
  confidence: number,
  evidenceIds: string[],
  reasons: string[] = [],
): SubSignal {
  return {
    score: Math.round(clamp(score)),
    confidence: Math.round(clamp(confidence)),
    configured_weight: weight,
    effective_weight: 0,
    status: 'available',
    reasons,
    evidence_ids: [...new Set(evidenceIds)].sort(),
  };
}

/**
 * Renormalizes over the sub-signals that actually have evidence. An unavailable signal is
 * removed from the denominator instead of contributing a zero, so "we do not know" can never be
 * read as "this market scores badly".
 */
function combineSignals(signals: Record<string, SubSignal>) {
  const entries = Object.entries(signals);
  const weighted = entries.filter(
    ([, signal]) => signal.score != null && signal.configured_weight > 0,
  );
  const availableWeight = weighted.reduce((sum, [, signal]) => sum + signal.configured_weight, 0);
  const configuredWeight = entries.reduce(
    (sum, [, signal]) => sum + signal.configured_weight,
    0,
  );
  for (const [, signal] of entries) signal.effective_weight = 0;
  for (const [, signal] of weighted) signal.effective_weight = signal.configured_weight / availableWeight;
  const score = availableWeight
    ? Math.round(
        weighted.reduce((sum, [, signal]) => sum + signal.score! * signal.configured_weight, 0) /
          availableWeight,
      )
    : null;
  const confidence = weightedConfidence(
    entries.map(([, signal]) => ({
      configured_weight: signal.configured_weight,
      confidence: signal.score == null ? 0 : signal.confidence,
    })),
  );
  const complete =
    availableWeight > 0 &&
    availableWeight === configuredWeight;
  return { score, confidence, available_weight: availableWeight, configured_weight: configuredWeight, complete };
}

// ---------------------------------------------------------------------------
// Market Access v2
// ---------------------------------------------------------------------------

export type MarketAccessRequirementType =
  | 'prohibition'
  | 'restriction'
  | 'mandatory_certification'
  | 'other_document';

export interface MarketAccessRequirementValue {
  requirement_type: MarketAccessRequirementType;
  requirement_code: string | null;
  description: string;
  /** Explicitly tri-state. `unknown` is never silently read as `yes`. */
  obtainable: 'yes' | 'no' | 'unknown';
  effective_from: string;
  effective_to?: string | null;
  observed_at: string;
}

/**
 * Proof that the regulatory corpus for this destination and HS scope was retrieved completely.
 * Without it, "no restriction row exists" is an absence of evidence, not evidence of absence.
 */
export interface RegulatoryCoverageValue {
  tariff_coverage: boolean;
  regulatory_coverage: boolean;
  completeness: 'COMPLETE' | 'PARTIAL' | 'FAILED' | 'STALE';
  observed_at: string;
  effective_from: string;
  effective_to?: string | null;
}

export interface MarketAccessV2Policy extends CalculationIdentity, AssertionConfidencePolicy {
  weights: { tariff: number; regulatory: number };
  tariff_policy: TariffSelectionPolicyV2;
  /** Ad-valorem rate at or above which the tariff sub-signal scores zero. */
  tariff_zero_score_percent: number;
  requirement_penalties: Record<Exclude<MarketAccessRequirementType, 'prohibition'>, number>;
  /** Additional penalty when a live requirement's obtainability is unresolved. */
  unresolved_obtainability_penalty: number;
  maximum_requirement_age_days: number;
  maximum_coverage_age_days: number;
  allowed_assertion_classes: AssertionClass[];
}

export interface MarketAccessV2Input {
  scope: ExactFactScope;
  tariffs: readonly ScopedFact<TariffFactValue>[];
  requirements: readonly ScopedFact<MarketAccessRequirementValue>[];
  regulatory_coverage?: ScopedFact<RegulatoryCoverageValue>;
  /**
   * The scope tariff facts are evaluated in when the run admits tariff evidence on its own clock
   * (WP2, owner decision D-004 in docs/35). Identical to `scope` except for a later-or-equal
   * `as_of_date`. Only tariff selection uses it; every other fact is evaluated in `scope`.
   */
  tariff_scope?: ExactFactScope;
}

export interface MarketAccessBlocker {
  code: 'destination_import_prohibition' | 'mandatory_requirement_explicitly_unobtainable';
  requirement_type: MarketAccessRequirementType;
  requirement_code: string | null;
  fact_id: string;
}

export interface MarketAccessV2Result {
  status: CalculationStatus;
  /** Null whenever blocked, so a legal gate can never be averaged away by a good tariff. */
  score: number | null;
  /** Reconciliation only. Ranking on this value while blocked is a defect. */
  soft_score: number | null;
  confidence: number;
  reasons: string[];
  blockers: MarketAccessBlocker[];
  applicable_tariff: ApplicableIndiaTariffResult;
  sub_signals: Record<'tariff' | 'regulatory', SubSignal>;
  provenance: CalculationProvenance;
}

function validateMarketAccessPolicy(policy: MarketAccessV2Policy) {
  validIdentity(policy);
  validIdentity(policy.tariff_policy);
  validateConfidencePolicy(policy);
  const weights = Object.values(policy.weights);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => weight > 0)) {
    throw new Error('Market Access weights must be non-negative with at least one positive weight.');
  }
  if (!Number.isFinite(policy.tariff_zero_score_percent) || policy.tariff_zero_score_percent <= 0) {
    throw new Error('Market Access tariff_zero_score_percent must be positive.');
  }
  for (const penalty of [
    ...Object.values(policy.requirement_penalties),
    policy.unresolved_obtainability_penalty,
  ]) {
    if (!Number.isFinite(penalty) || penalty < 0 || penalty > 100) {
      throw new Error('Market Access penalties must be between 0 and 100.');
    }
  }
  for (const age of [policy.maximum_requirement_age_days, policy.maximum_coverage_age_days]) {
    if (!Number.isFinite(age) || age < 0) throw new Error('Market Access ages must be non-negative.');
  }
}

export function calculateMarketAccessV2(
  input: MarketAccessV2Input,
  policy: MarketAccessV2Policy,
): MarketAccessV2Result {
  validateMarketAccessPolicy(policy);
  if (!validScope(input.scope)) throw new Error('Market Access requires a valid exact scope.');

  const excluded: ExcludedFact[] = [];
  const used: ScopedFact<unknown>[] = [];
  const tariffScope = resolveTariffScope(input.scope, input.tariff_scope);
  const tariff = selectApplicableIndiaTariff(tariffScope, input.tariffs, policy.tariff_policy);
  excluded.push(...tariff.provenance.excluded_facts);
  const tariffFacts = input.tariffs.filter((fact) => tariff.provenance.used_fact_ids.includes(fact.id));
  used.push(...tariffFacts);

  const signals: MarketAccessV2Result['sub_signals'] = {
    tariff:
      tariff.status === 'available' && tariff.rate_percent != null
        ? availableSignal(
            policy.weights.tariff,
            100 - (tariff.rate_percent / policy.tariff_zero_score_percent) * 100,
            Math.min(...tariffFacts.map((fact) => effectiveConfidence(fact, policy)), 100),
            tariff.provenance.used_fact_ids,
          )
        : unavailableSignal(
            policy.weights.tariff,
            tariff.reasons[0] ?? 'No tariff applicable to Indian origin is available.',
          ),
    regulatory: unavailableSignal(
      policy.weights.regulatory,
      'No COMPLETE regulatory coverage proof exists; absent restrictions are unknown, not absent.',
    ),
  };

  // Requirements are evaluated regardless of coverage: a retrieved prohibition blocks the market
  // even when the wider corpus is incomplete. Only the *absence* of requirements needs coverage.
  const currentRequirements: PresentScopedFact<MarketAccessRequirementValue>[] = [];
  for (const fact of [...input.requirements].sort((left, right) => left.id.localeCompare(right.id))) {
    const common = commonFactExclusion(fact, input.scope, policy.allowed_assertion_classes);
    if (common) {
      excluded.push({ fact_id: fact.id, reason: common });
      continue;
    }
    const present = fact as PresentScopedFact<MarketAccessRequirementValue>;
    if (!currentAt(input.scope.as_of_date, present.value.effective_from, present.value.effective_to)) {
      excluded.push({ fact_id: present.id, reason: 'requirement_not_in_force_at_assessment_clock' });
      continue;
    }
    if (!withinAge(input.scope.as_of_date, present.value.observed_at, policy.maximum_requirement_age_days)) {
      excluded.push({ fact_id: present.id, reason: 'requirement_evidence_stale_or_future_dated' });
      continue;
    }
    currentRequirements.push(present);
  }

  const blockers: MarketAccessBlocker[] = [];
  for (const requirement of currentRequirements) {
    if (requirement.value.requirement_type === 'prohibition') {
      blockers.push({
        code: 'destination_import_prohibition',
        requirement_type: 'prohibition',
        requirement_code: requirement.value.requirement_code,
        fact_id: requirement.id,
      });
    } else if (requirement.value.obtainable === 'no') {
      blockers.push({
        code: 'mandatory_requirement_explicitly_unobtainable',
        requirement_type: requirement.value.requirement_type,
        requirement_code: requirement.value.requirement_code,
        fact_id: requirement.id,
      });
    }
  }
  if (blockers.length) used.push(...currentRequirements);

  const coverageExclusion = input.regulatory_coverage
    ? commonFactExclusion(input.regulatory_coverage, input.scope, policy.allowed_assertion_classes)
    : 'fact_state_missing';
  const coverage =
    input.regulatory_coverage && !coverageExclusion
      ? (input.regulatory_coverage as PresentScopedFact<RegulatoryCoverageValue>)
      : null;
  if (input.regulatory_coverage && coverageExclusion) {
    excluded.push({ fact_id: input.regulatory_coverage.id, reason: coverageExclusion });
  }
  const coverageUsable =
    coverage != null &&
    coverage.value.regulatory_coverage &&
    coverage.value.completeness === 'COMPLETE' &&
    currentAt(input.scope.as_of_date, coverage.value.effective_from, coverage.value.effective_to) &&
    withinAge(input.scope.as_of_date, coverage.value.observed_at, policy.maximum_coverage_age_days);
  if (coverage && !coverageUsable) {
    excluded.push({ fact_id: coverage.id, reason: 'regulatory_coverage_incomplete_or_stale' });
  }

  const requirementReasons: string[] = [];
  if (coverageUsable && coverage) {
    let penalty = 0;
    const softRequirements = currentRequirements.filter(
      (fact) => fact.value.requirement_type !== 'prohibition',
    );
    for (const requirement of softRequirements) {
      const type = requirement.value.requirement_type as Exclude<
        MarketAccessRequirementType,
        'prohibition'
      >;
      penalty += policy.requirement_penalties[type];
      if (requirement.value.obtainable === 'unknown') {
        penalty += policy.unresolved_obtainability_penalty;
        requirementReasons.push(
          `${requirement.value.requirement_code ?? type}: obtainability is unresolved.`,
        );
      }
    }
    const evidence = [coverage.id, ...softRequirements.map((fact) => fact.id)];
    signals.regulatory = availableSignal(
      policy.weights.regulatory,
      100 - penalty,
      Math.min(
        effectiveConfidence(coverage, policy),
        ...softRequirements.map((fact) => effectiveConfidence(fact, policy)),
        100,
      ),
      evidence,
      requirementReasons,
    );
    used.push(coverage, ...softRequirements);
  }

  const combined = combineSignals(signals);
  const blocked = blockers.length > 0;
  const status: CalculationStatus = blocked
    ? 'blocked'
    : combined.score == null
      ? 'unavailable'
      : combined.complete
        ? 'available'
        : 'partial';
  const reasons = Object.entries(signals).flatMap(([name, signal]) =>
    signal.status === 'unavailable' ? signal.reasons.map((reason) => `${name}: ${reason}`) : [],
  );

  return {
    status,
    score: blocked ? null : combined.score,
    soft_score: combined.score,
    confidence: combined.confidence,
    reasons,
    blockers: blockers.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        (left.requirement_code ?? '').localeCompare(right.requirement_code ?? '') ||
        left.fact_id.localeCompare(right.fact_id),
    ),
    applicable_tariff: tariff,
    sub_signals: signals,
    provenance: provenance(policy, input.scope, used, excluded, {
      tariff_basis: tariff.tariff_basis,
      tariff_rate_percent: tariff.rate_percent,
      ...(input.tariff_scope ? { tariff_as_of_date: tariffScope.as_of_date } : {}),
      regulatory_coverage_proved_complete: coverageUsable,
      absent_requirement_is_unknown_without_complete_coverage: true,
      blockers_are_not_weighted: true,
      current_requirement_fact_ids: currentRequirements.map((fact) => fact.id).sort(),
    }),
  };
}

// ---------------------------------------------------------------------------
// Export Economics v3
// ---------------------------------------------------------------------------

export type ExportCostComponentCode =
  | 'packaging'
  | 'inland_transport'
  | 'origin_charges'
  | 'international_freight'
  | 'insurance'
  | 'destination_charges'
  | 'financing'
  | 'cleartrade_fee';

export const EXPORT_COST_COMPONENTS: readonly ExportCostComponentCode[] = Object.freeze([
  'packaging',
  'inland_transport',
  'origin_charges',
  'international_freight',
  'insurance',
  'destination_charges',
  'financing',
  'cleartrade_fee',
]);

/** Components that form part of a CIF customs value, in buildup order. */
const CIF_CUSTOMS_COMPONENTS: readonly ExportCostComponentCode[] = Object.freeze([
  'packaging',
  'inland_transport',
  'origin_charges',
  'international_freight',
  'insurance',
]);

/** Components that form part of an FOB customs value. */
const FOB_CUSTOMS_COMPONENTS: readonly ExportCostComponentCode[] = Object.freeze([
  'packaging',
  'inland_transport',
  'origin_charges',
]);

export type CustomsValuationBasis = 'CIF' | 'FOB';

export interface ExporterPriceValue {
  amount_per_unit: number;
  currency: string;
  quantity_unit: string;
  /** The Incoterm that defines which downstream costs this price already carries. */
  incoterm: string;
  declared_at: string;
}

export interface ExportCostComponentValue {
  component: ExportCostComponentCode;
  amount_per_unit: number;
  currency: string;
  quantity_unit: string;
  observed_at: string;
  valid_until?: string | null;
}

export interface ImportBenchmarkValue {
  value_per_unit: number;
  currency: string;
  quantity_unit: string;
  valuation_basis: 'CIF';
  observed_at: string;
  effective_from: string;
  effective_to?: string | null;
}

export interface CustomsValuationBasisValue {
  basis: CustomsValuationBasis;
  effective_from: string;
  effective_to?: string | null;
  observed_at: string;
}

export interface ExportEconomicsV3Policy
  extends CalculationIdentity,
    AssertionConfidencePolicy,
    FxSelectionPolicy {
  tariff_policy: TariffSelectionPolicyV2;
  /**
   * Cost components already carried by an exporter price quoted at each Incoterm. A separately
   * supplied fact for an owned component is recorded and excluded rather than added twice.
   */
  incoterm_cost_ownership: Record<string, readonly ExportCostComponentCode[]>;
  /** Components that must be known before a landed cost may be published at all. */
  required_cost_components: readonly ExportCostComponentCode[];
  allowed_price_assertion_classes: AssertionClass[];
  allowed_benchmark_assertion_classes: AssertionClass[];
  allowed_cost_assertion_classes: AssertionClass[];
  allowed_customs_basis_assertion_classes: AssertionClass[];
  /**
   * Declared destination valuation rule, used only when no authoritative evidence fact exists.
   * This is a stated ClearTrade policy, hashed into the assessment identity, not fabricated
   * evidence: an unlisted destination stays unknown rather than defaulting to a base.
   */
  customs_valuation_basis_by_country: Record<string, CustomsValuationBasis>;
  maximum_price_age_days: number;
  maximum_benchmark_age_days: number;
  maximum_cost_component_age_days: number;
  maximum_customs_basis_age_days: number;
  full_score_at_or_below_ratio: number;
  zero_score_at_or_above_ratio: number;
}

export interface ExportEconomicsV3Input {
  scope: ExactFactScope;
  exporter_price: ScopedFact<ExporterPriceValue>;
  benchmark: ScopedFact<ImportBenchmarkValue>;
  tariffs: readonly ScopedFact<TariffFactValue>[];
  cost_components: readonly ScopedFact<ExportCostComponentValue>[];
  fx_rates: readonly ScopedFact<FxRateValue>[];
  customs_valuation_basis?: ScopedFact<CustomsValuationBasisValue>;
  /**
   * The scope tariff facts are evaluated in when the run admits tariff evidence on its own clock
   * (WP2, owner decision D-004 in docs/35). Identical to `scope` except for a later-or-equal
   * `as_of_date`. Only tariff selection uses it; every other fact is evaluated in `scope`.
   */
  tariff_scope?: ExactFactScope;
}

export interface ExportEconomicsComponentBreakdown {
  component: ExportCostComponentCode;
  /** `bundled_in_price` proves the component was recognized and deliberately not re-added. */
  treatment: 'added' | 'bundled_in_price' | 'missing';
  amount: number | null;
  in_customs_value: boolean;
  fact_id: string | null;
}

export interface ExportEconomicsV3Result {
  status: 'available' | 'partial' | 'unavailable';
  score: number | null;
  confidence: number;
  reasons: string[];
  amounts: {
    currency: string;
    quantity_unit: string;
    exporter_price: number;
    customs_valuation_basis: CustomsValuationBasis;
    customs_value: number;
    duty_rate_percent: number;
    duty_amount: number;
    cif_equivalent_cost: number;
    total_landed_cost: number;
    benchmark_value: number;
    cif_equivalent_ratio_to_benchmark: number;
    landed_ratio_to_benchmark: number;
  } | null;
  components: ExportEconomicsComponentBreakdown[];
  /** True when an optional component was unknown, so the landed cost is a lower bound. */
  cost_stack_incomplete: boolean;
  provenance: CalculationProvenance;
}

function validateExportEconomicsPolicy(policy: ExportEconomicsV3Policy) {
  validIdentity(policy);
  validIdentity(policy.tariff_policy);
  validateConfidencePolicy(policy);
  for (const value of [
    policy.maximum_price_age_days,
    policy.maximum_benchmark_age_days,
    policy.maximum_cost_component_age_days,
    policy.maximum_customs_basis_age_days,
    policy.maximum_fx_age_days,
  ]) {
    if (!Number.isFinite(value) || value < 0) throw new Error('Evidence ages must be non-negative.');
  }
  if (
    !Number.isFinite(policy.full_score_at_or_below_ratio) ||
    !Number.isFinite(policy.zero_score_at_or_above_ratio) ||
    policy.full_score_at_or_below_ratio <= 0 ||
    policy.zero_score_at_or_above_ratio <= policy.full_score_at_or_below_ratio
  ) {
    throw new Error('Invalid Export Economics ratio scoring band.');
  }
  for (const [incoterm, owned] of Object.entries(policy.incoterm_cost_ownership)) {
    if (!/^[A-Z]{3}$/.test(incoterm)) throw new Error(`Invalid Incoterm key ${incoterm}.`);
    for (const component of owned) {
      if (!EXPORT_COST_COMPONENTS.includes(component)) {
        throw new Error(`Incoterm ${incoterm} declares unknown cost component ${component}.`);
      }
    }
  }
  for (const component of policy.required_cost_components) {
    if (!EXPORT_COST_COMPONENTS.includes(component)) {
      throw new Error(`Unknown required cost component ${component}.`);
    }
  }
  for (const [country, basis] of Object.entries(policy.customs_valuation_basis_by_country)) {
    if (!/^[A-Z]{2}$/.test(country) || (basis !== 'CIF' && basis !== 'FOB')) {
      throw new Error(`Invalid declared customs valuation basis for ${country}.`);
    }
  }
}

function ratioScore(ratio: number, fullAt: number, zeroAt: number) {
  if (ratio <= fullAt) return 100;
  if (ratio >= zeroAt) return 0;
  return Math.round(((zeroAt - ratio) / (zeroAt - fullAt)) * 100);
}

function unavailableEconomics(
  input: ExportEconomicsV3Input,
  policy: ExportEconomicsV3Policy,
  reasons: string[],
  used: ScopedFact<unknown>[],
  excluded: ExcludedFact[],
  components: ExportEconomicsComponentBreakdown[] = [],
  details: Record<string, unknown> = {},
): ExportEconomicsV3Result {
  return {
    status: 'unavailable',
    score: null,
    confidence: 0,
    reasons,
    amounts: null,
    components,
    cost_stack_incomplete: true,
    provenance: provenance(policy, input.scope, used, excluded, details),
  };
}

/**
 * Builds a complete per-unit landed cost from an exporter price plus every cost the exporter's
 * Incoterm does not already carry, then applies destination duty on the destination's own
 * customs base.
 *
 * The three failure modes this shape exists to prevent: adding a cost the Incoterm already
 * bundled, treating an unknown cost as zero, and taking duty on the wrong valuation base.
 */
export function calculateExportEconomicsV3(
  input: ExportEconomicsV3Input,
  policy: ExportEconomicsV3Policy,
): ExportEconomicsV3Result {
  validateExportEconomicsPolicy(policy);
  if (!validScope(input.scope)) throw new Error('Export Economics requires a valid exact scope.');

  const excluded: ExcludedFact[] = [];
  const used: ScopedFact<unknown>[] = [];
  const priceExclusion = commonFactExclusion(
    input.exporter_price,
    input.scope,
    policy.allowed_price_assertion_classes,
  );
  if (priceExclusion) excluded.push({ fact_id: input.exporter_price.id, reason: priceExclusion });
  const benchmarkExclusion = commonFactExclusion(
    input.benchmark,
    input.scope,
    policy.allowed_benchmark_assertion_classes,
  );
  if (benchmarkExclusion) excluded.push({ fact_id: input.benchmark.id, reason: benchmarkExclusion });
  if (priceExclusion || benchmarkExclusion) {
    return unavailableEconomics(
      input,
      policy,
      ['A present, exact-scope exporter price and import benchmark are required.'],
      used,
      excluded,
    );
  }

  const price = input.exporter_price as PresentScopedFact<ExporterPriceValue>;
  const benchmark = input.benchmark as PresentScopedFact<ImportBenchmarkValue>;
  used.push(price, benchmark);
  const settlementCurrency = benchmark.value.currency;
  const quantityUnit = benchmark.value.quantity_unit;
  const reasons: string[] = [];
  if (!Number.isFinite(price.value.amount_per_unit) || price.value.amount_per_unit <= 0) {
    reasons.push('The exporter price must be strictly positive.');
  }
  if (!Number.isFinite(benchmark.value.value_per_unit) || benchmark.value.value_per_unit <= 0) {
    reasons.push('The import benchmark must be strictly positive.');
  }
  if (!validCurrency(settlementCurrency) || !validCurrency(price.value.currency)) {
    reasons.push('Price and benchmark currencies must be explicit ISO-style currency codes.');
  }
  if (!validUnit(quantityUnit) || price.value.quantity_unit !== quantityUnit) {
    reasons.push('The exporter price and benchmark quantity units must match exactly.');
  }
  if (benchmark.value.valuation_basis !== 'CIF') {
    reasons.push('The import benchmark must be explicitly CIF-valued.');
  }
  if (
    !currentAt(input.scope.as_of_date, benchmark.value.effective_from, benchmark.value.effective_to) ||
    !withinAge(input.scope.as_of_date, benchmark.value.observed_at, policy.maximum_benchmark_age_days)
  ) {
    reasons.push('The import benchmark is not current at the assessment clock.');
  }
  if (!withinAge(input.scope.as_of_date, price.value.declared_at, policy.maximum_price_age_days)) {
    reasons.push('The exporter price is stale or dated after the assessment clock.');
  }
  const incoterm = price.value.incoterm.trim().toUpperCase();
  const owned = policy.incoterm_cost_ownership[incoterm];
  if (!owned) {
    reasons.push(`Incoterm ${incoterm || '(none)'} has no declared cost-ownership rule.`);
  }
  if (reasons.length) {
    return unavailableEconomics(input, policy, reasons, used, excluded, [], { incoterm });
  }

  const ownedComponents = new Set(owned!);

  // Duty base first: it decides which Incoterms can be decomposed at all.
  let basis: CustomsValuationBasis | null = null;
  let basisSource: 'evidence' | 'policy' | null = null;
  if (input.customs_valuation_basis) {
    const basisExclusion = commonFactExclusion(
      input.customs_valuation_basis,
      input.scope,
      policy.allowed_customs_basis_assertion_classes,
    );
    if (basisExclusion) {
      excluded.push({ fact_id: input.customs_valuation_basis.id, reason: basisExclusion });
    } else {
      const fact = input.customs_valuation_basis as PresentScopedFact<CustomsValuationBasisValue>;
      const usable =
        (fact.value.basis === 'CIF' || fact.value.basis === 'FOB') &&
        currentAt(input.scope.as_of_date, fact.value.effective_from, fact.value.effective_to) &&
        withinAge(input.scope.as_of_date, fact.value.observed_at, policy.maximum_customs_basis_age_days);
      if (!usable) {
        excluded.push({ fact_id: fact.id, reason: 'customs_valuation_basis_not_current' });
      } else {
        basis = fact.value.basis;
        basisSource = 'evidence';
        used.push(fact);
      }
    }
  }
  if (!basis) {
    const declared = policy.customs_valuation_basis_by_country[input.scope.country_code];
    if (declared === 'CIF' || declared === 'FOB') {
      basis = declared;
      basisSource = 'policy';
    }
  }
  if (!basis) {
    return unavailableEconomics(
      input,
      policy,
      ['The destination customs valuation base is unknown; duty cannot be taken on a guessed base.'],
      used,
      excluded,
      [],
      { incoterm },
    );
  }
  const customsComponents = new Set(
    basis === 'CIF' ? CIF_CUSTOMS_COMPONENTS : FOB_CUSTOMS_COMPONENTS,
  );
  const outsideCustomsScope = [...ownedComponents].filter(
    (component) => !customsComponents.has(component),
  );
  if (outsideCustomsScope.length) {
    return unavailableEconomics(
      input,
      policy,
      [
        `Incoterm ${incoterm} bundles ${outsideCustomsScope.sort().join(', ')} beyond the ${basis} customs base and cannot be decomposed without inventing a split.`,
      ],
      used,
      excluded,
      [],
      { incoterm, customs_valuation_basis: basis },
    );
  }

  const priceConversion = convertMoney(
    price.value.amount_per_unit,
    price.value.currency,
    settlementCurrency,
    input.fx_rates,
    input.scope,
    policy,
    excluded,
  );
  if (!priceConversion.ok) {
    return unavailableEconomics(
      input,
      policy,
      ['A dated, direction-explicit FX fact is required to state the exporter price in the benchmark currency.'],
      used,
      excluded,
      [],
      { incoterm, customs_valuation_basis: basis, fx_failure: priceConversion.reason },
    );
  }
  if (priceConversion.fx) used.push(priceConversion.fx);
  const exporterPrice = priceConversion.amount;

  // One fact per component, newest observation wins, and every rejection is recorded.
  const byComponent = new Map<ExportCostComponentCode, PresentScopedFact<ExportCostComponentValue>[]>();
  for (const fact of [...input.cost_components].sort((left, right) => left.id.localeCompare(right.id))) {
    const common = commonFactExclusion(fact, input.scope, policy.allowed_cost_assertion_classes);
    if (common) {
      excluded.push({ fact_id: fact.id, reason: common });
      continue;
    }
    const present = fact as PresentScopedFact<ExportCostComponentValue>;
    if (!EXPORT_COST_COMPONENTS.includes(present.value.component)) {
      excluded.push({ fact_id: present.id, reason: 'unknown_cost_component' });
      continue;
    }
    if (ownedComponents.has(present.value.component)) {
      excluded.push({ fact_id: present.id, reason: 'included_in_incoterm_price' });
      continue;
    }
    if (
      !Number.isFinite(present.value.amount_per_unit) ||
      present.value.amount_per_unit < 0 ||
      present.value.quantity_unit !== quantityUnit
    ) {
      excluded.push({ fact_id: present.id, reason: 'cost_component_amount_or_unit_invalid' });
      continue;
    }
    if (
      !withinAge(input.scope.as_of_date, present.value.observed_at, policy.maximum_cost_component_age_days) ||
      (present.value.valid_until != null &&
        (timestamp(present.value.valid_until) == null ||
          timestamp(present.value.valid_until)! <= timestamp(input.scope.as_of_date)!))
    ) {
      excluded.push({ fact_id: present.id, reason: 'cost_component_expired_or_stale' });
      continue;
    }
    const bucket = byComponent.get(present.value.component) ?? [];
    bucket.push(present);
    byComponent.set(present.value.component, bucket);
  }

  const breakdown: ExportEconomicsComponentBreakdown[] = [];
  const missing: ExportCostComponentCode[] = [];
  let customsAdditions = 0;
  let cifAdditions = 0;
  let postCustomsAdditions = 0;
  for (const component of EXPORT_COST_COMPONENTS) {
    const inCustomsValue = customsComponents.has(component);
    if (ownedComponents.has(component)) {
      breakdown.push({
        component,
        treatment: 'bundled_in_price',
        amount: null,
        in_customs_value: inCustomsValue,
        fact_id: null,
      });
      continue;
    }
    const candidates = byComponent.get(component) ?? [];
    const selected = newestByObservation(candidates);
    for (const candidate of candidates) {
      if (candidate.id !== selected?.id) {
        excluded.push({ fact_id: candidate.id, reason: 'superseded_by_newer_cost_component_fact' });
      }
    }
    if (!selected) {
      missing.push(component);
      breakdown.push({
        component,
        treatment: 'missing',
        amount: null,
        in_customs_value: inCustomsValue,
        fact_id: null,
      });
      continue;
    }
    const conversion = convertMoney(
      selected.value.amount_per_unit,
      selected.value.currency,
      settlementCurrency,
      input.fx_rates,
      input.scope,
      policy,
      excluded,
    );
    if (!conversion.ok) {
      excluded.push({ fact_id: selected.id, reason: conversion.reason });
      missing.push(component);
      breakdown.push({
        component,
        treatment: 'missing',
        amount: null,
        in_customs_value: inCustomsValue,
        fact_id: null,
      });
      continue;
    }
    if (conversion.fx) used.push(conversion.fx);
    used.push(selected);
    if (inCustomsValue) customsAdditions += conversion.amount;
    else postCustomsAdditions += conversion.amount;
    if (CIF_CUSTOMS_COMPONENTS.includes(component)) cifAdditions += conversion.amount;
    breakdown.push({
      component,
      treatment: 'added',
      amount: round(conversion.amount),
      in_customs_value: inCustomsValue,
      fact_id: selected.id,
    });
  }

  const missingRequired = missing.filter((component) =>
    policy.required_cost_components.includes(component),
  );
  if (missingRequired.length) {
    return unavailableEconomics(
      input,
      policy,
      [
        `Required cost components are unknown and are never assumed to be zero: ${missingRequired.sort().join(', ')}.`,
      ],
      used,
      excluded,
      breakdown,
      { incoterm, customs_valuation_basis: basis, missing_cost_components: missing.sort() },
    );
  }

  const tariffScope = resolveTariffScope(input.scope, input.tariff_scope);
  const tariff = selectApplicableIndiaTariff(tariffScope, input.tariffs, policy.tariff_policy);
  if (tariff.status !== 'available' || tariff.rate_percent == null) {
    return unavailableEconomics(
      input,
      policy,
      ['A current tariff explicitly applicable to Indian origin is required.'],
      used,
      [...excluded, ...tariff.provenance.excluded_facts],
      breakdown,
      { incoterm, customs_valuation_basis: basis, tariff_reasons: tariff.reasons },
    );
  }
  used.push(...input.tariffs.filter((fact) => tariff.provenance.used_fact_ids.includes(fact.id)));

  const customsValue = exporterPrice + customsAdditions;
  const dutyAmount = customsValue * (tariff.rate_percent / 100);
  const cifEquivalent = exporterPrice + cifAdditions;
  const totalLanded = exporterPrice + customsAdditions + postCustomsAdditions + dutyAmount;
  const landedRatio = totalLanded / benchmark.value.value_per_unit;
  const score = ratioScore(
    landedRatio,
    policy.full_score_at_or_below_ratio,
    policy.zero_score_at_or_above_ratio,
  );
  // The selected tariff facts are already in `used`, so their confidence is folded in through
  // the same assertion-class multiplier as everything else. Adding the selector's raw
  // confidence again would let one class of evidence bypass the authority discount.
  const confidences = used.map((fact) => effectiveConfidence(fact, policy));
  const incomplete = missing.length > 0;

  return {
    status: incomplete ? 'partial' : 'available',
    score,
    confidence: Math.round(Math.min(...confidences)),
    reasons: incomplete
      ? [`Landed cost is a lower bound; unknown optional components: ${missing.sort().join(', ')}.`]
      : [],
    amounts: {
      currency: settlementCurrency,
      quantity_unit: quantityUnit,
      exporter_price: round(exporterPrice),
      customs_valuation_basis: basis,
      customs_value: round(customsValue),
      duty_rate_percent: tariff.rate_percent,
      duty_amount: round(dutyAmount),
      cif_equivalent_cost: round(cifEquivalent),
      total_landed_cost: round(totalLanded),
      benchmark_value: round(benchmark.value.value_per_unit),
      cif_equivalent_ratio_to_benchmark: round(cifEquivalent / benchmark.value.value_per_unit),
      landed_ratio_to_benchmark: round(landedRatio),
    },
    components: breakdown,
    cost_stack_incomplete: incomplete,
    provenance: provenance(
      policy,
      input.scope,
      used,
      [...excluded, ...tariff.provenance.excluded_facts],
      {
        offer_incoterm: incoterm,
        incoterm_owned_components: [...ownedComponents].sort(),
        customs_valuation_basis: basis,
        customs_valuation_basis_source: basisSource,
        duty_base: `${basis.toLowerCase()}_customs_value`,
        tariff_basis: tariff.tariff_basis,
        tariff_rate_percent: tariff.rate_percent,
        ...(input.tariff_scope ? { tariff_as_of_date: tariffScope.as_of_date } : {}),
        missing_cost_components: missing.sort(),
        benchmark_valuation_basis: 'CIF',
        score_basis: 'total_landed_cost_including_duty_divided_by_cif_import_benchmark',
        settlement_currency: settlementCurrency,
      },
    ),
  };
}

// ---------------------------------------------------------------------------
// Exporter–Market Fit v3
// ---------------------------------------------------------------------------

interface EffectiveValue {
  effective_from: string;
  effective_to?: string | null;
  observed_at: string;
}

export type ExporterFitBenchmarkValue =
  | (EffectiveValue & {
      benchmark_type: 'order_quantity';
      minimum_quantity?: number | null;
      maximum_quantity?: number | null;
      quantity_unit: string;
    })
  | (EffectiveValue & {
      benchmark_type: 'order_value';
      /** The reference per-unit price a buyer in this market pays. */
      reference_value_per_unit: number;
      currency: string;
      quantity_unit: string;
    })
  | (EffectiveValue & {
      benchmark_type: 'production_lead_time';
      maximum_days: number;
    })
  | (EffectiveValue & {
      benchmark_type: 'packaging_requirement';
      requirement_code: string;
      mandatory: boolean;
    })
  | (EffectiveValue & {
      benchmark_type: 'certification_requirement';
      certification_code: string;
      mandatory: boolean;
      obtainable: 'yes' | 'no' | 'unknown';
    });

export interface QuantityCapabilityValue {
  amount: number;
  quantity_unit: string;
  declared_at: string;
}

export interface LeadTimeCapabilityValue {
  days: number;
  declared_at: string;
}

export interface PriceCapabilityValue {
  amount_per_unit: number;
  currency: string;
  quantity_unit: string;
  declared_at: string;
}

export interface PackagingCapabilityValue {
  /** Normalized capability codes the exporter has declared it can supply. */
  capability_codes: readonly string[];
  declared_at: string;
}

export type ExporterCertificationStatus =
  | 'held'
  | 'in_progress'
  | 'not_started'
  | 'absent'
  | 'expired';

export interface ExporterCertificationValue {
  certification_code: string;
  status: ExporterCertificationStatus;
  evidence_reference?: string | null;
  valid_until?: string | null;
  declared_at: string;
}

export type ExporterFitSignalName =
  | 'capacity'
  | 'moq'
  | 'production_lead_time'
  | 'price'
  | 'packaging'
  | 'certification';

export interface ExporterMarketFitV3Policy
  extends CalculationIdentity,
    AssertionConfidencePolicy,
    FxSelectionPolicy {
  weights: Record<ExporterFitSignalName, number>;
  certification_scores: {
    held_documented: number;
    held_undocumented: number;
    in_progress: number;
    not_started: number;
    confirmed_absent: number;
    expired: number;
  };
  packaging_scores: { capability_matches: number; capability_does_not_match: number };
  allowed_benchmark_assertion_classes: AssertionClass[];
  allowed_exporter_assertion_classes: AssertionClass[];
  maximum_benchmark_age_days: number;
  maximum_exporter_fact_age_days: number;
}

export interface ExporterMarketFitV3Input {
  scope: ExactFactScope;
  capacity?: ScopedFact<QuantityCapabilityValue>;
  moq?: ScopedFact<QuantityCapabilityValue>;
  production_lead_time?: ScopedFact<LeadTimeCapabilityValue>;
  price?: ScopedFact<PriceCapabilityValue>;
  packaging?: ScopedFact<PackagingCapabilityValue>;
  /** Non-present certification facts use subject_key for the certification code. */
  certifications: readonly ScopedFact<ExporterCertificationValue>[];
  benchmarks: readonly ScopedFact<ExporterFitBenchmarkValue>[];
  fx_rates?: readonly ScopedFact<FxRateValue>[];
}

export interface FitHardBlocker {
  code: 'mandatory_certification_explicitly_unobtainable_and_not_held';
  certification_code: string;
  benchmark_fact_id: string;
  exporter_fact_id: string;
}

export interface ExporterMarketFitV3Result {
  status: CalculationStatus;
  /** Null when blocked so a hard gate cannot enter a weighted country score. */
  score: number | null;
  /** Reconciliation only; callers must never rank a blocked market on this value. */
  soft_score: number | null;
  confidence: number;
  reasons: string[];
  hard_blockers: FitHardBlocker[];
  sub_signals: Record<ExporterFitSignalName, SubSignal>;
  provenance: CalculationProvenance;
}

function validateFitPolicy(policy: ExporterMarketFitV3Policy) {
  validIdentity(policy);
  validateConfidencePolicy(policy);
  const weights = Object.values(policy.weights);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => weight > 0)) {
    throw new Error('Exporter–Market Fit weights must be non-negative with at least one positive weight.');
  }
  if (
    [...Object.values(policy.certification_scores), ...Object.values(policy.packaging_scores)].some(
      (score) => !Number.isFinite(score) || score < 0 || score > 100,
    )
  ) {
    throw new Error('Exporter–Market Fit component scores must be between 0 and 100.');
  }
  for (const age of [
    policy.maximum_benchmark_age_days,
    policy.maximum_exporter_fact_age_days,
    policy.maximum_fx_age_days,
  ]) {
    if (!Number.isFinite(age) || age < 0) throw new Error('Exporter–Market Fit ages must be non-negative.');
  }
}

function newestBenchmark<T extends ExporterFitBenchmarkValue>(facts: PresentScopedFact<T>[]) {
  return newestFirst(facts)[0];
}

function benchmarkIsUsable(
  fact: ScopedFact<ExporterFitBenchmarkValue>,
  scope: ExactFactScope,
  policy: ExporterMarketFitV3Policy,
) {
  const common = commonFactExclusion(fact, scope, policy.allowed_benchmark_assertion_classes);
  if (common) return common;
  const present = fact as PresentScopedFact<ExporterFitBenchmarkValue>;
  if (
    !currentAt(scope.as_of_date, present.value.effective_from, present.value.effective_to) ||
    !withinAge(scope.as_of_date, present.value.observed_at, policy.maximum_benchmark_age_days)
  ) {
    return 'benchmark_not_current_at_assessment_clock';
  }
  return null;
}

function exporterFactIsUsable<T extends { declared_at: string }>(
  fact: ScopedFact<T>,
  scope: ExactFactScope,
  policy: ExporterMarketFitV3Policy,
) {
  const common = commonFactExclusion(fact, scope, policy.allowed_exporter_assertion_classes);
  if (common) return common;
  const present = fact as PresentScopedFact<T>;
  if (!withinAge(scope.as_of_date, present.value.declared_at, policy.maximum_exporter_fact_age_days)) {
    return 'exporter_fact_stale_or_future_dated';
  }
  return null;
}

/**
 * Compares first-party exporter capability against what this destination market actually
 * requires. An exporter fact ClearTrade does not hold produces `insufficient_exporter_data`, a
 * state distinct from a poor fit; nothing here converts silence into a low score.
 */
export function calculateExporterMarketFitV3(
  input: ExporterMarketFitV3Input,
  policy: ExporterMarketFitV3Policy,
): ExporterMarketFitV3Result {
  validateFitPolicy(policy);
  if (!validScope(input.scope)) throw new Error('Exporter–Market Fit requires a valid exact scope.');
  const excluded: ExcludedFact[] = [];
  const used: ScopedFact<unknown>[] = [];
  const benchmarks: PresentScopedFact<ExporterFitBenchmarkValue>[] = [];
  for (const fact of [...input.benchmarks].sort((left, right) => left.id.localeCompare(right.id))) {
    const reason = benchmarkIsUsable(fact, input.scope, policy);
    if (reason) excluded.push({ fact_id: fact.id, reason });
    else benchmarks.push(fact as PresentScopedFact<ExporterFitBenchmarkValue>);
  }

  const signals: Record<ExporterFitSignalName, SubSignal> = {
    capacity: unavailableSignal(policy.weights.capacity, 'Capacity or an exact-scope order benchmark is unavailable.'),
    moq: unavailableSignal(policy.weights.moq, 'MOQ or an exact-scope order benchmark is unavailable.'),
    production_lead_time: unavailableSignal(
      policy.weights.production_lead_time,
      'Production lead time or an exact-scope lead-time benchmark is unavailable.',
    ),
    price: unavailableSignal(policy.weights.price, 'Exporter price or an exact-scope market price benchmark is unavailable.'),
    packaging: unavailableSignal(policy.weights.packaging, 'Packaging capability or an exact-scope packaging requirement is unavailable.'),
    certification: unavailableSignal(policy.weights.certification, 'No certification requirement has a confirmed exporter state.'),
  };

  /** Tracks whether the exporter side was known at all, separately from benchmark coverage. */
  let exporterFactObserved = false;
  const observeExporterFact = <T extends { declared_at: string }>(
    fact: ScopedFact<T> | undefined,
  ): PresentScopedFact<T> | null => {
    if (!fact) return null;
    const reason = exporterFactIsUsable(fact, input.scope, policy);
    if (reason) {
      excluded.push({ fact_id: fact.id, reason });
      return null;
    }
    exporterFactObserved = true;
    return fact as PresentScopedFact<T>;
  };

  const orderBenchmark = newestBenchmark(
    benchmarks.filter(
      (fact): fact is PresentScopedFact<Extract<ExporterFitBenchmarkValue, { benchmark_type: 'order_quantity' }>> =>
        fact.value.benchmark_type === 'order_quantity',
    ),
  );
  const capacity = observeExporterFact(input.capacity);
  const moq = observeExporterFact(input.moq);
  if (orderBenchmark) {
    const minimum = orderBenchmark.value.minimum_quantity;
    if (
      capacity &&
      minimum != null &&
      Number.isFinite(minimum) &&
      minimum > 0 &&
      Number.isFinite(capacity.value.amount) &&
      capacity.value.amount > 0 &&
      capacity.value.quantity_unit === orderBenchmark.value.quantity_unit
    ) {
      signals.capacity = availableSignal(
        policy.weights.capacity,
        (capacity.value.amount / minimum) * 100,
        Math.min(effectiveConfidence(capacity, policy), effectiveConfidence(orderBenchmark, policy)),
        [capacity.id, orderBenchmark.id],
      );
      used.push(capacity, orderBenchmark);
    }
    const maximum = orderBenchmark.value.maximum_quantity;
    if (
      moq &&
      maximum != null &&
      Number.isFinite(maximum) &&
      maximum > 0 &&
      Number.isFinite(moq.value.amount) &&
      moq.value.amount > 0 &&
      moq.value.quantity_unit === orderBenchmark.value.quantity_unit
    ) {
      signals.moq = availableSignal(
        policy.weights.moq,
        (maximum / moq.value.amount) * 100,
        Math.min(effectiveConfidence(moq, policy), effectiveConfidence(orderBenchmark, policy)),
        [moq.id, orderBenchmark.id],
      );
      used.push(moq, orderBenchmark);
    }
  }

  const leadBenchmark = newestBenchmark(
    benchmarks.filter(
      (fact): fact is PresentScopedFact<Extract<ExporterFitBenchmarkValue, { benchmark_type: 'production_lead_time' }>> =>
        fact.value.benchmark_type === 'production_lead_time',
    ),
  );
  const lead = observeExporterFact(input.production_lead_time);
  if (
    leadBenchmark &&
    lead &&
    Number.isFinite(lead.value.days) &&
    lead.value.days > 0 &&
    Number.isFinite(leadBenchmark.value.maximum_days) &&
    leadBenchmark.value.maximum_days > 0
  ) {
    signals.production_lead_time = availableSignal(
      policy.weights.production_lead_time,
      (leadBenchmark.value.maximum_days / lead.value.days) * 100,
      Math.min(effectiveConfidence(lead, policy), effectiveConfidence(leadBenchmark, policy)),
      [lead.id, leadBenchmark.id],
    );
    used.push(lead, leadBenchmark);
  }

  const priceBenchmark = newestBenchmark(
    benchmarks.filter(
      (fact): fact is PresentScopedFact<Extract<ExporterFitBenchmarkValue, { benchmark_type: 'order_value' }>> =>
        fact.value.benchmark_type === 'order_value',
    ),
  );
  const price = observeExporterFact(input.price);
  if (priceBenchmark && price) {
    const conversion = convertMoney(
      price.value.amount_per_unit,
      price.value.currency,
      priceBenchmark.value.currency,
      input.fx_rates ?? [],
      input.scope,
      policy,
      excluded,
    );
    if (!conversion.ok) {
      signals.price = unavailableSignal(
        policy.weights.price,
        'The exporter price cannot be stated in the benchmark currency without a dated FX fact.',
      );
    } else if (
      price.value.quantity_unit !== priceBenchmark.value.quantity_unit ||
      !Number.isFinite(conversion.amount) ||
      conversion.amount <= 0 ||
      !Number.isFinite(priceBenchmark.value.reference_value_per_unit) ||
      priceBenchmark.value.reference_value_per_unit <= 0
    ) {
      signals.price = unavailableSignal(
        policy.weights.price,
        'The exporter price and market price benchmark are not on a comparable per-unit basis.',
      );
    } else {
      if (conversion.fx) used.push(conversion.fx);
      signals.price = availableSignal(
        policy.weights.price,
        (priceBenchmark.value.reference_value_per_unit / conversion.amount) * 100,
        Math.min(effectiveConfidence(price, policy), effectiveConfidence(priceBenchmark, policy)),
        [price.id, priceBenchmark.id, ...(conversion.fx ? [conversion.fx.id] : [])],
      );
      used.push(price, priceBenchmark);
    }
  }

  const packagingRequirements = benchmarks.filter(
    (fact): fact is PresentScopedFact<Extract<ExporterFitBenchmarkValue, { benchmark_type: 'packaging_requirement' }>> =>
      fact.value.benchmark_type === 'packaging_requirement',
  );
  const packaging = observeExporterFact(input.packaging);
  if (packagingRequirements.length && packaging) {
    const declared = new Set(
      packaging.value.capability_codes.map((item) => item.trim().toUpperCase()).filter(Boolean),
    );
    const mandatory = packagingRequirements.filter((fact) => fact.value.mandatory);
    const evaluated = mandatory.length ? mandatory : packagingRequirements;
    const matched = evaluated.filter((fact) =>
      declared.has(fact.value.requirement_code.trim().toUpperCase()),
    );
    signals.packaging = availableSignal(
      policy.weights.packaging,
      matched.length === evaluated.length
        ? policy.packaging_scores.capability_matches
        : policy.packaging_scores.capability_does_not_match,
      Math.min(
        effectiveConfidence(packaging, policy),
        ...evaluated.map((fact) => effectiveConfidence(fact, policy)),
      ),
      [packaging.id, ...evaluated.map((fact) => fact.id)],
      matched.length === evaluated.length
        ? []
        : [
            `Unmet packaging requirements: ${evaluated
              .filter((fact) => !matched.includes(fact))
              .map((fact) => fact.value.requirement_code)
              .sort()
              .join(', ')}.`,
          ],
    );
    used.push(packaging, ...evaluated);
  }

  const requirements = benchmarks.filter(
    (fact): fact is PresentScopedFact<Extract<ExporterFitBenchmarkValue, { benchmark_type: 'certification_requirement' }>> =>
      fact.value.benchmark_type === 'certification_requirement',
  );
  const certificationScores: number[] = [];
  const certificationConfidences: number[] = [];
  const certificationEvidence = new Set<string>();
  const certificationReasons: string[] = [];
  const hardBlockers: FitHardBlocker[] = [];
  for (const requirement of [...requirements].sort((left, right) =>
    left.value.certification_code.localeCompare(right.value.certification_code),
  )) {
    const code = requirement.value.certification_code.trim().toUpperCase();
    const certification = input.certifications.find((fact) => {
      const factCode = fact.state === 'present' ? fact.value.certification_code : fact.subject_key;
      return factCode?.trim().toUpperCase() === code;
    });
    if (!certification) {
      certificationReasons.push(`${code}: certification state is unknown.`);
      continue;
    }
    if (certification.state === 'missing' || certification.state === 'unknown') {
      certificationReasons.push(`${code}: certification state is ${certification.state}.`);
      excluded.push({ fact_id: certification.id, reason: `fact_state_${certification.state}` });
      continue;
    }

    let score: number;
    let explicitlyNotHeld = false;
    // Narrow positively on `present`. Excluding the other states first does not remove the
    // non-present constituent from the union, so `certification.value` would stay optional.
    if (certification.state === 'present') {
      const reason = exporterFactIsUsable(certification, input.scope, policy);
      if (reason) {
        excluded.push({ fact_id: certification.id, reason });
        certificationReasons.push(`${code}: certification fact is not usable.`);
        continue;
      }
      exporterFactObserved = true;
      const value = certification.value;
      const expired =
        value.status === 'expired' ||
        (value.valid_until != null &&
          timestamp(value.valid_until) != null &&
          timestamp(value.valid_until)! <= timestamp(input.scope.as_of_date)!);
      if (expired) {
        score = policy.certification_scores.expired;
        explicitlyNotHeld = true;
      } else if (value.status === 'held') {
        score = value.evidence_reference?.trim()
          ? policy.certification_scores.held_documented
          : policy.certification_scores.held_undocumented;
      } else if (value.status === 'in_progress') {
        score = policy.certification_scores.in_progress;
        explicitlyNotHeld = true;
      } else if (value.status === 'not_started') {
        score = policy.certification_scores.not_started;
        explicitlyNotHeld = true;
      } else {
        score = policy.certification_scores.confirmed_absent;
        explicitlyNotHeld = true;
      }
    } else {
      const reason = factEnvelopeExclusion(
        certification,
        input.scope,
        policy.allowed_exporter_assertion_classes,
      );
      if (
        reason ||
        !withinAge(
          input.scope.as_of_date,
          certification.provenance.retrieved_at,
          policy.maximum_exporter_fact_age_days,
        )
      ) {
        excluded.push({
          fact_id: certification.id,
          reason: reason ?? 'confirmed_absence_stale_or_future_dated',
        });
        certificationReasons.push(`${code}: confirmed absence is not usable.`);
        continue;
      }
      exporterFactObserved = true;
      score = policy.certification_scores.confirmed_absent;
      explicitlyNotHeld = true;
    }

    certificationScores.push(score);
    certificationConfidences.push(
      Math.min(effectiveConfidence(certification, policy), effectiveConfidence(requirement, policy)),
    );
    certificationEvidence.add(certification.id);
    certificationEvidence.add(requirement.id);
    used.push(certification, requirement);
    if (requirement.value.mandatory && requirement.value.obtainable === 'no' && explicitlyNotHeld) {
      hardBlockers.push({
        code: 'mandatory_certification_explicitly_unobtainable_and_not_held',
        certification_code: code,
        benchmark_fact_id: requirement.id,
        exporter_fact_id: certification.id,
      });
    }
  }
  if (certificationScores.length) {
    signals.certification = availableSignal(
      policy.weights.certification,
      certificationScores.reduce((sum, score) => sum + score, 0) / certificationScores.length,
      Math.min(...certificationConfidences),
      [...certificationEvidence],
      certificationReasons,
    );
  } else if (certificationReasons.length) {
    signals.certification.reasons = certificationReasons;
  }

  const combined = combineSignals(signals);
  const blocked = hardBlockers.length > 0;
  const status: CalculationStatus = blocked
    ? 'blocked'
    : combined.score == null
      ? exporterFactObserved
        ? 'unavailable'
        : 'insufficient_exporter_data'
      : combined.complete
        ? 'available'
        : 'partial';
  const reasons = Object.entries(signals).flatMap(([name, signal]) =>
    signal.status === 'unavailable' ? signal.reasons.map((reason) => `${name}: ${reason}`) : [],
  );

  return {
    status,
    score: blocked ? null : combined.score,
    soft_score: combined.score,
    confidence: combined.confidence,
    reasons,
    hard_blockers: hardBlockers.sort((left, right) =>
      left.certification_code.localeCompare(right.certification_code),
    ),
    sub_signals: signals,
    provenance: provenance(policy, input.scope, used, excluded, {
      available_weight: combined.available_weight,
      configured_weight: combined.configured_weight,
      exporter_fact_observed: exporterFactObserved,
      hard_blockers_are_not_weighted: true,
      certification_unknown_is_not_absent: true,
      missing_exporter_data_is_not_a_low_score: true,
    }),
  };
}

// ---------------------------------------------------------------------------
// Logistics Feasibility v3
// ---------------------------------------------------------------------------

export interface LogisticsRouteValue {
  route_status: 'route_available' | 'route_unavailable';
  transport_mode: string;
  origin_location_code: string | null;
  origin_gateway_code: string | null;
  destination_location_code: string | null;
  transit_time_min_days: number | null;
  transit_time_max_days: number | null;
  /** Null means the provider did not state handling coverage — unknown, never "unsupported". */
  supported_constraint_codes: readonly string[] | null;
  effective_from: string;
  effective_to?: string | null;
  observed_at: string;
}

export interface LogisticsFreightQuoteValue {
  route_fact_id: string;
  freight_per_unit: number;
  currency: string;
  quantity_unit: string;
  assumed_goods_value_per_unit: number;
  assumed_goods_value_currency: string;
  quoted_at: string;
  valid_until: string;
}

export type LogisticsSignalName =
  | 'route_availability'
  | 'transit_time'
  | 'freight_burden'
  | 'handling_compatibility';

export interface LogisticsV3Policy extends CalculationIdentity, AssertionConfidencePolicy {
  weights: Record<LogisticsSignalName, number>;
  route_available_score: number;
  route_unavailable_score: number;
  /** Transit duration at or above which the transit sub-signal scores zero. */
  transit_zero_score_days: number;
  freight_burden_zero_score_percent: number;
  handling_scores: { supported: number; unsupported: number };
  maximum_route_age_days: number;
  maximum_freight_quote_age_days: number;
  allowed_route_assertion_classes: AssertionClass[];
  allowed_freight_quote_assertion_classes: AssertionClass[];
}

export interface LogisticsV3Input {
  scope: ExactFactScope;
  routes: readonly ScopedFact<LogisticsRouteValue>[];
  freight_quotes: readonly ScopedFact<LogisticsFreightQuoteValue>[];
  /** Exporter-declared handling constraints. Empty means none declared, null means unknown. */
  required_constraint_codes?: readonly string[] | null;
  /** Declared origin identity. Unknown origin never filters routes. */
  expected_origin?: { location_code?: string | null; gateway_code?: string | null } | null;
  /** Restricts route selection when the exporter's mode is fixed. */
  required_transport_mode?: string | null;
}

export interface LogisticsV3Result {
  status: 'available' | 'partial' | 'unavailable';
  score: number | null;
  confidence: number;
  reasons: string[];
  /** `unknown` is a first-class outcome: an unmapped route is not an impossible route. */
  route_status: 'route_available' | 'route_unavailable' | 'unknown';
  selected_route_id: string | null;
  sub_signals: Record<LogisticsSignalName, SubSignal>;
  provenance: CalculationProvenance;
}

function validateLogisticsPolicy(policy: LogisticsV3Policy) {
  validIdentity(policy);
  validateConfidencePolicy(policy);
  const weights = Object.values(policy.weights);
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0) || !weights.some((weight) => weight > 0)) {
    throw new Error('Logistics weights must be non-negative with at least one positive weight.');
  }
  if (policy.weights.route_availability <= 0) {
    throw new Error('Logistics route_availability must have positive policy weight.');
  }
  if (
    [
      policy.route_available_score,
      policy.route_unavailable_score,
      policy.handling_scores.supported,
      policy.handling_scores.unsupported,
    ].some((score) => !Number.isFinite(score) || score < 0 || score > 100) ||
    !Number.isFinite(policy.transit_zero_score_days) ||
    policy.transit_zero_score_days <= 0 ||
    !Number.isFinite(policy.freight_burden_zero_score_percent) ||
    policy.freight_burden_zero_score_percent <= 0 ||
    !Number.isFinite(policy.maximum_route_age_days) ||
    policy.maximum_route_age_days < 0 ||
    !Number.isFinite(policy.maximum_freight_quote_age_days) ||
    policy.maximum_freight_quote_age_days < 0
  ) {
    throw new Error('Invalid Logistics v3 scoring or freshness policy.');
  }
}

function routeUsability(
  fact: ScopedFact<LogisticsRouteValue>,
  input: LogisticsV3Input,
  policy: LogisticsV3Policy,
) {
  const common = commonFactExclusion(fact, input.scope, policy.allowed_route_assertion_classes);
  if (common) return common;
  const present = fact as PresentScopedFact<LogisticsRouteValue>;
  if (
    !currentAt(input.scope.as_of_date, present.value.effective_from, present.value.effective_to) ||
    !withinAge(input.scope.as_of_date, present.value.observed_at, policy.maximum_route_age_days)
  ) {
    return 'route_evidence_not_current_at_assessment_clock';
  }
  if (
    input.required_transport_mode &&
    present.value.transport_mode.trim().toUpperCase() !== input.required_transport_mode.trim().toUpperCase()
  ) {
    return 'route_transport_mode_does_not_match_requirement';
  }
  // A declared origin filters routes; an undeclared origin filters nothing, because an unknown
  // origin is not evidence that a route starts somewhere else.
  const expectedLocation = input.expected_origin?.location_code?.trim().toUpperCase();
  const expectedGateway = input.expected_origin?.gateway_code?.trim().toUpperCase();
  if (expectedLocation && present.value.origin_location_code?.trim().toUpperCase() !== expectedLocation) {
    return 'route_origin_location_does_not_match_exporter_declared_origin';
  }
  if (expectedGateway && present.value.origin_gateway_code?.trim().toUpperCase() !== expectedGateway) {
    return 'route_origin_gateway_does_not_match_exporter_declared_origin';
  }
  return null;
}

/**
 * Scores whether this destination can actually be served from the exporter's origin.
 *
 * The load-bearing distinction is between an explicitly unavailable route and no route evidence
 * at all: only the former is a fact about the market, and only the former is scored.
 */
export function calculateLogisticsV3(
  input: LogisticsV3Input,
  policy: LogisticsV3Policy,
): LogisticsV3Result {
  validateLogisticsPolicy(policy);
  if (!validScope(input.scope)) throw new Error('Logistics v3 requires a valid exact scope.');
  const excluded: ExcludedFact[] = [];
  const currentRoutes: PresentScopedFact<LogisticsRouteValue>[] = [];
  for (const fact of [...input.routes].sort((left, right) => left.id.localeCompare(right.id))) {
    const reason = routeUsability(fact, input, policy);
    if (reason) excluded.push({ fact_id: fact.id, reason });
    else currentRoutes.push(fact as PresentScopedFact<LogisticsRouteValue>);
  }

  const signals: Record<LogisticsSignalName, SubSignal> = {
    route_availability: unavailableSignal(
      policy.weights.route_availability,
      'No current explicit route-availability evidence exists.',
    ),
    transit_time: unavailableSignal(policy.weights.transit_time, 'No current route states a transit duration.'),
    freight_burden: unavailableSignal(policy.weights.freight_burden, 'No current basis-compatible freight quote exists.'),
    handling_compatibility: unavailableSignal(
      policy.weights.handling_compatibility,
      'Route handling coverage or the exporter handling requirement is unknown.',
    ),
  };

  if (!currentRoutes.length) {
    const combined = combineSignals(signals);
    return {
      status: 'unavailable',
      score: null,
      confidence: combined.confidence,
      reasons: ['No current explicit route-availability evidence exists.'],
      route_status: 'unknown',
      selected_route_id: null,
      sub_signals: signals,
      provenance: provenance(policy, input.scope, [], excluded, {
        missing_route_evidence_is_not_route_unavailable: true,
      }),
    };
  }

  const availableRoutes = newestFirst(
    currentRoutes.filter((fact) => fact.value.route_status === 'route_available'),
  );
  const used: ScopedFact<unknown>[] = [];

  if (!availableRoutes.length) {
    const explicitUnavailable = newestFirst(
      currentRoutes.filter((fact) => fact.value.route_status === 'route_unavailable'),
    )[0];
    if (!explicitUnavailable) {
      const combined = combineSignals(signals);
      return {
        status: 'unavailable',
        score: null,
        confidence: combined.confidence,
        reasons: ['Route evidence carries no explicit supported status.'],
        route_status: 'unknown',
        selected_route_id: null,
        sub_signals: signals,
        provenance: provenance(policy, input.scope, [], excluded, {}),
      };
    }
    signals.route_availability = availableSignal(
      policy.weights.route_availability,
      policy.route_unavailable_score,
      effectiveConfidence(explicitUnavailable, policy),
      [explicitUnavailable.id],
    );
    const combined = combineSignals(signals);
    return {
      status: 'available',
      score: combined.score,
      confidence: combined.confidence,
      reasons: [],
      route_status: 'route_unavailable',
      selected_route_id: explicitUnavailable.id,
      sub_signals: signals,
      provenance: provenance(policy, input.scope, [explicitUnavailable], excluded, {
        route_unavailability_is_explicit: true,
        transit_and_freight_not_applicable_to_unavailable_route: true,
      }),
    };
  }

  const selectedRoute = availableRoutes[0];
  used.push(selectedRoute);
  signals.route_availability = availableSignal(
    policy.weights.route_availability,
    policy.route_available_score,
    effectiveConfidence(selectedRoute, policy),
    [selectedRoute.id],
  );

  const transitMax = selectedRoute.value.transit_time_max_days ?? selectedRoute.value.transit_time_min_days;
  if (transitMax != null && Number.isFinite(transitMax) && transitMax > 0) {
    signals.transit_time = availableSignal(
      policy.weights.transit_time,
      100 - (transitMax / policy.transit_zero_score_days) * 100,
      effectiveConfidence(selectedRoute, policy),
      [selectedRoute.id],
    );
  }

  const required = input.required_constraint_codes;
  if (required != null && required.length === 0) {
    // Nothing to accommodate: route handling coverage cannot be a constraint on this shipment.
    signals.handling_compatibility = availableSignal(
      policy.weights.handling_compatibility,
      policy.handling_scores.supported,
      effectiveConfidence(selectedRoute, policy),
      [selectedRoute.id],
      ['The exporter confirmed no special handling requirement.'],
    );
  } else if (required != null && selectedRoute.value.supported_constraint_codes != null) {
    const supported = new Set(
      selectedRoute.value.supported_constraint_codes.map((item) => item.trim().toUpperCase()),
    );
    const unmet = [...required]
      .map((item) => item.trim().toUpperCase())
      .filter((item) => item && !supported.has(item))
      .sort();
    signals.handling_compatibility = availableSignal(
      policy.weights.handling_compatibility,
      unmet.length ? policy.handling_scores.unsupported : policy.handling_scores.supported,
      effectiveConfidence(selectedRoute, policy),
      [selectedRoute.id],
      unmet.length ? [`Route does not state support for: ${unmet.join(', ')}.`] : [],
    );
  }

  const validQuotes: PresentScopedFact<LogisticsFreightQuoteValue>[] = [];
  for (const fact of [...input.freight_quotes].sort((left, right) => left.id.localeCompare(right.id))) {
    const common = commonFactExclusion(fact, input.scope, policy.allowed_freight_quote_assertion_classes);
    if (common) {
      excluded.push({ fact_id: fact.id, reason: common });
      continue;
    }
    const quote = fact as PresentScopedFact<LogisticsFreightQuoteValue>;
    if (quote.value.route_fact_id !== selectedRoute.id) {
      excluded.push({ fact_id: quote.id, reason: 'freight_quote_is_not_for_the_selected_route' });
      continue;
    }
    if (
      !withinAge(input.scope.as_of_date, quote.value.quoted_at, policy.maximum_freight_quote_age_days) ||
      timestamp(quote.value.valid_until) == null ||
      timestamp(quote.value.valid_until)! <= timestamp(input.scope.as_of_date)!
    ) {
      excluded.push({ fact_id: quote.id, reason: 'freight_quote_expired_or_stale' });
      continue;
    }
    if (
      !Number.isFinite(quote.value.freight_per_unit) ||
      quote.value.freight_per_unit < 0 ||
      !Number.isFinite(quote.value.assumed_goods_value_per_unit) ||
      quote.value.assumed_goods_value_per_unit <= 0 ||
      !validCurrency(quote.value.currency) ||
      quote.value.currency !== quote.value.assumed_goods_value_currency ||
      !validUnit(quote.value.quantity_unit)
    ) {
      excluded.push({ fact_id: quote.id, reason: 'freight_quote_basis_invalid' });
      continue;
    }
    validQuotes.push(quote);
  }

  const selectedQuote = [...validQuotes].sort((left, right) => {
    const quoted = timestamp(right.value.quoted_at)! - timestamp(left.value.quoted_at)!;
    return quoted || left.id.localeCompare(right.id);
  })[0];
  if (selectedQuote) {
    const burdenPercent =
      (selectedQuote.value.freight_per_unit / selectedQuote.value.assumed_goods_value_per_unit) * 100;
    signals.freight_burden = availableSignal(
      policy.weights.freight_burden,
      100 - (burdenPercent / policy.freight_burden_zero_score_percent) * 100,
      effectiveConfidence(selectedQuote, policy),
      [selectedQuote.id],
    );
    used.push(selectedQuote);
  }

  const combined = combineSignals(signals);
  const reasons = Object.entries(signals).flatMap(([name, signal]) =>
    signal.status === 'unavailable' ? signal.reasons.map((reason) => `${name}: ${reason}`) : [],
  );

  return {
    status: combined.complete ? 'available' : 'partial',
    score: combined.score,
    confidence: combined.confidence,
    reasons,
    route_status: 'route_available',
    selected_route_id: selectedRoute.id,
    sub_signals: signals,
    provenance: provenance(policy, input.scope, used, excluded, {
      expired_freight_does_not_expire_route_evidence: true,
      unknown_handling_coverage_is_not_incompatibility: true,
      selected_route_id: selectedRoute.id,
      selected_route_mode: selectedRoute.value.transport_mode,
      selected_route_origin: selectedRoute.value.origin_location_code,
      selected_route_gateway: selectedRoute.value.origin_gateway_code,
      selected_route_destination: selectedRoute.value.destination_location_code,
    }),
  };
}
