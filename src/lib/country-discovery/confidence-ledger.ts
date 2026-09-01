/**
 * A deterministic explanation of the canonical Country Truth confidence calculation.
 *
 * This module never scores a market. It reads the component confidence, base weights and
 * freshness multiplier already frozen in MarketAssessment.field_provenance and reconciles them
 * with the stored confidence_score. Missing evidence is described from the same Phase 1H
 * dependency contracts; unknown facts remain unknown and are never converted into low scores.
 */
import type { Prisma } from '@prisma/client';
import type { ProductReadiness } from './readiness';
import { PILLAR_LABELS, type PillarKey } from './market-view';

export type EvidenceOwner = 'exporter' | 'cleartrade_agent' | 'freight_logistics_partner' | 'system_provider';

export interface MissingEvidenceEntry {
  code: string;
  label: string;
  owners: EvidenceOwner[];
  required_facts: string[];
  conditional: boolean;
}

export interface ConfidenceLedgerComponent {
  key: PillarKey;
  label: string;
  base_weight: number;
  status: 'available' | 'unavailable';
  evidence_coverage: number;
  freshness_multiplier: number;
  pre_freshness_contribution: number;
  effective_contribution: number;
  maximum_contribution: number;
  exact_missing_evidence: MissingEvidenceEntry[];
}

export interface ExporterDataCeiling {
  current: number;
  /** Null because values and counterpart evidence decide whether the affected pillars qualify. */
  exact_reachable_confidence: null;
  potentially_unlocks_up_to_weight: number;
  conditional_upper_bound: number;
  exporter_missing_facts: string[];
  affected_components: PillarKey[];
  remaining_provider_or_agent_components: PillarKey[];
  explanation: string;
}

export interface ConfidenceGapLedger {
  formula_version: string | null;
  stored_confidence: number;
  coverage_before_freshness: number;
  freshness_multiplier: number;
  calculated_confidence: number;
  unrounded_component_sum: number;
  rounding_adjustment: number;
  reconciles: boolean;
  components: ConfidenceLedgerComponent[];
  exporter_data_ceiling: ExporterDataCeiling;
}

const COMPONENTS: Array<{ key: PillarKey; stored: string }> = [
  { key: 'demand_score', stored: 'demand_score' },
  { key: 'growth_score', stored: 'growth_score' },
  { key: 'competition_score', stored: 'competition_score' },
  { key: 'market_access', stored: 'market_access' },
  { key: 'export_economics', stored: 'export_economics' },
  { key: 'exporter_market_fit', stored: 'exporter_market_fit' },
  { key: 'logistics_feasibility', stored: 'logistics_feasibility' },
  { key: 'risk_resilience', stored: 'risk_resilience' },
];

interface StoredComponent {
  base_weight?: unknown;
  available?: unknown;
  confidence?: unknown;
  exclusion_reason?: unknown;
  sub_signals?: Record<string, { available?: unknown; exclusion_reason?: unknown }>;
  provenance?: { calculation_status?: unknown; details?: Record<string, unknown>; excluded_facts?: Array<{ fact_id?: unknown; reason?: unknown }> };
}

const number = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function missingReadiness(readiness: ProductReadiness, ...codes: string[]): string[] {
  return readiness.requirements.filter((item) => codes.includes(item.code) && !item.satisfied).map((item) => item.label);
}

