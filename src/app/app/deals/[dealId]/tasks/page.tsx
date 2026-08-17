/**
 * EXP-11 Deal — Tasks (docs/04).
 *
 * AC01 "internal-only tasks never appear" is structural, not a display filter: the
 * Prisma `where` below bakes in `visibility: exporter_visible`, the exact clause
 * `/api/v1/tasks` (the cross-deal exporter index) already uses, so an internal task can
 * never reach this page's payload to begin with — verified by scanning the rendered
 * payload for absence, not by hiding a DOM node client-side.
 *
 * Sections mirror the page anatomy: exporter-owned work is split into "My actions"
 * (open) and "Blocked dependency" (waiting) so a stuck task doesn't hide among
 * actionable ones; "Waiting on ClearTrade" shows only the task itself — its owner is
 * `agent`/`ops_supervisor`, so any internal subtask chatter is excluded by the same
 * visibility filter, never a separate summarization step that could drift.
 */

import { TaskState, UserRole } from '@prisma/client';
import { AskAgentButton } from '@/components/enablement/AskAgentButton';
import { EvidenceUploadForm } from '@/components/enablement/EvidenceUploadForm';
import { StatusChip } from '@/components/ui';
import { TaskActions } from '@/components/execution/TaskActions';
import { EXPORTER_ROLES } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { loadDealForWorkspace } from '../loadDeal';

const SLA_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  on_time: { label: 'On time', tone: 'info' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  escalated: { label: 'Escalated', tone: 'critical' },
};

function fmt(due: Date | null): string {
  if (!due) return 'No due date set';
  return due.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default async function DealTasksPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;

  const tasks = await prisma.task.findMany({
    where: { deal_id: dealId, visibility: 'exporter_visible' },
    include: {
      owner: { select: { name: true } },
      evidence: { orderBy: { created_at: 'desc' }, take: 1 },
    },
    orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
  });

  const myActions = tasks.filter((t) => EXPORTER_ROLES.includes(t.owner_role) && (t.state === TaskState.not_started || t.state === TaskState.in_progress));
  const blocked = tasks.filter((t) => EXPORTER_ROLES.includes(t.owner_role) && t.state === TaskState.waiting);
  const waitingOnClearTrade = tasks.filter(
    (t) => (t.owner_role === UserRole.agent || t.owner_role === UserRole.ops_supervisor) && t.state !== TaskState.done && t.state !== TaskState.cancelled,
  );
  const completed = tasks.filter((t) => t.state === TaskState.done);

  function TaskCard({ task, actionable }: { task: (typeof tasks)[number]; actionable: boolean }) {
    const slaChip = SLA_DISPLAY[task.sla_state] ?? SLA_DISPLAY.on_time;
    const latestEvidence = task.evidence[0]
      ? {
          id: task.evidence[0].id,
          file_name: task.evidence[0].file_name,
          review_status: task.evidence[0].review_status,
          review_note: task.evidence[0].review_note,
          uploaded_at: task.evidence[0].uploaded_at.toISOString(),
        }
      : null;

    return (
      <li className="rounded-md border border-[var(--color-border)] p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-primary">{task.title}</p>
            {task.description ? <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">{task.description}</p> : null}
          </div>
          <StatusChip label={slaChip.label} tone={slaChip.tone} icon={slaChip.tone === 'info' ? 'clock' : 'alert'} size="sm" />
        </div>

        {/* AC03: due date and owner shown for every active exporter task. */}
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-secondary)]">
          <span>Owner: {task.owner?.name ?? (EXPORTER_ROLES.includes(task.owner_role) ? 'You' : 'ClearTrade')}</span>
          <span>Due: {fmt(task.due_at)}</span>
          {task.blocked_reason ? (
            <span className="text-[var(--color-critical-text)]">
              Waiting on {task.waiting_on ?? 'resolution'}: {task.blocked_reason}
            </span>
          ) : null}
        </div>

        {actionable ? (
          <div className="mt-2 space-y-2">
            <TaskActions taskId={task.id} state={task.state} />
            <EvidenceUploadForm taskId={task.id} latestEvidence={latestEvidence} />
            <AskAgentButton taskId={task.id} />
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">My actions</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Work only you can complete.</p>
        {myActions.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">Nothing needs your action right now.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {myActions.map((t) => (
              <TaskCard key={t.id} task={t} actionable />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Blocked dependency</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Cannot be marked done until the dependency clears.</p>
        {blocked.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">Nothing is blocked.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {blocked.map((t) => (
              <TaskCard key={t.id} task={t} actionable />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Waiting on ClearTrade</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          High-level status only — internal steps on ClearTrade&apos;s side aren&apos;t shown here.
        </p>
        {waitingOnClearTrade.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--color-text-secondary)]">Nothing pending on ClearTrade&apos;s side.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {waitingOnClearTrade.map((t) => (
              <TaskCard key={t.id} task={t} actionable={false} />
            ))}
          </ul>
        )}
      </section>

      {completed.length > 0 ? (
        <details className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <summary className="cursor-pointer text-lg font-semibold text-primary">Completed ({completed.length})</summary>
          <ul className="mt-4 space-y-3">
            {completed.map((t) => (
              <li key={t.id} className="rounded-md border border-[var(--color-border)] p-3">
                <p className="text-sm font-medium text-primary">{t.title}</p>
                <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  Completed {t.completed_at ? fmt(t.completed_at) : '—'} · Owner: {t.owner?.name ?? 'ClearTrade'}
                </p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {tasks.length === 0 ? (
        <section className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-surface p-8 text-center">
          <p className="text-sm font-medium text-primary">No tasks on this deal yet</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Tasks appear here as the deal moves forward.</p>
        </section>
      ) : null}
    </div>
  );
}
