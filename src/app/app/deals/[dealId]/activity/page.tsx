/**
 * Deal — Activity (EXP-09-AC05, docs/08).
 *
 * `AuditEvent` has no `deal_id` column (it is keyed by `object_type`/`object_id` across
 * every domain, docs/02) so a deal's timeline is assembled by first resolving which
 * object ids belong to this deal, then querying audit rows against exactly those ids —
 * never a broader `exporter_org_id` scan, which would pull in every other deal's history
 * too.
 *
 * "Exporter-visible events only" is enforced two ways: (1) the `task` id set below is
 * pre-filtered to `visibility: exporter_visible`, so an internal task's state changes
 * never enter the id list in the first place — the same structural exclusion EXP-11 and
 * `/api/v1/tasks` use; (2) `escalate`/`login`/`config_change` are dropped from
 * `EXPORTER_VISIBLE_ACTIONS` because they describe ClearTrade's own internal handling of
 * a problem, not a material change the exporter needs to see (docs/01: internal
 * exception handling is not exporter-facing).
 */

import { StatusChip } from '@/components/ui';
import { prisma } from '@/lib/prisma';
import { loadDealForWorkspace } from '../loadDeal';

const EXPORTER_VISIBLE_ACTIONS = new Set([
  'create',
  'update',
  'approve',
  'reject',
  'request_changes',
  'stage_change',
  'state_change',
  'lock',
  'cancel',
  'generate',
  'file',
]);

const OBJECT_LABELS: Record<string, string> = {
  deal: 'Deal',
  task: 'Task',
  document: 'Document',
  shipment: 'Shipment',
  shipment_milestone: 'Shipment',
  payment: 'Payment',
  dispute: 'Case',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Created',
  update: 'Updated',
  approve: 'Approved',
  reject: 'Rejected',
  request_changes: 'Changes requested',
  stage_change: 'Stage changed',
  state_change: 'Status changed',
  lock: 'Locked',
  cancel: 'Cancelled',
  generate: 'Generated',
  file: 'Filed',
};

function fmt(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

function summarizeChange(before: unknown, after: unknown): string | null {
  if (!after || typeof after !== 'object') return null;
  const afterObj = after as Record<string, unknown>;
  const beforeObj = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of Object.keys(afterObj)) {
    if (key === 'id') continue;
    const nextVal = afterObj[key];
    const prevVal = beforeObj[key];
    if (prevVal !== undefined && prevVal !== nextVal) {
      parts.push(`${key.replace(/_/g, ' ')}: ${String(prevVal)} → ${String(nextVal)}`);
    } else if (prevVal === undefined && nextVal !== null && nextVal !== undefined) {
      parts.push(`${key.replace(/_/g, ' ')}: ${String(nextVal)}`);
    }
  }
  return parts.length > 0 ? parts.slice(0, 3).join(' · ') : null;
}

export default async function DealActivityPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const [tasks, documents, shipments, payments] = await Promise.all([
    prisma.task.findMany({ where: { deal_id: dealId, visibility: 'exporter_visible' }, select: { id: true } }),
    prisma.document.findMany({ where: { deal_id: dealId }, select: { id: true } }),
    prisma.shipment.findMany({ where: { deal_id: dealId }, select: { id: true } }),
    prisma.payment.findMany({ where: { deal_id: dealId }, select: { id: true } }),
  ]);

  const idsByType: Record<string, string[]> = {
    deal: [dealId],
    task: tasks.map((t) => t.id),
    document: documents.map((d) => d.id),
    shipment: shipments.map((s) => s.id),
    payment: payments.map((p) => p.id),
  };

  const orClauses = Object.entries(idsByType)
    .filter(([, ids]) => ids.length > 0)
    .map(([object_type, object_id]) => ({ object_type, object_id: { in: object_id } }));

  const events =
    orClauses.length === 0
      ? []
      : await prisma.auditEvent.findMany({
          where: { OR: orClauses, action: { in: Array.from(EXPORTER_VISIBLE_ACTIONS) } },
          orderBy: { timestamp: 'desc' },
          include: { actor: { select: { name: true, role: true } } },
          take: 200,
        });

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Activity</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Material changes on this deal — stage, approvals, documents, shipment and payment.
        </p>

        {events.length === 0 ? (
          <p className="mt-4 rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            No recorded activity yet. Material changes to this deal will appear here as they happen.
          </p>
        ) : (
          <ol className="mt-4 space-y-3 border-l border-[var(--color-border)] pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-action" aria-hidden="true" />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusChip label={OBJECT_LABELS[e.object_type] ?? e.object_type} tone="neutral" icon="dot" size="sm" />
                  <span className="text-sm font-medium text-primary">{ACTION_LABELS[e.action] ?? e.action}</span>
                </div>
                {summarizeChange(e.before_summary, e.after_summary) ? (
                  <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{summarizeChange(e.before_summary, e.after_summary)}</p>
                ) : null}
                <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                  {fmt(e.timestamp)} · {e.actor?.name ?? 'ClearTrade'}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
