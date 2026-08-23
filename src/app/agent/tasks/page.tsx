/**
 * AGT-07 Tasks, SLAs & Escalations — docs/05.
 *
 * Scope: every task the agent role owns across assigned exporters (`owner_role: agent`,
 * `exporter_org_id in assignedOrgIds`) — not just tasks already claimed by this agent.
 * That is the gap the ticket names: "the agent owns tasks across every deal with no
 * queue to work them from." `canTransitionTask()` already lets any agent assigned to the
 * org act on a role-owned task, so this queue and that permission line up by
 * construction rather than by a second copy of the ownership rule.
 *
 * Views are server filters (search params), not client-side re-slicing of one fetch —
 * same discipline as OPS-03's tabs — so a bookmarked/shared link reproduces the exact
 * queue.
 */

import Link from 'next/link';
import { SlaState, TaskState } from '@prisma/client';
import { TaskEscalationActions } from '@/components/agent/TaskEscalationActions';
import { PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { TaskActions } from '@/components/execution/TaskActions';
import { requirePortalAccess } from '@/lib/auth';
import { assignedOrgIds } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

type ViewKey = 'my_open' | 'overdue' | 'due_soon' | 'waiting' | 'escalated' | 'completed';

const VIEWS: { key: ViewKey; label: string }[] = [
  { key: 'my_open', label: 'My open' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_soon', label: 'Due soon' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'escalated', label: 'Escalated' },
  { key: 'completed', label: 'Completed' },
];

const SLA_DISPLAY: Record<SlaState, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  on_time: { label: 'On time', tone: 'info' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  escalated: { label: 'Escalated', tone: 'critical' },
};

const PRIORITY_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' | 'neutral' }> = {
  low: { label: 'Low', tone: 'neutral' },
  normal: { label: 'Normal', tone: 'info' },
  high: { label: 'High', tone: 'warning' },
  urgent: { label: 'Urgent', tone: 'critical' },
};

function fmtDue(due: Date | null) {
  if (!due) return 'No due date set';
  return due.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default async function AgentTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const principal = await requirePortalAccess('/agent');
  const orgIds = await assignedOrgIds(principal);

  const { view: rawView } = await searchParams;
  const view: ViewKey = (VIEWS.find((v) => v.key === rawView)?.key ?? 'my_open') as ViewKey;

  const baseWhere = { owner_role: 'agent' as const, exporter_org_id: { in: orgIds } };

  const viewWhere: Record<ViewKey, object> = {
    my_open: { ...baseWhere, owner_user_id: principal.id, state: { in: [TaskState.not_started, TaskState.in_progress, TaskState.waiting] } },
    overdue: { ...baseWhere, sla_state: SlaState.overdue, state: { notIn: [TaskState.done, TaskState.cancelled] } },
    due_soon: { ...baseWhere, sla_state: SlaState.due_soon, state: { notIn: [TaskState.done, TaskState.cancelled] } },
    waiting: { ...baseWhere, state: TaskState.waiting },
    escalated: { ...baseWhere, sla_state: SlaState.escalated, state: { notIn: [TaskState.done, TaskState.cancelled] } },
    completed: { ...baseWhere, state: TaskState.done },
  };

  const [tasks, unownedActiveCount] = await Promise.all([
    prisma.task.findMany({
      where: viewWhere[view],
      // Default sort: SLA urgency (escalated/overdue first), then soonest due.
      orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
      include: {
        owner: { select: { name: true } },
        exporter_org: { select: { display_name: true } },
        deal: { select: { id: true, buyer: { select: { display_name: true } } } },
      },
      take: 100,
    }),
    prisma.task.count({
      where: { ...baseWhere, owner_user_id: null, state: { notIn: [TaskState.done, TaskState.cancelled] } },
    }),
  ]);

  return (
    <div className="py-4 md:py-6">
      <div className="mb-6">
        <PageHeader
          eyebrow="Agent workspace"
          title="Tasks, SLAs & escalations"
          description="Every task you own across every assigned exporter, in one queue — not memory or WhatsApp."
        />
        {unownedActiveCount > 0 ? (
          <p className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_8%,transparent)] px-3 py-2 text-sm text-primary">
            {unownedActiveCount} active task{unownedActiveCount === 1 ? '' : 's'} across your book have no named owner yet — claim them below.
          </p>
        ) : null}
      </div>

      <nav aria-label="Task views" className="mb-5 flex flex-wrap gap-2">
        {VIEWS.map((v) => {
          const href = v.key === 'my_open' ? '/agent/tasks' : `/agent/tasks?view=${v.key}`;
          const active = v.key === view;
          return (
            <Link
              key={v.key}
              href={href}
              className={`focus-visible-ring rounded-full border px-3 py-1.5 text-sm font-medium ${
                active
                  ? 'border-transparent bg-primary text-[var(--color-text-inverse)]'
                  : 'border-[var(--color-border)] bg-surface text-primary hover:bg-surface-muted'
              }`}
            >
              {v.label}
            </Link>
          );
        })}
      </nav>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">
          {VIEWS.find((v) => v.key === view)?.label} <span className="font-normal text-[var(--color-text-secondary)]">({tasks.length})</span>
        </h2>

        {tasks.length === 0 ? (
          <p className="mt-4 rounded border border-dashed border-[var(--color-border)] bg-surface-muted px-4 py-6 text-sm text-[var(--color-text-secondary)]">
            Nothing in this view right now.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[960px]">
              <Thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <Tr>
                  <Th>Task</Th>
                  <Th>Exporter / deal</Th>
                  <Th>Type</Th>
                  <Th>Owner</Th>
                  <Th>State</Th>
                  <Th>Priority</Th>
                  <Th>Due</Th>
                  <Th>SLA</Th>
                  <Th>Blocker</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {tasks.map((task) => {
                  const slaChip = SLA_DISPLAY[task.sla_state];
                  const priorityChip = PRIORITY_DISPLAY[task.priority] ?? PRIORITY_DISPLAY.normal;
                  return (
                    <Tr key={task.id} className="align-top">
                      <Td className="font-medium text-primary">{task.title}</Td>
                      <Td className="text-[var(--color-text-secondary)]">
                        {task.deal_id ? (
                          <Link href={`/agent/deals/${task.deal_id}`} className="focus-visible-ring underline underline-offset-2">
                            {task.deal?.buyer.display_name ?? task.exporter_org?.display_name ?? 'Deal'}
                          </Link>
                        ) : (
                          task.exporter_org?.display_name ?? '—'
                        )}
                      </Td>
                      <Td className="text-[var(--color-text-secondary)]">{task.task_type ?? '—'}</Td>
                      <Td className="text-[var(--color-text-secondary)]">
                        {task.owner?.name ?? <span className="text-[var(--color-critical-text)]">Unassigned</span>}
                      </Td>
                      <Td className="text-[var(--color-text-secondary)]">{task.state.replace('_', ' ')}</Td>
                      <Td>
                        <StatusChip label={priorityChip.label} tone={priorityChip.tone} icon="dot" size="sm" />
                      </Td>
                      <Td className="text-[var(--color-text-secondary)]">{fmtDue(task.due_at)}</Td>
                      <Td>
                        <StatusChip label={slaChip.label} tone={slaChip.tone} icon={slaChip.tone === 'info' ? 'clock' : 'alert'} size="sm" />
                      </Td>
                      <Td className="text-[var(--color-text-secondary)]">{task.blocked_reason ?? '—'}</Td>
                      <Td>
                        <div className="space-y-1.5">
                          <TaskActions taskId={task.id} state={task.state} />
                          <TaskEscalationActions
                            taskId={task.id}
                            hasOwner={Boolean(task.owner_user_id)}
                            isEscalated={task.sla_state === SlaState.escalated}
                          />
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
