/** OPS-03 — Exceptions & Escalations queue, unified across domains (docs/06). */

import Link from 'next/link';
import { RiskState, SlaState, TaskState, UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type ExceptionType = 'blocked_deals' | 'overdue_sla' | 'rejected_docs' | 'shipment_exceptions';

const TABS: { key: ExceptionType | 'all'; label: string }[] = [
  { key: 'all', label: 'All exceptions' },
  { key: 'blocked_deals', label: 'Blocked deals' },
  { key: 'overdue_sla', label: 'Overdue SLAs' },
  { key: 'rejected_docs', label: 'Documents rejected' },
  { key: 'shipment_exceptions', label: 'Shipment exceptions' },
];

interface ExceptionRow {
  id: string;
  type: string;
  object: string;
  reason: string;
  category: string;
  owner: string;
  createdAt: Date;
  severity: 'critical' | 'warning';
}

const age = (date: Date) => {
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

function EmptyQueue({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

async function loadBlockedDeals(): Promise<ExceptionRow[]> {
  const deals = await prisma.deal.findMany({
    where: { risk_state: RiskState.blocked },
    orderBy: { updated_at: 'asc' },
    include: { exporter_org: true, owner_agent: true },
  });
  return deals.map((deal) => ({
    id: `deal-${deal.id}`,
    type: 'Deal blocked',
    object: `Deal ${deal.id.slice(-6)} · ${deal.exporter_org.display_name}`,
    reason: deal.risk_reason ?? 'Deal is blocked',
    category: 'Deal',
    owner: deal.owner_agent?.name ?? 'Unassigned',
    createdAt: deal.updated_at,
    severity: 'critical',
  }));
}

async function loadOverdueSla(): Promise<ExceptionRow[]> {
  const tasks = await prisma.task.findMany({
    where: { state: { notIn: [TaskState.done, TaskState.cancelled] }, sla_state: { in: [SlaState.overdue, SlaState.escalated] } },
    orderBy: [{ sla_state: 'desc' }, { due_at: 'asc' }],
    include: { owner: true, exporter_org: true, deal: true },
  });
  return tasks.map((task) => ({
    id: `task-${task.id}`,
    type: task.sla_state === SlaState.escalated ? 'Task escalated' : 'Task overdue',
    object: task.title,
    reason: task.blocked_reason ?? (task.due_at ? `Was due ${task.due_at.toLocaleDateString('en-IN')}` : 'SLA breached'),
    category: task.deal_id ? 'Deal' : 'Exporter',
    owner: task.owner?.name ?? 'Unassigned',
    createdAt: task.due_at ?? task.updated_at,
    severity: task.sla_state === SlaState.escalated ? 'critical' : 'warning',
  }));
}

async function loadRejectedDocs(): Promise<ExceptionRow[]> {
  const docs = await prisma.document.findMany({
    where: { OR: [{ approval_status: 'rejected' }, { filing_status: 'rejected' }] },
    orderBy: { updated_at: 'asc' },
    include: { deal: { include: { exporter_org: true, owner_agent: true } } },
  });
  return docs.map((doc) => ({
    id: `doc-${doc.id}`,
    type: 'Document rejected',
    object: `${doc.doc_type} v${doc.version} · ${doc.deal?.exporter_org.display_name ?? 'Unknown exporter'}`,
    reason: doc.rejection_reason ?? doc.changes_requested_reason ?? 'Rejected',
    category: 'Compliance',
    owner: doc.deal?.owner_agent?.name ?? 'Unassigned',
    createdAt: doc.updated_at,
    severity: 'critical',
  }));
}

async function loadShipmentExceptions(): Promise<ExceptionRow[]> {
  const shipments = await prisma.shipment.findMany({
    where: { exception_state: { not: 'none' } },
    orderBy: { updated_at: 'asc' },
    include: { deal: { include: { exporter_org: true, owner_agent: true } } },
  });
  return shipments.map((shipment) => ({
    id: `shipment-${shipment.id}`,
    type: 'Shipment exception',
    object: `Shipment ${shipment.id.slice(-6)} · ${shipment.deal.exporter_org.display_name}`,
    reason: shipment.exception_reason ?? 'Shipment exception',
    category: 'CHA',
    owner: shipment.deal.owner_agent?.name ?? 'Unassigned',
    createdAt: shipment.updated_at,
    severity: shipment.exception_state === 'blocked' ? 'critical' : 'warning',
  }));
}

export default async function OpsExceptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="The exceptions queue is available to Ops supervisors and administrators." />;
  }

  const { type } = await searchParams;
  const activeTab: ExceptionType | 'all' =
    type === 'blocked_deals' || type === 'overdue_sla' || type === 'rejected_docs' || type === 'shipment_exceptions'
      ? type
      : 'all';

  const loaders: Record<ExceptionType, () => Promise<ExceptionRow[]>> = {
    blocked_deals: loadBlockedDeals,
    overdue_sla: loadOverdueSla,
    rejected_docs: loadRejectedDocs,
    shipment_exceptions: loadShipmentExceptions,
  };

  const rows =
    activeTab === 'all'
      ? (await Promise.all(Object.values(loaders).map((load) => load()))).flat().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      : await loaders[activeTab]();

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">Operations</p>
        <h1 className="text-2xl font-semibold text-primary">Exceptions &amp; escalations</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Blocked, overdue, rejected and exception work across every domain, centralized in one queue.
        </p>
      </header>

      <nav aria-label="Exception filters" className="mb-5 flex flex-wrap gap-2">
        {TABS.map((tab) => {
          const href = tab.key === 'all' ? '/ops/exceptions' : `/ops/exceptions?type=${tab.key}`;
          const active = tab.key === activeTab;
          return (
            <Link
              key={tab.key}
              href={href}
              className={`focus-visible-ring rounded-full border px-3 py-1.5 text-sm font-medium ${
                active
                  ? 'border-transparent bg-primary text-[var(--color-text-inverse)]'
                  : 'border-[var(--color-border)] bg-surface text-primary hover:bg-surface-muted'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">
          {TABS.find((t) => t.key === activeTab)?.label} <span className="font-normal text-[var(--color-text-secondary)]">({rows.length})</span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Sorted oldest first — age drives priority alongside severity.</p>
        {rows.length === 0 ? (
          <div className="mt-4">
            <EmptyQueue>
              No active exceptions in this view. New and aging exceptions will be listed here with type, owner, reason and age.
            </EmptyQueue>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Object</th>
                  <th className="pb-2">Reason</th>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Owner</th>
                  <th className="pb-2">Age</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[var(--color-border)]">
                    <td className="py-3">
                      <StatusChip label={row.type} tone={row.severity} icon="alert" size="sm" />
                    </td>
                    <td className="py-3 font-medium text-primary">{row.object}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{row.reason}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{row.category}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{row.owner}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{age(row.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
