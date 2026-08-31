import { randomUUID } from 'node:crypto';
import {
  EvidenceCompletenessStatus,
  EvidenceOrigin,
  ExchangeRateSource,
  ExporterFitBenchmarkType,
  LogisticsTransportMode,
  MarketAccessEvidenceStatus,
  MarketAccessRuleType,
  OrgTier,
  Prisma,
  ProductClassificationMethod,
  ProductClassificationStatus,
  UserRole,
} from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '@/lib/config';
import { buildCountryTruthExporterFactSnapshot } from '@/lib/country-truth/exporter-fact-snapshot';
import { selectCountryTruthFacts, type CountryTruthEvidenceRows } from '@/lib/country-truth/fact-selection';
import { resolveCountryTruthFactSnapshot } from '@/lib/country-truth/fact-snapshot-service';
import { calculateCountryTruthPillars } from '@/lib/country-truth/pillars';
import { prisma } from '@/lib/prisma';

afterAll(() => prisma.$disconnect());

const AS_OF = new Date('2026-08-29T00:00:00.000Z');
const RETRIEVED = new Date('2026-08-20T00:00:00.000Z');
const POLICY = { value: CONFIG_DEFAULTS['country_truth.phase_1h'], version: 1 };

function exporterSnapshot(options: { orgId?: string; productId?: string; classificationId?: string; price?: string } = {}) {
  return buildCountryTruthExporterFactSnapshot({
    captured_at: AS_OF,
    exporter_org: {
      id: options.orgId ?? 'org-1',
      country: 'IN',
      pickup_location_code: 'INNSA',
      preferred_origin_gateway: 'INNSA',
      updated_at: RETRIEVED,
    },
    product: {
      id: options.productId ?? 'product-1',
      exporter_org_id: options.orgId ?? 'org-1',
      updated_at: RETRIEVED,
      hs_code: '090111',
      hs_nomenclature_version: 'HS2022',
      hs_classification_revision: 1,
      hs_classification_status: 'confirmed',
      price_target_amount: options.price ?? '10',
      price_target_currency: 'USD',
      price_target_quantity_unit: 'kg',
      price_target_incoterm: 'FOB',
      capacity_value: '1000',
      capacity_unit: 'kg',
      moq_value: '100',
      moq_unit: 'kg',
      lead_time_days: 21,
      logistics_constraint_codes: ['COLD_CHAIN'],
      logistics_constraints_confirmed: true,
    },
    certifications: [
      { id: 'cert-1', product_id: options.productId ?? 'product-1', code: 'ORG', name: 'Organic', status: 'held', evidence_ref: 'doc://organic', updated_at: RETRIEVED },
    ],
    classification: {
      id: options.classificationId ?? 'classification-1',
      product_id: options.productId ?? 'product-1',
      revision: 1,
      hs6_code: '090111',
      nomenclature_version: 'HS2022',
      status: 'confirmed',
      confirmed_by_id: 'agent-1',
      confirmed_at: RETRIEVED,
    },
  });
}

const emptyEvidence: CountryTruthEvidenceRows = {
  market_access_snapshots: [],
  market_access_evidence: [],
  fit_benchmarks: [],
  logistics_routes: [],
  exchange_rate_quotes: [],
};

const selectionScope = {
  exporter_org_id: 'org-1',
  origin_country_code: 'IN',
  country_code: 'GB',
  hs6: '090111',
  hs_revision: 'HS2022',
  as_of_date: AS_OF.toISOString(),
};

function marketAccessRow(overrides: Partial<Parameters<typeof selectCountryTruthFacts>[0]['evidence']['market_access_evidence'][number]> = {}) {
  return {
    id: `mae-${randomUUID()}`,
    snapshot_id: 'snapshot-1',
    country_code: 'GB',
    hs_code_scope: '090111',
    rule_type: MarketAccessRuleType.preferential_tariff_india as string,
    source_authority: 'HMRC',
    source_reference: 'https://example.test/tariff',
    retrieved_at: RETRIEVED,
    effective_at: new Date('2026-01-01T00:00:00.000Z'),
    expires_at: null,
    superseded_at: null,
    status: MarketAccessEvidenceStatus.verified as string,
    confidence: new Prisma.Decimal(1),
    evidence_origin: EvidenceOrigin.public_real as string,
    tariff_rate_percent: new Prisma.Decimal(0),
    requirement_code: null,
    requirement_description: null,
    requirement_obtainable: null,
    ...overrides,
  };
}

