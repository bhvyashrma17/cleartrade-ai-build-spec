/**
 * Phase 1H pillar orchestration.
 *
 * Runs the four deterministic non-trade calculations over one frozen fact selection and
 * translates them into the shapes the v4 country scorer consumes. No IO, no clock reads.
 *
 * The rule this file exists to enforce: a hard blocker never becomes a low number. A blocked
 * pillar is handed to the scorer as `unavailable` — so it cannot be averaged with a good tariff
 * or a cheap freight rate — and the blocker itself travels separately to the eligibility gate.
 */

import type { CountryTruthPhase1HPolicy } from '@/lib/config';
import type { AuthoritativeComponentInput } from '@/lib/discovery/country-truth-scoring-v4';
import type { SelectedCountryTruthFacts } from './fact-selection';
import {
  calculateExporterMarketFitV3,
  calculateExportEconomicsV3,
  calculateLogisticsV3,
  calculateMarketAccessV2,
  type CalculationProvenance,
  type ExactFactScope,
  type ExportEconomicsV3Result,
  type ExporterMarketFitV3Result,
  type LogisticsV3Result,
  type MarketAccessV2Result,
  type ScopedFact,
} from './phase-1h-calculations';

export type CountryTruthPillarName =
  | 'market_access'
  | 'export_economics'
  | 'exporter_market_fit'
  | 'logistics_feasibility';

export interface CountryTruthBlocker {
  pillar: CountryTruthPillarName;
  code: string;
  subject: string | null;
  evidence_fact_ids: string[];
}

export interface CountryTruthPillarResults {
  market_access: MarketAccessV2Result;
  export_economics: ExportEconomicsV3Result;
  exporter_market_fit: ExporterMarketFitV3Result;
  logistics_feasibility: LogisticsV3Result;
}

export interface CountryTruthPillarOutput {
  results: CountryTruthPillarResults;
  blockers: CountryTruthBlocker[];
  /** Exactly the four non-trade inputs the v4 scorer accepts. */
  non_trade: Record<CountryTruthPillarName, AuthoritativeComponentInput>;
}

function calculationScope(facts: SelectedCountryTruthFacts): ExactFactScope {
  return {
    exporter_org_id: facts.scope.exporter_org_id,
    country_code: facts.scope.country_code,
    hs6: facts.scope.hs6,
    hs_revision: facts.scope.hs_revision,
    as_of_date: facts.scope.as_of_date,
  };
}

/**
 * The scope tariff facts were selected in, when the run admitted tariff evidence on its own clock
 * (WP2, docs/35 D-004); otherwise undefined and tariffs share the calculation scope. Only the two
 * pillars that select an applicable tariff receive it — every other fact stays on the trade clock.
 */
function tariffScope(facts: SelectedCountryTruthFacts): ExactFactScope | undefined {
  const clock = facts.scope.tariff_as_of_date;
  return clock ? { ...calculationScope(facts), as_of_date: clock } : undefined;
}

/**
 * A missing optional fact is represented as an explicit non-present fact rather than omitted,
 * so the calculation records *why* an input was absent instead of silently having fewer inputs.
 */
function absentFact<T>(id: string, scope: ExactFactScope, reason: string): ScopedFact<T> {
  return {
    id,
    state: 'missing',
    reason,
    scope,
    confidence: 0,
    provenance: {
      assertion_class: 'exporter_declared',
      source: 'country_truth_fact_selection',
      source_reference: id,
      retrieved_at: scope.as_of_date,
    },
  };
}

function component(
  status: 'available' | 'unavailable',
  score: number | null,
  confidence: number,
  provenance: Record<string, unknown>,
  exclusionReason: string | null,
): AuthoritativeComponentInput {
  return { status, score, confidence, provenance, exclusion_reason: exclusionReason };
}

/**
 * Blocked and `insufficient_exporter_data` both yield an unavailable component, but for
 * different published reasons: the first because a gate fires, the second because ClearTrade
 * holds no first-party fact. Neither is ever a zero score.
 */
function toComponent(
  result: {
    status: string;
    score: number | null;
    confidence: number;
    reasons: string[];
    provenance: CalculationProvenance;
  },
  blocked: boolean,
  extra: Record<string, unknown> = {},
): AuthoritativeComponentInput {
  const provenance: Record<string, unknown> = {
    ...result.provenance,
    ...extra,
    calculation_status: result.status,
  };
  if (blocked) {
    return component('unavailable', null, 0, provenance, 'blocked_by_explicit_hard_gate');
  }
  if (result.score == null) {
    return component(
      'unavailable',
      null,
      0,
      provenance,
      result.status === 'insufficient_exporter_data'
        ? 'insufficient_exporter_data'
        : result.reasons[0] ?? 'no_usable_evidence',
    );
  }
  return component('available', result.score, result.confidence, provenance, null);
}

