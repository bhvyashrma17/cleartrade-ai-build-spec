/**
 * Phase 1H fact selection.
 *
 * Turns immutable raw evidence rows and a frozen first-party exporter snapshot into the typed,
 * exactly-scoped facts the deterministic pillar calculations consume. It performs no IO and
 * reads no clock: the caller supplies the frozen assessment clock, and nothing retrieved after
 * that clock is admissible.
 *
 * Three rules are load-bearing here:
 *   - a row that does not match this destination, this HS identity and this exporter is dropped,
 *     never widened, so no cross-country / cross-HS / cross-exporter fact can enter;
 *   - a tariff must sit on the exact HS6 line, while a prohibition or requirement may legitimately
 *     be published at chapter or heading level and is recorded with the scope it matched at;
 *   - an unrecorded value stays absent. Nothing in this module invents a zero, a default unit, a
 *     capability code, or an obtainability answer.
 */

import type {
  AssertionClass,
  CustomsValuationBasisValue,
  ExactFactScope,
  ExporterCertificationValue,
  ExporterFitBenchmarkValue,
  ExporterPriceValue,
  ExportCostComponentValue,
  FxRateValue,
  ImportBenchmarkValue,
  LeadTimeCapabilityValue,
  LogisticsFreightQuoteValue,
  LogisticsRouteValue,
  MarketAccessRequirementValue,
  PackagingCapabilityValue,
  PriceCapabilityValue,
  QuantityCapabilityValue,
  RegulatoryCoverageValue,
  ScopedFact,
  TariffFactValue,
} from './phase-1h-calculations';
import type { CountryTruthExporterFactSnapshot, CountryTruthFact } from './exporter-fact-snapshot';

export const COUNTRY_TRUTH_FACT_SELECTION_VERSION = 'country-truth-fact-selection-v1' as const;

type DecimalLike = { toString(): string } | string | number | null | undefined;

export interface CountryTruthSelectionScope extends ExactFactScope {
  /** Required here: every selection is performed for exactly one exporter tenant. */
  exporter_org_id: string;
  origin_country_code: string;
}

export interface MarketAccessSnapshotRow {
  id: string;
  country_code: string;
  hs_code_scope: string;
  source_authority: string;
  source_reference: string;
  retrieved_at: Date;
  effective_at: Date | null;
  expires_at: Date | null;
  completeness_status: string;
  tariff_coverage: boolean;
  regulatory_coverage: boolean;
  evidence_origin: string;
}

export interface MarketAccessEvidenceRow {
  id: string;
  snapshot_id: string;
  country_code: string;
  hs_code_scope: string;
  rule_type: string;
  source_authority: string;
  source_reference: string;
  retrieved_at: Date;
  effective_at: Date | null;
  expires_at: Date | null;
  superseded_at: Date | null;
  status: string;
  confidence: DecimalLike;
  evidence_origin: string;
  tariff_rate_percent: DecimalLike;
  requirement_code: string | null;
  requirement_description: string | null;
  requirement_obtainable: boolean | null;
}

export interface ExporterFitBenchmarkRow {
  id: string;
  country_code: string;
  hs_code_scope: string;
  benchmark_type: string;
  minimum_value: DecimalLike;
  maximum_value: DecimalLike;
  unit: string | null;
  currency: string | null;
  required: boolean | null;
  requirement_code: string | null;
  provider: string;
  source_reference: string;
  observed_at: Date;
  retrieved_at: Date;
  valid_until: Date | null;
  confidence: DecimalLike;
  status: string;
  evidence_origin: string;
}

export interface LogisticsRouteEvidenceRow {
  id: string;
  origin_country: string;
  origin_location_code: string | null;
  origin_gateway: string | null;
  destination_country: string;
  destination_port: string | null;
  transport_mode: string;
  route_available: boolean;
  transit_time_min_days: number | null;
  transit_time_max_days: number | null;
  freight_amount: DecimalLike;
  freight_currency: string | null;
  freight_rate_basis: string | null;
  freight_retrieved_at: Date | null;
  freight_valid_until: Date | null;
  assumed_shipment_value_amount: DecimalLike;
  assumed_shipment_value_currency: string | null;
  provider: string;
  source_reference: string;
  retrieved_at: Date;
  valid_until: Date | null;
  supported_product_constraint_codes: readonly string[];
  hs_code_scope: string | null;
  confidence: DecimalLike;
  status: string;
  evidence_origin: string;
}

export interface ExchangeRateQuoteRow {
  id: string;
  exporter_org_id: string;
  base_currency: string;
  quote_currency: string;
  rate: DecimalLike;
  source: string;
  source_reference: string | null;
  rate_date: Date;
  created_at: Date;
}

/**
 * A first-party per-unit cost line. Phase 1H has no connected provider or capture surface for
 * these yet, so production selections pass an empty list and Export Economics reports the
 * missing components explicitly rather than pricing them at zero.
 */
export interface ExportCostComponentRow {
  id: string;
  exporter_org_id: string;
  country_code: string;
  hs_code: string;
  hs_revision: string;
  component: string;
  amount_per_unit: DecimalLike;
  currency: string;
  quantity_unit: string;
  observed_at: Date;
  valid_until: Date | null;
  assertion_class: AssertionClass;
  source: string;
  source_reference: string;
  retrieved_at: Date;
  confidence: DecimalLike;
  evidence_origin: string;
}