function missingEvidence(key: PillarKey, component: StoredComponent, readiness: ProductReadiness, openQuestions: number): MissingEvidenceEntry[] {
  // General dependency contracts below must not appear as gaps once the frozen component is
  // already fully evidenced.
  if (number(component.confidence) >= 100) return [];
  const entries: MissingEvidenceEntry[] = [];
  const add = (entry: MissingEvidenceEntry) => {
    if (!entries.some((item) => item.code === entry.code)) entries.push(entry);
  };
  const rawReasons = [
    typeof component.exclusion_reason === 'string' ? component.exclusion_reason : null,
    ...Object.values(component.sub_signals ?? {}).filter((item) => item.available !== true).map((item) => typeof item.exclusion_reason === 'string' ? item.exclusion_reason : null),
    ...(component.provenance?.excluded_facts ?? []).map((item) => typeof item.fact_id === 'string' && typeof item.reason === 'string' ? `${item.fact_id}: ${item.reason}` : null),
  ].filter((item): item is string => Boolean(item));

  if (key === 'market_access') {
    if (openQuestions > 0) add({ code: 'classification_answers', label: `${openQuestions} product classification ${openQuestions === 1 ? 'answer' : 'answers'}`, owners: ['exporter', 'cleartrade_agent'], required_facts: ['destination classification answers', 'reviewed declarable line'], conditional: true });
    add({ code: 'authoritative_tariff', label: rawReasons[0] ?? 'Current authoritative tariff and India-origin preference applicability', owners: ['system_provider', 'cleartrade_agent'], required_facts: ['official destination tariff line', 'India-origin preference applicability', 'complete regulatory coverage'], conditional: false });
  }
  if (key === 'export_economics') {
    const exporterFacts = missingReadiness(readiness, 'export_price', 'shipment_size', 'origin_gateway');
    if (exporterFacts.length) add({ code: 'exporter_commercial_basis', label: 'Exporter price and normalization basis', owners: ['exporter'], required_facts: exporterFacts, conditional: true });
    add({ code: 'complete_cost_stack', label: rawReasons.join(' ') || 'Current exact-scope import benchmark and complete landed-cost stack', owners: ['cleartrade_agent', 'freight_logistics_partner', 'system_provider'], required_facts: ['compatible import unit-value benchmark', 'freight and handling quotes', 'insurance', 'customs valuation basis', 'FX where required', 'applicable tariff'], conditional: false });
  }
  if (key === 'exporter_market_fit') {
    const exporterFacts = missingReadiness(readiness, 'export_price', 'capacity', 'moq', 'packaging', 'lead_time');
    if (exporterFacts.length) add({ code: 'exporter_capabilities', label: 'Exporter product and operating capabilities', owners: ['exporter'], required_facts: exporterFacts, conditional: true });
    add({ code: 'destination_fit_benchmarks', label: rawReasons.join(' ') || 'Exact-scope destination fit benchmarks and certification requirements', owners: ['system_provider', 'cleartrade_agent'], required_facts: ['order quantity/value benchmark', 'production lead-time benchmark', 'packaging requirement', 'certification requirement and review'], conditional: false });
  }
  if (key === 'logistics_feasibility') {
    const exporterFacts = missingReadiness(readiness, 'origin_gateway', 'shipment_size', 'lead_time');
    if (exporterFacts.length) add({ code: 'exporter_route_basis', label: 'Exporter dispatch and shipment basis', owners: ['exporter'], required_facts: exporterFacts, conditional: true });
    add({ code: 'route_evidence', label: rawReasons[0] ?? 'Current explicit route evidence', owners: ['freight_logistics_partner', 'cleartrade_agent'], required_facts: ['origin-destination route', 'transport mode', 'transit time', 'equipment compatibility', 'current freight quote'], conditional: false });
  }
  if (key === 'risk_resilience') {
    for (const reason of rawReasons) {
      if (/macro/i.test(reason)) add({ code: 'macro_resilience', label: reason, owners: ['system_provider'], required_facts: ['current normalized macro-resilience signal'], conditional: false });
      else if (/payment|country-risk/i.test(reason)) add({ code: 'payment_resilience', label: reason, owners: ['system_provider'], required_facts: ['current normalized payment/country-risk signal'], conditional: false });
    }
  }
  if ((key === 'growth_score' || key === 'competition_score' || key === 'demand_score') && rawReasons.length) {
    add({ code: `${key}_trade_evidence`, label: rawReasons.join(' '), owners: ['system_provider'], required_facts: ['usable provider trade observations'], conditional: false });
  }
  return entries;
}

