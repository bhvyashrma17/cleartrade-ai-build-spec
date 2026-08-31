import { createHash, randomUUID } from 'node:crypto';
import { EvidenceOrigin, OrgTier, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '../src/lib/comtrade';
import { createCountryEvidencePlan, executeCountryEvidencePlan, resolveCountryEvidencePlan } from '../src/lib/country-evidence/service';
import { prisma } from '../src/lib/prisma';
import { reserveProviderQuota } from '../src/lib/provider-quota';

/**
 * Gap A. The deep run that produced the 20-market baseline had to reproduce the executor's
 * per-item loop externally, because the canonical executor could only take a whole plan at once
 * and therefore offered no point at which to reconcile or stop. These tests pin the native
 * batching that replaces that workaround, and in particular that slicing execution changes
 * nothing about what the evidence IS.
 */

async function confirmedClassification() {
  const marker = `batch-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const user = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Planner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Rice', evidence_origin: EvidenceOrigin.fixture } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: '100630', hs_code_source: 'exporter_supplied', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: 0.99, hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: user.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  return prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: '100630', nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: { schema_version: 'test' }, evidence: { source: 'test' }, rationale: 'Test classification', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: user.id, confirmed_by_id: user.id, confirmed_at: now } });
}

function fixtureClient(options: { failReporters?: string[]; retriesFor?: string[] } = {}) {
  const calls = vi.fn();
  const attempts = new Map<string, number>();
  return {
    calls,
    attempts,
    client: {
      name: 'batching-fixture',
      identity: { provider: 'un_comtrade' as const, mode: 'fixture' as const, authenticated: false, credential_fingerprint: `fixture-${randomUUID()}`, source_dataset: 'fixture-batching', source_dataset_version: 'v1' },
      async resolveChapter() { throw new Error('explicit HS6 should bypass reference'); },
      async fetchChapter(params: ComtradeFetchParams) {
        calls(params);
        if (options.failReporters?.includes(params.reporter)) throw new Error(`fixture provider outage for ${params.reporter}`);
        const key = `${params.reporter}:${params.partner}:${params.year}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        // Two physical calls for one logical item, so retry accounting can be asserted.
        const requestCount = options.retriesFor?.includes(params.reporter) && attempt === 1 ? 2 : 1;
        const values = params.partner === 'all' ? [['156', 60], ['699', 40]] : params.partner === '699' ? [['699', 10]] : [['0', 100]];
        const rows = values.map(([partner, value]) => ({ reporter: params.reporter, partner: String(partner), partner2: '0', hs_code: '100630', year: params.year, period: String(params.year), value: Number(value), value_status: 'observed' as const, quantity: null, quantity_status: 'missing' as const, unit: null, flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }));
        const raw = JSON.stringify({ count: rows.length, data: rows });
        return { rows, request_count: requestCount, retrieved_at: new Date(), source_dataset_version: 'v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'comtrade://fixture', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { truncated: false, rejected_rows: 0 }, quota_metadata: null, retrieved_at: new Date() }] };
      },
    },
  };
}

/**
 * Evidence is global and keyed by request fingerprint, so two plans asking the same reporter for
 * the same year share it by design. Each test therefore owns a disjoint reporter set — otherwise
 * a later test would silently reuse an earlier one's acquisitions and assert nothing about
 * acquisition at all. (Adjacent as-of years do not isolate: their five-year windows overlap.)
 */
const REPORTERS = ['124', '276', '392', '826'];
const asOf = new Date('2026-08-22T00:00:00Z');

async function fixturePlan(reporters: readonly string[]) {
  const classification = await confirmedClassification();
  return createCountryEvidencePlan({ product_classification_id: classification.id, as_of_date: asOf, candidate_reporters: [...reporters], source_mode: TradeSourceMode.fixture });
}

const reporterOf = (calls: ReturnType<typeof vi.fn>) => [...new Set(calls.mock.calls.map((call) => (call[0] as ComtradeFetchParams).reporter))].sort();

afterEach(() => setComtradeClient(null));
afterAll(() => prisma.$disconnect());

const DECOMPOSE = ['36', '76', '152', '170'];
const SCOPE = ['158', '191', '203', '208'];

