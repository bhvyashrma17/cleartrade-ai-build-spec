/**
 * Agent escalations — an aggregation over existing canonical exception state.
 *
 * Deliberately NOT a new `Escalation` table. The audit found four models that already represent
 * exceptions, each with a real state field the rest of the product reads and writes:
 *
 *   Task                   sla_state ∈ {overdue, escalated}, or a blocked_reason
 *   Dispute                status ∈ open..proposed_resolution, with a severity
 *   Shipment               exception_state ∈ {watch, blocked}, with a reason
 *   SanctionsScreeningCase result_state ∈ possible/confirmed match, insufficient coverage
 *
 * Copying those into a second canonical table would create two places where "is this resolved?"
 * is answered, and they would disagree the first time one was updated without the other. So this
 * is a read model: every row points back at the source of truth, and closing an exception means
 * changing that source, not this.
 *
 * Only categories backed by real state are exposed. Nothing here invents a "payment exception"
 * or "document exception" category that no column supports — an empty category an agent learns
 * to ignore is worse than an absent one.
 */

import { DisputeStatus, ExceptionState, SlaState, TaskState } from '@prisma/client';
import { tenantScope } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export type EscalationSource = 'task' | 'dispute' | 'shipment' | 'sanctions';

/** Ordered worst-first. Used for sorting; never invented where the source has no severity. */
export type EscalationSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unknown';

const SEVERITY_RANK: Record<EscalationSeverity, number> = {
  critical: 0, high: 1, medium: 2, low: 3, unknown: 4,
};

export interface EscalationRow {
  /** Stable across reads: source plus the source row's own id. No synthetic identity. */
  id: string;
  source: EscalationSource;
  sourceId: string;
  exporterOrgId: string;
  exporterName: string;
  /** What happened, in the source's own words where it has any. */
  title: string;
  detail: string | null;
  severity: EscalationSeverity;
  /** Null where the source genuinely tracks no owner — not defaulted to the reader. */
  ownerName: string | null;
  raisedAt: Date;
  /** Null where the source has no due date. Never derived from raisedAt. */
  dueAt: Date | null;
  /** Present only for sources that actually carry SLA state. */
  slaState: SlaState | null;
  state: string;
  /** Where to go to act on it, in the existing surfaces. */
  href: string | null;
}

export interface EscalationFilters {
  source?: EscalationSource;
  severity?: EscalationSeverity;
  exporterOrgId?: string;
}

/**
 * Load the agent's exception queue across every assigned exporter.
 *
 * Scoping is `tenantScope`, the same fragment every other cross-org list uses: an agent gets
 * `{ exporter_org_id: { in: assignedOrgIds } }`, which matches nothing when they hold no
 * assignments — never an unscoped read. Filtering happens in the query, not after fetching.
 */