export function buildConfidenceGapLedger(args: {
  field_provenance: Prisma.JsonValue | null;
  stored_confidence: number;
  readiness: ProductReadiness;
  open_classification_questions?: number;
}): ConfidenceGapLedger {
  const root = args.field_provenance && typeof args.field_provenance === 'object' && !Array.isArray(args.field_provenance)
    ? args.field_provenance as Record<string, unknown>
    : {};
  const overall = root.overall_score && typeof root.overall_score === 'object' && !Array.isArray(root.overall_score)
    ? root.overall_score as Record<string, unknown>
    : {};
  const freshness = number(overall.evidence_recency_weight, 1);
  const rawComponents = COMPONENTS.map(({ key, stored }) => ({ key, component: (root[stored] ?? {}) as StoredComponent }));
  const totalBase = rawComponents.reduce((sum, item) => sum + number(item.component.base_weight), 0) || 100;
  const components = rawComponents.map(({ key, component }): ConfidenceLedgerComponent => {
    const base = number(component.base_weight);
    const coverage = number(component.confidence);
    const preFreshness = base / totalBase * 100 * coverage / 100;
    return {
      key,
      label: PILLAR_LABELS[key],
      base_weight: base,
      status: component.available === true ? 'available' : 'unavailable',
      evidence_coverage: coverage,
      freshness_multiplier: freshness,
      pre_freshness_contribution: round4(preFreshness),
      effective_contribution: round4(preFreshness * freshness),
      maximum_contribution: round4(base / totalBase * 100 * freshness),
      exact_missing_evidence: missingEvidence(key, component, args.readiness, args.open_classification_questions ?? 0),
    };
  });
  const rawCoverage = components.reduce((sum, item) => sum + item.pre_freshness_contribution, 0);
  // This reproduces country-truth-scoring-v4 exactly: component coverage is rounded before the
  // frozen-period freshness multiplier, then the final result is rounded again.
  const coverageBeforeFreshness = Math.round(rawCoverage);
  const calculated = Math.round(coverageBeforeFreshness * freshness);
  const effectiveSum = components.reduce((sum, item) => sum + item.effective_contribution, 0);

  const exporterAffected = components.filter((component) => component.exact_missing_evidence.some((entry) => entry.owners.includes('exporter')) && component.evidence_coverage < 100);
  const exporterFacts = [...new Set(exporterAffected.flatMap((component) => component.exact_missing_evidence.filter((entry) => entry.owners.includes('exporter')).flatMap((entry) => entry.required_facts)))];
  const potentialWeight = round4(exporterAffected.reduce((sum, component) => sum + (component.maximum_contribution - component.effective_contribution), 0));
  const remaining = components.filter((component) => component.evidence_coverage < 100 && component.exact_missing_evidence.some((entry) => entry.owners.some((owner) => owner !== 'exporter'))).map((component) => component.key);
  const formula = root.confidence_score && typeof root.confidence_score === 'object' && !Array.isArray(root.confidence_score)
    ? (root.confidence_score as Record<string, unknown>).formula_version
    : overall.confidence_formula_version;

  return {
    formula_version: typeof formula === 'string' ? formula : null,
    stored_confidence: args.stored_confidence,
    coverage_before_freshness: coverageBeforeFreshness,
    freshness_multiplier: freshness,
    calculated_confidence: calculated,
    unrounded_component_sum: round4(effectiveSum),
    rounding_adjustment: round4(args.stored_confidence - effectiveSum),
    reconciles: calculated === args.stored_confidence,
    components,
    exporter_data_ceiling: {
      current: args.stored_confidence,
      exact_reachable_confidence: null,
      potentially_unlocks_up_to_weight: potentialWeight,
      conditional_upper_bound: Math.min(100, round4(args.stored_confidence + potentialWeight)),
      exporter_missing_facts: exporterFacts,
      affected_components: exporterAffected.map((component) => component.key),
      remaining_provider_or_agent_components: remaining,
      explanation: 'Supplying a missing value does not prove compatibility or create counterpart market evidence. This is an upper bound on affected canonical weight, not a projected confidence.',
    },
  };
}
