/**
 * Phase 1H fact manifests.
 *
 * Loads the raw non-trade evidence admissible at a frozen assessment clock, normalizes it
 * through deterministic selection, and persists the result as an immutable, checksummed
 * CountryTruthFactSnapshot. Facts are stored here; scores are stored on MarketAssessment. The
 * two are deliberately different records so a rescoring can never rewrite what was known.
 *
 * Re-running the same frozen question is idempotent because selection is deterministic over
 * evidence that was already retrievable at the clock. If evidence is backfilled with a past
 * retrieval date and would change a manifest that already exists, this module refuses rather
 * than quietly producing a second version of history.
 */

import { Prisma, type CountryTruthFactSnapshot } from '@prisma/client';
import type { CountryTruthPhase1HPolicy } from '@/lib/config';
import { canonicalHash } from '@/lib/country-evidence/planner';
import { allowedEvidenceOrigins, appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import type { CountryTruthExporterFactSnapshot } from './exporter-fact-snapshot';
import {
  COUNTRY_TRUTH_FACT_SELECTION_VERSION,
  selectCountryTruthFacts,
  type CountryTruthEvidenceRows,
  type ImportBenchmarkRow,
  type SelectedCountryTruthFacts,
} from './fact-selection';
import type { AssertionClass } from './phase-1h-calculations';

export const COUNTRY_TRUTH_FACTS_SCHEMA_VERSION = 'country-truth-facts-v1' as const;

/** India is the only origin ClearTrade assesses; it is stated rather than inferred. */
export const COUNTRY_TRUTH_ORIGIN_COUNTRY = 'IN' as const;

export interface CountryTruthFactSnapshotRequest {
  exporter_org_id: string;
  product_id: string;
  product_classification_id: string;
  country_trade_metrics_id: string;
  reporter_code: string;
  country_code: string;
  hs6: string;
  hs_revision: string;
  as_of_date: Date;
  exporter_snapshot: CountryTruthExporterFactSnapshot;
  exporter_snapshot_checksum: string;
  policy: { value: CountryTruthPhase1HPolicy; version: number };
  /**
   * The destination's own reported import unit value, supplied only when the caller has
   * established that this reporter values imports CIF.
   */
  import_benchmark?: ImportBenchmarkRow | null;
  /**
   * Supplemental India-origin import unit value. It is recorded in THIS manifest rather than in
   * CountryTradeMetrics so that Phase 1H can use it without altering a metric identity Phase 1G
   * has already validated. A customs statistic, never a selling price.
   */
  india_origin_unit_value?: CountryTruthSupplementalUnitValue | null;
  env?: NodeJS.ProcessEnv;
}

export interface CountryTruthSupplementalUnitValue {
  supplemental_version: string;
  value: { median: number; low: number; high: number; observation_count: number; basis: string } | null;
  unit: string | null;
  status: string;
  periods_used: number[];
  calculation_method: string;
  exclusion_reason: string | null;
}

export interface ResolvedCountryTruthFactSnapshot {
  record: CountryTruthFactSnapshot;
  facts: SelectedCountryTruthFacts;
  facts_payload: Record<string, unknown>;
  facts_checksum: string;
  snapshot_key: string;
  created: boolean;
}

/** HS scopes a destination rule may legitimately be published at for this product. */
function hsScopeCandidates(hs6: string): string[] {
  return [hs6, hs6.slice(0, 4), hs6.slice(0, 2)];
}

async function loadEvidenceRows(
  request: CountryTruthFactSnapshotRequest,
): Promise<CountryTruthEvidenceRows> {
  const origins = allowedEvidenceOrigins(request.env);
  const scopes = hsScopeCandidates(request.hs6);
  const asOf = request.as_of_date;

  const [snapshots, fitBenchmarks, routes, fxQuotes, fxObservations] = await Promise.all([
    prisma.marketAccessEvidenceSnapshot.findMany({
      where: {
        country_code: request.country_code,
        hs_code_scope: { in: scopes },
        retrieved_at: { lte: asOf },
        evidence_origin: { in: origins },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.exporterMarketFitBenchmark.findMany({
      where: {
        country_code: request.country_code,
        hs_code_scope: { in: scopes },
        retrieved_at: { lte: asOf },
        evidence_origin: { in: origins },
      },
      orderBy: { id: 'asc' },
    }),
    prisma.logisticsRouteEvidence.findMany({
      where: {
        origin_country: COUNTRY_TRUTH_ORIGIN_COUNTRY,
        destination_country: request.country_code,
        retrieved_at: { lte: asOf },
        evidence_origin: { in: origins },
        OR: [{ hs_code_scope: null }, { hs_code_scope: { in: scopes } }],
      },
      orderBy: { id: 'asc' },
    }),
    prisma.exchangeRateQuote.findMany({
      where: { exporter_org_id: request.exporter_org_id, created_at: { lte: asOf } },
      orderBy: { id: 'asc' },
    }),
    // Published reference rates are global. They are filtered by environment and origin like
    // every other evidence class, and by OBSERVATION date as well as retrieval date, so a rate
    // for a day after the clock can never be admitted.
    prisma.authoritativeFxObservation.findMany({
      where: {
        environment: appEnvironment(request.env),
        evidence_origin: { in: origins },
        retrieved_at: { lte: asOf },
        observation_date: { lte: asOf },
      },
      orderBy: [{ observation_date: 'desc' }, { id: 'asc' }],
      take: 200,
      include: { snapshot: { select: { source_authority: true } } },
    }),
  ]);

  const evidence = snapshots.length
    ? await prisma.marketAccessEvidence.findMany({
        where: {
          snapshot_id: { in: snapshots.map((row) => row.id) },
          // Each row carries its own origin. Inheriting the snapshot's would let a fixture row
          // filed under a real retrieval serve a production assessment.
          evidence_origin: { in: origins },
          retrieved_at: { lte: asOf },
        },
        orderBy: { id: 'asc' },
      })
    : [];

  return {
    market_access_snapshots: snapshots.map((row) => ({
      id: row.id,
      country_code: row.country_code,
      hs_code_scope: row.hs_code_scope,
      source_authority: row.source_authority,
      source_reference: row.source_reference,
      retrieved_at: row.retrieved_at,
      effective_at: row.effective_at,
      expires_at: row.expires_at,
      completeness_status: row.completeness_status,
      tariff_coverage: row.tariff_coverage,
      regulatory_coverage: row.regulatory_coverage,
      evidence_origin: row.evidence_origin,
    })),
    market_access_evidence: evidence.map((row) => ({
      id: row.id,
      snapshot_id: row.snapshot_id,
      country_code: row.country_code,
      hs_code_scope: row.hs_code_scope,
      rule_type: row.rule_type,
      source_authority: row.source_authority,
      source_reference: row.source_reference,
      retrieved_at: row.retrieved_at,
      effective_at: row.effective_at,
      expires_at: row.expires_at,
      superseded_at: row.superseded_at,
      status: row.status,
      confidence: row.confidence,
      evidence_origin: row.evidence_origin,
      tariff_rate_percent: row.tariff_rate_percent,
      preference_applicability: row.preference_applicability,
      preference_basis: row.preference_basis,
      duty_expression: row.duty_expression,
      duty_kind: row.duty_kind,
      national_tariff_code: row.national_tariff_code,
      verification_grade: row.verification_grade,
      requirement_code: row.requirement_code,
      requirement_description: row.requirement_description,
      requirement_obtainable: row.requirement_obtainable,
    })),
    fit_benchmarks: fitBenchmarks.map((row) => ({
      id: row.id,
      country_code: row.country_code,
      hs_code_scope: row.hs_code_scope,
      benchmark_type: row.benchmark_type,
      minimum_value: row.minimum_value,
      maximum_value: row.maximum_value,
      unit: row.unit,
      currency: row.currency,
      required: row.required,
      requirement_code: row.requirement_code,
      provider: row.provider,
      source_reference: row.source_reference,
      observed_at: row.observed_at,
      retrieved_at: row.retrieved_at,
      valid_until: row.valid_until,
      confidence: row.confidence,
      status: row.status,
      evidence_origin: row.evidence_origin,
    })),
    logistics_routes: routes.map((row) => ({
      id: row.id,
      origin_country: row.origin_country,
      origin_location_code: row.origin_location_code,
      origin_gateway: row.origin_gateway,
      destination_country: row.destination_country,
      destination_port: row.destination_port,
      transport_mode: row.transport_mode,
      route_available: row.route_available,
      transit_time_min_days: row.transit_time_min_days,
      transit_time_max_days: row.transit_time_max_days,
      freight_amount: row.freight_amount,
      freight_currency: row.freight_currency,
      freight_rate_basis: row.freight_rate_basis,
      freight_retrieved_at: row.freight_retrieved_at,
      freight_valid_until: row.freight_valid_until,
      assumed_shipment_value_amount: row.assumed_shipment_value_amount,
      assumed_shipment_value_currency: row.assumed_shipment_value_currency,
      provider: row.provider,
      source_reference: row.source_reference,
      retrieved_at: row.retrieved_at,
      valid_until: row.valid_until,
      supported_product_constraint_codes: row.supported_product_constraint_codes,
      hs_code_scope: row.hs_code_scope,
      confidence: row.confidence,
      status: row.status,
      evidence_origin: row.evidence_origin,
    })),
    authoritative_fx_observations: fxObservations.map((row) => ({
      id: row.id,
      provider: row.provider,
      series_key: row.series_key,
      base_currency: row.base_currency,
      quote_currency: row.quote_currency,
      rate: row.rate,
      observation_date: row.observation_date,
      retrieved_at: row.retrieved_at,
      source_authority: row.snapshot.source_authority,
      environment: row.environment,
      evidence_origin: row.evidence_origin,
    })),
    exchange_rate_quotes: fxQuotes.map((row) => ({
      id: row.id,
      exporter_org_id: row.exporter_org_id,
      base_currency: row.base_currency,
      quote_currency: row.quote_currency,
      rate: row.rate,
      source: row.source,
      source_reference: row.source_reference,
      rate_date: row.rate_date,
      created_at: row.created_at,
    })),
    // No connected provider or capture surface exists for per-unit export cost lines or for
    // published customs valuation rules yet. They stay empty rather than being approximated.
    cost_components: [],
    customs_valuation_bases: [],
    import_benchmarks: request.import_benchmark ? [request.import_benchmark] : [],
  };
}

function assertionClassesOf(facts: SelectedCountryTruthFacts): AssertionClass[] {
  const classes = new Set<AssertionClass>();
  const visit = (fact: { provenance: { assertion_class: AssertionClass } } | null | undefined) => {
    if (fact) classes.add(fact.provenance.assertion_class);
  };
  facts.market_access.tariffs.forEach(visit);
  facts.market_access.requirements.forEach(visit);
  visit(facts.market_access.regulatory_coverage);
  visit(facts.export_economics.exporter_price);
  visit(facts.export_economics.import_benchmark);
  visit(facts.export_economics.customs_valuation_basis);
  facts.export_economics.cost_components.forEach(visit);
  visit(facts.exporter_market_fit.capacity);
  visit(facts.exporter_market_fit.moq);
  visit(facts.exporter_market_fit.production_lead_time);
  visit(facts.exporter_market_fit.price);
  visit(facts.exporter_market_fit.packaging);
  facts.exporter_market_fit.certifications.forEach(visit);
  facts.exporter_market_fit.benchmarks.forEach(visit);
  facts.logistics.routes.forEach(visit);
  facts.logistics.freight_quotes.forEach(visit);
  facts.fx_rates.forEach(visit);
  return [...classes].sort();
}

/** Origins of the rows that actually survived selection, not of everything that was queried. */
function evidenceOriginsOf(
  rows: CountryTruthEvidenceRows,
  facts: SelectedCountryTruthFacts,
): string[] {
  const rejected = new Set(facts.rejected.map((item) => `${item.source}:${item.row_id}`));
  const origins = new Set<string>();
  const collect = (source: string, items: readonly { id: string; evidence_origin: string }[]) => {
    for (const row of items) {
      if (!rejected.has(`${source}:${row.id}`)) origins.add(row.evidence_origin);
    }
  };
  collect('market_access_snapshot', rows.market_access_snapshots);
  collect('market_access_evidence', rows.market_access_evidence);
  collect('fit_benchmark', rows.fit_benchmarks);
  collect('logistics_route', rows.logistics_routes);
  return [...origins].sort();
}

export function buildCountryTruthFactsPayload(
  request: CountryTruthFactSnapshotRequest,
  facts: SelectedCountryTruthFacts,
) {
  const payload = {
    schema_version: COUNTRY_TRUTH_FACTS_SCHEMA_VERSION,
    selection_version: COUNTRY_TRUTH_FACT_SELECTION_VERSION,
    calculation_version: request.policy.value.calculation_version,
    scope: {
      exporter_org_id: request.exporter_org_id,
      product_id: request.product_id,
      product_classification_id: request.product_classification_id,
      reporter_code: request.reporter_code,
      country_code: request.country_code,
      origin_country_code: COUNTRY_TRUTH_ORIGIN_COUNTRY,
      hs6: request.hs6,
      hs_revision: request.hs_revision,
      as_of_date: request.as_of_date.toISOString(),
    },
    exporter_snapshot_checksum: request.exporter_snapshot_checksum,
    facts: {
      market_access: facts.market_access,
      export_economics: facts.export_economics,
      exporter_market_fit: facts.exporter_market_fit,
      logistics: facts.logistics,
      fx_rates: facts.fx_rates,
    },
    supplemental_trade_statistics: {
      india_origin_unit_value_version: request.policy.value.india_origin_unit_value_version,
      // Explicitly null when unavailable: a supplemental statistic we could not compute is
      // recorded as absent, never omitted so that a reader could mistake it for zero.
      india_origin_unit_value: request.india_origin_unit_value ?? null,
      semantic_label: 'Trade-statistical unit value; not a selling-price quote.',
    },
    rejected_rows: facts.rejected,
  };
  return { payload, checksum: canonicalHash(payload) };
}

function selectionPolicySnapshot(policy: CountryTruthPhase1HPolicy) {
  return policy as unknown as Record<string, unknown>;
}

export async function resolveCountryTruthFactSnapshot(
  request: CountryTruthFactSnapshotRequest,
): Promise<ResolvedCountryTruthFactSnapshot> {
  const hsRevision = request.hs_revision.trim().toUpperCase();
  const countryCode = request.country_code.trim().toUpperCase();
  if (!/^\d{6}$/.test(request.hs6)) throw new Error('A Phase 1H fact manifest requires an exact HS6.');
  if (!/^[A-Z]{2}$/.test(countryCode)) throw new Error('A Phase 1H fact manifest requires an ISO alpha-2 destination.');
  if (request.exporter_snapshot.identity.hs_revision !== hsRevision) {
    throw new Error('The frozen exporter snapshot describes a different HS revision.');
  }

  const rows = await loadEvidenceRows({ ...request, country_code: countryCode });
  const facts = selectCountryTruthFacts({
    scope: {
      exporter_org_id: request.exporter_org_id,
      origin_country_code: COUNTRY_TRUTH_ORIGIN_COUNTRY,
      country_code: countryCode,
      hs6: request.hs6,
      hs_revision: hsRevision,
      as_of_date: request.as_of_date.toISOString(),
    },
    exporter_snapshot: request.exporter_snapshot,
    evidence: rows,
  });

  const { payload, checksum } = buildCountryTruthFactsPayload(
    { ...request, country_code: countryCode, hs_revision: hsRevision },
    facts,
  );
  const selectionPolicyHash = canonicalHash({
    ...selectionPolicySnapshot(request.policy.value),
    config_version: request.policy.version,
  });
  // Everything that can change the meaning of this manifest is in the key: the frozen question,
  // the exporter facts it was asked about, and the versioned policy that selected the evidence.
  const snapshotKey = canonicalHash({
    schema_version: COUNTRY_TRUTH_FACTS_SCHEMA_VERSION,
    selection_version: COUNTRY_TRUTH_FACT_SELECTION_VERSION,
    calculation_version: request.policy.value.calculation_version,
    exporter_org_id: request.exporter_org_id,
    product_id: request.product_id,
    product_classification_id: request.product_classification_id,
    country_trade_metrics_id: request.country_trade_metrics_id,
    reporter_code: request.reporter_code,
    country_code: countryCode,
    hs_code: request.hs6,
    hs_revision: hsRevision,
    as_of_date: request.as_of_date.toISOString(),
    exporter_snapshot_checksum: request.exporter_snapshot_checksum,
    selection_policy_version: request.policy.version,
    selection_policy_hash: selectionPolicyHash,
  });

  const existing = await prisma.countryTruthFactSnapshot.findUnique({ where: { snapshot_key: snapshotKey } });
  if (existing) {
    if (existing.facts_checksum !== checksum) {
      throw new Error(
        `Country Truth fact manifest ${snapshotKey} already exists with a different fact checksum. Evidence was backdated after the manifest was frozen; resolve a new versioned manifest instead of rewriting history.`,
      );
    }
    return { record: existing, facts, facts_payload: payload, facts_checksum: checksum, snapshot_key: snapshotKey, created: false };
  }

  const data = {
    snapshot_key: snapshotKey,
    schema_version: COUNTRY_TRUTH_FACTS_SCHEMA_VERSION,
    calculation_version: request.policy.value.calculation_version,
    exporter_org_id: request.exporter_org_id,
    product_id: request.product_id,
    product_classification_id: request.product_classification_id,
    country_trade_metrics_id: request.country_trade_metrics_id,
    reporter_code: request.reporter_code,
    country_code: countryCode,
    hs_code: request.hs6,
    hs_revision: hsRevision,
    as_of_date: request.as_of_date,
    exporter_snapshot_checksum: request.exporter_snapshot_checksum,
    selection_policy_version: request.policy.version,
    selection_policy_hash: selectionPolicyHash,
    selection_policy_snapshot: selectionPolicySnapshot(request.policy.value) as Prisma.InputJsonValue,
    facts_payload: payload as unknown as Prisma.InputJsonValue,
    facts_checksum: checksum,
    evidence_origins: evidenceOriginsOf(rows, facts) as never,
    assertion_classes: assertionClassesOf(facts) as never,
  };

  try {
    const record = await prisma.countryTruthFactSnapshot.create({ data });
    return { record, facts, facts_payload: payload, facts_checksum: checksum, snapshot_key: snapshotKey, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const raced = await prisma.countryTruthFactSnapshot.findUnique({ where: { snapshot_key: snapshotKey } });
    if (!raced) throw error;
    if (raced.facts_checksum !== checksum) {
      throw new Error(`Country Truth fact manifest ${snapshotKey} was written concurrently with a different fact checksum.`);
    }
    return { record: raced, facts, facts_payload: payload, facts_checksum: checksum, snapshot_key: snapshotKey, created: false };
  }
}

/**
 * Builds the destination import benchmark from frozen trade metrics, and only when policy states
 * that this destination reports imports on a CIF basis. Any other reporter yields null, so
 * Export Economics reports an explicitly unavailable benchmark rather than an incomparable one.
 */
export function importBenchmarkFromTradeMetrics(args: {
  policy: CountryTruthPhase1HPolicy;
  country_trade_metrics_id: string;
  country_code: string;
  hs_code: string;
  hs_revision: string;
  as_of_date: Date;
  /** Newest reporting year in the frozen analysis window; it dates the benchmark. */
  latest_period_year: number | null;
  unit_value: { value: { median: number; basis: string } | null; status: string } | null | undefined;
}): ImportBenchmarkRow | null {
  const basis = args.policy.trade_statistical_import_valuation_by_country[args.country_code.toUpperCase()];
  if (basis !== 'CIF') return null;
  const metric = args.unit_value;
  if (!metric || metric.status !== 'complete' || metric.value == null) return null;
  const median = metric.value.median;
  if (!Number.isFinite(median) || median <= 0) return null;
  const quantityUnit =
    metric.value.basis === 'net_weight_kg'
      ? 'kg'
      : metric.value.basis.startsWith('provider_quantity_')
        ? metric.value.basis.slice('provider_quantity_'.length)
        : null;
  if (!quantityUnit) return null;
  if (args.latest_period_year == null || !Number.isInteger(args.latest_period_year)) return null;
  // The benchmark describes a reporting period, not a retrieval. Dating it by the end of that
  // period is what lets the age policy notice a benchmark that has fallen too far behind, while
  // dating its retrieval at the frozen clock is what keeps a derived metric admissible at all:
  // the metrics row itself is written during the run, always after the assessment clock.
  const periodEnd = new Date(Date.UTC(args.latest_period_year, 11, 31));
  return {
    id: `country_trade_metrics:${args.country_trade_metrics_id}`,
    country_code: args.country_code.toUpperCase(),
    hs_code: args.hs_code,
    hs_revision: args.hs_revision.toUpperCase(),
    value_per_unit: median,
    // Comtrade trade values are reported in United States dollars.
    currency: 'USD',
    quantity_unit: quantityUnit,
    valuation_basis: 'CIF',
    observed_at: periodEnd,
    effective_from: periodEnd,
    effective_to: null,
    source: 'un_comtrade',
    source_reference: `country_trade_metrics:${args.country_trade_metrics_id}`,
    retrieved_at: args.as_of_date,
    confidence: 100,
  };
}
