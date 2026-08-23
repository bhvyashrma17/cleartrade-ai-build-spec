/**
 * `/agent/deals` — the agent's cross-exporter deal queue.
 *
 * A working list, not a second deal workspace: every row links into the existing
 * `/agent/deals/[dealId]` detail route rather than reproducing it. The nav has pointed here
 * since the portal was built and 404'd until now.
 *
 * Scoping is `tenantScope()`, the same fragment every other cross-org list uses — an agent gets
 * `{ exporter_org_id: { in: assignedOrgIds } }`, which matches nothing when they hold no
 * assignments. The filter is applied in the query, never after fetching, so an unassigned
 * exporter's deals never leave the database.
 *
 * Filters map to real `DealStage` and `RiskState` values only. "Waiting on buyer" and
 * "documents pending" are not offered, because no column distinguishes them today and a filter
 * that silently returns the wrong set is worse than an absent one.
 */

import Link from 'next/link';
import { DealStage, RiskState } from '@prisma/client';
import { PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { tenantScope } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { DEAL_STAGE_LABELS } from '@/lib/state-machines/deal';

const ACTIVE_STAGES: DealStage[] = [
  DealStage.qualifying, DealStage.negotiating, DealStage.terms_agreed,
  DealStage.deal_locked, DealStage.executing,
];

/** Only filters the current model genuinely supports. */
const FILTERS = [
  { key: 'active', label: 'Active' },
  { key: 'blocked', label: 'Blocked / at risk' },
  { key: 'negotiating', label: 'Negotiating' },
  { key: 'executing', label: 'Executing' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function whereForFilter(filter: FilterKey) {
  switch (filter) {
    case 'blocked': return { risk_state: { in: [RiskState.at_risk, RiskState.blocked] } };
    case 'negotiating': return { stage: { in: [DealStage.negotiating, DealStage.terms_agreed] } };
    case 'executing': return { stage: { in: [DealStage.deal_locked, DealStage.executing] } };
    case 'closed': return { stage: { notIn: ACTIVE_STAGES } };
    case 'all': return {};
    case 'active':
    default: return { stage: { in: ACTIVE_STAGES } };
  }
}

const fmtDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d) : '—';

const money = (amount: unknown, currency: string | null) =>
  amount == null ? '—' : `${currency ?? ''} ${String(amount)}`.trim();

/** Age in whole days, from a real timestamp. Not an SLA — deals carry no SLA column. */
function ageDays(from: Date): number {
  return Math.max(0, Math.floor((Date.now() - from.getTime()) / 86_400_000));
}

export default async function AgentDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const principal = await requirePortalAccess('/agent');
  const { filter } = await searchParams;
  const active = (FILTERS.find((f) => f.key === filter)?.key ?? 'active') as FilterKey;

  const scope = await tenantScope(principal);
  const deals = await prisma.deal.findMany({
    where: { ...scope, ...whereForFilter(active) },
    orderBy: [{ risk_state: 'desc' }, { updated_at: 'desc' }],
    take: 200,
    select: {
      id: true, stage: true, risk_state: true, risk_reason: true,
      total_amount: true, total_currency: true, value_amount: true, value_currency: true,
      incoterm: true, updated_at: true, created_at: true, closed_reason: true,
      exporter_org: { select: { id: true, display_name: true } },
      buyer: { select: { display_name: true, country_code: true } },
      product: { select: { name: true } },
      owner_agent: { select: { name: true } },
      // The most recent open task doubles as "next action" — the only real source for it.
      tasks: {
        where: { state: { notIn: ['done', 'cancelled'] } },
        orderBy: [{ sla_state: 'desc' }, { due_at: 'asc' }],
        take: 1,
        select: { title: true, sla_state: true, due_at: true },
      },
    },
  });

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader
        className="mb-4"
        eyebrow="Agent workspace"
        title="Deals"
        description="Every deal across your assigned exporters. At-risk first, then most recently updated."
      />

      <nav aria-label="Deal filters" className="mb-3 flex flex-wrap gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/agent/deals?filter=${f.key}`}
            aria-current={active === f.key ? 'page' : undefined}
            className={`focus-visible-ring rounded border px-2.5 py-1 text-xs font-medium ${
              active === f.key
                ? 'border-primary bg-primary text-[var(--color-text-inverse)]'
                : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-surface-muted'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {deals.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-10 text-center text-sm text-[var(--color-text-secondary)]">
          No deals match this filter across your assigned exporters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
          <Table className="min-w-[60rem]">
            <Thead>
              <Tr>
                <Th>Exporter / buyer</Th>
                <Th>Product</Th>
                <Th>Stage</Th>
                <Th align="right">Value</Th>
                <Th>Next action</Th>
                <Th>Risk</Th>
                <Th align="right">Age</Th>
              </Tr>
            </Thead>
            <Tbody>
              {deals.map((deal) => {
                const next = deal.tasks[0] ?? null;
                const atRisk = deal.risk_state === RiskState.at_risk || deal.risk_state === RiskState.blocked;
                return (
                  <Tr key={deal.id} className="align-top hover:bg-surface-muted">
                    <Td>
                      {/* Into the EXISTING deal workspace — this page never duplicates it. */}
                      <Link href={`/agent/deals/${deal.id}`} className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
                        {deal.exporter_org.display_name}
                      </Link>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {deal.buyer.display_name} · {deal.buyer.country_code}
                      </div>
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">{deal.product?.name ?? '—'}</Td>
                    <Td className="text-primary">{DEAL_STAGE_LABELS[deal.stage] ?? deal.stage}</Td>
                    <Td align="right" className="text-primary">
                      {money(deal.total_amount ?? deal.value_amount, deal.total_currency ?? deal.value_currency)}
                      {deal.incoterm ? <div className="text-xs text-[var(--color-text-muted)]">{deal.incoterm}</div> : null}
                    </Td>
                    <Td>
                      {next ? (
                        <>
                          <div className="text-xs text-primary">{next.title}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            {next.due_at ? `due ${fmtDate(next.due_at)}` : 'no due date'} · {next.sla_state}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">No open task</span>
                      )}
                    </Td>
                    <Td>
                      {atRisk ? (
                        <StatusChip
                          label={deal.risk_state}
                          tone="critical"
                          icon="alert"
                          size="sm"
                          detail={deal.risk_reason ?? undefined}
                        />
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">Normal</span>
                      )}
                      {deal.risk_reason && atRisk ? (
                        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{deal.risk_reason}</div>
                      ) : null}
                    </Td>
                    <Td align="right" className="text-[var(--color-text-secondary)]">
                      {ageDays(deal.created_at)}d
                      <div className="text-xs text-[var(--color-text-muted)]">upd {fmtDate(deal.updated_at)}</div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      )}

      <p className="mt-2 text-xs text-[var(--color-text-muted)]">
        Owner column omitted where a deal records no owning agent — {deals.filter((d) => !d.owner_agent).length} of{' '}
        {deals.length} shown have none.
      </p>
    </div>
  );
}
