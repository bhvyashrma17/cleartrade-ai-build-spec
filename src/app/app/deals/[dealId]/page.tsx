/**
 * EXP-09 Deal Workspace — Overview tab. Commercial terms summary, next actions, and a
 * recent-activity preview (the full timeline is the Activity tab, not built yet).
 */

import { TaskState, Visibility } from '@prisma/client';
import { StatusChip } from '@/components/ui';
import { prisma } from '@/lib/prisma';
import { loadDealForWorkspace } from './loadDeal';

const OPEN_STATES: TaskState[] = [TaskState.not_started, TaskState.in_progress, TaskState.waiting];

const SLA_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  on_time: { label: 'On time', tone: 'info' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  escalated: { label: 'Escalated', tone: 'critical' },
};

function money(amount: unknown, currency: string | null) {
  if (amount === null || amount === undefined) return '—';
  return `${currency ?? ''} ${Number(amount).toLocaleString('en-IN')}`.trim();
}

function formatDue(due: Date | null) {
  return due ? `Due ${due.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}` : 'No due date set';
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
      {children}
    </p>
  );
}

export default async function DealOverviewPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null; // tier-blocked / not found already handled by the layout

  const [exporterTasks, agentTasks, recentActivity] = await Promise.all([
    prisma.task.findMany({
      where: { deal_id: deal.id, visibility: Visibility.exporter_visible, owner_role: { in: ['exporter_owner', 'exporter_member'] }, state: { in: OPEN_STATES } },
      orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
    }),
    prisma.task.findMany({
      where: { deal_id: deal.id, visibility: Visibility.exporter_visible, owner_role: 'agent', state: { in: OPEN_STATES } },
      orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
    }),
    prisma.auditEvent.findMany({
      where: { object_type: 'deal', object_id: deal.id },
      orderBy: { timestamp: 'desc' },
      take: 5,
    }),
  ]);

  const latestSnapshot = deal.snapshots[0] ?? null;
  const paymentTerms = deal.payment_terms as { type?: string; description?: string } | null;
  const deliveryTerms = deal.delivery_terms as { ship_window_start?: string; ship_window_end?: string; notes?: string } | null;

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-3">
        <h2 className="text-lg font-semibold text-primary">Commercial terms</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {latestSnapshot ? `Locked as version ${latestSnapshot.version} — read-only except via a revision.` : 'Not yet locked — terms may still change during negotiation.'}
        </p>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-[var(--color-text-secondary)]">Quantity</dt>
            <dd className="mt-0.5 font-medium text-primary">{deal.quantity ? `${Number(deal.quantity).toLocaleString('en-IN')} ${deal.unit ?? ''}` : '—'}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Unit price</dt>
            <dd className="mt-0.5 font-medium text-primary">{money(deal.unit_price_amount, deal.unit_price_currency)}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Total value</dt>
            <dd className="mt-0.5 font-medium text-primary">{money(deal.total_amount, deal.total_currency)}</dd>
          </div>
          <div>
            <dt className="text-[var(--color-text-secondary)]">Incoterm</dt>
            <dd className="mt-0.5 font-medium text-primary">{deal.incoterm ? `${deal.incoterm}${deal.incoterm_place ? ` · ${deal.incoterm_place}` : ''}` : '—'}</dd>
          </div>
          <div className="col-span-2 sm:col-span-1">
            <dt className="text-[var(--color-text-secondary)]">Payment terms</dt>
            <dd className="mt-0.5 font-medium text-primary">
              {paymentTerms?.type ?? '—'}
              {paymentTerms?.description ? <span className="block font-normal text-[var(--color-text-secondary)]">{paymentTerms.description}</span> : null}
            </dd>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <dt className="text-[var(--color-text-secondary)]">Delivery</dt>
            <dd className="mt-0.5 font-medium text-primary">
              {deliveryTerms?.ship_window_start
                ? `${deliveryTerms.ship_window_start} – ${deliveryTerms.ship_window_end ?? '?'}`
                : 'Ship window not set'}
              {deliveryTerms?.notes ? <span className="block font-normal text-[var(--color-text-secondary)]">{deliveryTerms.notes}</span> : null}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-2">
        <h2 className="text-lg font-semibold text-primary">Recent activity</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Full history lives in the Activity tab.</p>
        {recentActivity.length === 0 ? (
          <div className="mt-4">
            <EmptyBlock>No material events recorded for this deal yet.</EmptyBlock>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {recentActivity.map((event) => (
              <li key={event.id} className="border-b border-[var(--color-border)] pb-3 text-sm last:border-0">
                <p className="font-normal text-primary">{event.action.replace(/_/g, ' ')}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  {event.timestamp.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-3">
        <h2 className="text-lg font-semibold text-primary">Your next actions</h2>
        {exporterTasks.length === 0 ? (
          <div className="mt-4">
            <EmptyBlock>Nothing outstanding on your side for this deal right now.</EmptyBlock>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-border)]">
            {exporterTasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-normal text-primary">{task.title}</p>
                  {task.description ? <p className="text-sm text-[var(--color-text-secondary)]">{task.description}</p> : null}
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{formatDue(task.due_at)}</p>
                </div>
                <StatusChip
                  label={SLA_DISPLAY[task.sla_state]?.label ?? 'On time'}
                  tone={SLA_DISPLAY[task.sla_state]?.tone ?? 'info'}
                  icon={task.sla_state === 'on_time' ? 'clock' : 'alert'}
                  size="sm"
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card xl:col-span-2">
        <h2 className="text-lg font-semibold text-primary">Waiting on ClearTrade</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">High-level status only — internal work is never shown here.</p>
        {agentTasks.length === 0 ? (
          <div className="mt-4">
            <EmptyBlock>Nothing is currently waiting on your agent for this deal.</EmptyBlock>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {agentTasks.map((task) => (
              <li key={task.id} className="border-b border-[var(--color-border)] pb-3 text-sm last:border-0">
                <p className="font-normal text-primary">{task.title}</p>
                <p className="text-xs text-[var(--color-text-secondary)]">{formatDue(task.due_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
