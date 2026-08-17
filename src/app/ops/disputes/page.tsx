/** OPS-06 — Dispute oversight (docs/06). Internal notes are counted here for Ops
 * visibility only; they are never exposed through any exporter-facing API (AC01). */

import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const SEVERITY_TONE = { low: 'neutral', medium: 'info', high: 'warning', critical: 'critical' } as const;
const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  investigating: 'Investigating',
  waiting_external: 'Waiting on external party',
  proposed_resolution: 'Resolution proposed',
  resolved: 'Resolved',
  closed: 'Closed',
};

function EmptyQueue({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

const age = (date: Date) => {
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

export default async function OpsDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Dispute oversight is available to Ops supervisors, Ops finance and administrators." />;
  }

  const { scope } = await searchParams;
  const showAll = scope === 'all';

  const disputes = await prisma.dispute.findMany({
    where: showAll ? {} : { status: { notIn: ['resolved', 'closed'] } },
    orderBy: [{ severity: 'desc' }, { created_at: 'asc' }],
    include: {
      owner: true,
      deal: { include: { exporter_org: true } },
      _count: { select: { internal_notes: true } },
    },
  });

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-primary">Operations</p>
          <h1 className="text-2xl font-semibold text-primary">Dispute oversight</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Intake through investigation, resolution and closure.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href="/ops/disputes"
            className={`focus-visible-ring rounded-full border px-3 py-1.5 font-medium ${!showAll ? 'border-transparent bg-primary text-[var(--color-text-inverse)]' : 'border-[var(--color-border)] bg-surface text-primary hover:bg-surface-muted'}`}
          >
            Open cases
          </Link>
          <Link
            href="/ops/disputes?scope=all"
            className={`focus-visible-ring rounded-full border px-3 py-1.5 font-medium ${showAll ? 'border-transparent bg-primary text-[var(--color-text-inverse)]' : 'border-[var(--color-border)] bg-surface text-primary hover:bg-surface-muted'}`}
          >
            All cases
          </Link>
        </div>
      </header>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">
          Case queue <span className="font-normal text-[var(--color-text-secondary)]">({disputes.length})</span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Sorted by severity, then oldest first.</p>
        {disputes.length === 0 ? (
          <div className="mt-4">
            <EmptyQueue>{showAll ? 'No disputes have been raised yet.' : 'No open disputes. Every case has been resolved or closed.'}</EmptyQueue>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2">Case</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Severity</th>
                  <th className="pb-2">Exporter</th>
                  <th className="pb-2">Owner</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Next update</th>
                  <th className="pb-2">Age</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((dispute) => (
                  <tr key={dispute.id} className="border-t border-[var(--color-border)]">
                    <td className="py-3 font-medium text-primary">
                      <Link href={`/ops/disputes/${dispute.id}`} className="focus-visible-ring underline-offset-2 hover:underline">
                        Case {dispute.id.slice(-6)}
                      </Link>
                      <p className="mt-0.5 text-xs font-normal text-[var(--color-text-secondary)]">{dispute.summary}</p>
                    </td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{dispute.type.replace(/_/g, ' ')}</td>
                    <td className="py-3">
                      <StatusChip label={dispute.severity} tone={SEVERITY_TONE[dispute.severity]} icon="alert" size="sm" />
                    </td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{dispute.deal?.exporter_org.display_name ?? '—'}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{dispute.owner?.name ?? 'Unassigned'}</td>
                    <td className="py-3">
                      <StatusChip
                        label={STATUS_LABEL[dispute.status]}
                        tone={dispute.status === 'resolved' || dispute.status === 'closed' ? 'positive' : 'info'}
                        icon={dispute.status === 'resolved' || dispute.status === 'closed' ? 'check' : 'clock'}
                        size="sm"
                        detail={dispute._count.internal_notes ? `${dispute._count.internal_notes} internal note(s) — Ops only` : undefined}
                      />
                    </td>
                    <td className="py-3 text-[var(--color-text-secondary)]">
                      {dispute.status === 'waiting_external' && dispute.sla_due_at
                        ? `${dispute.sla_due_at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                        : dispute.owner
                          ? 'With owner'
                          : 'Needs assignment'}
                    </td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{age(dispute.created_at)}</td>
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
