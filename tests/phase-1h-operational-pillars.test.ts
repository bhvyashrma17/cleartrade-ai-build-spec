import { createHash, randomUUID } from 'node:crypto';
import {
  CertificationStatus, EvidenceAssertionClass, EvidenceOrigin, LogisticsTransportMode, OrgTier, Prisma,
  ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole,
} from '@prisma/client';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '../src/lib/comtrade';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { createCountryEvidencePlan, executeCountryEvidencePlan } from '../src/lib/country-evidence/service';
import { calculateAndPersistCountryTradeMetrics } from '../src/lib/country-trade-metrics/service';
import { importBenchmarkFromTradeMetrics, resolveCountryTruthFactSnapshot } from '../src/lib/country-truth/fact-snapshot-service';
import { calculateCountryTruthPillars } from '../src/lib/country-truth/pillars';
import { buildCountryTruthExporterFactSnapshot } from '../src/lib/country-truth/exporter-fact-snapshot';
import { prisma } from '../src/lib/prisma';

/**
 * CANARY A — deterministic UAT.
 *
 * Proves that Export Economics, Exporter-Market Fit and Logistics Feasibility can all become
 * AVAILABLE once the operational evidence exists, and that each one goes unavailable again for a
 * stated reason the moment a required input is removed. Every row here is explicitly `fixture`
 * evidence for a synthetic exporter; the platform forbids fixture origins in staging and
 * production, which is exactly why this canary is a test rather than a staging run.
 */

const AS_OF = new Date('2026-08-30T00:00:00Z');
const CLOCK = new Date('2026-08-31T00:00:00Z');
const REPORTER = '276';
const COUNTRY = 'DE';
let hsCounter = 0;

