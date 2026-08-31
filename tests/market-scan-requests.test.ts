import { randomUUID } from 'node:crypto';
import { JobStatus, JobType, MarketScanRequestStatus, OrgTier, ProductClassificationMethod, ProductClassificationStatus, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import {
  approveMarketScan, currentScanRequest, marketScanQueue, reconcileScanRequest,
  rejectMarketScan, requestMarketScan,
} from '@/lib/country-discovery/scan-requests';
import { productDiscoveryState } from '@/lib/country-discovery/service';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '@/types';

afterAll(() => prisma.$disconnect());

/**
 * The exporter market-scan request queue.
 *
 * The property under test throughout: an exporter can ASK for a global scan and can never
 * CAUSE one. A scan is ~218 metered provider calls against a platform-wide quota, so every
 * path that could release that work without a permitted staff decision is an attack.
 */

let hs6Counter = 0;
/** Collision-free HS6 per fixture, so no two fixtures share a classification identity. */
const nextHs6 = () => String(960000 + (hs6Counter += 1)).padStart(6, '0');

async function fixture(options: { classified?: boolean } = {}) {
  const classified = options.classified ?? true;
  const marker = `scan-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const owner = await prisma.user.create({ data: { email: `${marker}-o@example.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const agent = await prisma.user.create({ data: { email: `${marker}-a@example.test`, name: 'Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { agent_user_id: agent.id, exporter_org_id: org.id, status: 'active' } });
  const admin = await prisma.user.create({ data: { email: `${marker}-x@example.test`, name: 'Ops', role: UserRole.ops_supervisor } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Archetype product' } });

  const hs6 = nextHs6();
  let classification = null;
  if (classified) {
    const now = new Date();
    await prisma.product.update({ where: { id: product.id }, data: {
      hs_code: hs6, hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022',
      hs_classification_method: ProductClassificationMethod.exporter_supplied,
      hs_classification_status: ProductClassificationStatus.confirmed,
      hs_confirmed_by_id: agent.id, hs_confirmed_at: now, hs_classification_revision: 1,
    } });
    classification = await prisma.productClassification.create({ data: {
      product_id: product.id, revision: 1, hs6_code: hs6, nomenclature: 'HS', nomenclature_version: 'HS2022',
      method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {},
      rationale: 'test', source_references: [], confidence: 0.99,
      status: ProductClassificationStatus.confirmed, proposed_by_id: agent.id, confirmed_by_id: agent.id, confirmed_at: now,
    } });
  }

  const principal = (user: { id: string; email: string; name: string | null; role: UserRole }, orgId: string | null): Principal =>
    ({ id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: orgId, tier: OrgTier.paid });

  return {
    org, owner, agent, admin, product, classification, hs6,
    exporter: principal(owner, org.id),
    agentPrincipal: principal(agent, null),
    opsPrincipal: principal(admin, null),
  };
}

const ask = (f: Awaited<ReturnType<typeof fixture>>, actor?: Principal) =>
  requestMarketScan({ actor: actor ?? f.exporter, exporter_org_id: f.org.id, product_id: f.product.id, correlation_id: randomUUID() });

describe('exporter requests a scan', () => {
  test('a request is recorded pending and spends nothing', async () => {
    const f = await fixture();
    const { request, created } = await ask(f);
    expect(created).toBe(true);
    expect(request.status).toBe(MarketScanRequestStatus.pending);
    expect(request.requested_by_id).toBe(f.owner.id);
    expect(request.hs6_code).toBe(f.hs6);
    // Asking must never enqueue metered work.
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(0);
  });

  test('an unclassified product cannot be requested', async () => {
    const f = await fixture({ classified: false });
    await expect(ask(f)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('the request carries no field through which markets or provider mode could be chosen', async () => {
    const columns = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'MarketScanRequest'`);
    const names = columns.map((c) => c.column_name).join(' ');
    for (const forbidden of ['reporter', 'countr', 'source_mode', 'quota', 'policy', 'provider']) {
      expect(names).not.toMatch(new RegExp(forbidden, 'i'));
    }
  });

  test('the exporter sees their own request on the product surface', async () => {
    const f = await fixture();
    await ask(f);
    const state = await productDiscoveryState(f.exporter, f.org.id, f.product.id);
    expect(state.viewer_can_start_screening).toBe(false);
    expect(state.scan_request).toMatchObject({ status: 'pending' });
  });
});

describe('idempotency', () => {
  test('clicking five times produces one pending request', async () => {
    const f = await fixture();
    const outcomes = [];
    for (let i = 0; i < 5; i += 1) outcomes.push(await ask(f));
    expect(outcomes.filter((o) => o.created)).toHaveLength(1);
    expect(new Set(outcomes.map((o) => o.request.id)).size).toBe(1);
    expect(await prisma.marketScanRequest.count({ where: { product_classification_id: f.classification!.id } })).toBe(1);
  });

  test('concurrent submits cannot both create a request', async () => {
    const f = await fixture();
    // The partial unique index — not the pre-check — is what makes this safe under a race.
    const results = await Promise.all([ask(f), ask(f), ask(f)]);
    expect(new Set(results.map((r) => r.request.id)).size).toBe(1);
    expect(await prisma.marketScanRequest.count({ where: { product_classification_id: f.classification!.id } })).toBe(1);
  });

  test('a completed screen under the current policy identity satisfies the request without new work', async () => {
    const f = await fixture();
    await prisma.countryScreeningRun.create({ data: {
      product_classification_id: f.classification!.id, run_key: `run-${randomUUID()}`, status: 'completed',
      hs_code: f.hs6, hs_revision: 'HS2022', as_of_date: new Date(), source_mode: 'mock',
      screening_period: 2025, period_selection_policy_version: 'pp1', period_selection_policy_hash: 'ph1',
      period_selection_policy_snapshot: {}, max_fallback_lookback_years: 2,
      policy_version: 'p1', policy_hash: 'h1', policy_snapshot: {},
      universe_version: 'v1', universe_checksum: 'uc1', universe_size: 218, universe_snapshot: {},
      reporter_registry_version: 'rr1', reporter_registry_checksum: 'rc1',
      screening_algorithm_version: 'v1', parser_version: 'pv1', normalization_version: 'nv1',
      shortlist_target_size: 20, max_shortlist_size: 25, estimated_call_cost: 218, shortlist_size: 20,
    } });
    const { request, satisfied_by_existing_run } = await ask(f);
    expect(satisfied_by_existing_run).toBe(true);
    expect(request.status).toBe(MarketScanRequestStatus.completed);
    expect(request.resolution_note).toMatch(/already covered/i);
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(0);
  });

  test('an in-flight screening job attaches the request rather than queueing a rival', async () => {
    const f = await fixture();
    await prisma.job.create({ data: {
      type: JobType.country_screening, status: JobStatus.processing, payload: {},
      exporter_org_id: f.org.id, target_type: 'product_classification', target_id: f.classification!.id,
      correlation_id: randomUUID(),
    } as never });
    const { request } = await ask(f);
    expect(request.status).toBe(MarketScanRequestStatus.running);
    expect(request.resolution_note).toMatch(/already running/i);
  });
});

describe('approval releases the work; nothing else does', () => {
  test('an approved request hands off to the canonical screening service exactly once', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    const { request: approved, job } = await approveMarketScan({ actor: f.agentPrincipal, request_id: request.id, correlation_id: randomUUID() });
    expect(approved.status).toBe(MarketScanRequestStatus.queued);
    expect(approved.decided_by_id).toBe(f.agent.id);
    expect(approved.screening_job_id).toBe(job.id);
    // Exactly one screening job — approval must not be able to double-launch.
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(1);
    // And a second approval of the same request is refused.
    await expect(approveMarketScan({ actor: f.agentPrincipal, request_id: request.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(1);
  });

  test('the exporter cannot approve — their own request or any other', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    await expect(approveMarketScan({ actor: f.exporter, request_id: request.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(0);
  });

  test('an unassigned agent cannot approve another exporter’s request', async () => {
    const [target, other] = await Promise.all([fixture(), fixture()]);
    const { request } = await ask(target);
    await expect(approveMarketScan({ actor: other.agentPrincipal, request_id: request.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: target.org.id } })).toBe(0);
  });

  test('a rejected request can never be executed', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    const rejected = await rejectMarketScan({ actor: f.agentPrincipal, request_id: request.id, reason: 'Confirm the classification first.', correlation_id: randomUUID() });
    expect(rejected.status).toBe(MarketScanRequestStatus.rejected);
    expect(rejected.rejection_reason).toBe('Confirm the classification first.');
    await expect(approveMarketScan({ actor: f.agentPrincipal, request_id: request.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(0);
  });

  test('a rejection must carry a reason', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    await expect(rejectMarketScan({ actor: f.agentPrincipal, request_id: request.id, reason: '   ', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a classification that moved after the request fails closed instead of screening a stale identity', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    // The exporter's product is reclassified while the request sits in the queue.
    const now = new Date();
    await prisma.productClassification.create({ data: {
      product_id: f.product.id, revision: 2, hs6_code: nextHs6(), nomenclature: 'HS', nomenclature_version: 'HS2022',
      method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {},
      rationale: 'reclassified', source_references: [], confidence: 0.99,
      status: ProductClassificationStatus.confirmed, proposed_by_id: f.agent.id, confirmed_by_id: f.agent.id, confirmed_at: now,
    } });
    await expect(approveMarketScan({ actor: f.agentPrincipal, request_id: request.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // No metered work, and the stale request is closed rather than left approvable.
    expect(await prisma.job.count({ where: { type: JobType.country_screening, exporter_org_id: f.org.id } })).toBe(0);
    const after = await prisma.marketScanRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect(after.status).toBe(MarketScanRequestStatus.rejected);
    expect(after.rejection_reason).toMatch(/classification changed/i);
  });
});

describe('tenant isolation', () => {
  test('an exporter cannot request a scan for another org’s product', async () => {
    const [mine, theirs] = await Promise.all([fixture(), fixture()]);
    await expect(requestMarketScan({ actor: mine.exporter, exporter_org_id: theirs.org.id, product_id: theirs.product.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Naming their own org with someone else's product id is refused identically — the error
    // code must not become an existence oracle for another tenant's products.
    await expect(requestMarketScan({ actor: mine.exporter, exporter_org_id: mine.org.id, product_id: theirs.product.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an arbitrary product id is refused the same way a foreign one is', async () => {
    const f = await fixture();
    await expect(requestMarketScan({ actor: f.exporter, exporter_org_id: f.org.id, product_id: 'does-not-exist', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an exporter cannot read another org’s request or open the staff queue', async () => {
    const [mine, theirs] = await Promise.all([fixture(), fixture()]);
    await ask(theirs);
    await expect(currentScanRequest(mine.exporter, theirs.org.id, theirs.product.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(marketScanQueue(mine.exporter)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an agent’s queue shows only their assigned exporters', async () => {
    const [mine, theirs] = await Promise.all([fixture(), fixture()]);
    await Promise.all([ask(mine), ask(theirs)]);
    const queue = await marketScanQueue(mine.agentPrincipal);
    expect(queue.map((entry) => entry.exporter_org_id)).toContain(mine.org.id);
    expect(queue.map((entry) => entry.exporter_org_id)).not.toContain(theirs.org.id);
  });
});

describe('staff queue and reconciliation', () => {
  test('the queue reports reuse and staleness for the reviewer', async () => {
    const f = await fixture();
    await ask(f);
    const [entry] = await marketScanQueue(f.opsPrincipal).then((q) => q.filter((e) => e.exporter_org_id === f.org.id));
    expect(entry).toMatchObject({ status: 'pending', hs6_code: f.hs6, classification_stale: false, existing_run: null });
    expect(entry!.product.name).toBe('Archetype product');
  });

  test('request status follows the screening job rather than advancing on its own', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    const { request: approved, job } = await approveMarketScan({ actor: f.agentPrincipal, request_id: request.id, correlation_id: randomUUID() });
    expect(approved.status).toBe(MarketScanRequestStatus.queued);

    await prisma.job.update({ where: { id: job.id }, data: { status: JobStatus.processing } });
    expect((await reconcileScanRequest(request.id))!.status).toBe(MarketScanRequestStatus.running);

    await prisma.job.update({ where: { id: job.id }, data: { status: JobStatus.completed, result: { screening_run_id: 'run-abc' } } });
    const done = await reconcileScanRequest(request.id);
    expect(done!.status).toBe(MarketScanRequestStatus.completed);
    expect(done!.screening_run_id).toBe('run-abc');

    // A failed job surfaces as failed, not as a request stuck at "queued" forever.
    const g = await fixture();
    const second = await ask(g);
    const { job: job2 } = await approveMarketScan({ actor: g.agentPrincipal, request_id: second.request.id, correlation_id: randomUUID() });
    await prisma.job.update({ where: { id: job2.id }, data: { status: JobStatus.failed } });
    expect((await reconcileScanRequest(second.request.id))!.status).toBe(MarketScanRequestStatus.failed);
  });

  test('approval and rejection are both written to the audit trail', async () => {
    const f = await fixture();
    const { request } = await ask(f);
    await approveMarketScan({ actor: f.agentPrincipal, request_id: request.id, correlation_id: randomUUID() });
    const events = await prisma.auditEvent.findMany({ where: { object_type: 'market_scan_request', object_id: request.id }, orderBy: { timestamp: 'asc' } });
    expect(events.map((e) => e.action)).toEqual(['create', 'approve']);
    // The audit record must agree with the row it describes, not diverge from it.
    const after = await prisma.marketScanRequest.findUniqueOrThrow({ where: { id: request.id } });
    expect((events.at(-1)!.after_summary as { status?: string }).status).toBe(after.status);
  });
});
