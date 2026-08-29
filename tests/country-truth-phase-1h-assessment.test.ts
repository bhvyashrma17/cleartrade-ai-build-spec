import { createHash, randomUUID } from 'node:crypto';
import {
  EvidenceCompletenessStatus,
  EvidenceOrigin,
  JobStatus,
  MarketAccessEvidenceStatus,
  MarketAccessRuleType,
  MarketEligibilityStatus,
  OrgTier,
  Prisma,
  ProductClassificationMethod,
  ProductClassificationStatus,
  UserRole,
} from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '@/lib/comtrade';
import { CONFIG_DEFAULTS } from '@/lib/config';
import { calculateAndPersistCountryTradeMetrics, calculateIndiaOriginUnitValueSupplement } from '@/lib/country-trade-metrics/service';
import { requestCountryTruthDiscovery } from '@/lib/country-truth-discovery-request';
import { runCountryTruthDiscovery } from '@/lib/job-handlers/country-truth-discovery';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

afterEach(() => setComtradeClient(null));
afterAll(() => prisma.$disconnect());

const REQUESTED_AT = new Date('2026-08-24T00:00:00.000Z');
const EVIDENCE_RETRIEVED_AT = new Date('2026-08-20T00:00:00.000Z');

async function fixture() {
  const marker = `ct-1h-${randomUUID()}`;
  const hs6 = String(100000 + (parseInt(marker.slice(-6).replace(/-/g, ''), 16) % 1000)).padStart(6, '0');
  const itcHs = `${hs6}12`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid, country: 'IN' } });
  const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  const product = await prisma.product.create({
    data: {
      exporter_org_id: org.id,
      name: 'Basmati rice',
      evidence_origin: EvidenceOrigin.authenticated_real,
      price_target_amount: new Prisma.Decimal('1200'),
      price_target_currency: 'USD',
      price_target_quantity_unit: 'kg',
      price_target_incoterm: 'FOB',
      capacity_value: new Prisma.Decimal('1000'),
      capacity_unit: 'kg',
      lead_time_days: 21,
    },
  });
  await prisma.product.update({
    where: { id: product.id },
    data: {
      itc_hs_code: itcHs,
      hs_code: hs6,
      hs_code_source: 'manually_verified',
      hs_nomenclature: 'ITC-HS',
      hs_nomenclature_version: '2022',
      hs_classification_method: ProductClassificationMethod.manually_verified,
      hs_classification_status: ProductClassificationStatus.confirmed,
      hs_classification_confidence: new Prisma.Decimal('0.99'),
      hs_confirmed_by_id: agent.id,
      hs_confirmed_at: REQUESTED_AT,
      hs_classification_revision: 1,
    },
  });
  const classification = await prisma.productClassification.create({
    data: {
      product_id: product.id,
      revision: 1,
      itc_hs_code: itcHs,
      hs6_code: hs6,
      nomenclature: 'ITC-HS',
      nomenclature_version: '2022',
      method: ProductClassificationMethod.manually_verified,
      product_facts_snapshot: { name: product.name },
      evidence: { source: 'test' },
      rationale: 'Confirmed pilot classification.',
      source_references: [],
      confidence: new Prisma.Decimal('0.99'),
      status: ProductClassificationStatus.confirmed,
      proposed_by_id: agent.id,
      confirmed_by_id: agent.id,
      confirmed_at: REQUESTED_AT,
    },
  });
  const actor: Principal = { id: agent.id, email: agent.email, name: agent.name, role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
  const requested = await requestCountryTruthDiscovery({
    actor,
    exporter_org_id: org.id,
    product_id: product.id,
    candidate_countries: ['Germany'],
    correlation_id: randomUUID(),
    requested_at: REQUESTED_AT,
  });
  // These tests drive the handler directly rather than through the queue. Leaving the job in
  // `queued` would let an unrelated test's claimNextJob pick it up.
  const job = await prisma.job.update({ where: { id: requested.job.id }, data: { status: JobStatus.processing } });
  return { org, agent, product, classification, hs6, job, payload: requested.payload };
}