function fixtureComtradeClient() {
  return {
    name: 'pillars-fixture',
    identity: { provider: 'un_comtrade' as const, mode: 'fixture' as const, authenticated: false, credential_fingerprint: `fixture-${randomUUID()}`, source_dataset: 'fixture-pillars', source_dataset_version: 'v1' },
    async resolveChapter() { throw new Error('explicit HS6 should bypass reference'); },
    async fetchChapter(params: ComtradeFetchParams) {
      const hs = params.hs_codes[0]!;
      const rows = (params.partner === 'all'
        ? [['156', 60_000_000, 30_000_000], ['699', 40_000_000, 20_000_000]]
        : params.partner === '699'
          ? [['699', 40_000_000, 20_000_000]]
          : [['0', 100_000_000, 50_000_000]]
      ).map(([partner, value, weight]) => ({ reporter: params.reporter, partner: String(partner), partner2: '0', hs_code: hs, year: params.year, period: String(params.year), value: Number(value), value_status: 'observed' as const, quantity: null, quantity_status: 'missing' as const, unit: null, net_weight: Number(weight), flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }));
      const raw = JSON.stringify({ count: rows.length, data: rows });
      return { rows, request_count: 1, retrieved_at: new Date(), source_dataset_version: 'v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'comtrade://fixture', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { truncated: false, rejected_rows: 0 }, quota_metadata: null, retrieved_at: new Date() }] };
    },
  };
}

/** A synthetic exporter with every structured fact Phase 1H needs, all fixture-origin. */
async function syntheticExporter() {
  // Chapter 10 (cereals), so the weight-based unit value is comparable exactly as it is for
  // the real Basmati product; each test still gets its own HS6 to keep evidence isolated.
  const hs6 = String(100_600 + ++hsCounter);
  const marker = `pillars-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: `SYNTHETIC ${marker}`, tier: OrgTier.paid, country: 'IN', state: 'Maharashtra', city: 'Mumbai', pickup_location_code: 'INNSA1', preferred_origin_gateway: 'INNSA' } });
  const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Synthetic rice', evidence_origin: EvidenceOrigin.fixture } });
  await prisma.product.update({
    where: { id: product.id },
    data: {
      hs_code: hs6, hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022',
      hs_classification_method: ProductClassificationMethod.exporter_supplied,
      hs_classification_status: ProductClassificationStatus.confirmed,
      hs_confirmed_by_id: agent.id, hs_confirmed_at: AS_OF, hs_classification_revision: 1,
      price_target_amount: new Prisma.Decimal('1.2000'), price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB',
      capacity_value: new Prisma.Decimal('500000'), capacity_unit: 'kg', available_capacity_value: new Prisma.Decimal('300000'), capacity_period: 'month',
      moq_value: new Prisma.Decimal('20000'), moq_unit: 'kg',
      lead_time_days: 21, delivery_commitment_days: 45,
      packaging_format: 'PP_BAG', pack_size_value: new Prisma.Decimal('25'), pack_size_unit: 'kg',
      units_per_carton: 1, cartons_per_pallet: 40, palletized: true,
      container_compatibility: ['20FT_DRY'], special_handling_codes: [], temperature_controlled: false,
      logistics_constraint_codes: ['DRY_CONTAINER'], logistics_constraints_confirmed: true,
      shipment_quantity_value: new Prisma.Decimal('20000'), shipment_quantity_unit: 'kg',
      shipment_container_count: 1, shipment_container_type: '20FT_DRY',
      origin_city: 'Mumbai', origin_state: 'Maharashtra', origin_country: 'IN', origin_location_code: 'INNSA1', origin_gateway_code: 'INNSA', origin_provenance: 'exporter_declared',
    },
  });
  await prisma.productCertification.create({
    data: {
      product_id: product.id, code: 'PHYTO', name: 'Phytosanitary certificate', status: CertificationStatus.held,
      issuer: 'Plant Quarantine Organisation of India', certificate_reference: 'SYNTH-PHYTO-1',
      valid_from: new Date('2026-01-01T00:00:00Z'), valid_until: new Date('2027-01-01T00:00:00Z'),
      verification_state: 'agent_verified', verified_by_id: agent.id, verified_at: AS_OF,
    },
  });
  const classification = await prisma.productClassification.create({
    data: { product_id: product.id, revision: 1, hs6_code: hs6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {}, rationale: 'synthetic', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: agent.id, confirmed_by_id: agent.id, confirmed_at: AS_OF },
  });
  return { org, agent, product, classification, hs6 };
}

/** Every operational input, as explicitly fixture-origin evidence. */
async function seedOperationalEvidence(
  f: Awaited<ReturnType<typeof syntheticExporter>>,
  options: { omit_component?: string; freight_valid_until?: Date } = {},
) {
  const common = { exporter_org_id: f.org.id, product_id: f.product.id, destination_country: COUNTRY, hs6_code: f.hs6, hs_revision: 'HS2022', observed_at: AS_OF, effective_from: AS_OF, valid_until: new Date('2026-12-31T00:00:00Z'), evidence_origin: EvidenceOrigin.fixture, confidence: new Prisma.Decimal(1), status: 'verified', entered_by_id: f.agent.id, cost_owner: 'exporter' };
  // FOB already carries packaging, inland transport and origin charges, so only the legs beyond
  // the ship's rail are quoted. The ClearTrade fee is derived from FeePolicy, never quoted.
  await prisma.operationalCostEvidence.createMany({
    data: [
      { ...common, valid_until: options.freight_valid_until ?? common.valid_until, component: 'international_freight', quote_type: 'international_freight', amount: new Prisma.Decimal('1800'), currency: 'USD', rate_basis: 'per_container', quantity_unit: 'kg', equipment_code: '20FT_DRY', transport_mode: 'ocean', partner_name: 'Synthetic Forwarder', quote_reference: 'FRT-1', assertion_class: EvidenceAssertionClass.partner_quote, source: 'Synthetic Forwarder', source_reference: 'FRT-1' },
      { ...common, component: 'insurance', quote_type: 'cargo_insurance', amount: new Prisma.Decimal('0'), currency: 'USD', rate_basis: 'percent_of_value', percent_of_value: new Prisma.Decimal('0.5'), percent_basis: 'invoice_value', coverage_terms: 'ICC(A) 110%', coverage_percent: new Prisma.Decimal('110'), assertion_class: EvidenceAssertionClass.partner_quote, source: 'Synthetic Insurer', source_reference: 'INS-1' },
      { ...common, component: 'destination_charges', quote_type: 'destination_handling', amount: new Prisma.Decimal('220'), currency: 'USD', rate_basis: 'per_shipment', quantity_unit: 'kg', assertion_class: EvidenceAssertionClass.partner_quote, source: 'Synthetic Destination Agent', source_reference: 'DEST-1' },
      { ...common, component: 'financing', quote_type: 'financing', amount: new Prisma.Decimal('150'), currency: 'USD', rate_basis: 'per_shipment', quantity_unit: 'kg', assertion_class: EvidenceAssertionClass.agent_verified, source: 'Synthetic Bank', source_reference: 'FIN-1' },
    ].filter((row) => row.component !== options.omit_component),
  });
  await prisma.customsValuationBasisEvidence.create({
    data: { jurisdiction: 'EU', country_code: COUNTRY, valuation_type: 'legal_customs_valuation', basis: 'CIF', included_components: ['goods_price', 'international_freight', 'insurance'], excluded_components: ['import_duty'], source_authority: 'Synthetic UAT authority', source_reference: `synthetic-customs-${f.org.id}`, effective_from: new Date('2020-01-01T00:00:00Z'), observed_at: AS_OF, retrieved_at: AS_OF, verification_grade: 'discovery_grade', assertion_class: EvidenceAssertionClass.authoritative_public, evidence_origin: EvidenceOrigin.fixture, confidence: new Prisma.Decimal(1), status: 'verified' },
  });
  await prisma.logisticsRouteEvidence.create({
    data: {
      exporter_org_id: f.org.id, assertion_class: EvidenceAssertionClass.partner_quote,
      origin_country: 'IN', origin_state: 'Maharashtra', origin_city: 'Mumbai', origin_location_code: 'INNSA1', origin_gateway: 'INNSA',
      destination_country: COUNTRY, destination_port: 'DEHAM', transport_mode: LogisticsTransportMode.ocean,
      route_available: true, transit_time_min_days: 22, transit_time_max_days: 30,
      freight_amount: new Prisma.Decimal('1800'), freight_currency: 'USD', freight_rate_basis: 'per_container',
      freight_retrieved_at: AS_OF, freight_valid_until: new Date('2026-12-31T00:00:00Z'),
      assumed_shipment_value_amount: new Prisma.Decimal('24000'), assumed_shipment_value_currency: 'USD',
      provider: 'synthetic_forwarder', source_reference: `route-${f.org.id}`, retrieved_at: AS_OF, valid_until: new Date('2026-12-31T00:00:00Z'),
      equipment_assumption: '20FT_DRY', supported_product_constraint_codes: ['DRY_CONTAINER'], hs_code_scope: f.hs6,
      confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture,
    },
  });
  // Market access: an exactly-resolved national line with a confirmed India preference, so the
  // duty applied to the customs value is a real determination rather than an assumption.
  const snapshot = await prisma.marketAccessEvidenceSnapshot.create({
    data: { jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, hs6_code: f.hs6, national_code_system: 'EU_TARIC', classification_resolution: 'exact', candidate_line_count: 1, source_authority: 'Synthetic UAT tariff authority', source_reference: `synthetic-tariff-${f.org.id}`, retrieved_at: AS_OF, completeness_status: 'COMPLETE', tariff_coverage: true, regulatory_coverage: true, parser_version: 'synthetic-v1', evidence_origin: EvidenceOrigin.fixture, provider: 'synthetic_tariff', source_dataset: 'synthetic', raw_evidence: {} },
  });
  await prisma.marketAccessEvidence.createMany({
    data: [
      { snapshot_id: snapshot.id, jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, rule_type: 'mandatory_certification', source_authority: 'Synthetic UAT tariff authority', source_reference: `synthetic-tariff-${f.org.id}#phyto`, retrieved_at: AS_OF, effective_at: new Date('2026-01-01T00:00:00Z'), status: 'verified', confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture, requirement_code: 'PHYTO', requirement_description: 'Phytosanitary certificate', requirement_obtainable: true, national_tariff_code: `${f.hs6}1000`, national_code_system: 'EU_TARIC', verification_grade: 'execution_grade', raw_evidence: {} },
      { snapshot_id: snapshot.id, jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, rule_type: 'preferential_tariff_india', source_authority: 'Synthetic UAT tariff authority', source_reference: `synthetic-tariff-${f.org.id}#india`, retrieved_at: AS_OF, effective_at: new Date('2026-01-01T00:00:00Z'), status: 'verified', confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture, tariff_rate_percent: new Prisma.Decimal('5.0000'), preference_applicability: 'confirmed_applicable', preference_basis: 'Synthetic UAT: origin qualification confirmed.', duty_expression: '5.00 %', duty_kind: 'ad_valorem', national_tariff_code: `${f.hs6}1000`, national_code_system: 'EU_TARIC', verification_grade: 'execution_grade', raw_evidence: {} },
    ],
  });
  await seedBenchmarks(f);
}

