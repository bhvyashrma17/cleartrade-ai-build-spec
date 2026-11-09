import { randomUUID } from 'node:crypto';
import { describe, expect, test, vi } from 'vitest';
import { EvidenceOrigin, OrgTier, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { importReferenceDataset } from '@/lib/reference-datasets/service';

/**
 * E-053: a member adds a product, confirms its HS code, and Demand Discovery starts. Before this,
 * nothing let an exporter save a product, so a member signed up with Google could not run anything.
 */
const auth = vi.hoisted(() => ({ caller: null as null | Record<string, unknown> }));
vi.mock('../src/lib/auth', async () => {
  const { unauthenticated } = await import('../src/lib/errors');
  return {
    getPrincipal: vi.fn(async () => auth.caller),
    requirePrincipal: vi.fn(async () => {
      if (!auth.caller) throw unauthenticated();
      return auth.caller;
    }),
  };
});
const v5 = vi.hoisted(() => ({ started: [] as string[] }));
vi.mock('../src/lib/demand-discovery-v5/service', () => ({
  // Auto-start off, so the route's own start is what runs.
  autoStartDemandDiscoveryV5: vi.fn(async () => ({ started: false, reason: 'Auto-start is switched off in config.' })),
  demandDiscoveryV5Availability: vi.fn(async () => ({ available: true })),
  startDemandDiscoveryV5: vi.fn(async (args: { product_id: string }) => {
    v5.started.push(args.product_id);
    return { run_id: `run-${args.product_id}`, job_id: `job-${args.product_id}`, status: 'queued' };
  }),
}));
const { POST } = await import('../src/app/api/v1/products/route');

const ask = async (body: unknown) => {
  const response = await POST(new Request('http://test/api/v1/products', { method: 'POST', body: JSON.stringify(body) }) as never);
  return { status: response.status, body: await response.json() };
};

async function member(tier: OrgTier) {
  const suffix = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({ data: { display_name: `Rice Co ${suffix}`, tier } });
  const user = await prisma.user.create({ data: { email: `rice-${suffix}@test.local`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  return { org, principal: { id: user.id, email: user.email, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id, tier } };
}

async function loadCodeList() {
  const ops = await prisma.user.create({ data: { email: `codes-${randomUUID().slice(0, 8)}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true, email: true, name: true } });
  const lines = ['code,description', '100630,"Cereals; rice, semi-milled or wholly milled, whether or not polished or glazed"', '330741,"Agarbatti and other odoriferous preparations which operate by burning"', '091030,"Spices; turmeric (curcuma)"', ...Array.from({ length: 4_100 }, (_, i) => `${String(400000 + i)},"Filler product ${i} ${randomUUID().slice(0, 4)}"`)];
  await importReferenceDataset({
    actor: { id: ops.id, email: ops.email, name: ops.name ?? '', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid },
    dataset_key: 'cepii:product-codes:HS22', bytes: Buffer.from(lines.join('\n')), source_url: 'https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS22_V202601.zip',
    retrieved_at: new Date('2026-10-31T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture,
  });
}

const rice = { name: 'Basmati rice, 1121 sella', hs_code: '100630', confirm_hs_code: true };

describe('POST /api/v1/products', () => {
  test('no session is 401 and a free account is 402, and nothing is saved', async () => {
    auth.caller = null;
    expect((await ask(rice)).status).toBe(401);
    const free = await member(OrgTier.free);
    auth.caller = free.principal;
    expect(await ask(rice)).toMatchObject({ status: 402, body: { error: { code: 'UPGRADE_REQUIRED' } } });
    expect(await prisma.product.count({ where: { exporter_org_id: free.org.id } })).toBe(0);
  });

  test('a member saves the product, the code is confirmed as theirs, and the run starts', async () => {
    await loadCodeList();
    const paid = await member(OrgTier.paid);
    auth.caller = paid.principal;

    expect(await ask({ ...rice, confirm_hs_code: false })).toMatchObject({ status: 422, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect((await ask({ ...rice, hs_code: '999999' })).body.error.fields[0]).toMatchObject({ field: 'hs_code', code: 'unknown_code' });
    expect(await prisma.product.count({ where: { exporter_org_id: paid.org.id } })).toBe(0);

    const saved = await ask(rice);
    expect(saved.status).toBe(201);
    const productId = saved.body.data.product_id as string;
    expect(saved.body.data).toMatchObject({ hs_code: '100630', run: { id: `run-${productId}`, job_id: `job-${productId}`, status: 'queued' }, not_started_reason: null });
    expect(v5.started).toEqual([productId]);

    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(product).toMatchObject({ exporter_org_id: paid.org.id, name: rice.name, hs_code: '100630', hs_classification_status: 'confirmed', hs_code_source: 'exporter_supplied', hs_confirmed_by_id: paid.principal.id, evidence_origin: 'manually_entered_real' });
    const classification = await prisma.productClassification.findFirstOrThrow({ where: { product_id: productId } });
    expect(classification).toMatchObject({ status: 'confirmed', method: 'exporter_supplied', hs6_code: '100630', proposed_by_id: paid.principal.id, confirmed_by_id: paid.principal.id });
    expect(await prisma.auditEvent.count({ where: { object_type: 'product', object_id: productId, action: 'create' } })).toBe(1);

    expect((await ask({ ...rice, name: 'basmati rice, 1121 SELLA' })).body.error.fields[0]).toMatchObject({ field: 'name', code: 'duplicate' });
  });
});