/**
 * A destination import benchmark, expressed per unit on a stated valuation basis.
 *
 * The caller supplies this only when the destination's statistical import valuation is known to
 * be CIF; a trade-statistical unit value whose valuation basis is unrecorded is not a
 * comparable benchmark and must not be presented as one.
 */
export interface ImportBenchmarkRow {
  id: string;
  country_code: string;
  hs_code: string;
  hs_revision: string;
  value_per_unit: DecimalLike;
  currency: string;
  quantity_unit: string;
  valuation_basis: string;
  observed_at: Date;
  effective_from: Date;
  effective_to: Date | null;
  source: string;
  source_reference: string;
  retrieved_at: Date;
  confidence: DecimalLike;
}

export interface CustomsValuationBasisRow {
  id: string;
  country_code: string;
  basis: string;
  effective_from: Date;
  effective_to: Date | null;
  observed_at: Date;
  source: string;
  source_reference: string;
  retrieved_at: Date;
  confidence: DecimalLike;
  evidence_origin: string;
}

export interface CountryTruthEvidenceRows {
  market_access_snapshots: readonly MarketAccessSnapshotRow[];
  market_access_evidence: readonly MarketAccessEvidenceRow[];
  fit_benchmarks: readonly ExporterFitBenchmarkRow[];
  logistics_routes: readonly LogisticsRouteEvidenceRow[];
  exchange_rate_quotes: readonly ExchangeRateQuoteRow[];
  cost_components?: readonly ExportCostComponentRow[];
  customs_valuation_bases?: readonly CustomsValuationBasisRow[];
  import_benchmarks?: readonly ImportBenchmarkRow[];
}

export interface SelectedCountryTruthFacts {
  selection_version: typeof COUNTRY_TRUTH_FACT_SELECTION_VERSION;
  scope: CountryTruthSelectionScope;
  market_access: {
    tariffs: ScopedFact<TariffFactValue>[];
    requirements: ScopedFact<MarketAccessRequirementValue>[];
    regulatory_coverage: ScopedFact<RegulatoryCoverageValue> | null;
  };
  export_economics: {
    exporter_price: ScopedFact<ExporterPriceValue> | null;
    import_benchmark: ScopedFact<ImportBenchmarkValue> | null;
    cost_components: ScopedFact<ExportCostComponentValue>[];
    customs_valuation_basis: ScopedFact<CustomsValuationBasisValue> | null;
  };
  exporter_market_fit: {
    capacity: ScopedFact<QuantityCapabilityValue> | null;
    moq: ScopedFact<QuantityCapabilityValue> | null;
    production_lead_time: ScopedFact<LeadTimeCapabilityValue> | null;
    price: ScopedFact<PriceCapabilityValue> | null;
    packaging: ScopedFact<PackagingCapabilityValue> | null;
    certifications: ScopedFact<ExporterCertificationValue>[];
    benchmarks: ScopedFact<ExporterFitBenchmarkValue>[];
  };
  logistics: {
    routes: ScopedFact<LogisticsRouteValue>[];
    freight_quotes: ScopedFact<LogisticsFreightQuoteValue>[];
    required_constraint_codes: string[] | null;
    expected_origin: { location_code: string | null; gateway_code: string | null } | null;
  };
  fx_rates: ScopedFact<FxRateValue>[];
  /** Every row that was considered and rejected, with the reason, for reconciliation. */
  rejected: Array<{ source: string; row_id: string; reason: string }>;
}

const MAX_CONFIDENCE = 100;

function iso(value: Date): string {
  return value.toISOString();
}

function decimal(value: DecimalLike): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Stored 0..1 confidences become the 0..100 scale every Phase 1H calculation works in. */
function confidencePercent(value: DecimalLike): number {
  const parsed = decimal(value);
  if (parsed == null || parsed < 0) return 0;
  return Math.min(MAX_CONFIDENCE, parsed <= 1 ? parsed * 100 : parsed);
}

function normalizedCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/\s+/g, ' ').toUpperCase();
  return trimmed ? trimmed : null;
}

function digitsOnly(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : null;
}

/**
 * `exact` for an HS6 tariff line; `prefix_N` when a chapter or heading rule genuinely covers the
 * product. Null means the row describes different goods and must not be used at all.
 */
function hsScopeMatch(scope: string | null | undefined, hs6: string): 'exact' | `prefix_${number}` | null {
  const candidate = digitsOnly(scope);
  if (!candidate) return null;
  if (candidate === hs6) return 'exact';
  if (candidate.length < hs6.length && hs6.startsWith(candidate) && candidate.length % 2 === 0) {
    return `prefix_${candidate.length}`;
  }
  return null;
}

function factState<T>(fact: CountryTruthFact<T>): 'present' | 'unknown' | 'confirmed_absent' {
  return fact.state;
}

function presentValue<T>(fact: CountryTruthFact<T>): T | null {
  return fact.state === 'present' ? fact.value : null;
}

interface Recorder {
  reject(source: string, rowId: string, reason: string): void;
}

function scopeFor(
  scope: CountryTruthSelectionScope,
  tenantScoped: boolean,
): ExactFactScope {
  return tenantScoped
    ? {
        exporter_org_id: scope.exporter_org_id,
        country_code: scope.country_code,
        hs6: scope.hs6,
        hs_revision: scope.hs_revision,
        as_of_date: scope.as_of_date,
      }
    : {
        country_code: scope.country_code,
        hs6: scope.hs6,
        hs_revision: scope.hs_revision,
        as_of_date: scope.as_of_date,
      };
}

/**
 * Evidence must have been knowable at the assessment clock. A row retrieved later is not
 * "fresher", it is information the frozen assessment never had.
 */