/** Destination requirements, so Fit has something real to compare exporter capability against. */
async function seedBenchmarks(f: Awaited<ReturnType<typeof syntheticExporter>>) {
  await prisma.exporterMarketFitBenchmark.createMany({
    data: [
      { jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, benchmark_type: 'order_quantity', minimum_value: new Prisma.Decimal('10000'), maximum_value: new Prisma.Decimal('100000'), unit: 'kg', provider: 'synthetic_benchmarks', source_reference: `bm-qty-${f.org.id}`, source_version: 'v1', observed_at: AS_OF, retrieved_at: AS_OF, confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture },
      { jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, benchmark_type: 'production_lead_time', minimum_value: new Prisma.Decimal('7'), maximum_value: new Prisma.Decimal('60'), unit: 'days', provider: 'synthetic_benchmarks', source_reference: `bm-lt-${f.org.id}`, source_version: 'v1', observed_at: AS_OF, retrieved_at: AS_OF, confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture },
      { jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, benchmark_type: 'order_value', minimum_value: new Prisma.Decimal('0.90'), maximum_value: new Prisma.Decimal('1.60'), unit: 'kg', currency: 'USD', provider: 'synthetic_benchmarks', source_reference: `bm-val-${f.org.id}`, source_version: 'v1', observed_at: AS_OF, retrieved_at: AS_OF, confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture },
      { jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, benchmark_type: 'packaging_required', required: true, requirement_code: 'PP_BAG', provider: 'synthetic_benchmarks', source_reference: `bm-pack-${f.org.id}`, source_version: 'v1', observed_at: AS_OF, retrieved_at: AS_OF, confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture },
      { jurisdiction: 'EU', country_code: COUNTRY, hs_code_scope: f.hs6, benchmark_type: 'customization_required', required: true, requirement_code: 'PHYTO', provider: 'synthetic_benchmarks', source_reference: `bm-cert-${f.org.id}`, source_version: 'v1', observed_at: AS_OF, retrieved_at: AS_OF, confidence: new Prisma.Decimal(1), evidence_origin: EvidenceOrigin.fixture },
    ],
  });
}

