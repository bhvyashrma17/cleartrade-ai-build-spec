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
const v5 = vi.hoisted(() => ({ started: [] as string[], factsAtConfirm: new Map<string, Record<string, unknown>>() }));
vi.mock('../src/lib/demand-discovery-v5/service', () => ({
  // Auto-start off, so the route's own start is what runs. Confirmation calls this, and a real
  // auto-start freezes the product's facts here, so it records what the product held at that moment.
  autoStartDemandDiscoveryV5: vi.fn(async (args: { product_id: string }) => {
    const { prisma: db } = await import('../src/lib/prisma');
    const facts = await db.product.findUniqueOrThrow({
      where: { id: args.product_id },
      select: { price_target_amount: true, price_target_currency: true, price_target_quantity_unit: true, price_target_incoterm: true, capacity_value: true, capacity_unit: true, capacity_period: true },
    });
    v5.factsAtConfirm.set(args.product_id, { ...facts, price_target_amount: facts.price_target_amount?.toString() ?? null, capacity_value: facts.capacity_value?.toString() ?? null });
    return { started: false, reason: 'Auto-start is switched off in config.' };
  }),
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

let codeListLoaded = false;
async function loadCodeList() {
  if (codeListLoaded) return;
  codeListLoaded = true;
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
    // No price or capacity given: none written, and the run starts without them as before.
    expect(v5.factsAtConfirm.get(productId)).toMatchObject({ price_target_amount: null, capacity_value: null });
    expect(await prisma.auditEvent.count({ where: { object_type: 'product_operational_facts', object_id: productId } })).toBe(0);
  });

  test('E-068: a FOB price per kg and a monthly capacity are on the product before the code is confirmed', async () => {
    await loadCodeList();
    const paid = await member(OrgTier.paid);
    auth.caller = paid.principal;

    const saved = await ask({ ...rice, fob_price_per_kg: { amount: '95.50', currency: 'inr' }, monthly_capacity: { value: '20', unit: 'tonne' } });
    expect(saved.status).toBe(201);
    const productId = saved.body.data.product_id as string;
    // Confirmation is what starts a run, and the run freezes the facts there: they were already in place.
    expect(v5.factsAtConfirm.get(productId)).toEqual({
      price_target_amount: '95.5', price_target_currency: 'INR', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB',
      capacity_value: '20', capacity_unit: 'tonne', capacity_period: 'month',
    });
    expect(v5.started).toContain(productId);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { object_type: 'product_operational_facts', object_id: productId } });
    expect(audit.after_summary).toMatchObject({ provenance: 'exporter_declared' });

    // What the run reads from them: 95.50 INR per kg FOB, and 20 tonnes a month = 240,000 kg a year.
    const { exporterUsdPerKg, exporterYearlyKg } = await import('../src/lib/demand-discovery-v5/exporter-inputs');
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(exporterYearlyKg({ capacity_value: Number(product.capacity_value), capacity_unit: product.capacity_unit, capacity_period: product.capacity_period })).toMatchObject({ value: 240_000 });
    expect(exporterUsdPerKg({ price_target_amount: Number(product.price_target_amount), price_target_currency: product.price_target_currency, price_target_quantity_unit: product.price_target_quantity_unit, price_target_incoterm: product.price_target_incoterm, unit_net_weight_value: null, unit_net_weight_unit: null }, 0.0119)).toMatchObject({ basis: { currency: 'INR', quantity_unit: 'kg', incoterm: 'FOB' } });

    // Only one of the two is fine.
    const priceOnly = await ask({ ...rice, name: 'Basmati rice, 1509 steam', fob_price_per_kg: { amount: '1.25', currency: 'USD' } });
    expect(priceOnly.status).toBe(201);
    expect(v5.factsAtConfirm.get(priceOnly.body.data.product_id)).toMatchObject({ price_target_amount: '1.25', price_target_currency: 'USD', capacity_value: null, capacity_period: null });
  });

  test('E-068: a bad price or capacity is named beside its field, and nothing is saved', async () => {
    await loadCodeList();
    const paid = await member(OrgTier.paid);
    auth.caller = paid.principal;

    const zero = await ask({ ...rice, fob_price_per_kg: { amount: '0', currency: 'INR' } });
    expect(zero).toMatchObject({ status: 422, body: { error: { code: 'VALIDATION_ERROR' } } });
    expect(zero.body.error.fields).toEqual([expect.objectContaining({ field: 'fob_price_per_kg.amount', code: 'invalid' })]);
    const words = await ask({ ...rice, monthly_capacity: { value: 'twenty', unit: 'tonne' } });
    expect(words.body.error.fields[0]).toMatchObject({ field: 'monthly_capacity.value' });
    const pieces = await ask({ ...rice, monthly_capacity: { value: '20', unit: 'carton' } });
    expect(pieces.body.error.fields[0]).toMatchObject({ field: 'monthly_capacity.unit', message: 'Choose kg or tonnes.' });
    const extra = await ask({ ...rice, fob_price_per_kg: { amount: '95', currency: 'INR', incoterm: 'CIF' } });
    expect(extra.status).toBe(422);

    expect(await prisma.product.count({ where: { exporter_org_id: paid.org.id } })).toBe(0);
  });
});

describe('declareProductOperationalFacts: capacity period', () => {
  test('E-068: a period sent with production capacity alone is kept', async () => {
    const paid = await member(OrgTier.paid);
    const product = await prisma.product.create({ data: { exporter_org_id: paid.org.id, name: 'Turmeric fingers', description: 'Turmeric fingers', evidence_origin: EvidenceOrigin.manually_entered_real } });
    const { declareProductOperationalFacts } = await import('../src/lib/exporter-facts/service');
    const declare = (facts: Record<string, unknown>) => declareProductOperationalFacts({ actor: paid.principal as never, exporter_org_id: paid.org.id, product_id: product.id, facts, correlation_id: randomUUID() });

    await declare({ capacity_value: '120', capacity_unit: 'tonne', capacity_period: 'year' });
    expect(await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).toMatchObject({ capacity_unit: 'tonne', capacity_period: 'year' });
    // Unchanged: available capacity without a period still clears it, as the details form sends both.
    await declare({ available_capacity_value: '10', available_capacity_unit: 'tonne' });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).capacity_period).toBeNull();
    // And a change that touches neither leaves it alone.
    await declare({ capacity_period: 'month' });
    await declare({ lead_time_days: 21 });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).capacity_period).toBe('month');
  });
});