/** Deterministic in-process provider. No network call leaves this test. */
function authenticatedClient() {
  const calls = vi.fn();
  const client = {
    name: 'mocked-authenticated-comtrade',
    identity: {
      provider: 'un_comtrade' as const,
      mode: 'authenticated' as const,
      authenticated: true,
      credential_fingerprint: `auth-${randomUUID()}`,
      source_dataset: 'un-comtrade-api',
      source_dataset_version: 'mock-v1',
    },
    async resolveChapter() {
      throw new Error('Explicit HS6 must bypass reference data.');
    },
    async fetchChapter(params: ComtradeFetchParams) {
      calls(params);
      const values = params.partner === 'all' ? [['156', 60], ['699', 40]] : params.partner === '699' ? [['699', 40]] : [['0', 100]];
      const rows = values.map(([partner, value]) => ({
        reporter: params.reporter,
        partner: String(partner),
        partner2: '0',
        hs_code: params.hs_codes[0],
        year: params.year,
        period: String(params.year),
        value: Number(value),
        value_status: 'observed' as const,
        quantity: 10,
        quantity_status: 'observed' as const,
        unit: 'kg',
        net_weight: 10,
        flow_code: 'M',
        frequency: 'A',
        customs_code: 'C00',
        mode_of_supply: '0',
      }));
      const raw = JSON.stringify({ count: rows.length, data: rows });
      return {
        rows,
        request_count: 1,
        retrieved_at: new Date('2026-08-24T01:00:00.000Z'),
        source_dataset_version: 'mock-v1',
        evidence_pages: [
          {
            http_status: 200,
            raw_response_text: raw,
            response_checksum: createHash('sha256').update(raw).digest('hex'),
            redacted_request: 'https://comtradeapi.un.org/redacted',
            provider_row_count: rows.length,
            returned_row_count: rows.length,
            completeness: 'COMPLETE' as const,
            completeness_metadata: {
              provider_count: rows.length,
              response_rows: rows.length,
              accepted_rows: rows.length,
              rejected_rows: 0,
              truncated: false,
              pagination_supported: false,
              parser_version: 'comtrade-parser-v2',
            },
            quota_metadata: null,
            retrieved_at: new Date('2026-08-24T01:00:00.000Z'),
          },
        ],
      };
    },
  };
  return { client, calls };
}

const context = (f: Awaited<ReturnType<typeof fixture>>) => ({
  job_id: f.job.id,
  attempt_no: 1,
  payload: f.job.payload,
  exporter_org_id: f.org.id,
  target_id: f.classification.id,
  correlation_id: f.job.correlation_id,
  reportProgress: async () => undefined,
});

async function publishGermanProhibition(hs6: string) {
  const snapshot = await prisma.marketAccessEvidenceSnapshot.create({
    data: {
      jurisdiction: 'DE',
      country_code: 'DE',
      hs_code_scope: hs6,
      source_authority: 'EU TARIC',
      source_reference: `https://example.test/${randomUUID()}`,
      retrieved_at: EVIDENCE_RETRIEVED_AT,
      completeness_status: EvidenceCompletenessStatus.COMPLETE,
      tariff_coverage: true,
      regulatory_coverage: true,
      parser_version: 'test-v1',
      evidence_origin: EvidenceOrigin.public_real,
      provider: 'EU TARIC',
      raw_evidence: {},
    },
  });
  return prisma.marketAccessEvidence.create({
    data: {
      snapshot_id: snapshot.id,
      jurisdiction: 'DE',
      country_code: 'DE',
      hs_code_scope: hs6,
      rule_type: MarketAccessRuleType.import_prohibition,
      source_authority: 'EU TARIC',
      source_reference: `https://example.test/${randomUUID()}#ban`,
      retrieved_at: EVIDENCE_RETRIEVED_AT,
      effective_at: new Date('2026-01-01T00:00:00.000Z'),
      status: MarketAccessEvidenceStatus.verified,
      confidence: new Prisma.Decimal(1),
      evidence_origin: EvidenceOrigin.public_real,
      requirement_code: 'DE-BAN',
      requirement_description: 'Import of this product is prohibited.',
      raw_evidence: {},
    },
  });
}

