/** OPS-01 — portfolio-wide flow and exception monitoring. */

import Link from 'next/link';
import { RiskState, SlaState, TaskState, UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { EmptyState, MetricCard, PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const stages = [
  ['onboarding', 'Onboarding'], ['ready', 'Ready'], ['market_selected', 'Market selected'],
  ['buyer_engaged', 'Buyer engaged'], ['deal_locked', 'Deal locked'], ['docs_cleared', 'Docs cleared'],
  ['shipped', 'Shipped'], ['payment_realized', 'Payment realized'],
] as const;

const age = (date: Date) => {
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

export default async function OpsControlTowerPage() {
  const principal = await requirePortalAccess('/ops');
  // Finance has a focused queue; it must not receive portfolio-wide operational data.
  if (!( [UserRole.ops_supervisor, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="The Operations Control Tower is available to Ops supervisors and administrators." />;
  }

  const now = new Date();
  const [blockedDeals, overdueSlas, unassignedExporters, rejectedDocs, shipmentExceptions, overduePayments, openDisputes, stageGroups, riskDeals, riskShipments, agents, escalatedTasks] = await Promise.all([
    prisma.deal.count({ where: { risk_state: RiskState.blocked } }),
    prisma.task.count({ where: { state: { notIn: [TaskState.done, TaskState.cancelled] }, sla_state: { in: [SlaState.overdue, SlaState.escalated] } } }),
    prisma.exporterOrg.count({ where: { assigned_agent_id: null } }),
    prisma.document.count({ where: { OR: [{ approval_status: 'rejected' }, { filing_status: 'rejected' }] } }),
    prisma.shipment.count({ where: { exception_state: { not: 'none' } } }),
    prisma.payment.count({ where: { due_at: { lt: now }, received_at: null } }),
    prisma.dispute.count({ where: { status: { notIn: ['resolved', 'closed'] } } }),
    prisma.exporterOrg.groupBy({ by: ['journey_stage'], _count: { _all: true } }),
    prisma.deal.findMany({ where: { risk_state: { in: [RiskState.at_risk, RiskState.blocked] } }, orderBy: [{ risk_state: 'desc' }, { updated_at: 'asc' }], take: 8, include: { exporter_org: true, owner_agent: true } }),
    prisma.shipment.findMany({ where: { exception_state: { not: 'none' } }, orderBy: { updated_at: 'asc' }, take: 8, include: { deal: { include: { exporter_org: true, owner_agent: true } } } }),
    prisma.user.findMany({ where: { role: UserRole.agent, is_active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, _count: { select: { agent_assignments: { where: { status: 'active' } }, owned_deals: { where: { stage: { in: ['qualifying', 'negotiating', 'terms_agreed', 'deal_locked', 'executing'] } } }, owned_tasks: { where: { state: { notIn: ['done', 'cancelled'] }, sla_state: { in: ['overdue', 'escalated'] } } } } } } }),
    prisma.task.findMany({ where: { escalated_at: { not: null }, state: { notIn: [TaskState.done, TaskState.cancelled] } }, orderBy: { escalated_at: 'desc' }, take: 6, include: { owner: true, exporter_org: true, deal: true } }),
  ]);

  const stageCounts = new Map(stageGroups.map((row) => [row.journey_stage, row._count._all]));
  const riskItems = [
    ...riskDeals.map((deal) => ({ id: deal.id, ref: `Deal ${deal.id.slice(-6)}`, issue: deal.risk_reason ?? 'Deal needs review', category: 'Deal', owner: deal.owner_agent?.name ?? 'Unassigned', created: deal.updated_at, tone: deal.risk_state === RiskState.blocked ? 'critical' as const : 'warning' as const })),
    ...riskShipments.map((shipment) => ({ id: shipment.id, ref: `Shipment ${shipment.id.slice(-6)}`, issue: shipment.exception_reason ?? 'Shipment exception', category: 'CHA', owner: shipment.deal.owner_agent?.name ?? 'Unassigned', created: shipment.updated_at, tone: 'critical' as const })),
  ].sort((a, b) => a.created.getTime() - b.created.getTime()).slice(0, 8);

  const metrics: [string, number, string][] = [
    ['Blocked deals', blockedDeals, '/ops/exceptions?type=blocked_deals'], ['Overdue SLAs', overdueSlas, '/ops/exceptions?type=overdue_sla'],
    ['Unassigned exporters', unassignedExporters, '/ops/assignments'], ['Documents rejected', rejectedDocs, '/ops/exceptions?type=rejected_docs'],
    ['Shipment exceptions', shipmentExceptions, '/ops/exceptions?type=shipment_exceptions'], ['Overdue payments', overduePayments, '/ops/finance?filter=overdue'],
    ['Open disputes', openDisputes, '/ops/disputes'],
  ];

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader
        className="mb-6"
        actionsAlign="end"
        eyebrow="Operations"
        title="Control Tower"
        description="Portfolio flow, ownership and exceptions."
        actions={
          <StatusChip label={riskItems.length ? 'Attention needed' : 'Healthy portfolio'} tone={riskItems.length ? 'warning' : 'positive'} icon={riskItems.length ? 'alert' : 'check'} />
        }
      />

      <section aria-label="Exception KPIs" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, href]) => <Link key={label} href={href} className="focus-visible-ring rounded-lg"><MetricCard label={label} value={value} secondaryText="Open filtered queue" /></Link>)}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-5">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-3">
          <h2 className="text-lg font-semibold text-primary">Risk queue</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Highest severity and oldest first.</p>
          {riskItems.length === 0 ? <EmptyState bordered title="Healthy portfolio — no active risks or shipment exceptions. New and aging work will appear here." /> : <div className="mt-4 overflow-x-auto"><Table className="min-w-[600px]"><Thead className="text-xs uppercase text-[var(--color-text-muted)]"><Tr><Th>Reference</Th><Th>Issue</Th><Th>Category</Th><Th>Owner</Th><Th>Age</Th></Tr></Thead><Tbody>{riskItems.map((item) => <Tr key={item.id}><Td className="font-medium text-primary">{item.ref}</Td><Td><StatusChip label={item.issue} tone={item.tone} icon="alert" size="sm" /></Td><Td className="text-[var(--color-text-secondary)]">{item.category}</Td><Td className="text-[var(--color-text-secondary)]">{item.owner}</Td><Td className="text-[var(--color-text-secondary)]">{age(item.created)}</Td></Tr>)}</Tbody></Table></div>}
        </section>
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-2"><h2 className="text-lg font-semibold text-primary">Stage funnel</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Exporter journey stages, not activity volume.</p><ol className="mt-4 space-y-3">{stages.map(([stage, label]) => { const count = stageCounts.get(stage) ?? 0; return <li key={stage} className="flex items-center gap-3"><span className="w-28 text-sm text-[var(--color-text-secondary)]">{label}</span><div className="h-2 flex-1 overflow-hidden rounded bg-surface-muted"><div className="h-full rounded bg-action" style={{ width: `${Math.min(100, Math.max(0, count * 20))}%` }} /></div><span className="w-5 text-right text-sm font-semibold text-primary">{count}</span></li>; })}</ol></section>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Agent capacity</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Advisory load signal — not a hard cap.</p>{agents.length === 0 ? <EmptyState bordered title="No active agents are available for assignment." /> : <div className="mt-4 space-y-3">{agents.map((agent) => <div key={agent.id} className="flex items-center justify-between border-b border-[var(--color-border)] pb-3 text-sm last:border-0"><span className="font-medium text-primary">{agent.name}</span><span className="text-[var(--color-text-secondary)]">{agent._count.agent_assignments} exporters · {agent._count.owned_deals} active deals · {agent._count.owned_tasks} overdue</span></div>)}</div>}</section>
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Recent escalations</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Open items awaiting an Ops decision.</p>{escalatedTasks.length === 0 ? <EmptyState bordered title="No open escalations. Escalated tasks will be listed here with their owner and context." /> : <ul className="mt-4 space-y-3">{escalatedTasks.map((task) => <li key={task.id} className="border-b border-[var(--color-border)] pb-3 last:border-0"><p className="font-normal text-primary">{task.title}</p><p className="mt-1 text-sm text-[var(--color-text-secondary)]">{task.owner?.name ?? 'Unassigned'} · {task.exporter_org?.display_name ?? task.deal_id ?? 'Portfolio'} · escalated {task.escalated_at ? age(task.escalated_at) : 'recently'} ago</p></li>)}</ul>}</section>
      </div>
    </div>
  );
}
