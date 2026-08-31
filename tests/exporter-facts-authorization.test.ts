import { randomUUID } from 'node:crypto';
import { CertificationStatus, EvidenceOrigin, LogisticsTransportMode, OrgTier, Prisma, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import {
  declareProductOperationalFacts,
  recordOperationalQuote,
  recordRouteEvidence,
  verifyProductCertification,
} from '../src/lib/exporter-facts/service';
import { loadOperationalCostRows } from '../src/lib/country-truth/operational-evidence';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

/** Adversarial pass B: tenancy, self-verification, quote leakage and provenance laundering. */

afterAll(() => prisma.$disconnect());

const principal = (id: string, role: UserRole, orgId: string | null = null): Principal => ({ id, email: `${id}@cleartrade.test`, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid });

async function tenant() {
  const marker = `facts-${randomUUID().slice(0, 8)}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const owner = await prisma.user.create({ data: { email: `${marker}-owner@test.local`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const agent = await prisma.user.create({ data: { email: `${marker}-agent@test.local`, name: 'Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Rice' } });
  const certification = await prisma.productCertification.create({ data: { product_id: product.id, code: 'PHYTO', name: 'Phytosanitary', status: CertificationStatus.held, certificate_reference: 'CERT-1', valid_until: new Date('2027-01-01T00:00:00Z') } });
  // An exporter principal belongs to its own org; an agent reaches it through assignment.
  return { org, owner: principal(owner.id, UserRole.exporter_owner, org.id), agent: principal(agent.id, UserRole.agent), product, certification };
}

const quote = (over: Record<string, unknown> = {}) => ({
  component: 'origin_charges' as const, quote_type: 'cha' as const, amount: '400', currency: 'USD',
  rate_basis: 'per_shipment' as const, quantity_unit: 'kg', destination_country: 'DE',
  observed_at: new Date('2026-08-20T00:00:00Z'), effective_from: new Date('2026-08-20T00:00:00Z'), valid_until: new Date('2026-12-31T00:00:00Z'),
  source: 'Partner CHA', source_reference: `Q-${randomUUID().slice(0, 8)}`, ...over,
});

describe('exporter fact authorization', () => {
  test('an exporter declares its own facts and they stay exporter_declared', async () => {
    const t = await tenant();
    const updated = await declareProductOperationalFacts({
      actor: t.owner, exporter_org_id: t.org.id, product_id: t.product.id, correlation_id: randomUUID(),
      facts: { price_target_amount: '1.20', price_target_currency: 'usd', price_target_quantity_unit: 'kg', price_target_incoterm: 'fob', moq_value: '20000', moq_unit: 'kg', packaging_format: 'pp_bag', container_compatibility: ['20ft_dry'] },
    });
    expect(updated).toMatchObject({ price_target_currency: 'USD', price_target_incoterm: 'FOB', packaging_format: 'PP_BAG', origin_provenance: 'exporter_declared' });
    expect(updated.container_compatibility).toEqual(['20FT_DRY']);
  });

  test('an exporter cannot verify its own certification', async () => {
    const t = await tenant();
    await expect(verifyProductCertification({ actor: t.owner, exporter_org_id: t.org.id, product_id: t.product.id, certification_id: t.certification.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const untouched = await prisma.productCertification.findUniqueOrThrow({ where: { id: t.certification.id } });
    expect(untouched).toMatchObject({ verification_state: 'unverified', verified_by_id: null });

    const verified = await verifyProductCertification({ actor: t.agent, exporter_org_id: t.org.id, product_id: t.product.id, certification_id: t.certification.id, correlation_id: randomUUID() });
    expect(verified).toMatchObject({ verification_state: 'agent_verified', verified_by_id: t.agent.id });
    expect(verified.verified_at).not.toBeNull();
  });

  test('an expired certificate cannot be verified as current, and one without a reference cannot be verified at all', async () => {
    const t = await tenant();
    const expired = await prisma.productCertification.create({ data: { product_id: t.product.id, code: 'ORGANIC', name: 'Organic', status: CertificationStatus.held, certificate_reference: 'ORG-1', valid_until: new Date('2020-01-01T00:00:00Z') } });
    await expect(verifyProductCertification({ actor: t.agent, exporter_org_id: t.org.id, product_id: t.product.id, certification_id: expired.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'expired' })] });

    const uncited = await prisma.productCertification.create({ data: { product_id: t.product.id, code: 'HACCP', name: 'HACCP', status: CertificationStatus.held } });
    await expect(verifyProductCertification({ actor: t.agent, exporter_org_id: t.org.id, product_id: t.product.id, certification_id: uncited.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'certificate_reference' })] });
  });

  test('an unassigned agent cannot touch another tenant\'s evidence', async () => {
    const owner = await tenant();
    const other = await tenant();
    await expect(verifyProductCertification({ actor: other.agent, exporter_org_id: owner.org.id, product_id: owner.product.id, certification_id: owner.certification.id, correlation_id: randomUUID() })).rejects.toBeTruthy();
    await expect(recordOperationalQuote({ actor: other.agent, exporter_org_id: owner.org.id, quote: quote(), correlation_id: randomUUID() })).rejects.toBeTruthy();
    await expect(declareProductOperationalFacts({ actor: other.owner, exporter_org_id: owner.org.id, product_id: owner.product.id, facts: { moq_value: '1' }, correlation_id: randomUUID() })).rejects.toBeTruthy();
    expect(await prisma.operationalCostEvidence.count({ where: { exporter_org_id: owner.org.id } })).toBe(0);
  });

  test('an exporter cannot file a partner quote', async () => {
    const t = await tenant();
    await expect(recordOperationalQuote({ actor: t.owner, exporter_org_id: t.org.id, quote: quote(), correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('the ClearTrade fee can never be filed by hand', async () => {
    const t = await tenant();
    await expect(recordOperationalQuote({ actor: t.agent, exporter_org_id: t.org.id, quote: quote({ component: 'cleartrade_fee', quote_type: 'cleartrade_fee' }), correlation_id: randomUUID() }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'forbidden' })] });
  });

  test('a quote must expire, and cannot expire before it starts', async () => {
    const t = await tenant();
    await expect(recordOperationalQuote({ actor: t.agent, exporter_org_id: t.org.id, quote: quote({ valid_until: new Date('2026-08-01T00:00:00Z') }), correlation_id: randomUUID() }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'valid_until' })] });
  });

  test('a freight quote cannot be attached to a route it does not describe', async () => {
    const t = await tenant();
    const route = await recordRouteEvidence({ actor: t.agent, exporter_org_id: t.org.id, correlation_id: randomUUID(), route: { origin_country: 'IN', destination_country: 'DE', transport_mode: LogisticsTransportMode.ocean, route_available: true, equipment_assumption: '20FT_DRY', provider: 'partner', source_reference: `route-${randomUUID().slice(0, 8)}` } });
    await expect(recordOperationalQuote({ actor: t.agent, exporter_org_id: t.org.id, correlation_id: randomUUID(), quote: quote({ component: 'international_freight', quote_type: 'international_freight', route_evidence_id: route.id, destination_country: 'US' }) }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'mismatch' })] });
    // Wrong container type on the right lane is equally refused.
    await expect(recordOperationalQuote({ actor: t.agent, exporter_org_id: t.org.id, correlation_id: randomUUID(), quote: quote({ component: 'international_freight', quote_type: 'international_freight', route_evidence_id: route.id, destination_country: 'DE', equipment_code: '40FT_HC' }) }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'equipment_code' })] });
  });

  test('a quote for one exporter never becomes another exporter\'s evidence', async () => {
    const a = await tenant();
    const b = await tenant();
    await recordOperationalQuote({ actor: a.agent, exporter_org_id: a.org.id, quote: quote({ product_id: a.product.id }), correlation_id: randomUUID() });

    const forB = await loadOperationalCostRows({ exporter_org_id: b.org.id, product_id: b.product.id, destination_country: 'DE', as_of: new Date('2026-08-31T00:00:00Z'), origins: [EvidenceOrigin.manually_entered_real] });
    expect(forB).toHaveLength(0);
    const forA = await loadOperationalCostRows({ exporter_org_id: a.org.id, product_id: a.product.id, destination_country: 'DE', as_of: new Date('2026-08-31T00:00:00Z'), origins: [EvidenceOrigin.manually_entered_real] });
    expect(forA).toHaveLength(1);
  });

  test('a product a tenant does not own cannot be named on its quote', async () => {
    const a = await tenant();
    const b = await tenant();
    await expect(recordOperationalQuote({ actor: a.agent, exporter_org_id: a.org.id, quote: quote({ product_id: b.product.id }), correlation_id: randomUUID() }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'product_id' })] });
  });

  test('a revised quote supersedes rather than mutating the one an assessment may have used', async () => {
    const t = await tenant();
    const first = await recordOperationalQuote({ actor: t.agent, exporter_org_id: t.org.id, quote: quote({ product_id: t.product.id, amount: '400' }), correlation_id: randomUUID() });
    const second = await recordOperationalQuote({ actor: t.agent, exporter_org_id: t.org.id, quote: quote({ product_id: t.product.id, amount: '600' }), correlation_id: randomUUID() });

    const original = await prisma.operationalCostEvidence.findUniqueOrThrow({ where: { id: first.id } });
    expect(Number(original.amount)).toBe(400);
    expect(original.superseded_by_id).toBe(second.id);
    // Everything that gives the row its meaning is protected; only the supersession annotation
    // was permitted.
    await expect(prisma.operationalCostEvidence.update({ where: { id: first.id }, data: { amount: new Prisma.Decimal('1') } })).rejects.toThrow(/immutable/);
    await expect(prisma.operationalCostEvidence.delete({ where: { id: first.id } })).rejects.toThrow(/immutable/);
  });

  test('an incomplete price is refused rather than half-recorded', async () => {
    const t = await tenant();
    await expect(declareProductOperationalFacts({ actor: t.owner, exporter_org_id: t.org.id, product_id: t.product.id, correlation_id: randomUUID(), facts: { price_target_amount: '1.20', price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: null } }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'incomplete' })] });
    await expect(declareProductOperationalFacts({ actor: t.owner, exporter_org_id: t.org.id, product_id: t.product.id, correlation_id: randomUUID(), facts: { price_target_amount: '1.20', price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'ZZZ' } }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ field: 'price_target_incoterm' })] });
  });

  test('route evidence records what was found; nothing infers a lane', async () => {
    const t = await tenant();
    const route = await recordRouteEvidence({ actor: t.agent, exporter_org_id: t.org.id, correlation_id: randomUUID(), route: { origin_country: 'in', destination_country: 'de', transport_mode: LogisticsTransportMode.ocean, route_available: true, transit_time_min_days: 22, transit_time_max_days: 30, supported_product_constraint_codes: ['dry_container'], provider: 'partner', source_reference: `route-${randomUUID().slice(0, 8)}` } });
    expect(route).toMatchObject({ origin_country: 'IN', destination_country: 'DE', route_available: true, evidence_origin: EvidenceOrigin.manually_entered_real });
    expect(route.supported_product_constraint_codes).toEqual(['DRY_CONTAINER']);
    await expect(recordRouteEvidence({ actor: t.owner, exporter_org_id: t.org.id, correlation_id: randomUUID(), route: { origin_country: 'IN', destination_country: 'DE', transport_mode: LogisticsTransportMode.ocean, route_available: false, provider: 'partner', source_reference: 'x' } }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