describe('Phase 1H assessment identity and freezing', () => {
  test('every assessment carries a fact manifest, a checksum and a unique record identity', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const outcome = await runCountryTruthDiscovery(context(f));
    const result = outcome.result as Record<string, unknown>;
    const assessments = await prisma.marketAssessment.findMany({ where: { run_id: String(result.discovery_run_id) } });
    expect(assessments).toHaveLength(1);
    const assessment = assessments[0];
    expect(assessment.assessment_identity).toMatch(/^[a-f0-9]{64}$/);
    expect(assessment.country_truth_fact_snapshot_checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(assessment.country_truth_fact_snapshot_id).toBeTruthy();

    const manifest = await prisma.countryTruthFactSnapshot.findUniqueOrThrow({
      where: { id: assessment.country_truth_fact_snapshot_id! },
    });
    expect(manifest).toMatchObject({
      exporter_org_id: f.org.id,
      product_id: f.product.id,
      product_classification_id: f.classification.id,
      country_code: 'DE',
      hs_code: f.hs6,
      exporter_snapshot_checksum: f.payload.exporter_fact_snapshot_checksum,
    });
    expect(manifest.facts_checksum).toBe(assessment.country_truth_fact_snapshot_checksum);
    // Facts and scores are separate records: the manifest holds no score field at all.
    expect(Object.keys(manifest.facts_payload as Record<string, unknown>)).not.toContain('score');
    expect(String(result.country_truth_fact_snapshot_ids)).toContain(manifest.id);
  });

  test('a completed assessment is immutable history', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const outcome = await runCountryTruthDiscovery(context(f));
    const result = outcome.result as Record<string, unknown>;
    const assessment = await prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(result.discovery_run_id) } });
    await expect(
      prisma.marketAssessment.update({ where: { id: assessment.id }, data: { overall_score: 99 } }),
    ).rejects.toThrow(/immutable/);
    await expect(prisma.marketAssessment.delete({ where: { id: assessment.id } })).rejects.toThrow(/immutable/);
  });

  test('editing the product after the job was frozen does not reinterpret the assessment', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    // A price edit between enqueue and execution must not reach the frozen question.
    await prisma.product.update({
      where: { id: f.product.id },
      data: { price_target_amount: new Prisma.Decimal('9999'), price_target_incoterm: 'CIF', lead_time_days: 1 },
    });
    const outcome = await runCountryTruthDiscovery(context(f));
    const result = outcome.result as Record<string, unknown>;
    const assessment = await prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(result.discovery_run_id) } });
    const manifest = await prisma.countryTruthFactSnapshot.findUniqueOrThrow({
      where: { id: assessment.country_truth_fact_snapshot_id! },
    });
    const payload = manifest.facts_payload as unknown as {
      facts: { exporter_market_fit: { price: { value: { amount_per_unit: number } } | null } };
    };
    expect(manifest.exporter_snapshot_checksum).toBe(f.payload.exporter_fact_snapshot_checksum);
    expect(payload.facts.exporter_market_fit.price?.value.amount_per_unit).toBe(1200);
  });

  test('an explicit destination prohibition makes the market ineligible instead of merely low scoring', async () => {
    const f = await fixture();
    await publishGermanProhibition(f.hs6);
    setComtradeClient(authenticatedClient().client);
    const outcome = await runCountryTruthDiscovery(context(f));
    const result = outcome.result as Record<string, unknown>;
    const assessment = await prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(result.discovery_run_id) } });
    expect(assessment.eligibility_status).toBe(MarketEligibilityStatus.ineligible);
    expect(assessment.overall_score).toBeNull();
    expect(assessment.country_truth_assessment_state).toBe('blocked');
    expect(assessment.eligibility_reasons).toMatchObject([
      { pillar: 'market_access', code: 'destination_import_prohibition', subject: 'DE-BAN' },
    ]);
    // The demand evidence is unchanged and still recorded; only the ranking is withdrawn.
    const provenance = assessment.field_provenance as Record<string, { raw_available_score_before_blockers?: number | null }>;
    expect(provenance.overall_score.raw_available_score_before_blockers).toEqual(expect.any(Number));
  });

  test('an unblocked market remains eligible and rankable', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const outcome = await runCountryTruthDiscovery(context(f));
    const result = outcome.result as Record<string, unknown>;
    const assessment = await prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(result.discovery_run_id) } });
    expect(assessment.eligibility_status).toBe(MarketEligibilityStatus.eligible);
    expect(assessment.eligibility_reasons).toEqual([]);
    expect(assessment.overall_score).toEqual(expect.any(Number));
  });

  test('two independent runs of the same question never share a record identity', async () => {
    const first = await fixture();
    const second = await fixture();
    setComtradeClient(authenticatedClient().client);
    const a = (await runCountryTruthDiscovery(context(first))).result as Record<string, unknown>;
    const b = (await runCountryTruthDiscovery(context(second))).result as Record<string, unknown>;
    const [left, right] = await Promise.all([
      prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(a.discovery_run_id) } }),
      prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(b.discovery_run_id) } }),
    ]);
    expect(left.assessment_identity).not.toBe(right.assessment_identity);
  });

  test('the job payload freezes the Phase 1H policy identity and rejects a mismatch', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const payload = f.job.payload as unknown as Record<string, unknown>;
    const policies = payload.policies as Record<string, { policy_hash: string }>;
    const tampered = {
      ...payload,
      policies: {
        ...policies,
        country_truth_phase_1h: { ...policies.country_truth_phase_1h, policy_hash: 'a'.repeat(64) },
      },
    };
    await expect(runCountryTruthDiscovery({ ...context(f), payload: tampered })).rejects.toThrow(
      /Phase 1H policy identity no longer matches/,
    );
  });
});