async function ensureFeePolicy() {
  const existing = await prisma.feePolicy.findFirst({ where: { is_active: true } });
  if (existing) return existing;
  return prisma.feePolicy.create({ data: { version: 1, commitment_fee_amount: new Prisma.Decimal('25000'), commitment_fee_currency: 'INR', success_fee_rate: new Prisma.Decimal('0.0200'), small_shipment_threshold_amount: new Prisma.Decimal('500000'), small_shipment_threshold_currency: 'INR', small_shipment_rate: new Prisma.Decimal('0.0300'), small_shipment_flat_amount: new Prisma.Decimal('15000'), agent_share_rate: new Prisma.Decimal('0.3000'), minimum_shipment_amount: new Prisma.Decimal('100000'), minimum_shipment_currency: 'INR' } });
}

async function seedFx() {
  const snapshot = await prisma.authoritativeFxSnapshot.create({
    data: { provider: 'ecb_sdmx', source_authority: 'European Central Bank', source_dataset: 'EXR', series_key: 'D.INR.EUR.SP00.A', request_reference: 'fixture', requested_at: AS_OF, retrieved_at: AS_OF, http_status: 200, raw_response_checksum: randomUUID(), raw_response_text: 'fixture', parser_version: 'ecb-sdmx-exr-v1', normalization_version: 'ecb-fx-normalization-v1', environment: 'test', evidence_origin: EvidenceOrigin.fixture, completeness: 'COMPLETE' },
  });
  await prisma.authoritativeFxObservation.createMany({
    data: [
      { snapshot_id: snapshot.id, provider: 'ecb_sdmx', series_key: 'D.INR.EUR.SP00.A', base_currency: 'EUR', quote_currency: 'INR', rate: new Prisma.Decimal('111.0585'), observation_date: new Date('2026-08-28T00:00:00Z'), observation_status: 'A', normalization_version: 'ecb-fx-normalization-v1', parser_version: 'ecb-sdmx-exr-v1', environment: 'test', evidence_origin: EvidenceOrigin.fixture, retrieved_at: AS_OF },
      { snapshot_id: snapshot.id, provider: 'ecb_sdmx', series_key: 'D.USD.EUR.SP00.A', base_currency: 'EUR', quote_currency: 'USD', rate: new Prisma.Decimal('1.1643'), observation_date: new Date('2026-08-28T00:00:00Z'), observation_status: 'A', normalization_version: 'ecb-fx-normalization-v1', parser_version: 'ecb-sdmx-exr-v1', environment: 'test', evidence_origin: EvidenceOrigin.fixture, retrieved_at: AS_OF },
    ],
    skipDuplicates: true,
  });
}