function retrievedBefore(retrievedAt: Date, asOf: number) {
  return retrievedAt.getTime() <= asOf;
}

function selectTariffsAndRequirements(
  rows: readonly MarketAccessEvidenceRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
) {
  const tariffs: ScopedFact<TariffFactValue>[] = [];
  const requirements: ScopedFact<MarketAccessRequirementValue>[] = [];
  const factScope = scopeFor(scope, false);
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.country_code.toUpperCase() !== scope.country_code) {
      recorder.reject('market_access_evidence', row.id, 'destination_country_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('market_access_evidence', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    if (row.status === 'stale' || row.status === 'superseded') {
      recorder.reject('market_access_evidence', row.id, `evidence_status_${row.status}`);
      continue;
    }
    if (row.superseded_at != null && row.superseded_at.getTime() <= asOf) {
      recorder.reject('market_access_evidence', row.id, 'superseded_before_assessment_clock');
      continue;
    }
    const match = hsScopeMatch(row.hs_code_scope, scope.hs6);
    if (!match) {
      recorder.reject('market_access_evidence', row.id, 'hs_scope_does_not_cover_product');
      continue;
    }
    const provenance = {
      assertion_class: 'authoritative_public' as const,
      source: row.source_authority,
      source_reference: row.source_reference,
      retrieved_at: iso(row.retrieved_at),
    };
    const base = {
      scope: factScope,
      provenance,
      confidence: confidencePercent(row.confidence),
    };
    const effectiveFrom = iso(row.effective_at ?? row.retrieved_at);
    const effectiveTo = row.expires_at ? iso(row.expires_at) : null;

    if (row.rule_type === 'destination_tariff' || row.rule_type === 'preferential_tariff_india') {
      // A tariff published for a heading is not this product's tariff line.
      if (match !== 'exact') {
        recorder.reject('market_access_evidence', row.id, 'tariff_scope_is_not_the_exact_hs6_line');
        continue;
      }
      const rate = decimal(row.tariff_rate_percent);
      const isPreference = row.rule_type === 'preferential_tariff_india';
      const applicability: TariffFactValue['preference_applicability'] = !isPreference
        ? undefined
        : row.status === 'not_applicable'
          ? 'not_applicable'
          : row.status === 'verified' && rate != null
            ? 'applicable'
            : 'unknown';
      tariffs.push({
        ...base,
        id: `market_access_tariff:${row.id}`,
        state: 'present',
        value: {
          tariff_type: isPreference ? 'india_preference' : 'ordinary',
          origin_country: scope.origin_country_code,
          rate_percent: rate,
          ...(isPreference ? { preference_applicability: applicability } : {}),
          effective_from: effectiveFrom,
          effective_to: effectiveTo,
        },
      });
      continue;
    }

    const requirementType: MarketAccessRequirementValue['requirement_type'] | null =
      row.rule_type === 'import_prohibition'
        ? 'prohibition'
        : row.rule_type === 'import_restriction'
          ? 'restriction'
          : row.rule_type === 'mandatory_certification'
            ? 'mandatory_certification'
            : row.rule_type === 'material_non_tariff_requirement'
              ? 'other_document'
              : null;
    if (!requirementType) {
      recorder.reject('market_access_evidence', row.id, `unsupported_rule_type_${row.rule_type}`);
      continue;
    }
    if (row.status === 'not_applicable') {
      recorder.reject('market_access_evidence', row.id, 'requirement_marked_not_applicable');
      continue;
    }
    requirements.push({
      ...base,
      id: `market_access_requirement:${row.id}`,
      state: 'present',
      value: {
        requirement_type: requirementType,
        requirement_code: normalizedCode(row.requirement_code),
        description: row.requirement_description ?? '',
        obtainable:
          row.requirement_obtainable == null ? 'unknown' : row.requirement_obtainable ? 'yes' : 'no',
        effective_from: effectiveFrom,
        effective_to: effectiveTo,
        observed_at: iso(row.retrieved_at),
      },
      subject_key: normalizedCode(row.requirement_code) ?? undefined,
    });
  }
  return { tariffs, requirements };
}

function selectRegulatoryCoverage(
  rows: readonly MarketAccessSnapshotRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
): ScopedFact<RegulatoryCoverageValue> | null {
  const candidates: Array<{ row: MarketAccessSnapshotRow; match: string }> = [];
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.country_code.toUpperCase() !== scope.country_code) {
      recorder.reject('market_access_snapshot', row.id, 'destination_country_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('market_access_snapshot', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    const match = hsScopeMatch(row.hs_code_scope, scope.hs6);
    if (!match) {
      recorder.reject('market_access_snapshot', row.id, 'hs_scope_does_not_cover_product');
      continue;
    }
    candidates.push({ row, match });
  }
  // The narrowest, then newest, retrieval is the strongest completeness claim for this product.
  const selected = candidates.sort((left, right) => {
    const specificity =
      (right.match === 'exact' ? 1 : 0) - (left.match === 'exact' ? 1 : 0);
    if (specificity) return specificity;
    const retrieved = right.row.retrieved_at.getTime() - left.row.retrieved_at.getTime();
    return retrieved || left.row.id.localeCompare(right.row.id);
  })[0];
  if (!selected) return null;
  for (const candidate of candidates) {
    if (candidate.row.id !== selected.row.id) {
      recorder.reject('market_access_snapshot', candidate.row.id, 'superseded_by_narrower_or_newer_snapshot');
    }
  }
  const row = selected.row;
  return {
    id: `market_access_coverage:${row.id}`,
    state: 'present',
    scope: scopeFor(scope, false),
    provenance: {
      assertion_class: 'authoritative_public',
      source: row.source_authority,
      source_reference: row.source_reference,
      retrieved_at: iso(row.retrieved_at),
    },
    confidence: MAX_CONFIDENCE,
    value: {
      tariff_coverage: row.tariff_coverage,
      regulatory_coverage: row.regulatory_coverage,
      completeness: row.completeness_status as RegulatoryCoverageValue['completeness'],
      observed_at: iso(row.retrieved_at),
      effective_from: iso(row.effective_at ?? row.retrieved_at),
      effective_to: row.expires_at ? iso(row.expires_at) : null,
    },
  };
}

