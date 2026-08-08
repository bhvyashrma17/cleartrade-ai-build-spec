/** AGT-01 — an agent's SLA-ordered command centre. */

import Link from 'next/link';
import { BuyerLeadStage, RiskState, SlaState, TaskState, Visibility } from '@prisma/client';
import { MetricCard, StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { assignedOrgIds } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const taskTone = (sla: SlaState) => sla === SlaState.escalated || sla === SlaState.overdue ? 'critical' : sla === SlaState.due_soon ? 'warning' : 'info';
const taskLabel = (sla: SlaState) => ({ on_time: 'On time', due_soon: 'Due soon', overdue: 'Overdue', escalated: 'Escalated' })[sla];

/**
 * AGT-01-AC01 requires a due time on EVERY queue item. A task with no due_at must say so
 * explicitly rather than render an empty gap — "no due date" is itself information the
 * agent needs (docs/00 §7: name the state, never leave it blank).
 */
const formatDue = (due: Date | null) =>
  due ? `Due ${due.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'No due date set';

export default async function AgentMyDayPage() {
  const principal = await requirePortalAccess('/agent');
  const orgIds = await assignedOrgIds(principal);
  const activeStates = { notIn: [TaskState.done, TaskState.cancelled] };
  const [urgentTasks, assignedExporters, activeLeads, activeDeals, blockedDeals, followUps, executionTasks, risks] = await Promise.all([
    prisma.task.findMany({ where: { owner_user_id: principal.id, state: activeStates, OR: [{ sla_state: { in: [SlaState.escalated, SlaState.overdue, SlaState.due_soon] } }, { blocked_reason: { not: null } }] }, orderBy: [{ sla_state: 'desc' }, { due_at: 'asc' }], take: 8, include: { exporter_org: true, deal: true, owner: { select: { name: true } } } }),
    prisma.exporterOrg.count({ where: { id: { in: orgIds } } }),
    prisma.buyerLead.count({ where: { exporter_org_id: { in: orgIds }, stage: { in: [BuyerLeadStage.new, BuyerLeadStage.shortlisted, BuyerLeadStage.contacted, BuyerLeadStage.replied, BuyerLeadStage.interested, BuyerLeadStage.negotiation] } } }),
    prisma.deal.count({ where: { exporter_org_id: { in: orgIds }, stage: { in: ['qualifying', 'negotiating', 'terms_agreed', 'deal_locked', 'executing'] } } }),
    prisma.deal.count({ where: { exporter_org_id: { in: orgIds }, risk_state: { in: [RiskState.at_risk, RiskState.blocked] } } }),
    prisma.buyerLead.findMany({ where: { exporter_org_id: { in: orgIds }, stage: { in: [BuyerLeadStage.contacted, BuyerLeadStage.replied, BuyerLeadStage.interested, BuyerLeadStage.negotiation] }, next_action_at: { not: null } }, orderBy: { next_action_at: 'asc' }, take: 5, include: { buyer: true, exporter_org: true } }),
    prisma.task.findMany({ where: { owner_user_id: principal.id, state: activeStates, deal_id: { not: null } }, orderBy: [{ sla_state: 'desc' }, { due_at: 'asc' }], take: 5, include: { deal: true, exporter_org: true } }),
    prisma.deal.findMany({ where: { exporter_org_id: { in: orgIds }, risk_state: { in: [RiskState.at_risk, RiskState.blocked] } }, orderBy: { updated_at: 'asc' }, take: 5, include: { exporter_org: true } }),
  ]);

  return <div className="mx-auto max-w-7xl p-4 md:p-6">
    <header className="mb-6"><p className="text-sm font-medium text-primary">Agent workspace</p><h1 className="text-2xl font-semibold text-primary">My Day</h1><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Prioritized by escalation, SLA and risk.</p></header>
    <section aria-label="Portfolio summary" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricCard label="Assigned exporters" value={assignedExporters} /><MetricCard label="Due today / overdue" value={urgentTasks.length} secondaryText="Your active urgent queue" /><MetricCard label="Active deals" value={activeDeals} /><MetricCard label="At risk" value={blockedDeals} secondaryText="Blocked or at risk" /></section>
    <div className="mt-6 grid gap-6 xl:grid-cols-5">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-3"><h2 className="text-lg font-semibold text-primary">Today queue</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Escalated, overdue, due soon and blocked work.</p>{urgentTasks.length === 0 ? <p className="mt-4 rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">No urgent work. Keep an eye on your upcoming follow-ups and portfolio health below.</p> : <ul className="mt-4 divide-y divide-[var(--color-border)]">{urgentTasks.map((task) => <li key={task.id} className="flex items-center justify-between gap-4 py-3"><div><p className="font-medium text-primary">{task.title}</p><p className="text-sm text-[var(--color-text-secondary)]">{task.exporter_org?.display_name ?? task.deal_id ?? 'Assigned work'}{task.blocked_reason ? ` · Blocked: ${task.blocked_reason}` : ''}</p><p className="mt-1 text-xs text-[var(--color-text-muted)]">Owner: {task.owner?.name ?? 'Unassigned'} · {formatDue(task.due_at)}</p></div><div className="flex shrink-0 items-center gap-2">{task.visibility === Visibility.internal ? <StatusChip label="Internal" tone="neutral" icon="block" size="sm" detail="Internal task — not visible to the exporter." /> : <StatusChip label="Exporter-visible" tone="info" icon="dot" size="sm" detail="This task is visible to the exporter." />}<StatusChip label={taskLabel(task.sla_state)} tone={taskTone(task.sla_state)} icon={task.sla_state === SlaState.on_time ? 'clock' : 'alert'} size="sm" /></div></li>)}</ul>}</section>
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-2"><h2 className="text-lg font-semibold text-primary">Risk panel</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Open the relevant workspace to take action.</p>{risks.length === 0 ? <p className="mt-4 text-sm text-[var(--color-text-secondary)]">No assigned exporters or deals are at risk.</p> : <ul className="mt-4 space-y-3">{risks.map((deal) => <li key={deal.id}><Link href={`/agent/deals/${deal.id}`} className="focus-visible-ring block rounded"><p className="font-medium text-primary">{deal.exporter_org.display_name}</p><p className="text-sm text-[var(--color-text-secondary)]">{deal.risk_reason ?? 'Risk needs review'}</p></Link></li>)}</ul>}</section>
    </div>
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Follow-up lane</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Buyer outreach with a scheduled next touch.</p>{followUps.length === 0 ? <p className="mt-4 text-sm text-[var(--color-text-secondary)]">No follow-ups are scheduled for your assigned accounts.</p> : <ul className="mt-4 space-y-3">{followUps.map((lead) => <li key={lead.id} className="border-b border-[var(--color-border)] pb-3 last:border-0"><Link href={`/agent/leads/${lead.id}`} className="focus-visible-ring font-medium text-primary">{lead.buyer.display_name}</Link><p className="text-sm text-[var(--color-text-secondary)]">{lead.exporter_org.display_name} · next touch {lead.next_action_at?.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p></li>)}</ul>}</section>
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card"><h2 className="text-lg font-semibold text-primary">Execution lane</h2><p className="mt-1 text-sm text-[var(--color-text-secondary)]">Document, shipment and payment work for active deals.</p>{executionTasks.length === 0 ? <p className="mt-4 text-sm text-[var(--color-text-secondary)]">No active execution tasks are assigned to you.</p> : <ul className="mt-4 space-y-3">{executionTasks.map((task) => <li key={task.id} className="border-b border-[var(--color-border)] pb-3 last:border-0"><p className="font-medium text-primary">{task.title}</p><p className="text-sm text-[var(--color-text-secondary)]">{task.blocked_reason ? `Blocked: ${task.blocked_reason}` : task.exporter_org?.display_name ?? 'Deal work'}</p></li>)}</ul>}</section>
    </div>
    <p className="mt-5 text-sm text-[var(--color-text-secondary)]">{activeLeads} active leads across your assigned exporters.</p>
  </div>;
}