/** Build metrics, then resolve the Phase 1H fact manifest and run every pillar. */
async function runPillars(f: Awaited<ReturnType<typeof syntheticExporter>>, policyOverride?: Partial<(typeof CONFIG_DEFAULTS)['country_truth.phase_1h']>) {
  const plan = await createCountryEvidencePlan({ product_classification_id: f.classification.id, as_of_date: AS_OF, candidate_reporters: [REPORTER], source_mode: TradeSourceMode.fixture });
  const executed = await executeCountryEvidencePlan(plan.id);
  if (!executed.manifest) throw new Error('expected a manifest');
  const metrics = await calculateAndPersistCountryTradeMetrics(executed.manifest.id);
  const record = metrics[0]!;

  const policy = {
    value: {
      ...CONFIG_DEFAULTS['country_truth.phase_1h'],
      // A policy statement, not fabricated evidence: this synthetic destination's published
      // import statistics are declared CIF so the unit-value benchmark is comparable.
      trade_statistical_import_valuation_by_country: { [COUNTRY]: 'CIF' as const },
      ...policyOverride,
    },
    version: 1,
  };
  const product = await prisma.product.findUniqueOrThrow({ where: { id: f.product.id }, include: { exporter_org: true, certifications: true } });
  const exporterFacts = buildCountryTruthExporterFactSnapshot({
    exporter_org: { id: product.exporter_org.id, country: product.exporter_org.country, state: product.exporter_org.state, city: product.exporter_org.city, pickup_location_code: product.exporter_org.pickup_location_code, preferred_origin_gateway: product.exporter_org.preferred_origin_gateway, updated_at: product.exporter_org.updated_at },
    product: { id: product.id, exporter_org_id: product.exporter_org_id, updated_at: product.updated_at, evidence_origin: product.evidence_origin, hs_code: product.hs_code, hs_nomenclature_version: product.hs_nomenclature_version, hs_classification_revision: product.hs_classification_revision, hs_classification_status: product.hs_classification_status, price_target_amount: product.price_target_amount, price_target_currency: product.price_target_currency, price_target_quantity_unit: product.price_target_quantity_unit, price_target_incoterm: product.price_target_incoterm, capacity_value: product.capacity_value, capacity_unit: product.capacity_unit, moq_value: product.moq_value, moq_unit: product.moq_unit, lead_time_days: product.lead_time_days, delivery_commitment_days: product.delivery_commitment_days, logistics_constraint_codes: product.logistics_constraint_codes, logistics_constraints_confirmed: product.logistics_constraints_confirmed, desired_order_size_amount: product.desired_order_size_amount, desired_order_size_currency: product.desired_order_size_currency, customization_capability: product.customization_capability, packaging_capability: product.packaging_capability, packaging: product.packaging, packaging_format: product.packaging_format, container_compatibility: product.container_compatibility, special_handling_codes: product.special_handling_codes },
    certifications: product.certifications.map((item) => ({ id: item.id, product_id: item.product_id, code: item.code, name: item.name, status: item.status, evidence_ref: item.evidence_ref, valid_until: item.valid_until, updated_at: item.updated_at, ...(item.verification_state === 'agent_verified' && item.verified_by_id && item.verified_at ? { verification: { verification_status: 'verified' as const, verified_at: item.verified_at, actor_user_id: item.verified_by_id } } : {}) })),
    classification: { id: f.classification.id, product_id: product.id, revision: 1, hs6_code: f.hs6, nomenclature_version: 'HS2022', status: 'confirmed', confirmed_by_id: f.agent.id, confirmed_at: AS_OF, evidence_refs: [] },
    captured_at: CLOCK,
  });
  const metricsPayload = record.metrics_payload as unknown as { metrics?: { unit_value?: { value: { median: number; basis: string } | null; status: string } } };
  const resolved = await resolveCountryTruthFactSnapshot({
    exporter_org_id: f.org.id, product_id: f.product.id, product_classification_id: f.classification.id,
    country_trade_metrics_id: record.id, reporter_code: REPORTER, country_code: COUNTRY,
    hs6: f.hs6, hs_revision: 'HS2022', as_of_date: CLOCK,
    exporter_snapshot: exporterFacts.snapshot, exporter_snapshot_checksum: exporterFacts.checksum,
    policy,
    shipment_basis: { quantity: 20_000, quantity_unit: 'kg', container_count: 1 },
    import_benchmark: importBenchmarkFromTradeMetrics({ policy: policy.value, country_trade_metrics_id: record.id, country_code: COUNTRY, hs_code: record.hs_code, hs_revision: record.hs_revision, as_of_date: record.as_of_date, latest_period_year: record.latest_common_year, unit_value: metricsPayload.metrics?.unit_value }),
  });
  return { facts: resolved.facts, pillars: calculateCountryTruthPillars(resolved.facts, policy.value), record };
}