function selectFitBenchmarks(
  rows: readonly ExporterFitBenchmarkRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
): ScopedFact<ExporterFitBenchmarkValue>[] {
  const facts: ScopedFact<ExporterFitBenchmarkValue>[] = [];
  const factScope = scopeFor(scope, false);
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.country_code.toUpperCase() !== scope.country_code) {
      recorder.reject('fit_benchmark', row.id, 'destination_country_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('fit_benchmark', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    if (row.status !== 'verified') {
      recorder.reject('fit_benchmark', row.id, `benchmark_status_${row.status}`);
      continue;
    }
    if (!hsScopeMatch(row.hs_code_scope, scope.hs6)) {
      recorder.reject('fit_benchmark', row.id, 'hs_scope_does_not_cover_product');
      continue;
    }
    const common = {
      id: `fit_benchmark:${row.id}`,
      state: 'present' as const,
      scope: factScope,
      provenance: {
        assertion_class: 'authoritative_public' as const,
        source: row.provider,
        source_reference: row.source_reference,
        retrieved_at: iso(row.retrieved_at),
      },
      confidence: confidencePercent(row.confidence),
    };
    const effective = {
      effective_from: iso(row.observed_at),
      effective_to: row.valid_until ? iso(row.valid_until) : null,
      observed_at: iso(row.observed_at),
    };
    const minimum = decimal(row.minimum_value);
    const maximum = decimal(row.maximum_value);
    const unit = row.unit?.trim();
    const currency = row.currency?.trim().toUpperCase();

    if (row.benchmark_type === 'order_quantity') {
      if (!unit) {
        recorder.reject('fit_benchmark', row.id, 'order_quantity_benchmark_has_no_unit');
        continue;
      }
      facts.push({
        ...common,
        value: { ...effective, benchmark_type: 'order_quantity', minimum_quantity: minimum, maximum_quantity: maximum, quantity_unit: unit },
      });
      continue;
    }
    if (row.benchmark_type === 'order_value') {
      const reference = maximum ?? minimum;
      if (!unit || !currency || reference == null) {
        recorder.reject('fit_benchmark', row.id, 'order_value_benchmark_lacks_unit_currency_or_value');
        continue;
      }
      facts.push({
        ...common,
        value: { ...effective, benchmark_type: 'order_value', reference_value_per_unit: reference, currency, quantity_unit: unit },
      });
      continue;
    }
    if (row.benchmark_type === 'production_lead_time') {
      const days = maximum ?? minimum;
      if (days == null || days <= 0) {
        recorder.reject('fit_benchmark', row.id, 'lead_time_benchmark_has_no_maximum');
        continue;
      }
      facts.push({ ...common, value: { ...effective, benchmark_type: 'production_lead_time', maximum_days: days } });
      continue;
    }
    if (row.benchmark_type === 'packaging_required') {
      const code = normalizedCode(row.requirement_code);
      if (!code) {
        recorder.reject('fit_benchmark', row.id, 'packaging_benchmark_has_no_requirement_code');
        continue;
      }
      facts.push({
        ...common,
        value: { ...effective, benchmark_type: 'packaging_requirement', requirement_code: code, mandatory: row.required === true },
      });
      continue;
    }
    recorder.reject('fit_benchmark', row.id, `unsupported_benchmark_type_${row.benchmark_type}`);
  }
  return facts;
}

/**
 * A mandatory certification published as market-access evidence is the same market requirement
 * the fit pillar must test the exporter against, so it is projected into a fit benchmark rather
 * than duplicated as a second, differently-shaped truth.
 */
function certificationRequirementBenchmarks(
  requirements: readonly ScopedFact<MarketAccessRequirementValue>[],
): ScopedFact<ExporterFitBenchmarkValue>[] {
  const facts: ScopedFact<ExporterFitBenchmarkValue>[] = [];
  for (const requirement of requirements) {
    if (requirement.state !== 'present') continue;
    if (requirement.value.requirement_type !== 'mandatory_certification') continue;
    const code = requirement.value.requirement_code;
    if (!code) continue;
    facts.push({
      id: `certification_requirement:${requirement.id}`,
      state: 'present',
      scope: requirement.scope,
      provenance: requirement.provenance,
      confidence: requirement.confidence,
      value: {
        benchmark_type: 'certification_requirement',
        certification_code: code,
        mandatory: true,
        obtainable: requirement.value.obtainable,
        effective_from: requirement.value.effective_from,
        effective_to: requirement.value.effective_to ?? null,
        observed_at: requirement.value.observed_at,
      },
    });
  }
  return facts;
}