export function calculateCountryTruthPillars(
  facts: SelectedCountryTruthFacts,
  policy: CountryTruthPhase1HPolicy,
): CountryTruthPillarOutput {
  const scope = calculationScope(facts);
  const tariff = tariffScope(facts);

  const marketAccess = calculateMarketAccessV2(
    {
      scope,
      tariffs: facts.market_access.tariffs,
      requirements: facts.market_access.requirements,
      regulatory_coverage: facts.market_access.regulatory_coverage ?? undefined,
      ...(tariff ? { tariff_scope: tariff } : {}),
    },
    policy.market_access,
  );

  const exportEconomics = calculateExportEconomicsV3(
    {
      scope,
      exporter_price:
        facts.export_economics.exporter_price ??
        absentFact('exporter_price_offer', scope, 'exporter_has_declared_no_priced_incoterm_offer'),
      benchmark:
        facts.export_economics.import_benchmark ??
        absentFact('cif_import_benchmark', scope, 'no_explicitly_cif_valued_import_benchmark_exists'),
      tariffs: facts.market_access.tariffs,
      cost_components: facts.export_economics.cost_components,
      fx_rates: facts.fx_rates,
      customs_valuation_basis: facts.export_economics.customs_valuation_basis ?? undefined,
      ...(tariff ? { tariff_scope: tariff } : {}),
    },
    policy.export_economics,
  );

  const exporterMarketFit = calculateExporterMarketFitV3(
    {
      scope,
      capacity: facts.exporter_market_fit.capacity ?? undefined,
      moq: facts.exporter_market_fit.moq ?? undefined,
      production_lead_time: facts.exporter_market_fit.production_lead_time ?? undefined,
      price: facts.exporter_market_fit.price ?? undefined,
      packaging: facts.exporter_market_fit.packaging ?? undefined,
      certifications: facts.exporter_market_fit.certifications,
      benchmarks: facts.exporter_market_fit.benchmarks,
      fx_rates: facts.fx_rates,
    },
    policy.exporter_market_fit,
  );

  const logistics = calculateLogisticsV3(
    {
      scope,
      routes: facts.logistics.routes,
      freight_quotes: facts.logistics.freight_quotes,
      required_constraint_codes: facts.logistics.required_constraint_codes,
      expected_origin: facts.logistics.expected_origin,
    },
    policy.logistics_feasibility,
  );

  const blockers: CountryTruthBlocker[] = [
    ...marketAccess.blockers.map((blocker) => ({
      pillar: 'market_access' as const,
      code: blocker.code,
      subject: blocker.requirement_code,
      evidence_fact_ids: [blocker.fact_id],
    })),
    ...exporterMarketFit.hard_blockers.map((blocker) => ({
      pillar: 'exporter_market_fit' as const,
      code: blocker.code,
      subject: blocker.certification_code,
      evidence_fact_ids: [blocker.benchmark_fact_id, blocker.exporter_fact_id].sort(),
    })),
  ].sort(
    (left, right) =>
      left.pillar.localeCompare(right.pillar) ||
      left.code.localeCompare(right.code) ||
      (left.subject ?? '').localeCompare(right.subject ?? ''),
  );

  return {
    results: {
      market_access: marketAccess,
      export_economics: exportEconomics,
      exporter_market_fit: exporterMarketFit,
      logistics_feasibility: logistics,
    },
    blockers,
    non_trade: {
      market_access: toComponent(marketAccess, marketAccess.blockers.length > 0, {
        applicable_tariff_basis: marketAccess.applicable_tariff.tariff_basis,
        blockers: marketAccess.blockers,
      }),
      export_economics: toComponent(exportEconomics, false, {
        cost_stack_incomplete: exportEconomics.cost_stack_incomplete,
        components: exportEconomics.components,
      }),
      exporter_market_fit: toComponent(exporterMarketFit, exporterMarketFit.hard_blockers.length > 0, {
        hard_blockers: exporterMarketFit.hard_blockers,
      }),
      logistics_feasibility: toComponent(logistics, false, {
        route_status: logistics.route_status,
        selected_route_id: logistics.selected_route_id,
      }),
    },
  };
}