describe('Country Evidence native batching', () => {
  test('executes a plan reporter batch by reporter batch and resumes to the same result', async () => {
    const fixture = fixtureClient();
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(REPORTERS);
    expect(plan.items).toHaveLength(44);

    const first = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['124', '276'] } });
    // A batch that leaves work behind must not mint a manifest: doing so would freeze an
    // evidence set whose per-reporter completeness described only half the plan.
    expect(first).toMatchObject({ status: 'batch_incomplete', manifest: null, executed_items: 22, remaining_items: 22 });
    expect(reporterOf(fixture.calls)).toEqual(['124', '276']);
    expect(await prisma.countryEvidenceManifest.count({ where: { plan_id: plan.id } })).toBe(0);

    // Interruption between batches leaves the plan resumable rather than failed.
    const interrupted = await prisma.countryEvidencePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(interrupted.status).toBe('partial');

    const second = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['392', '826'] } });
    expect(second.status).toBe('metric_ready');
    expect(second.manifest).not.toBeNull();
    expect(reporterOf(fixture.calls)).toEqual(REPORTERS);
    expect(fixture.calls).toHaveBeenCalledTimes(44);
  });

  test('produces the same manifest however execution was decomposed', async () => {
    // Batched first, so the batched path is the one that actually acquires. The whole-plan run
    // then reuses the identical evidence by fingerprint and must arrive at the same manifest.
    const batchedFixture = fixtureClient();
    setComtradeClient(batchedFixture.client);
    const batched = await fixturePlan(DECOMPOSE);
    for (const reporter of DECOMPOSE) await executeCountryEvidencePlan(batched.id, { batch: { reporters: [reporter] } });
    const batchedResult = await executeCountryEvidencePlan(batched.id);
    expect(batchedFixture.calls).toHaveBeenCalledTimes(44);
    setComtradeClient(null);

    const wholeFixture = fixtureClient();
    setComtradeClient(wholeFixture.client);
    const whole = await fixturePlan(DECOMPOSE);
    const wholeResult = await executeCountryEvidencePlan(whole.id);
    expect(wholeFixture.calls).not.toHaveBeenCalled();

    const strip = (payload: unknown) => {
      const value = JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
      // plan_key differs because each test plan belongs to its own classification; every other
      // field — including per-reporter evaluation and coverage — must be identical.
      delete value.plan_key;
      delete value.references;
      return value;
    };
    expect(strip(batchedResult.manifest!.manifest_payload)).toEqual(strip(wholeResult.manifest!.manifest_payload));
    expect(batchedResult.manifest!.evaluation_state).toBe(wholeResult.manifest!.evaluation_state);

    // Batch boundaries are not part of evidence identity: item keys and request fingerprints
    // are functions of the frozen plan, never of how execution was sliced.
    const wholeItems = await prisma.countryEvidencePlanItem.findMany({ where: { plan_id: whole.id }, orderBy: [{ reporter_code: 'asc' }, { period: 'asc' }, { purpose: 'asc' }] });
    const batchedItems = await prisma.countryEvidencePlanItem.findMany({ where: { plan_id: batched.id }, orderBy: [{ reporter_code: 'asc' }, { period: 'asc' }, { purpose: 'asc' }] });
    expect(batchedItems.map((item) => item.resolution_state)).toEqual(wholeItems.map((item) => item.resolution_state));
  });

  test('never touches a reporter outside the requested batch and rejects one outside the plan', async () => {
    const fixture = fixtureClient();
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(SCOPE);

    await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['191'] } });
    expect(reporterOf(fixture.calls)).toEqual(['191']);
    const untouched = await prisma.countryEvidencePlanItem.findMany({ where: { plan_id: plan.id, reporter_code: { not: '191' } } });
    expect(untouched.every((item) => item.resolution_state === 'fetch_required' && item.source_evidence_id === null)).toBe(true);

    // A reporter the plan does not contain cannot be injected, and the caller is told rather
    // than quietly handed the intersection.
    await expect(executeCountryEvidencePlan(plan.id, { batch: { reporters: ['842'] } })).rejects.toThrow(/not candidates of this Country Evidence plan/);
    await expect(executeCountryEvidencePlan(plan.id, { batch: { reporters: ['158', '999'] } })).rejects.toThrow(/999/);
    await expect(executeCountryEvidencePlan(plan.id, { batch: { reporters: [] } })).rejects.toThrow(/at least one reporter/);
    await expect(executeCountryEvidencePlan(plan.id, { batch: { max_items: 0 } })).rejects.toThrow(/positive integer/);
    expect(reporterOf(fixture.calls)).toEqual(['191']);
  });

  test('re-running a completed batch reuses evidence instead of re-acquiring it', async () => {
    const fixture = fixtureClient();
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(['218']);

    await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['218'] } });
    const afterFirst = fixture.calls.mock.calls.length;
    expect(afterFirst).toBe(11);

    const repeat = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['218'] } });
    expect(fixture.calls).toHaveBeenCalledTimes(afterFirst);
    expect(repeat.physical_calls).toBe(0);
    expect(repeat.estimated_calls).toBe(0);
  });

  test('caps a batch with max_items deterministically and leaves the remainder resumable', async () => {
    const fixture = fixtureClient();
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(['233']);

    const capped = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['233'], max_items: 4 } });
    expect(capped).toMatchObject({ status: 'batch_incomplete', executed_items: 4 });
    expect(fixture.calls).toHaveBeenCalledTimes(4);
    const resolved = await resolveCountryEvidencePlan(plan.id);
    expect(resolved.items.filter((item) => item.resolution_state === 'reusable')).toHaveLength(4);

    // The plan holds only this reporter, so finishing its remaining 7 items finishes the plan
    // and the manifest is published exactly once, at the point the whole plan became terminal.
    const rest = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['233'] } });
    expect(rest).toMatchObject({ status: 'metric_ready', executed_items: 7, remaining_items: 0 });
    expect(rest.manifest).not.toBeNull();
    expect(fixture.calls).toHaveBeenCalledTimes(11);
  });

  test('counts provider retries as physical calls', async () => {
    const fixture = fixtureClient({ retriesFor: ['246'] });
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(['246']);
    const result = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['246'] } });
    // 11 logical items, each first attempt costing two physical requests.
    expect(result.executed_items).toBe(11);
    expect(result.physical_calls).toBe(22);
  });

  test('enforces the configured quota reserve before contacting the provider', async () => {
    const fixture = fixtureClient();
    const credential = `auth-${randomUUID()}`;
    setComtradeClient({ ...fixture.client, identity: { ...fixture.client.identity, mode: 'authenticated', authenticated: true, credential_fingerprint: credential } });
    // 450 - 445 = 5 calls left. A 11-item batch needs 11 and must leave 3 unspent.
    await reserveProviderQuota({ provider: 'un_comtrade', credential_fingerprint: credential, configured_limit: 450, request_count: 445 });
    const classification = await confirmedClassification();
    const plan = await createCountryEvidencePlan({ product_classification_id: classification.id, as_of_date: asOf, candidate_reporters: ['250'], source_mode: TradeSourceMode.authenticated });

    const deferred = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['250'] }, minimum_quota_reserve: 3 });
    expect(deferred).toMatchObject({ status: 'deferred_quota', available_calls: 5, quota_reserve: 3, physical_calls: 0 });
    expect(fixture.calls).not.toHaveBeenCalled();

    // The floor is the only thing blocking it; explicitly waiving the reserve still defers,
    // because 11 required calls exceed the 5 that remain.
    const stillDeferred = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['250'] }, minimum_quota_reserve: 0 });
    expect(stillDeferred.status).toBe('deferred_quota');
    expect(fixture.calls).not.toHaveBeenCalled();
    await expect(executeCountryEvidencePlan(plan.id, { minimum_quota_reserve: -1 })).rejects.toThrow(/non-negative integer/);
  });

  test('a provider failure inside a batch stays a failure and never becomes absence', async () => {
    const fixture = fixtureClient({ failReporters: ['344'] });
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(['300', '344']);

    const good = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['300'] } });
    expect(good.status).toBe('batch_incomplete');
    const bad = await executeCountryEvidencePlan(plan.id, { batch: { reporters: ['344'] } });
    expect(bad.status).toBe('batch_incomplete');

    const failed = await prisma.countryEvidencePlanItem.findMany({ where: { plan_id: plan.id, reporter_code: '344' } });
    expect(failed.every((item) => item.resolution_state === 'fetch_required' || item.resolution_state === 'failed')).toBe(true);
    expect(failed.every((item) => item.resolution_state !== 'missing')).toBe(true);
    // The whole-plan call must still refuse to publish a metric-ready manifest.
    const whole = await executeCountryEvidencePlan(plan.id);
    expect(whole.status).not.toBe('metric_ready');
  });

  test('default behaviour is unchanged when no batch is supplied', async () => {
    const fixture = fixtureClient();
    setComtradeClient(fixture.client);
    const plan = await fixturePlan(['348']);
    const result = await executeCountryEvidencePlan(plan.id);
    expect(result.status).toBe('metric_ready');
    expect(result.manifest).not.toBeNull();
    expect(result.estimated_calls).toBe(11);
    expect(reporterOf(fixture.calls)).toEqual(['348']);
  });
});
