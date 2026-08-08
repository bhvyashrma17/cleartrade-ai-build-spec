'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { DataTable, StatusChip, type DataTableColumn } from '@/components/ui';
import { ApiClientError, apiGet } from '@/lib/api-client';
import type { ListResponse, PageMeta } from '@/types';

const PER_PAGE = 20;
const EMPTY_PAGE: PageMeta = { page: 1, per_page: PER_PAGE, total: 0, total_pages: 1 };

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  state: string;
  priority: string;
  due_at: string | null;
  sla_state: string;
  blocked_reason: string | null;
  task_type: string | null;
  deal_id: string | null;
  owner_name: string | null;
  action_href: string | null;
}

const STATE_OPTIONS = [
  { value: '', label: 'Open (not done)' },
  { value: 'not_started', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const SLA_DISPLAY: Record<string, { label: string; tone: 'positive' | 'info' | 'warning' | 'critical' }> = {
  on_time: { label: 'On time', tone: 'info' },
  due_soon: { label: 'Due soon', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'critical' },
  escalated: { label: 'Escalated', tone: 'critical' },
};

function formatDue(due: string | null) {
  if (!due) return 'No due date set';
  return new Date(due).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function TasksList() {
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [pageMeta, setPageMeta] = useState<PageMeta>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [state]);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams({ page: String(page), per_page: String(PER_PAGE) });
      if (state) params.set('state', state);
      const res = await apiGet<ListResponse<TaskRow>>(`/api/v1/tasks?${params.toString()}`);
      setTasks(res.data);
      setPageMeta(res.meta);
    } catch (error) {
      setLoadError(error instanceof ApiClientError ? error.message : 'Could not load your tasks. Please retry.');
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [page, state]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const hasActiveFilters = Boolean(state);

  const columns: DataTableColumn<TaskRow>[] = [
    {
      key: 'title',
      header: 'Task',
      render: (task) => (
        <div>
          <div className="font-medium text-primary">{task.title}</div>
          {task.blocked_reason ? (
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">Blocked: {task.blocked_reason}</div>
          ) : task.description ? (
            <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">{task.description}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      render: (task) => task.owner_name ?? 'Unassigned',
    },
    {
      key: 'due_at',
      header: 'Due',
      sortable: false,
      render: (task) => formatDue(task.due_at),
    },
    {
      key: 'sla_state',
      header: 'Status',
      render: (task) => {
        const display = SLA_DISPLAY[task.sla_state] ?? SLA_DISPLAY.on_time;
        return <StatusChip label={display.label} tone={display.tone} icon={display.tone === 'critical' ? 'alert' : display.tone === 'warning' ? 'clock' : 'dot'} size="sm" />;
      },
    },
  ];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">Your work</p>
        <h1 className="text-2xl font-semibold text-primary">Tasks</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Everything owed on your account — enablement steps and deal-related work in one queue.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
        <div>
          <label className="block text-sm font-medium text-primary" htmlFor="task-state-filter">
            Status
          </label>
          <select
            id="task-state-filter"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="mt-1 rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          >
            {STATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError ? (
        <div className="rounded-lg border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-4 text-sm text-[var(--color-critical-text)]">
          <p className="font-medium">{loadError}</p>
          <button type="button" onClick={fetchTasks} className="mt-2 font-medium underline underline-offset-2">
            Retry
          </button>
        </div>
      ) : (
        <DataTable<TaskRow>
          columns={columns}
          rows={tasks}
          rowKey={(task) => task.id}
          loading={loading}
          page={pageMeta}
          onPageChange={setPage}
          hasActiveFilters={hasActiveFilters}
          emptyState={{
            title: 'No tasks yet',
            description: 'Tasks created by your readiness assessment or your agent will appear here.',
          }}
          filteredEmptyState={{
            title: 'No tasks in this status',
            description: 'Try a different status filter.',
            action: (
              <button type="button" onClick={() => setState('')} className="text-sm font-medium text-primary underline underline-offset-2">
                Reset filter
              </button>
            ),
          }}
          rowActions={(task) =>
            task.action_href ? (
              <Link href={task.action_href} className="focus-visible-ring text-sm font-medium text-primary underline underline-offset-2">
                Open
              </Link>
            ) : (
              <span className="text-xs text-[var(--color-text-secondary)]" title="This task's workspace isn't built yet.">
                —
              </span>
            )
          }
        />
      )}
    </div>
  );
}