function selectRoutes(
  rows: readonly LogisticsRouteEvidenceRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
) {
  const routes: ScopedFact<LogisticsRouteValue>[] = [];
  const freightQuotes: ScopedFact<LogisticsFreightQuoteValue>[] = [];
  const factScope = scopeFor(scope, false);
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.destination_country.toUpperCase() !== scope.country_code) {
      recorder.reject('logistics_route', row.id, 'destination_country_mismatch');
      continue;
    }
    if (row.origin_country.toUpperCase() !== scope.origin_country_code) {
      recorder.reject('logistics_route', row.id, 'origin_country_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('logistics_route', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    if (row.status !== 'verified') {
      recorder.reject('logistics_route', row.id, `route_status_${row.status}`);
      continue;
    }
    // A route published for other goods is not evidence about this product; a route with no HS
    // scope at all is a general lane and stays usable.
    if (row.hs_code_scope != null && !hsScopeMatch(row.hs_code_scope, scope.hs6)) {
      recorder.reject('logistics_route', row.id, 'hs_scope_does_not_cover_product');
      continue;
    }
    const routeId = `logistics_route:${row.id}`;
    routes.push({
      id: routeId,
      state: 'present',
      scope: factScope,
      provenance: {
        assertion_class: 'authoritative_public',
        source: row.provider,
        source_reference: row.source_reference,
        retrieved_at: iso(row.retrieved_at),
      },
      confidence: confidencePercent(row.confidence),
      value: {
        route_status: row.route_available ? 'route_available' : 'route_unavailable',
        transport_mode: row.transport_mode,
        origin_location_code: normalizedCode(row.origin_location_code),
        origin_gateway_code: normalizedCode(row.origin_gateway),
        destination_location_code: normalizedCode(row.destination_port),
        transit_time_min_days: row.transit_time_min_days,
        transit_time_max_days: row.transit_time_max_days,
        // An empty provider array is "nothing stated", which is unknown coverage rather than a
        // claim that the lane supports nothing.
        supported_constraint_codes: row.supported_product_constraint_codes.length
          ? row.supported_product_constraint_codes.map((item) => item.trim().toUpperCase()).sort()
          : null,
        effective_from: iso(row.retrieved_at),
        effective_to: row.valid_until ? iso(row.valid_until) : null,
        observed_at: iso(row.retrieved_at),
      },
    });

    const freight = decimal(row.freight_amount);
    const goodsValue = decimal(row.assumed_shipment_value_amount);
    if (freight == null) continue;
    if (
      goodsValue == null ||
      goodsValue <= 0 ||
      !row.freight_currency ||
      !row.assumed_shipment_value_currency ||
      !row.freight_rate_basis ||
      !row.freight_retrieved_at ||
      !row.freight_valid_until
    ) {
      recorder.reject('logistics_freight_quote', row.id, 'freight_quote_missing_basis_currency_or_validity');
      continue;
    }
    freightQuotes.push({
      id: `logistics_freight_quote:${row.id}`,
      state: 'present',
      // A commercial rate is a partner assertion made to this exporter, so it is tenant scoped.
      scope: scopeFor(scope, true),
      provenance: {
        assertion_class: 'partner_quote',
        source: row.provider,
        source_reference: row.source_reference,
        retrieved_at: iso(row.freight_retrieved_at),
      },
      confidence: confidencePercent(row.confidence),
      value: {
        route_fact_id: routeId,
        freight_per_unit: freight,
        currency: row.freight_currency.trim().toUpperCase(),
        quantity_unit: row.freight_rate_basis.trim(),
        assumed_goods_value_per_unit: goodsValue,
        assumed_goods_value_currency: row.assumed_shipment_value_currency.trim().toUpperCase(),
        quoted_at: iso(row.freight_retrieved_at),
        valid_until: iso(row.freight_valid_until),
      },
    });
  }
  return { routes, freightQuotes };
}

const AUTHORITATIVE_FX_SOURCES = new Set(['rbi_reference', 'customs_notified']);

function selectFxRates(
  rows: readonly ExchangeRateQuoteRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
): ScopedFact<FxRateValue>[] {
  const facts: ScopedFact<FxRateValue>[] = [];
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    // An FX quote belongs to the exporter that recorded it. Reusing another tenant's bank rate
    // would be a cross-exporter leak even though the currency pair looks identical.
    if (row.exporter_org_id !== scope.exporter_org_id) {
      recorder.reject('exchange_rate_quote', row.id, 'exporter_org_mismatch');
      continue;
    }
    if (!retrievedBefore(row.created_at, asOf)) {
      recorder.reject('exchange_rate_quote', row.id, 'recorded_after_assessment_clock');
      continue;
    }
    const rate = decimal(row.rate);
    if (rate == null || rate <= 0) {
      recorder.reject('exchange_rate_quote', row.id, 'rate_is_not_positive');
      continue;
    }
    const authoritative = AUTHORITATIVE_FX_SOURCES.has(row.source);
    if (authoritative && !row.source_reference?.trim()) {
      recorder.reject('exchange_rate_quote', row.id, 'regulatory_rate_has_no_citation');
      continue;
    }
    facts.push({
      id: `exchange_rate_quote:${row.id}`,
      state: 'present',
      scope: scopeFor(scope, !authoritative),
      provenance: {
        assertion_class: authoritative ? 'authoritative_public' : 'partner_quote',
        source: row.source,
        source_reference: row.source_reference?.trim() || `exchange_rate_quote:${row.id}`,
        retrieved_at: iso(row.created_at),
      },
      confidence: MAX_CONFIDENCE,
      value: {
        base_currency: row.base_currency.trim().toUpperCase(),
        quote_currency: row.quote_currency.trim().toUpperCase(),
        direction: 'quote_per_base',
        rate,
        rate_date: iso(row.rate_date),
      },
    });
  }
  return facts;
}