afterEach(() => setComtradeClient(null));
afterAll(() => prisma.$disconnect());

describe('Canary A — all three operational pillars from synthetic evidence', () => {
  test('Export Economics, Exporter-Market Fit and Logistics all become available', async () => {
    setComtradeClient(fixtureComtradeClient());
    await ensureFeePolicy();
    await seedFx();
    const f = await syntheticExporter();
    await seedOperationalEvidence(f);
    const { facts, pillars } = await runPillars(f);

    // Every fixture row is labelled fixture; nothing here claims to be real evidence.
    expect(facts.export_economics.cost_components.every((fact) => fact.state === 'present')).toBe(true);

    // --- Export Economics ---
    const economics = pillars.results.export_economics;
    expect(economics.status).toBe('available');
    expect(economics.score).not.toBeNull();
    expect(economics.amounts).not.toBeNull();
    // FOB already carries packaging, inland transport and origin charges: they are recognised as
    // bundled rather than either re-added or reported missing.
    const bundled = economics.components.filter((entry) => entry.treatment === 'bundled_in_price').map((entry) => entry.component).sort();
    expect(bundled).toEqual(['inland_transport', 'origin_charges', 'packaging']);
    expect(economics.components.some((entry) => entry.treatment === 'missing')).toBe(false);
    // The ClearTrade fee came from FeePolicy, not from anything the exporter typed.
    const fee = facts.export_economics.cost_components.find((fact) => fact.state === 'present' && fact.value.component === 'cleartrade_fee');
    expect(fee).toBeTruthy();
    expect(fee!.provenance.assertion_class).toBe('system_derived');
    expect(fee!.provenance.source_reference).toMatch(/^fee_policy:\d+:/);
    // Duty was assessed on the customs value the destination's basis defines.
    expect(economics.amounts!.customs_valuation_basis).toBe('CIF');

    // --- Exporter-Market Fit ---
    const fit = pillars.results.exporter_market_fit;
    expect(fit.status).toBe('available');
    expect(fit.score).not.toBeNull();
    expect(fit.hard_blockers).toHaveLength(0);

    // --- Logistics Feasibility ---
    const logistics = pillars.results.logistics_feasibility;
    expect(logistics.status).toBe('available');
    expect(logistics.route_status).toBe('route_available');
    expect(logistics.selected_route_id).not.toBeNull();
  }, 60_000);

  test('removing one required cost component returns economics to unavailable, not to a lower score', async () => {
    setComtradeClient(fixtureComtradeClient());
    await ensureFeePolicy();
    await seedFx();
    const f = await syntheticExporter();
    await seedOperationalEvidence(f, { omit_component: 'destination_charges' });

    const { pillars } = await runPillars(f);
    const economics = pillars.results.export_economics;
    expect(economics.status).toBe('unavailable');
    expect(economics.score).toBeNull();
    expect(economics.amounts).toBeNull();
    expect(economics.components.find((entry) => entry.component === 'destination_charges')).toMatchObject({ treatment: 'missing', amount: null });
    // Logistics is unaffected: a route stays feasible while economics is incomplete.
    expect(pillars.results.logistics_feasibility.status).toBe('available');
    expect(pillars.results.exporter_market_fit.status).toBe('available');
  }, 60_000);

  test('an expired freight quote removes the cost without making the route infeasible', async () => {
    setComtradeClient(fixtureComtradeClient());
    await ensureFeePolicy();
    await seedFx();
    const f = await syntheticExporter();
    await seedOperationalEvidence(f, { freight_valid_until: new Date('2026-08-29T00:00:00Z') });

    const { pillars } = await runPillars(f);
    expect(pillars.results.export_economics.status).toBe('unavailable');
    // The lane is still evidenced; only its price is stale.
    expect(pillars.results.logistics_feasibility.route_status).toBe('route_available');
  }, 60_000);

  test('with no exporter facts at all, fit reports insufficient data rather than a zero score', async () => {
    setComtradeClient(fixtureComtradeClient());
    await ensureFeePolicy();
    const f = await syntheticExporter();
    await seedBenchmarks(f);
    await prisma.product.update({ where: { id: f.product.id }, data: { price_target_amount: null, price_target_currency: null, price_target_quantity_unit: null, price_target_incoterm: null, capacity_value: null, capacity_unit: null, moq_value: null, moq_unit: null, lead_time_days: null, packaging_format: null, container_compatibility: [], special_handling_codes: [], logistics_constraint_codes: [], logistics_constraints_confirmed: false } });
    await prisma.productCertification.deleteMany({ where: { product_id: f.product.id } });

    const { pillars } = await runPillars(f);
    const fit = pillars.results.exporter_market_fit;
    expect(fit.status).toBe('insufficient_exporter_data');
    expect(fit.score).toBeNull();
    // Missing routes are unknown, never infeasible.
    expect(pillars.results.logistics_feasibility.route_status).toBe('unknown');
    expect(pillars.results.logistics_feasibility.status).not.toBe('available');
  }, 60_000);
});