/**
 * Phase 1G is unfinished. Merging Phase 1H must not cause a resumed 1G run to compute
 * replacement CountryTradeMetrics rows, and must not disturb the ones it already validated.
 */
describe('Phase 1G metric isolation under Phase 1H', () => {
  test('a Phase 1H run writes v1 metric rows and resuming Phase 1G reuses them exactly', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const result = (await runCountryTruthDiscovery(context(f))).result as Record<string, unknown>;
    const metricIds = result.country_trade_metrics_ids as string[];
    const before = await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: metricIds[0] } });
    expect(before.metric_policy_version).toBe('country-trade-metrics-v1');
    expect(before.calculation_version).toBe('country-trade-calculator-v1');
    expect((before.metrics_payload as Record<string, unknown>).metrics).not.toHaveProperty('india_unit_value');

    // This is the Phase 1G path: the default config, no Phase 1H policy in sight. It must
    // resolve to the same identity and return the SAME row rather than creating a v2 replacement.
    const totalBefore = await prisma.countryTradeMetrics.count({ where: { manifest_id: before.manifest_id } });
    const resumed = await calculateAndPersistCountryTradeMetrics(before.manifest_id);
    expect(resumed.map((row) => row.id)).toEqual([before.id]);
    expect(await prisma.countryTradeMetrics.count({ where: { manifest_id: before.manifest_id } })).toBe(totalBefore);
    const after = await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toEqual(before);
  });

  test('the default metric policy hash still matches the identity frozen into the job payload', async () => {
    const f = await fixture();
    const frozen = (f.job.payload as unknown as { policies: { country_trade_metrics: { policy_version: string; calculation_version: string; policy_hash: string } } }).policies.country_trade_metrics;
    expect(frozen.policy_version).toBe('country-trade-metrics-v1');
    expect(frozen.calculation_version).toBe('country-trade-calculator-v1');
    setComtradeClient(authenticatedClient().client);
    const result = (await runCountryTruthDiscovery(context(f))).result as Record<string, unknown>;
    const row = await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: (result.country_trade_metrics_ids as string[])[0] } });
    expect(row.metric_policy_hash).toBe(frozen.policy_hash);
  });

  test('Phase 1H obtains its India-origin unit value without writing to CountryTradeMetrics', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const result = (await runCountryTruthDiscovery(context(f))).result as Record<string, unknown>;
    const before = await prisma.countryTradeMetrics.findUniqueOrThrow({
      where: { id: (result.country_trade_metrics_ids as string[])[0] },
    });
    const countBefore = await prisma.countryTradeMetrics.count({ where: { manifest_id: before.manifest_id } });

    const supplement = await calculateIndiaOriginUnitValueSupplement(
      before.manifest_id,
      CONFIG_DEFAULTS['country_trade_metrics.policy'],
    );
    expect(supplement).toHaveLength(1);
    expect(supplement[0].supplemental_version).toBe('india-origin-unit-value-v1');
    expect(supplement[0].result.calculation_method).toMatch(/^india_origin_/);

    expect(await prisma.countryTradeMetrics.count({ where: { manifest_id: before.manifest_id } })).toBe(countBefore);
    expect(await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before);
  });

  test('the supplemental statistic is recorded in the Phase 1H manifest, not the metric row', async () => {
    const f = await fixture();
    setComtradeClient(authenticatedClient().client);
    const result = (await runCountryTruthDiscovery(context(f))).result as Record<string, unknown>;
    const assessment = await prisma.marketAssessment.findFirstOrThrow({ where: { run_id: String(result.discovery_run_id) } });
    const manifest = await prisma.countryTruthFactSnapshot.findUniqueOrThrow({
      where: { id: assessment.country_truth_fact_snapshot_id! },
    });
    const payload = manifest.facts_payload as unknown as {
      supplemental_trade_statistics: {
        india_origin_unit_value_version: string;
        india_origin_unit_value: { supplemental_version: string; calculation_method: string } | null;
        semantic_label: string;
      };
    };
    expect(payload.supplemental_trade_statistics.india_origin_unit_value_version).toBe('india-origin-unit-value-v1');
    expect(payload.supplemental_trade_statistics.india_origin_unit_value?.supplemental_version).toBe('india-origin-unit-value-v1');
    expect(payload.supplemental_trade_statistics.semantic_label).toMatch(/not a selling-price quote/);

    const metricPayload = (
      await prisma.countryTradeMetrics.findUniqueOrThrow({ where: { id: assessment.country_trade_metrics_id! } })
    ).metrics_payload as Record<string, unknown>;
    expect(metricPayload.metrics).not.toHaveProperty('india_unit_value');
    expect(metricPayload.calculation_version).toBe('country-trade-calculator-v1');
  });
});
