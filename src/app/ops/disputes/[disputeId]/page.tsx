/**
 * OPS-06 Case detail. "Facts, evidence, messages, internal notes, linked objects" with
 * **visibility segmentation** — the messages section and the internal-notes section are
 * two separate queries against two separate models, rendered in two visually distinct
 * blocks, exactly like the exporter's Support page. Same leak risk as AGT-06's internal
 * layer, verified the same way (see scripts/verify-support-disputes.ts).
 */

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { DisputeActions } from '@/components/ops-disputes/DisputeActions';
import { DISPUTE_SEVERITY_DISPLAY, DISPUTE_STATUS_DISPLAY, DISPUTE_TYPE_LABELS, supportChip } from '@/components/support/statusDisplay';
import { PageHeader, StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function fmt(d: Date | null): string {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

export default async function OpsDisputeDetailPage({ params }: { params: Promise<{ disputeId: string }> }) {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Dispute oversight is available to Ops supervisors, Ops finance and administrators." />;
  }

  const { disputeId } = await params;
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      owner: { select: { name: true } },
      deal: { include: { exporter_org: { select: { display_name: true } }, buyer: { select: { display_name: true } } } },
      shipment: { select: { id: true, status: true } },
      payment: { select: { id: true, label: true, status: true } },
    },
  });
  if (!dispute) notFound();

  const [messages, internalNotes, assignableUsers] = await Promise.all([
    dispute.deal_id
      ? prisma.message.findMany({
          where: { deal_id: dispute.deal_id },
          orderBy: { created_at: 'asc' },
          include: { author: { select: { name: true, role: true } } },
        })
      : Promise.resolve([]),
    prisma.internalNote.findMany({
      where: { dispute_id: dispute.id },
      orderBy: { created_at: 'desc' },
      include: { author: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { is_active: true, role: { in: [UserRole.agent, UserRole.ops_supervisor, UserRole.ops_finance] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const statusChip = supportChip(DISPUTE_STATUS_DISPLAY, dispute.status);
  const severityChip = supportChip(DISPUTE_SEVERITY_DISPLAY, dispute.severity);

  return (
    <div className="py-4 md:py-6">
      <p className="text-sm font-normal text-primary">
        <Link href="/ops/disputes" className="underline underline-offset-2">Dispute oversight</Link> · Case {dispute.id.slice(-6)}
      </p>

      <PageHeader
        className="mt-2"
        title={`${DISPUTE_TYPE_LABELS[dispute.type] ?? dispute.type} case`}
        description={`${dispute.deal?.exporter_org.display_name ?? '—'} · ${dispute.deal?.buyer.display_name ?? '—'}`}
        actions={
          <div className="flex gap-1.5">
            <StatusChip {...severityChip} />
            <StatusChip {...statusChip} />
          </div>
        }
      />

      <section className="mt-4 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Facts</h2>
        <p className="mt-2 text-sm text-primary">{dispute.summary}</p>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Owner</dt>
            <dd className="mt-0.5 text-primary">{dispute.owner?.name ?? 'Unassigned'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase text-[var(--color-text-muted)]">Opened</dt>
            <dd className="mt-0.5 text-primary">{fmt(dispute.created_at)}</dd>
          </div>
          {dispute.shipment ? (
            <div>
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Linked shipment</dt>
              <dd className="mt-0.5 text-primary">{dispute.shipment.status.replace(/_/g, ' ')}</dd>
            </div>
          ) : null}
          {dispute.payment ? (
            <div>
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Linked payment</dt>
              <dd className="mt-0.5 text-primary">{dispute.payment.label ?? dispute.payment.id} · {dispute.payment.status.replace(/_/g, ' ')}</dd>
            </div>
          ) : null}
          {dispute.waiting_on ? (
            <div>
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Waiting on</dt>
              <dd className="mt-0.5 text-primary">{dispute.waiting_on} · follow up {fmt(dispute.sla_due_at)}</dd>
            </div>
          ) : null}
          {dispute.resolution ? (
            <div className="sm:col-span-2">
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Resolution</dt>
              <dd className="mt-0.5 text-primary">{dispute.resolution}</dd>
            </div>
          ) : null}
          {dispute.closed_at ? (
            <div>
              <dt className="text-xs uppercase text-[var(--color-text-muted)]">Closed</dt>
              <dd className="mt-0.5 text-primary">{fmt(dispute.closed_at)} · {dispute.closure_basis ?? 'exporter accepted'}</dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-4">
          <DisputeActions dealId={dispute.deal_id ?? ''} disputeId={dispute.id} status={dispute.status} assignableUsers={assignableUsers} />
        </div>
      </section>

      <section className="mt-4 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Messages</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">The deal&apos;s exporter-visible conversation — the same thread the exporter sees.</p>
        {messages.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">No messages on this deal yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {messages.map((m) => (
              <li key={m.id} className="border-t border-[var(--color-border)] pt-2 first:border-0 first:pt-0">
                <p className="text-sm text-primary">{m.body}</p>
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{m.author.name} ({m.author.role}) · {fmt(m.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Visibility segmentation: internal notes render in a visually distinct,
          dashed-border block — never merged with the messages section above, and never
          reachable from any exporter-facing route (OPS-06-AC01). */}
      <section className="mt-4 rounded-lg border-2 border-dashed border-[var(--color-border-strong)] bg-surface-muted p-5">
        <h2 className="text-lg font-semibold text-primary">Internal notes</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Never shown to the exporter.</p>
        {internalNotes.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--color-text-secondary)]">None.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {internalNotes.map((n) => (
              <li key={n.id} className="rounded-md border border-[var(--color-border)] bg-surface p-2">
                <p className="text-sm text-primary">{n.body}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">{n.author.name} · {fmt(n.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