function selectCostComponents(
  rows: readonly ExportCostComponentRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
): ScopedFact<ExportCostComponentValue>[] {
  const facts: ScopedFact<ExportCostComponentValue>[] = [];
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.exporter_org_id !== scope.exporter_org_id) {
      recorder.reject('cost_component', row.id, 'exporter_org_mismatch');
      continue;
    }
    if (row.country_code.toUpperCase() !== scope.country_code) {
      recorder.reject('cost_component', row.id, 'destination_country_mismatch');
      continue;
    }
    if (digitsOnly(row.hs_code) !== scope.hs6 || row.hs_revision.trim().toUpperCase() !== scope.hs_revision) {
      recorder.reject('cost_component', row.id, 'hs_identity_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('cost_component', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    const amount = decimal(row.amount_per_unit);
    if (amount == null) {
      recorder.reject('cost_component', row.id, 'amount_is_not_a_number');
      continue;
    }
    facts.push({
      id: `cost_component:${row.id}`,
      state: 'present',
      scope: scopeFor(scope, true),
      provenance: {
        assertion_class: row.assertion_class,
        source: row.source,
        source_reference: row.source_reference,
        retrieved_at: iso(row.retrieved_at),
      },
      confidence: confidencePercent(row.confidence),
      value: {
        component: row.component as ExportCostComponentValue['component'],
        amount_per_unit: amount,
        currency: row.currency.trim().toUpperCase(),
        quantity_unit: row.quantity_unit.trim(),
        observed_at: iso(row.observed_at),
        valid_until: row.valid_until ? iso(row.valid_until) : null,
      },
    });
  }
  return facts;
}

function selectImportBenchmark(
  rows: readonly ImportBenchmarkRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
): ScopedFact<ImportBenchmarkValue> | null {
  const candidates: ImportBenchmarkRow[] = [];
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.country_code.toUpperCase() !== scope.country_code) {
      recorder.reject('import_benchmark', row.id, 'destination_country_mismatch');
      continue;
    }
    if (digitsOnly(row.hs_code) !== scope.hs6 || row.hs_revision.trim().toUpperCase() !== scope.hs_revision) {
      recorder.reject('import_benchmark', row.id, 'hs_identity_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('import_benchmark', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    // Only an explicitly CIF-valued benchmark is comparable to a landed cost buildup.
    if (row.valuation_basis !== 'CIF') {
      recorder.reject('import_benchmark', row.id, 'benchmark_valuation_basis_is_not_cif');
      continue;
    }
    const value = decimal(row.value_per_unit);
    if (value == null || value <= 0) {
      recorder.reject('import_benchmark', row.id, 'benchmark_value_is_not_positive');
      continue;
    }
    candidates.push(row);
  }
  const selected = candidates.sort((left, right) => {
    const observed = right.observed_at.getTime() - left.observed_at.getTime();
    return observed || left.id.localeCompare(right.id);
  })[0];
  if (!selected) return null;
  return {
    id: `import_benchmark:${selected.id}`,
    state: 'present',
    scope: scopeFor(scope, false),
    provenance: {
      assertion_class: 'authoritative_public',
      source: selected.source,
      source_reference: selected.source_reference,
      retrieved_at: iso(selected.retrieved_at),
    },
    confidence: confidencePercent(selected.confidence),
    value: {
      value_per_unit: decimal(selected.value_per_unit)!,
      currency: selected.currency.trim().toUpperCase(),
      quantity_unit: selected.quantity_unit.trim(),
      valuation_basis: 'CIF',
      observed_at: iso(selected.observed_at),
      effective_from: iso(selected.effective_from),
      effective_to: selected.effective_to ? iso(selected.effective_to) : null,
    },
  };
}

function selectCustomsValuationBasis(
  rows: readonly CustomsValuationBasisRow[],
  scope: CountryTruthSelectionScope,
  asOf: number,
  recorder: Recorder,
): ScopedFact<CustomsValuationBasisValue> | null {
  const candidates: CustomsValuationBasisRow[] = [];
  for (const row of [...rows].sort((left, right) => left.id.localeCompare(right.id))) {
    if (row.country_code.toUpperCase() !== scope.country_code) {
      recorder.reject('customs_valuation_basis', row.id, 'destination_country_mismatch');
      continue;
    }
    if (!retrievedBefore(row.retrieved_at, asOf)) {
      recorder.reject('customs_valuation_basis', row.id, 'retrieved_after_assessment_clock');
      continue;
    }
    if (row.basis !== 'CIF' && row.basis !== 'FOB') {
      recorder.reject('customs_valuation_basis', row.id, 'unsupported_valuation_basis');
      continue;
    }
    candidates.push(row);
  }
  const selected = candidates.sort((left, right) => {
    const effective = right.effective_from.getTime() - left.effective_from.getTime();
    return effective || left.id.localeCompare(right.id);
  })[0];
  if (!selected) return null;
  return {
    id: `customs_valuation_basis:${selected.id}`,
    state: 'present',
    scope: scopeFor(scope, false),
    provenance: {
      assertion_class: 'authoritative_public',
      source: selected.source,
      source_reference: selected.source_reference,
      retrieved_at: iso(selected.retrieved_at),
    },
    confidence: confidencePercent(selected.confidence),
    value: {
      basis: selected.basis as 'CIF' | 'FOB',
      effective_from: iso(selected.effective_from),
      effective_to: selected.effective_to ? iso(selected.effective_to) : null,
      observed_at: iso(selected.observed_at),
    },
  };
}

