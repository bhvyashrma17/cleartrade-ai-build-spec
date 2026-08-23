/** OPS-06 — Dispute oversight (docs/06). Internal notes are counted here for Ops
 * visibility only; they are never exposed through any exporter-facing API (AC01). */

import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { EmptyState, PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
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
    <div className="py-4 md:py-6">
      <PageHeader
        className="mb-6"
        actionsAlign="end"
        eyebrow="Operations"
        title="Dispute oversight"
        description="Intake through investigation, resolution and closure."
        actions={
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
        }
      />

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">
          Case queue <span className="font-normal text-[var(--color-text-secondary)]">({disputes.length})</span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Sorted by severity, then oldest first.</p>
        {disputes.length === 0 ? (
          <div className="mt-4">
            <EmptyState bordered title={showAll ? 'No disputes have been raised yet.' : 'No open disputes. Every case has been resolved or closed.'} />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[760px]">
              <Thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <Tr>
                  <Th>Case</Th>
                  <Th>Type</Th>
                  <Th>Severity</Th>
                  <Th>Exporter</Th>
                  <Th>Owner</Th>
                  <Th>Status</Th>
                  <Th>Next update</Th>
                  <Th>Age</Th>
                </Tr>
              </Thead>
              <Tbody>
                {disputes.map((dispute) => (
                  <Tr key={dispute.id}>
                    <Td className="font-medium text-primary">
                      <Link href={`/ops/disputes/${dispute.id}`} className="focus-visible-ring underline-offset-2 hover:underline">
                        Case {dispute.id.slice(-6)}
                      </Link>
                      <p className="mt-0.5 text-xs font-normal text-[var(--color-text-secondary)]">{dispute.summary}</p>
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">{dispute.type.replace(/_/g, ' ')}</Td>
                    <Td>
                      <StatusChip label={dispute.severity} tone={SEVERITY_TONE[dispute.severity]} icon="alert" size="sm" />
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">{dispute.deal?.exporter_org.display_name ?? '—'}</Td>
                    <Td className="text-[var(--color-text-secondary)]">{dispute.owner?.name ?? 'Unassigned'}</Td>
                    <Td>
                      <StatusChip
                        label={STATUS_LABEL[dispute.status]}
                        tone={dispute.status === 'resolved' || dispute.status === 'closed' ? 'positive' : 'info'}
                        icon={dispute.status === 'resolved' || dispute.status === 'closed' ? 'check' : 'clock'}
                        size="sm"
                        detail={dispute._count.internal_notes ? `${dispute._count.internal_notes} internal note(s) — Ops only` : undefined}
                      />
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">
                      {dispute.status === 'waiting_external' && dispute.sla_due_at
                        ? `${dispute.sla_due_at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`
                        : dispute.owner
                          ? 'With owner'
                          : 'Needs assignment'}
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">{age(dispute.created_at)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
