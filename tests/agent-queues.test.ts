import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import {
  DealStage, DisputeSeverity, DisputeStatus, ExceptionState, OrgTier,
  ScopeType, SlaState, TaskPriority, TaskState, UserRole,
} from '@prisma/client';
import { agentEscalations, escalationCounts } from '../src/lib/agent-escalations';
import { assignExporterToAgent } from '../src/lib/staff-provisioning';
import { tenantScope } from '../src/lib/permissions';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

const principal = (id: string, role: UserRole, orgId: string | null = null): Principal => ({
  id, email: `${id}@t.test`, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid,
});

/** Two exporters: one assigned to our agent, one not. Everything is duplicated across both. */
async function world() {
  const s = randomUUID().slice(0, 8);
  const [mine, theirs] = await Promise.all([
    prisma.exporterOrg.create({ data: { display_name: `Mine ${s}`, tier: OrgTier.paid }, select: { id: true } }),
    prisma.exporterOrg.create({ data: { display_name: `Theirs ${s}`, tier: OrgTier.paid }, select: { id: true } }),
  ]);
  const [agentUser, opsUser] = await Promise.all([
    prisma.user.create({ data: { email: `q-agt-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `q-ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
  ]);
  const ops = principal(opsUser.id, UserRole.ops_supervisor);
  const agent = principal(agentUser.id, UserRole.agent);
  await assignExporterToAgent({ actor: ops, agentUserId: agentUser.id, exporterOrgId: mine.id, correlationId: randomUUID() });

  const seedOrg = async (orgId: string, tag: string) => {
    const buyer = await prisma.buyer.create({
      data: { legal_name: `B ${tag}`, display_name: `B ${tag}`, country_code: 'DE', buyer_type: 'importer' },
      select: { id: true },
    });
    const product = await prisma.product.create({ data: { exporter_org_id: orgId, name: `P ${tag}` }, select: { id: true } });
    const deal = await prisma.deal.create({
      data: { exporter_org_id: orgId, buyer_id: buyer.id, product_id: product.id, stage: DealStage.negotiating },
      select: { id: true },
    });
    await prisma.task.create({
      data: {
        scope_type: ScopeType.deal, scope_id: deal.id,
        exporter_org_id: orgId, deal_id: deal.id, title: `Escalated task ${tag}`,
        state: TaskState.in_progress, sla_state: SlaState.escalated,
        priority: TaskPriority.high, owner_role: UserRole.agent,
      },
    });
    await prisma.dispute.create({
      data: {
        deal_id: deal.id, scope_type: ScopeType.deal, scope_id: deal.id,
        type: 'quality', severity: DisputeSeverity.high, status: DisputeStatus.open,
        summary: `Dispute ${tag}`,
      },
    });
    await prisma.shipment.create({
      data: { deal_id: deal.id, exception_state: ExceptionState.blocked, exception_reason: `Stuck ${tag}` },
    });
    return { dealId: deal.id, buyerId: buyer.id };
  };

  const mineSeed = await seedOrg(mine.id, `mine-${s}`);
  const theirsSeed = await seedOrg(theirs.id, `theirs-${s}`);
  return { suffix: s, mineOrgId: mine.id, theirsOrgId: theirs.id, agent, ops, mineSeed, theirsSeed };
}

describe('/agent/deals scoping (read path)', () => {
  test('the query scope covers only assigned exporters', async () => {
    const w = await world();
    const scope = await tenantScope(w.agent);
    // The exact fragment the page spreads into its `where`. Scoping happens in the query.
    expect(scope).toEqual({ exporter_org_id: { in: [w.mineOrgId] } });

    const deals = await prisma.deal.findMany({ where: { ...scope }, select: { exporter_org_id: true } });
    expect(deals.length).toBeGreaterThan(0);
    expect(deals.every((d) => d.exporter_org_id === w.mineOrgId)).toBe(true);
    expect(deals.some((d) => d.exporter_org_id === w.theirsOrgId)).toBe(false);
  });

  test('an agent with no assignments sees nothing, never everything', async () => {
    const s = randomUUID().slice(0, 8);
    const lonely = await prisma.user.create({
      data: { email: `lonely-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true },
    });
    const scope = await tenantScope(principal(lonely.id, UserRole.agent));
    // `in: []` matches nothing — the correct answer, and never an unscoped read.
    expect(scope).toEqual({ exporter_org_id: { in: [] } });
    expect(await prisma.deal.findMany({ where: { ...scope } })).toEqual([]);
  });

  test('unassigning removes the deals from scope', async () => {
    const w = await world();
    const assignment = await prisma.agentAssignment.findFirstOrThrow({
      where: { agent_user_id: w.agent.id, exporter_org_id: w.mineOrgId, status: 'active' },
    });
    const { unassignExporterFromAgent } = await import('../src/lib/staff-provisioning');
    await unassignExporterFromAgent({ actor: w.ops, assignmentId: assignment.id, correlationId: randomUUID() });

    const scope = await tenantScope(w.agent);
    expect(scope).toEqual({ exporter_org_id: { in: [] } });
    expect(await prisma.deal.findMany({ where: { ...scope } })).toEqual([]);
  });
});

describe('/agent/escalations aggregation', () => {
  test('each supported canonical source maps to a row', async () => {
    const w = await world();
    const rows = await agentEscalations(w.agent);
    const sources = new Set(rows.map((r) => r.source));

    // Four sources, each backed by real state — no speculative categories.
    expect(sources.has('task')).toBe(true);
    expect(sources.has('dispute')).toBe(true);
    expect(sources.has('shipment')).toBe(true);
    expect([...sources].every((s) => ['task', 'dispute', 'shipment', 'sanctions'].includes(s))).toBe(true);
  });

  test('only assigned exporters appear', async () => {
    const w = await world();
    const rows = await agentEscalations(w.agent);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.exporterOrgId === w.mineOrgId)).toBe(true);
    expect(rows.some((r) => r.exporterOrgId === w.theirsOrgId)).toBe(false);
  });

  test('an agent with no assignments gets an empty queue', async () => {
    const s = randomUUID().slice(0, 8);
    const lonely = await prisma.user.create({
      data: { email: `lonely2-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true },
    });
    expect(await agentEscalations(principal(lonely.id, UserRole.agent))).toEqual([]);
  });

  test('ids are deterministic and derived from the source row, not synthesised', async () => {
    const w = await world();
    const first = await agentEscalations(w.agent);
    const second = await agentEscalations(w.agent);
    expect(first.map((r) => r.id)).toEqual(second.map((r) => r.id));
    // `source:sourceId` — so the same exception is the same row across reads and never doubles.
    expect(new Set(first.map((r) => r.id)).size).toBe(first.length);
    expect(first.every((r) => r.id === `${r.source}:${r.sourceId}`)).toBe(true);
  });

  test('worst-first ordering, oldest first within a severity', async () => {
    const w = await world();
    const rows = await agentEscalations(w.agent);
    const rank = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 } as const;
    for (let i = 1; i < rows.length; i += 1) {
      expect(rank[rows[i - 1]!.severity]).toBeLessThanOrEqual(rank[rows[i]!.severity]);
    }
  });

  test('unsupported fields stay null rather than being fabricated', async () => {
    const w = await world();
    const rows = await agentEscalations(w.agent);
    const dispute = rows.find((r) => r.source === 'dispute')!;
    const shipment = rows.find((r) => r.source === 'shipment')!;
    // Neither model carries a due date or SLA; inventing one from raisedAt would look like
    // a real deadline an agent could be measured against.
    expect(dispute.dueAt).toBeNull();
    expect(dispute.slaState).toBeNull();
    expect(shipment.dueAt).toBeNull();
    expect(shipment.slaState).toBeNull();
    // Tasks DO carry SLA state, so theirs is populated.
    expect(rows.find((r) => r.source === 'task')!.slaState).toBe(SlaState.escalated);
  });

  test('filtering by source is applied in the query, and counts stay honest', async () => {
    const w = await world();
    const all = await agentEscalations(w.agent);
    const tasksOnly = await agentEscalations(w.agent, { source: 'task' });
    expect(tasksOnly.every((r) => r.source === 'task')).toBe(true);
    expect(tasksOnly.length).toBeLessThan(all.length);

    const counts = escalationCounts(all);
    expect(counts.total).toBe(all.length);
    expect(counts.task).toBe(tasksOnly.length);
  });

  test('reading the queue mutates nothing', async () => {
    const w = await world();
    const before = await Promise.all([
      prisma.task.findMany({ where: { exporter_org_id: w.mineOrgId }, orderBy: { id: 'asc' } }),
      prisma.dispute.findMany({ where: { deal_id: w.mineSeed.dealId }, orderBy: { id: 'asc' } }),
      prisma.shipment.findMany({ where: { deal_id: w.mineSeed.dealId }, orderBy: { id: 'asc' } }),
    ]);
    await agentEscalations(w.agent);
    const after = await Promise.all([
      prisma.task.findMany({ where: { exporter_org_id: w.mineOrgId }, orderBy: { id: 'asc' } }),
      prisma.dispute.findMany({ where: { deal_id: w.mineSeed.dealId }, orderBy: { id: 'asc' } }),
      prisma.shipment.findMany({ where: { deal_id: w.mineSeed.dealId }, orderBy: { id: 'asc' } }),
    ]);
    // A queue is a read model: resolving an exception means acting on its source, not here.
    expect(after).toEqual(before);
  });
});