/**
 * Projects the frozen first-party snapshot into exporter-side facts.
 *
 * Everything here is `exporter_declared` unless the snapshot itself records an agent
 * verification, and every unknown stays unknown: an exporter who has not told us their capacity
 * has no capacity fact, rather than a capacity of zero.
 */
function selectExporterFacts(
  snapshot: CountryTruthExporterFactSnapshot,
  scope: CountryTruthSelectionScope,
  recorder: Recorder,
) {
  const tenantScope = scopeFor(scope, true);
  const capturedAt = snapshot.captured_at;
  const base = <T>(id: string, fact: CountryTruthFact<T>) => ({
    id,
    scope: tenantScope,
    confidence: MAX_CONFIDENCE,
    provenance: {
      assertion_class:
        fact.state === 'unknown'
          ? ('exporter_declared' as AssertionClass)
          : (fact.provenance.assertion_class as AssertionClass),
      source: 'exporter_fact_snapshot',
      source_reference: `${snapshot.schema_version}:${snapshot.identity.product_id}`,
      retrieved_at: capturedAt,
    },
  });

  const price = presentValue(snapshot.commercial.price_target.amount);
  const priceCurrency = presentValue(snapshot.commercial.price_target.currency);
  const priceUnit = presentValue(snapshot.commercial.price_target.quantity_unit);
  const priceIncoterm = presentValue(snapshot.commercial.price_target.incoterm);
  const priceAmount = price == null ? null : Number(price);

  let exporterPrice: ScopedFact<ExporterPriceValue> | null = null;
  let priceCapability: ScopedFact<PriceCapabilityValue> | null = null;
  if (priceAmount != null && Number.isFinite(priceAmount) && priceCurrency && priceUnit) {
    priceCapability = {
      ...base('exporter_price_target', snapshot.commercial.price_target.amount),
      state: 'present',
      value: { amount_per_unit: priceAmount, currency: priceCurrency, quantity_unit: priceUnit, declared_at: capturedAt },
    };
    if (priceIncoterm) {
      exporterPrice = {
        ...base('exporter_price_offer', snapshot.commercial.price_target.amount),
        state: 'present',
        value: {
          amount_per_unit: priceAmount,
          currency: priceCurrency,
          quantity_unit: priceUnit,
          incoterm: priceIncoterm,
          declared_at: capturedAt,
        },
      };
    } else {
      recorder.reject('exporter_fact_snapshot', 'price_target', 'price_has_no_declared_incoterm');
    }
  } else if (priceAmount != null) {
    recorder.reject('exporter_fact_snapshot', 'price_target', 'price_has_no_currency_or_quantity_unit');
  }

  const quantityFact = (
    id: string,
    value: CountryTruthFact<string>,
    unit: CountryTruthFact<string>,
  ): ScopedFact<QuantityCapabilityValue> | null => {
    const amount = presentValue(value);
    const quantityUnit = presentValue(unit);
    if (amount == null || quantityUnit == null) return null;
    const parsed = Number(amount);
    if (!Number.isFinite(parsed)) {
      recorder.reject('exporter_fact_snapshot', id, 'quantity_is_not_a_number');
      return null;
    }
    return {
      ...base(id, value),
      state: 'present',
      value: { amount: parsed, quantity_unit: quantityUnit, declared_at: capturedAt },
    };
  };

  const leadTime = presentValue(snapshot.commercial.lead_time_days);
  const productionLeadTime: ScopedFact<LeadTimeCapabilityValue> | null =
    leadTime == null
      ? null
      : {
          ...base('exporter_lead_time_days', snapshot.commercial.lead_time_days),
          state: 'present',
          value: { days: leadTime, declared_at: capturedAt },
        };

  const certifications: ScopedFact<ExporterCertificationValue>[] = snapshot.certifications.items.map(
    (item) => {
      const lifecycle = presentValue(item.lifecycle_status);
      const holdingState = factState(item.holding);
      const evidenceRef = presentValue(item.evidence_ref);
      const validUntil = presentValue(item.valid_until);
      const provenanceSource =
        item.lifecycle_status.state === 'present' ? item.lifecycle_status.provenance : null;
      const common = {
        id: `exporter_certification:${item.certification_id}`,
        scope: tenantScope,
        confidence: MAX_CONFIDENCE,
        subject_key: item.code,
        provenance: {
          assertion_class: (provenanceSource?.assertion_class ?? 'exporter_declared') as AssertionClass,
          source: 'exporter_fact_snapshot',
          source_reference: `certification:${item.certification_id}`,
          retrieved_at: capturedAt,
        },
      };
      if (lifecycle == null) {
        return { ...common, state: 'unknown', reason: 'certification_lifecycle_state_unknown' };
      }
      if (lifecycle === 'not_applicable') {
        // "Not applicable to my product" is not "I do not hold it"; the market decides
        // applicability, so this stays an unknown rather than a confirmed absence.
        return { ...common, state: 'unknown', reason: 'exporter_marked_certification_not_applicable' };
      }
      const status: ExporterCertificationValue['status'] =
        lifecycle === 'held'
          ? 'held'
          : lifecycle === 'in_progress'
            ? 'in_progress'
            : lifecycle === 'expired'
              ? 'expired'
              : 'not_started';
      if (holdingState === 'confirmed_absent' && status === 'not_started') {
        return {
          ...common,
          state: 'present',
          value: {
            certification_code: item.code,
            status: 'not_started',
            evidence_reference: evidenceRef,
            valid_until: validUntil,
            declared_at: capturedAt,
          },
        };
      }
      return {
        ...common,
        state: 'present',
        value: {
          certification_code: item.code,
          status,
          evidence_reference: evidenceRef,
          valid_until: validUntil,
          declared_at: capturedAt,
        },
      };
    },
  );

  const constraints = snapshot.commercial.logistics_constraints;
  const requiredConstraintCodes =
    constraints.state === 'present'
      ? [...constraints.value].map((item) => item.trim().toUpperCase()).sort()
      : constraints.state === 'confirmed_absent'
        ? []
        : null;

  const originLocation = presentValue(snapshot.origin.pickup_location_code);
  const originGateway = presentValue(snapshot.origin.preferred_origin_gateway);

  // `packaging_capability` is free prose in exporter master data. Deriving a structured
  // capability code from it would be an invention, so packaging stays an explicit unknown until
  // a coded capability surface exists.
  const packaging: ScopedFact<PackagingCapabilityValue> | null = null;

  return {
    exporter_price: exporterPrice,
    capacity: quantityFact('exporter_capacity', snapshot.commercial.capacity.value, snapshot.commercial.capacity.unit),
    moq: quantityFact('exporter_moq', snapshot.commercial.minimum_order_quantity.value, snapshot.commercial.minimum_order_quantity.unit),
    production_lead_time: productionLeadTime,
    price: priceCapability,
    packaging,
    certifications,
    required_constraint_codes: requiredConstraintCodes,
    expected_origin:
      originLocation || originGateway
        ? { location_code: originLocation, gateway_code: originGateway }
        : null,
  };
}

