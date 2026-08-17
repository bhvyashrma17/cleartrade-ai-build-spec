import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test, vi } from 'vitest';
import { OrgTier, UserRole } from '@prisma/client';

/**
 * Rollback when canonical lead CREATION fails.
 *
 * In its own file because it mocks `@/lib/buyer-leads`, and the mock has to be hoisted above
 * the import of the command under test. Mocking is the only way to fail creation
 * deterministically at the right point: breaking the data instead (deleting the Product, say)
 * cascades the BuyerFitAssessment away, so the command would fail earlier — in
 * `recordAgentDecision` — and the test would pass while proving nothing about creation.
 */
vi.mock('@/lib/buyer-leads', () => ({
  createBuyerLeadCanonical: vi.fn(async () => {
    throw new Error('canonical lead creation failed');
  }),
}));

const { shortlistBuyerCommand } = await import('../src/lib/buyer-commands');
const { prisma } = await import('../src/lib/prisma');
type Principal = import('../src/types').Principal;

afterAll(async () => { await prisma.$disconnect(); });

describe('shortlist is atomic across all three writes', () => {
  test('a failure creating the lead rolls back membership and the decision too', async () => {
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({
      data: { display_name: `Rollback ${s}`, tier: OrgTier.paid }, select: { id: true },
    });
    const agentUser = await prisma.user.create({
      data: { email: `rb-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true },
    });
    await prisma.agentAssignment.create({
      data: { exporter_org_id: org.id, agent_user_id: agentUser.id, status: 'active' },
    });
    const product = await prisma.product.create({
      data: { exporter_org_id: org.id, name: `P ${s}` }, select: { id: true },
    });
    const buyer = await prisma.buyer.create({
      data: { legal_name: `B ${s}`, display_name: `B ${s}`, country_code: 'DE', buyer_type: 'importer' },
      select: { id: true },
    });
    const fit = await prisma.buyerFitAssessment.create({
      data: {
        buyer_id: buyer.id, product_id: product.id, exporter_org_id: org.id,
        score: 74, confidence_score: 66, components: { volume_fit: 80 },
        input_snapshot: { rows: [] }, model_version: 'buyerfit-v2',
      },
      select: { id: true },
    });
    const agent: Principal = {
      id: agentUser.id, email: 'a@t.test', name: 'Agent', role: UserRole.agent,
      exporter_org_id: null, tier: OrgTier.paid,
    };

    await expect(shortlistBuyerCommand({
      actor: agent, subjectId: fit.id,
      reason: 'Shortlisting a discovered buyer.', correlationId: randomUUID(),
    })).rejects.toThrow(/canonical lead creation failed/);

    // All three writes rolled back together. A decision claiming a shortlist with no lead
    // behind it is exactly the divergence this architecture exists to prevent.
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: fit.id } })).toBe(0);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: buyer.id } })).toBe(0);
    expect(await prisma.buyerLead.count({ where: { buyer_id: buyer.id } })).toBe(0);
    // And no audit event survived either.
    expect(await prisma.auditEvent.count({ where: { exporter_org_id: org.id } })).toBe(0);
  });
});