describe('Phase 1H fact selection scoping', () => {
  test('a rule published for another destination is never selected', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: { ...emptyEvidence, market_access_evidence: [marketAccessRow({ id: 'mae-de', country_code: 'DE' })] },
    });
    expect(facts.market_access.tariffs).toHaveLength(0);
    expect(facts.rejected).toContainEqual({ source: 'market_access_evidence', row_id: 'mae-de', reason: 'destination_country_mismatch' });
  });

  test('a tariff published at heading level is not this product tariff line', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: { ...emptyEvidence, market_access_evidence: [marketAccessRow({ id: 'mae-0901', hs_code_scope: '0901' })] },
    });
    expect(facts.market_access.tariffs).toHaveLength(0);
    expect(facts.rejected).toContainEqual({
      source: 'market_access_evidence',
      row_id: 'mae-0901',
      reason: 'tariff_scope_is_not_the_exact_hs6_line',
    });
  });

  test('a chapter-level prohibition does cover the product', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: {
        ...emptyEvidence,
        market_access_evidence: [
          marketAccessRow({ id: 'mae-ban', hs_code_scope: '09', rule_type: MarketAccessRuleType.import_prohibition, tariff_rate_percent: null, requirement_code: 'BAN' }),
        ],
      },
    });
    expect(facts.market_access.requirements).toHaveLength(1);
    expect(facts.market_access.requirements[0]).toMatchObject({ state: 'present' });
  });

  test('a rule for a different chapter is rejected', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: { ...emptyEvidence, market_access_evidence: [marketAccessRow({ id: 'mae-other', hs_code_scope: '52' })] },
    });
    expect(facts.rejected).toContainEqual({ source: 'market_access_evidence', row_id: 'mae-other', reason: 'hs_scope_does_not_cover_product' });
  });

  test('evidence retrieved after the frozen clock is refused at selection', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: { ...emptyEvidence, market_access_evidence: [marketAccessRow({ id: 'mae-late', retrieved_at: new Date('2026-09-15T00:00:00.000Z') })] },
    });
    expect(facts.rejected).toContainEqual({ source: 'market_access_evidence', row_id: 'mae-late', reason: 'retrieved_after_assessment_clock' });
  });

  test('another exporter FX quote is never borrowed for this tenant', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: {
        ...emptyEvidence,
        exchange_rate_quotes: [
          { id: 'fx-other', exporter_org_id: 'org-2', base_currency: 'INR', quote_currency: 'USD', rate: new Prisma.Decimal('0.0125'), source: ExchangeRateSource.rbi_reference, source_reference: 'RBI/2026/1', rate_date: RETRIEVED, created_at: RETRIEVED },
          { id: 'fx-mine', exporter_org_id: 'org-1', base_currency: 'INR', quote_currency: 'USD', rate: new Prisma.Decimal('0.0125'), source: ExchangeRateSource.rbi_reference, source_reference: 'RBI/2026/1', rate_date: RETRIEVED, created_at: RETRIEVED },
        ],
      },
    });
    expect(facts.fx_rates.map((item) => item.id)).toEqual(['exchange_rate_quote:fx-mine']);
    expect(facts.rejected).toContainEqual({ source: 'exchange_rate_quote', row_id: 'fx-other', reason: 'exporter_org_mismatch' });
  });

  test('a regulatory rate without its citation is not admitted as authoritative', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: {
        ...emptyEvidence,
        exchange_rate_quotes: [
          { id: 'fx-uncited', exporter_org_id: 'org-1', base_currency: 'INR', quote_currency: 'USD', rate: new Prisma.Decimal('0.0125'), source: ExchangeRateSource.customs_notified, source_reference: null, rate_date: RETRIEVED, created_at: RETRIEVED },
        ],
      },
    });
    expect(facts.fx_rates).toHaveLength(0);
    expect(facts.rejected).toContainEqual({ source: 'exchange_rate_quote', row_id: 'fx-uncited', reason: 'regulatory_rate_has_no_citation' });
  });

  test('an empty provider handling list is unknown coverage rather than "supports nothing"', () => {
    const route = {
      id: 'route-1',
      origin_country: 'IN',
      origin_location_code: 'INNSA',
      origin_gateway: 'INNSA',
      destination_country: 'GB',
      destination_port: 'GBFXT',
      transport_mode: LogisticsTransportMode.ocean as string,
      route_available: true,
      transit_time_min_days: 20,
      transit_time_max_days: 30,
      freight_amount: null,
      freight_currency: null,
      freight_rate_basis: null,
      freight_retrieved_at: null,
      freight_valid_until: null,
      assumed_shipment_value_amount: null,
      assumed_shipment_value_currency: null,
      provider: 'test-carrier',
      source_reference: 'https://example.test/route',
      retrieved_at: RETRIEVED,
      valid_until: null,
      supported_product_constraint_codes: [] as string[],
      hs_code_scope: null,
      confidence: new Prisma.Decimal(1),
      status: 'verified',
      evidence_origin: EvidenceOrigin.public_real as string,
    };
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: { ...emptyEvidence, logistics_routes: [route] },
    });
    const selected = facts.logistics.routes[0];
    expect(selected.state).toBe('present');
    expect(selected.state === 'present' && selected.value.supported_constraint_codes).toBeNull();
  });

  test('manual route evidence is tenant scoped and an unscoped manual row fails closed', () => {
    const base = {
      id: 'mine', exporter_org_id: 'org-1', assertion_class: 'partner_quote', origin_country: 'IN',
      origin_location_code: 'INNSA', origin_gateway: 'INNSA', destination_country: 'GB', destination_port: 'GBFXT',
      transport_mode: LogisticsTransportMode.ocean as string, route_available: true, transit_time_min_days: 20,
      transit_time_max_days: 30, freight_amount: null, freight_currency: null, freight_rate_basis: null,
      freight_retrieved_at: null, freight_valid_until: null, assumed_shipment_value_amount: null,
      assumed_shipment_value_currency: null, provider: 'forwarder', source_reference: 'QUOTE-1', retrieved_at: RETRIEVED,
      valid_until: null, supported_product_constraint_codes: [] as string[], hs_code_scope: null,
      confidence: new Prisma.Decimal(1), status: 'verified', evidence_origin: EvidenceOrigin.manually_entered_real as string,
    };
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: { ...emptyEvidence, logistics_routes: [
        base,
        { ...base, id: 'other-tenant', exporter_org_id: 'org-2' },
        { ...base, id: 'unscoped-manual', exporter_org_id: null, assertion_class: 'agent_verified' },
      ] },
    });
    expect(facts.logistics.routes.map((route) => route.id)).toEqual(['logistics_route:mine']);
    expect(facts.rejected).toEqual(expect.arrayContaining([
      { source: 'logistics_route', row_id: 'other-tenant', reason: 'exporter_org_mismatch' },
      { source: 'logistics_route', row_id: 'unscoped-manual', reason: 'unscoped_non_public_route_evidence' },
    ]));
  });

  test('an exporter snapshot from another tenant is refused outright', () => {
    expect(() =>
      selectCountryTruthFacts({
        scope: selectionScope,
        exporter_snapshot: exporterSnapshot({ orgId: 'org-2', productId: 'product-2', classificationId: 'classification-2' }).snapshot,
        evidence: emptyEvidence,
      }),
    ).toThrow(/different exporter/);
  });

  test('missing exporter facts reach the fit pillar as insufficient data, not a low score', () => {
    const bare = buildCountryTruthExporterFactSnapshot({
      captured_at: AS_OF,
      exporter_org: { id: 'org-1', country: 'IN', updated_at: RETRIEVED },
      product: {
        id: 'product-1',
        exporter_org_id: 'org-1',
        updated_at: RETRIEVED,
        hs_classification_revision: 1,
        hs_classification_status: 'confirmed',
        logistics_constraint_codes: [],
        logistics_constraints_confirmed: false,
      },
      certifications: [],
      classification: { id: 'classification-1', product_id: 'product-1', revision: 1, hs6_code: '090111', nomenclature_version: 'HS2022', status: 'confirmed' },
    });
    const facts = selectCountryTruthFacts({ scope: selectionScope, exporter_snapshot: bare.snapshot, evidence: emptyEvidence });
    const pillars = calculateCountryTruthPillars(facts, POLICY.value);
    expect(pillars.results.exporter_market_fit.status).toBe('insufficient_exporter_data');
    expect(pillars.non_trade.exporter_market_fit).toMatchObject({
      status: 'unavailable',
      score: null,
      exclusion_reason: 'insufficient_exporter_data',
    });
  });

  test('a blocked pillar reaches the scorer as unavailable, never as a low score', () => {
    const facts = selectCountryTruthFacts({
      scope: selectionScope,
      exporter_snapshot: exporterSnapshot().snapshot,
      evidence: {
        ...emptyEvidence,
        market_access_evidence: [
          marketAccessRow({ id: 'mae-tariff' }),
          marketAccessRow({ id: 'mae-ban', rule_type: MarketAccessRuleType.import_prohibition, tariff_rate_percent: null, requirement_code: 'BAN' }),
        ],
      },
    });
    const pillars = calculateCountryTruthPillars(facts, POLICY.value);
    expect(pillars.results.market_access.status).toBe('blocked');
    expect(pillars.non_trade.market_access).toMatchObject({ status: 'unavailable', score: null, exclusion_reason: 'blocked_by_explicit_hard_gate' });
    expect(pillars.blockers).toEqual([
      { pillar: 'market_access', code: 'destination_import_prohibition', subject: 'BAN', evidence_fact_ids: ['market_access_requirement:mae-ban'] },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Persisted manifest identity and immutability
// ---------------------------------------------------------------------------

async function persistedFixture() {
  const marker = `ct-facts-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid, country: 'IN' } });
  const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
  const product = await prisma.product.create({
    data: {
      exporter_org_id: org.id,
      name: 'Green coffee',
      evidence_origin: EvidenceOrigin.authenticated_real,
      hs_code: '090111',
      hs_nomenclature_version: 'HS2022',
      hs_classification_status: ProductClassificationStatus.confirmed,
      hs_classification_revision: 1,
      price_target_amount: new Prisma.Decimal('10'),
      price_target_currency: 'USD',
      price_target_quantity_unit: 'kg',
      price_target_incoterm: 'FOB',
      capacity_value: new Prisma.Decimal('1000'),
      capacity_unit: 'kg',
      logistics_constraint_codes: [],
      logistics_constraints_confirmed: true,
    },
  });
  const classification = await prisma.productClassification.create({
    data: {
      product_id: product.id,
      revision: 1,
      hs6_code: '090111',
      nomenclature: 'HS',
      nomenclature_version: 'HS2022',
      method: ProductClassificationMethod.manually_verified,
      product_facts_snapshot: { name: product.name },
      evidence: { source: 'test' },
      rationale: 'Test classification.',
      source_references: [],
      confidence: new Prisma.Decimal('0.99'),
      status: ProductClassificationStatus.confirmed,
      proposed_by_id: agent.id,
      confirmed_by_id: agent.id,
      confirmed_at: RETRIEVED,
    },
  });
  const plan = await prisma.countryEvidencePlan.create({
    data: {
      plan_key: `plan-${marker}`,
      product_classification_id: classification.id,
      hs_code: '090111',
      hs_revision: 'HS2022',
      as_of_date: AS_OF,
      candidate_reporters: ['826'],
      policy_version: 'test',
      policy_hash: 'test',
      source_mode: 'authenticated',
      policy_snapshot: {},
      period_set: [2021, 2022, 2023],
      latest_common_year: 2023,
      requested_history_years: 3,
      actual_history_years: 3,
      candidate_strategy: 'explicit_candidates_v1',
      estimated_call_cost: 0,
    },
  });
  const manifest = await prisma.countryEvidenceManifest.create({
    data: { plan_id: plan.id, checksum: `manifest-${marker}`, evaluation_state: 'metric_ready', policy_version: 'test', policy_hash: 'test', policy_snapshot: {}, manifest_payload: {} },
  });
  const metrics = await prisma.countryTradeMetrics.create({
    data: {
      manifest_id: manifest.id,
      product_classification_id: classification.id,
      reporter_code: '826',
      country_code: 'GB',
      hs_code: '090111',
      hs_revision: 'HS2022',
      as_of_date: AS_OF,
      period_set: [2021, 2022, 2023],
      latest_common_year: 2023,
      metric_policy_version: 'test',
      metric_policy_hash: 'test',
      metric_policy_snapshot: {},
      calculation_version: 'test',
      metrics_payload: { manifest_checksum: `manifest-${marker}`, metrics: {} },
      checksum: `metrics-${marker}`,
    },
  });
  const facts = exporterSnapshot({ orgId: org.id, productId: product.id, classificationId: classification.id });
  return { org, agent, product, classification, metrics, facts };
}

function snapshotRequest(f: Awaited<ReturnType<typeof persistedFixture>>, overrides: Record<string, unknown> = {}) {
  return {
    exporter_org_id: f.org.id,
    product_id: f.product.id,
    product_classification_id: f.classification.id,
    country_trade_metrics_id: f.metrics.id,
    reporter_code: '826',
    country_code: 'GB',
    hs6: '090111',
    hs_revision: 'HS2022',
    as_of_date: AS_OF,
    exporter_snapshot: f.facts.snapshot,
    exporter_snapshot_checksum: f.facts.checksum,
    policy: POLICY,
    ...overrides,
  };
}

describe('Phase 1H fact manifest integrity', () => {
  test('resolving the same frozen question twice reuses one immutable manifest', async () => {
    const f = await persistedFixture();
    const first = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const second = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.facts_checksum).toBe(first.facts_checksum);
    expect(first.record.facts_checksum).toHaveLength(64);
  });

  test('a different Phase 1H policy version produces a separate manifest', async () => {
    const f = await persistedFixture();
    const base = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const reversioned = await resolveCountryTruthFactSnapshot(
      snapshotRequest(f, { policy: { value: POLICY.value, version: 2 } }),
    );
    expect(reversioned.snapshot_key).not.toBe(base.snapshot_key);
    expect(reversioned.record.id).not.toBe(base.record.id);
  });

  test('a semantic policy change produces a separate manifest even at the same config version', async () => {
    const f = await persistedFixture();
    const base = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const retuned = await resolveCountryTruthFactSnapshot(
      snapshotRequest(f, {
        policy: {
          value: { ...POLICY.value, market_access: { ...POLICY.value.market_access, tariff_zero_score_percent: 40 } },
          version: POLICY.version,
        },
      }),
    );
    expect(retuned.record.selection_policy_hash).not.toBe(base.record.selection_policy_hash);
    expect(retuned.snapshot_key).not.toBe(base.snapshot_key);
  });

  test('a different frozen exporter snapshot produces a separate manifest', async () => {
    const f = await persistedFixture();
    const base = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const edited = exporterSnapshot({ orgId: f.org.id, productId: f.product.id, classificationId: f.classification.id, price: '12' });
    const rebuilt = await resolveCountryTruthFactSnapshot(
      snapshotRequest(f, { exporter_snapshot: edited.snapshot, exporter_snapshot_checksum: edited.checksum }),
    );
    expect(edited.checksum).not.toBe(f.facts.checksum);
    expect(rebuilt.snapshot_key).not.toBe(base.snapshot_key);
  });

  test('revising the supplemental unit-value version moves only the Phase 1H identity', async () => {
    const f = await persistedFixture();
    const metricsBefore = await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: f.metrics.id } });
    const base = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const revised = await resolveCountryTruthFactSnapshot(
      snapshotRequest(f, {
        policy: {
          value: { ...POLICY.value, india_origin_unit_value_version: 'india-origin-unit-value-v2' },
          version: POLICY.version,
        },
      }),
    );
    expect(revised.snapshot_key).not.toBe(base.snapshot_key);
    expect(revised.record.id).not.toBe(base.record.id);
    // The whole point of the separation: a supplemental-statistic revision must not touch the
    // metric row an unfinished Phase 1G run is still relying on.
    expect(await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: f.metrics.id } })).toEqual(metricsBefore);
    expect(await prisma.countryTradeMetrics.count({ where: { manifest_id: f.metrics.manifest_id } })).toBe(1);
  });

  test('an uncomputed supplemental statistic is recorded as an explicit absence', async () => {
    const f = await persistedFixture();
    const resolved = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const payload = resolved.record.facts_payload as unknown as {
      supplemental_trade_statistics: { india_origin_unit_value: unknown; india_origin_unit_value_version: string };
    };
    expect(payload.supplemental_trade_statistics.india_origin_unit_value).toBeNull();
    expect(payload.supplemental_trade_statistics.india_origin_unit_value_version).toBe('india-origin-unit-value-v1');
  });

  test('evidence backdated after a manifest was frozen is refused, not silently merged', async () => {
    const f = await persistedFixture();
    await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    const snapshot = await prisma.marketAccessEvidenceSnapshot.create({
      data: {
        jurisdiction: 'GB',
        country_code: 'GB',
        hs_code_scope: '090111',
        source_authority: 'HMRC',
        source_reference: 'https://example.test/backdated',
        retrieved_at: RETRIEVED,
        completeness_status: EvidenceCompletenessStatus.COMPLETE,
        tariff_coverage: true,
        regulatory_coverage: true,
        parser_version: 'test-v1',
        evidence_origin: EvidenceOrigin.public_real,
        provider: 'HMRC',
        raw_evidence: {},
      },
    });
    await prisma.marketAccessEvidence.create({
      data: {
        snapshot_id: snapshot.id,
        jurisdiction: 'GB',
        country_code: 'GB',
        hs_code_scope: '090111',
        rule_type: MarketAccessRuleType.preferential_tariff_india,
        source_authority: 'HMRC',
        source_reference: 'https://example.test/backdated#india',
        retrieved_at: RETRIEVED,
        status: MarketAccessEvidenceStatus.verified,
        confidence: new Prisma.Decimal(1),
        evidence_origin: EvidenceOrigin.public_real,
        tariff_rate_percent: new Prisma.Decimal(0),
        raw_evidence: {},
      },
    });
    await expect(resolveCountryTruthFactSnapshot(snapshotRequest(f))).rejects.toThrow(/backdated after the manifest was frozen/);
  });

  test('a persisted fact manifest cannot be updated or deleted', async () => {
    const f = await persistedFixture();
    const resolved = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    await expect(
      prisma.countryTruthFactSnapshot.update({ where: { id: resolved.record.id }, data: { facts_checksum: 'rewritten' } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.countryTruthFactSnapshot.delete({ where: { id: resolved.record.id } })).rejects.toThrow(/immutable/);
  });

  test('the manifest records the evidence origins and assertion classes it actually used', async () => {
    const f = await persistedFixture();
    const benchmark = await prisma.exporterMarketFitBenchmark.create({
      data: {
        jurisdiction: 'GB',
        country_code: 'GB',
        hs_code_scope: '090111',
        benchmark_type: ExporterFitBenchmarkType.order_quantity,
        minimum_value: new Prisma.Decimal(500),
        maximum_value: new Prisma.Decimal(2000),
        unit: 'kg',
        provider: 'test-provider',
        source_reference: `bench-${randomUUID()}`,
        source_version: 'v1',
        observed_at: RETRIEVED,
        retrieved_at: RETRIEVED,
        confidence: new Prisma.Decimal(1),
        evidence_origin: EvidenceOrigin.public_real,
      },
    });
    const resolved = await resolveCountryTruthFactSnapshot(snapshotRequest(f));
    expect(resolved.record.evidence_origins).toContain(EvidenceOrigin.public_real);
    expect(resolved.record.assertion_classes).toContain('authoritative_public');
    expect(resolved.record.assertion_classes).toContain('exporter_declared');
    expect(resolved.facts.exporter_market_fit.benchmarks.map((item) => item.id)).toContain(`fit_benchmark:${benchmark.id}`);
  });

  test('legacy historical evidence tables reject rewrites of what was already recorded', async () => {
    const snapshot = await prisma.marketAccessEvidenceSnapshot.create({
      data: {
        jurisdiction: 'GB',
        country_code: 'GB',
        hs_code_scope: `9999${Math.floor(Math.random() * 90 + 10)}`,
        source_authority: 'HMRC',
        source_reference: `https://example.test/${randomUUID()}`,
        retrieved_at: RETRIEVED,
        completeness_status: EvidenceCompletenessStatus.COMPLETE,
        tariff_coverage: true,
        regulatory_coverage: true,
        parser_version: 'test-v1',
        evidence_origin: EvidenceOrigin.public_real,
        provider: 'HMRC',
        raw_evidence: {},
      },
    });
    await expect(
      prisma.marketAccessEvidenceSnapshot.update({
        where: { id: snapshot.id },
        data: { completeness_status: EvidenceCompletenessStatus.STALE },
      }),
    ).rejects.toThrow(/immutable evidence/);
  });

  test('the supplier coverage upsert still works beside its new immutability guard', async () => {
    const id = `coverage-${randomUUID()}`;
    const data = {
      id,
      country_code: 'GB',
      reporter: '826',
      hs_code: '090111',
      year: 2023,
      world_total_value: new Prisma.Decimal(100),
      supplier_value_sum: new Prisma.Decimal(100),
      partner_count: 2,
      coverage_ratio: new Prisma.Decimal(1),
      query_scope: {},
      acquisition_ids: [],
      completeness_status: EvidenceCompletenessStatus.COMPLETE,
      threshold_version: 'v1',
    };
    await prisma.supplierCoverageAssertion.upsert({ where: { id }, create: data, update: {} });
    // The warehouse engine re-asserts coverage on every run; the immutability trigger must not
    // turn that idempotent write into a hard failure.
    await expect(prisma.supplierCoverageAssertion.upsert({ where: { id }, create: data, update: {} })).resolves.toMatchObject({ id });
  });
});
