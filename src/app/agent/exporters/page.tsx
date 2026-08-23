/**
 * AGT-02 index — the agent's assigned exporters.
 *
 * The navigation entry point to Exporter 360. It existed in the agent nav but had no route,
 * so the link 404'd; this is that route.
 *
 * Deliberately narrow. An agent holds roughly ten exporters, so this is a triage list, not a
 * dashboard: who is assigned to me, what state are they in, and what needs me next. Anything
 * requiring a decision lives one click away in Exporter 360, where the full context is.
 *
 * Scoping is by `AgentAssignment`, not by a role check alone: `assignedOrgIds()` is the same
 * function `tenantScope()` uses, so this list can never show an org the agent's other queries
 * would refuse. Ops sees every org, by role rather than by omission.
 */

import Link from 'next/link';
import { DealStage, RiskState, SlaState, TaskState } from '@prisma/client';
import { PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { assignedOrgIds } from '@/lib/permissions';
import { isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const ACTIVE_DEAL_STAGES: DealStage[] = [
  DealStage.qualifying, DealStage.negotiating, DealStage.terms_agreed,
  DealStage.deal_locked, DealStage.executing,
];
const OPEN_TASK_STATES = { notIn: [TaskState.done, TaskState.cancelled] };

const JOURNEY_LABELS: Record<string, string> = {
  onboarding: 'Onboarding', ready: 'Ready', market_selected: 'Market selected',
  buyer_engaged: 'Buyer engaged', deal_locked: 'Deal locked', docs_cleared: 'Docs cleared',
  shipped: 'Shipped', payment_realized: 'Payment realized',
};

const fmt = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d) : '—';

/**
 * The single most useful thing to show per row: what is actually blocking this exporter.
 *
 * Ordered by urgency rather than by data availability — an escalated task outranks a stalled
 * deal, which outranks having no market selected. Returns null when nothing needs the agent,
 * which is a real and good state and should not be dressed up as a task.
 */
function nextAction(row: {
  escalated: number; overdue: number; atRisk: number; activeDeals: number;
  journey: string; selectedMarkets: number;
}): { label: string; tone: 'critical' | 'warning' | 'info' } | null {
  if (row.escalated > 0) return { label: `${row.escalated} escalated task${row.escalated === 1 ? '' : 's'}`, tone: 'critical' };
  if (row.atRisk > 0) return { label: `${row.atRisk} deal${row.atRisk === 1 ? '' : 's'} at risk`, tone: 'critical' };
  if (row.overdue > 0) return { label: `${row.overdue} overdue task${row.overdue === 1 ? '' : 's'}`, tone: 'warning' };
  if (row.selectedMarkets === 0) return { label: 'No market selected yet', tone: 'info' };
  if (row.activeDeals === 0) return { label: 'No active deal', tone: 'info' };
  return null;
}

export default async function AgentExportersPage() {
  const principal = await requirePortalAccess('/agent');
  const orgIds = isOps(principal) ? null : await assignedOrgIds(principal);

  const orgs = await prisma.exporterOrg.findMany({
    where: orgIds ? { id: { in: orgIds } } : {},
    orderBy: { display_name: 'asc' },
    select: {
      id: true, display_name: true, legal_name: true, tier: true,
      journey_stage: true, readiness_status: true, updated_at: true,
    },
  });

  // One grouped query per metric rather than N per org: an agent with ten exporters would
  // otherwise issue forty round trips to render one list.
  const ids = orgs.map((o) => o.id);
  const [tasks, deals, selected] = ids.length
    ? await Promise.all([
        prisma.task.groupBy({
          by: ['exporter_org_id', 'sla_state'],
          where: { exporter_org_id: { in: ids }, state: OPEN_TASK_STATES },
          _count: { _all: true },
        }),
        prisma.deal.groupBy({
          by: ['exporter_org_id', 'risk_state'],
          where: { exporter_org_id: { in: ids }, stage: { in: ACTIVE_DEAL_STAGES } },
          _count: { _all: true },
        }),
        prisma.marketAssessment.groupBy({
          by: ['product_id'],
          where: { is_selected: true, product: { exporter_org_id: { in: ids } } },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];

  // MarketAssessment reaches the org through Product, so resolve those ids back to orgs.
  const selectedProductIds = selected.map((s) => s.product_id).filter((id): id is string => Boolean(id));
  const productOrgs = selectedProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: selectedProductIds } },
        select: { id: true, exporter_org_id: true },
      })
    : [];
  const selectedByOrg = new Map<string, number>();
  for (const product of productOrgs) {
    selectedByOrg.set(product.exporter_org_id, (selectedByOrg.get(product.exporter_org_id) ?? 0) + 1);
  }

  // `Task.exporter_org_id` is nullable (a task need not belong to a tenant), so rows without
  // one are skipped rather than coerced — an unattributable task belongs in nobody's count.
  const countBy = <T extends { exporter_org_id: string | null; _count: { _all: number } }>(
    rows: T[], match: (row: T) => boolean,
  ) => {
    const out = new Map<string, number>();
    for (const row of rows) {
      if (!row.exporter_org_id || !match(row)) continue;
      out.set(row.exporter_org_id, (out.get(row.exporter_org_id) ?? 0) + row._count._all);
    }
    return out;
  };

  const escalated = countBy(tasks, (t) => t.sla_state === SlaState.escalated);
  const overdue = countBy(tasks, (t) => t.sla_state === SlaState.overdue);
  const atRisk = countBy(deals, (d) => d.risk_state === RiskState.at_risk || d.risk_state === RiskState.blocked);
  const activeDeals = countBy(deals, () => true);

  const rows = orgs.map((org) => {
    const stats = {
      escalated: escalated.get(org.id) ?? 0,
      overdue: overdue.get(org.id) ?? 0,
      atRisk: atRisk.get(org.id) ?? 0,
      activeDeals: activeDeals.get(org.id) ?? 0,
      journey: org.journey_stage as string,
      selectedMarkets: selectedByOrg.get(org.id) ?? 0,
    };
    return { org, stats, action: nextAction(stats) };
  });

  // Exporters needing attention first — the list is a work queue, not an alphabetical roster.
  const ordered = [...rows].sort((a, b) => {
    const weight = (r: typeof a) => (r.stats.escalated > 0 || r.stats.atRisk > 0 ? 0 : r.stats.overdue > 0 ? 1 : r.action ? 2 : 3);
    return weight(a) - weight(b) || a.org.display_name.localeCompare(b.org.display_name);
  });

  return (
    <div className="py-4 md:py-6">
      <PageHeader
        className="mb-6"
        eyebrow="Agent workspace"
        title="Exporters"
        description={
          isOps(principal)
            ? 'All exporter accounts. Ops sees every account by role.'
            : `${orgs.length} exporter${orgs.length === 1 ? '' : 's'} assigned to you. Needing attention first.`
        }
      />

      {orgs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
          No exporters are assigned to you yet. Ops assigns accounts from the assignments queue.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
          <Table>
            <Thead>
              <Tr>
                <Th>Exporter</Th>
                <Th>Journey</Th>
                <Th>Readiness</Th>
                <Th align="right">Active deals</Th>
                <Th align="right">Open tasks</Th>
                <Th>Needs you next</Th>
              </Tr>
            </Thead>
            <Tbody>
              {ordered.map(({ org, stats, action }) => (
                <Tr key={org.id} className="hover:bg-surface-muted">
                  <Td>
                    <Link href={`/agent/exporters/${org.id}`} className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
                      {org.display_name}
                    </Link>
                    <div className="text-xs text-[var(--color-text-muted)]">
                      {org.legal_name ?? '—'} · {org.tier} · updated {fmt(org.updated_at)}
                    </div>
                  </Td>
                  <Td className="text-primary">{JOURNEY_LABELS[stats.journey] ?? stats.journey}</Td>
                  <Td className="text-primary">{org.readiness_status}</Td>
                  <Td align="right" className="text-primary">{stats.activeDeals}</Td>
                  <Td align="right" className="text-primary">
                    {stats.escalated + stats.overdue > 0 ? (
                      <span className="text-critical">{stats.escalated + stats.overdue}</span>
                    ) : '—'}
                  </Td>
                  <Td>
                    {action ? (
                      <StatusChip
                        label={action.label}
                        tone={action.tone === 'critical' ? 'critical' : action.tone === 'warning' ? 'warning' : 'info'}
                        icon={action.tone === 'info' ? 'dot' : 'alert'}
                        size="sm"
                      />
                    ) : (
                      // A genuinely clear account is stated plainly rather than left blank —
                      // blank reads as missing data, not as "nothing needed".
                      <span className="text-xs text-[var(--color-text-muted)]">Nothing outstanding</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