export async function agentEscalations(
  principal: Principal,
  filters: EscalationFilters = {},
): Promise<EscalationRow[]> {
  const scope = await tenantScope(principal);
  // An agent with no assignments yields `{ in: [] }`, which matches nothing. Short-circuiting
  // avoids four pointless round trips for the common empty case.
  if ('exporter_org_id' in scope && typeof scope.exporter_org_id === 'object'
      && scope.exporter_org_id && 'in' in scope.exporter_org_id
      && (scope.exporter_org_id.in as string[]).length === 0) {
    return [];
  }
  const orgFilter = filters.exporterOrgId ? { exporter_org_id: filters.exporterOrgId } : {};

  const [tasks, disputes, shipments, sanctions] = await Promise.all([
    filters.source && filters.source !== 'task' ? [] : prisma.task.findMany({
      where: {
        ...scope, ...orgFilter,
        state: { notIn: [TaskState.done, TaskState.cancelled] },
        OR: [{ sla_state: { in: [SlaState.overdue, SlaState.escalated] } }, { blocked_reason: { not: null } }],
      },
      select: {
        id: true, title: true, blocked_reason: true, sla_state: true, due_at: true, created_at: true,
        state: true, exporter_org_id: true, deal_id: true,
        exporter_org: { select: { display_name: true } },
        owner: { select: { name: true } },
      },
    }),
    // Dispute carries no exporter_org_id of its own — it reaches a tenant through its Deal.
    // Disputes with no deal (scope_type/scope_id based) are therefore not represented here;
    // including them would require resolving a polymorphic scope, and guessing the tenant is
    // exactly the kind of fabrication this queue must not do. Noted rather than silently
    // dropped: see the module docblock.
    filters.source && filters.source !== 'dispute' ? [] : prisma.dispute.findMany({
      where: {
        deal: { ...scope, ...orgFilter },
        status: { in: [DisputeStatus.open, DisputeStatus.investigating, DisputeStatus.waiting_external, DisputeStatus.proposed_resolution] },
      },
      select: {
        id: true, type: true, severity: true, status: true, summary: true, created_at: true, deal_id: true,
        owner: { select: { name: true } },
        deal: { select: { exporter_org_id: true, exporter_org: { select: { display_name: true } } } },
      },
    }),
    filters.source && filters.source !== 'shipment' ? [] : prisma.shipment.findMany({
      where: {
        exception_state: { in: [ExceptionState.watch, ExceptionState.blocked] },
        deal: { ...scope, ...orgFilter },
      },
      select: {
        id: true, exception_state: true, exception_reason: true, status: true, updated_at: true, created_at: true,
        deal: { select: { id: true, exporter_org_id: true, exporter_org: { select: { display_name: true } } } },
      },
    }),
    filters.source && filters.source !== 'sanctions' ? [] : prisma.sanctionsScreeningCase.findMany({
      where: {
        result_state: { in: ['possible_match', 'confirmed_match', 'insufficient_screening_coverage'] },
        // Sanctions cases are buyer-scoped; reach the tenant through the buyer's leads so the
        // same assignment boundary applies.
        buyer: { buyer_leads: { some: { ...scope, ...orgFilter } } },
      },
      select: {
        id: true, result_state: true, created_at: true, algorithm_version: true,
        buyer: {
          select: {
            display_name: true,
            buyer_leads: { where: { ...scope }, select: { exporter_org_id: true, exporter_org: { select: { display_name: true } } }, take: 1 },
          },
        },
      },
    }),
  ]);

  const rows: EscalationRow[] = [
    ...tasks.map((t): EscalationRow => ({
      id: `task:${t.id}`, source: 'task', sourceId: t.id,
      exporterOrgId: t.exporter_org_id ?? '', exporterName: t.exporter_org?.display_name ?? 'Unknown',
      title: t.title,
      detail: t.blocked_reason,
      // Escalated outranks overdue; a blocked-but-on-time task is a medium, not an emergency.
      severity: t.sla_state === SlaState.escalated ? 'critical' : t.sla_state === SlaState.overdue ? 'high' : 'medium',
      ownerName: t.owner?.name ?? null,
      raisedAt: t.created_at, dueAt: t.due_at, slaState: t.sla_state, state: t.state,
      href: t.deal_id ? `/agent/deals/${t.deal_id}` : '/agent/tasks',
    })),
    ...disputes.map((d): EscalationRow => ({
      id: `dispute:${d.id}`, source: 'dispute', sourceId: d.id,
      exporterOrgId: d.deal?.exporter_org_id ?? '', exporterName: d.deal?.exporter_org?.display_name ?? 'Unknown',
      title: `Dispute: ${String(d.type).replaceAll('_', ' ')}`,
      detail: d.summary,
      severity: d.severity as EscalationSeverity,
      ownerName: d.owner?.name ?? null,
      raisedAt: d.created_at, dueAt: null, slaState: null, state: d.status,
      href: d.deal_id ? `/agent/deals/${d.deal_id}` : null,
    })),
    ...shipments.map((s): EscalationRow => ({
      id: `shipment:${s.id}`, source: 'shipment', sourceId: s.id,
      exporterOrgId: s.deal.exporter_org_id, exporterName: s.deal.exporter_org?.display_name ?? 'Unknown',
      title: `Shipment ${s.exception_state}`,
      detail: s.exception_reason,
      severity: s.exception_state === ExceptionState.blocked ? 'critical' : 'medium',
      // Shipment stores exception_owner_id with no named relation, so a name would need a
      // second lookup. Null is honest; the deal workspace shows the owner.
      ownerName: null,
      raisedAt: s.created_at, dueAt: null, slaState: null, state: s.status,
      href: `/agent/deals/${s.deal.id}`,
    })),
    ...sanctions.map((c): EscalationRow => {
      const lead = c.buyer?.buyer_leads[0];
      return {
        id: `sanctions:${c.id}`, source: 'sanctions', sourceId: c.id,
        exporterOrgId: lead?.exporter_org_id ?? '',
        exporterName: lead?.exporter_org?.display_name ?? 'Unknown',
        title: `Sanctions: ${String(c.result_state).replaceAll('_', ' ')}`,
        detail: `${c.buyer?.display_name ?? 'Buyer'} · ${c.algorithm_version}`,
        severity: c.result_state === 'confirmed_match' ? 'critical'
          : c.result_state === 'possible_match' ? 'high' : 'medium',
        ownerName: null,
        raisedAt: c.created_at, dueAt: null, slaState: null, state: c.result_state,
        href: null,
      };
    }),
  ];

  const filtered = filters.severity ? rows.filter((r) => r.severity === filters.severity) : rows;

  // Worst first, then oldest — an agent works the top of this list, so the ordering is the
  // product. Ties break on id so the queue does not reshuffle between refreshes.
  return filtered.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || a.raisedAt.getTime() - b.raisedAt.getTime()
    || a.id.localeCompare(b.id));
}

/** Counts per source, for the queue header. Computed from the same rows the list shows. */
export function escalationCounts(rows: EscalationRow[]): Record<EscalationSource | 'total', number> {
  return {
    total: rows.length,
    task: rows.filter((r) => r.source === 'task').length,
    dispute: rows.filter((r) => r.source === 'dispute').length,
    shipment: rows.filter((r) => r.source === 'shipment').length,
    sanctions: rows.filter((r) => r.source === 'sanctions').length,
  };
}