export function selectCountryTruthFacts(args: {
  scope: CountryTruthSelectionScope;
  exporter_snapshot: CountryTruthExporterFactSnapshot;
  evidence: CountryTruthEvidenceRows;
}): SelectedCountryTruthFacts {
  const { scope } = args;
  if (!/^[A-Z]{2}$/.test(scope.country_code)) throw new Error('Fact selection requires an ISO alpha-2 destination.');
  if (!/^[A-Z]{2}$/.test(scope.origin_country_code)) throw new Error('Fact selection requires an ISO alpha-2 origin.');
  if (!/^\d{6}$/.test(scope.hs6)) throw new Error('Fact selection requires an exact HS6 identity.');
  if (!scope.exporter_org_id.trim()) throw new Error('Fact selection requires an exporter tenant.');
  const asOf = Date.parse(scope.as_of_date);
  if (!Number.isFinite(asOf)) throw new Error('Fact selection requires a valid assessment clock.');
  if (args.exporter_snapshot.identity.exporter_org_id !== scope.exporter_org_id) {
    throw new Error('The frozen exporter snapshot belongs to a different exporter.');
  }
  if (args.exporter_snapshot.identity.hs6 !== scope.hs6 || args.exporter_snapshot.identity.hs_revision !== scope.hs_revision) {
    throw new Error('The frozen exporter snapshot describes a different HS identity.');
  }

  const rejected: SelectedCountryTruthFacts['rejected'] = [];
  const recorder: Recorder = {
    reject(source, rowId, reason) {
      rejected.push({ source, row_id: rowId, reason });
    },
  };

  const { tariffs, requirements } = selectTariffsAndRequirements(
    args.evidence.market_access_evidence,
    scope,
    asOf,
    recorder,
  );
  const regulatoryCoverage = selectRegulatoryCoverage(args.evidence.market_access_snapshots, scope, asOf, recorder);
  const benchmarks = [
    ...selectFitBenchmarks(args.evidence.fit_benchmarks, scope, asOf, recorder),
    ...certificationRequirementBenchmarks(requirements),
  ].sort((left, right) => left.id.localeCompare(right.id));
  const { routes, freightQuotes } = selectRoutes(args.evidence.logistics_routes, scope, asOf, recorder);
  const fxRates = selectFxRates(args.evidence.exchange_rate_quotes, scope, asOf, recorder);
  const costComponents = selectCostComponents(args.evidence.cost_components ?? [], scope, asOf, recorder);
  const customsBasis = selectCustomsValuationBasis(args.evidence.customs_valuation_bases ?? [], scope, asOf, recorder);
  const importBenchmark = selectImportBenchmark(args.evidence.import_benchmarks ?? [], scope, asOf, recorder);
  const exporter = selectExporterFacts(args.exporter_snapshot, scope, recorder);

  return {
    selection_version: COUNTRY_TRUTH_FACT_SELECTION_VERSION,
    scope,
    market_access: { tariffs, requirements, regulatory_coverage: regulatoryCoverage },
    export_economics: {
      exporter_price: exporter.exporter_price,
      import_benchmark: importBenchmark,
      cost_components: costComponents,
      customs_valuation_basis: customsBasis,
    },
    exporter_market_fit: {
      capacity: exporter.capacity,
      moq: exporter.moq,
      production_lead_time: exporter.production_lead_time,
      price: exporter.price,
      packaging: exporter.packaging,
      certifications: exporter.certifications,
      benchmarks,
    },
    logistics: {
      routes,
      freight_quotes: freightQuotes,
      required_constraint_codes: exporter.required_constraint_codes,
      expected_origin: exporter.expected_origin,
    },
    fx_rates: fxRates,
    rejected: rejected.sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.row_id.localeCompare(right.row_id) ||
        left.reason.localeCompare(right.reason),
    ),
  };
}
