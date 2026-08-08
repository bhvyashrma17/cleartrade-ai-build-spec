/** OPS-02 — Assignments & agent capacity (docs/06). Prevents invisible ownership gaps. */

import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

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

export default async function OpsAssignmentsPage() {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Assignments are available to Ops supervisors and administrators." />;
  }

  const [unassigned, agents, history] = await Promise.all([
    prisma.exporterOrg.findMany({
      where: { assigned_agent_id: null },
      orderBy: { created_at: 'asc' },
      select: { id: true, display_name: true, journey_stage: true, readiness_status: true, created_at: true },
    }),
    prisma.user.findMany({
      where: { role: UserRole.agent, is_active: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            agent_assignments: { where: { status: 'active' } },
            owned_deals: { where: { stage: { in: ['qualifying', 'negotiating', 'terms_agreed', 'deal_locked', 'executing'] } } },
            owned_tasks: { where: { state: { notIn: ['done', 'cancelled'] }, sla_state: { in: ['overdue', 'escalated'] } } },
          },
        },
      },
    }),
    prisma.agentAssignment.findMany({
      orderBy: { started_at: 'desc' },
      take: 20,
      include: { exporter_org: true, agent: true, assigned_by: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-6">
        <p className="text-sm font-medium text-primary">Operations</p>
        <h1 className="text-2xl font-semibold text-primary">Assignments &amp; agent capacity</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Every exporter, lead and deal must have a visible owner. No hard capacity cap — advisory load only.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-primary">
            Unassigned queue <span className="font-normal text-[var(--color-text-secondary)]">({unassigned.length})</span>
          </h2>
          <StatusChip
            label={unassigned.length ? `${unassigned.length} awaiting an owner` : 'No ownership gaps'}
            tone={unassigned.length ? 'warning' : 'positive'}
            icon={unassigned.length ? 'alert' : 'check'}
          />
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Exporters with no assigned agent, oldest first.</p>
        {unassigned.length === 0 ? (
          <div className="mt-4">
            <EmptyQueue>No newly active exporter is currently unassigned.</EmptyQueue>
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <tr>
                  <th className="pb-2">Exporter</th>
                  <th className="pb-2">Journey stage</th>
                  <th className="pb-2">Readiness</th>
                  <th className="pb-2">Age</th>
                </tr>
              </thead>
              <tbody>
                {unassigned.map((org) => (
                  <tr key={org.id} className="border-t border-[var(--color-border)]">
                    <td className="py-3 font-medium text-primary">{org.display_name}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{org.journey_stage.replace(/_/g, ' ')}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{org.readiness_status.replace(/_/g, ' ')}</td>
                    <td className="py-3 text-[var(--color-text-secondary)]">{age(org.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Agent capacity</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Advisory load signal — not a hard cap.</p>
          {agents.length === 0 ? (
            <div className="mt-4">
              <EmptyQueue>No active agents are available for assignment.</EmptyQueue>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {agents.map((agent) => (
                <div key={agent.id} className="flex items-center justify-between border-b border-[var(--color-border)] pb-3 text-sm last:border-0">
                  <span className="font-medium text-primary">{agent.name}</span>
                  <span className="text-[var(--color-text-secondary)]">
                    {agent._count.agent_assignments} exporters · {agent._count.owned_deals} active deals · {agent._count.owned_tasks} overdue
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Assignment history</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Audit-backed — who assigned or reassigned, and why.</p>
          {history.length === 0 ? (
            <div className="mt-4">
              <EmptyQueue>No assignments have been recorded yet.</EmptyQueue>
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {history.map((entry) => (
                <li key={entry.id} className="border-b border-[var(--color-border)] pb-3 text-sm last:border-0">
                  <p className="font-medium text-primary">
                    {entry.exporter_org.display_name} <span className="font-normal text-[var(--color-text-secondary)]">→ {entry.agent.name}</span>
                  </p>
                  <p className="mt-1 text-[var(--color-text-secondary)]">
                    {entry.status === 'active' ? 'Active' : 'Ended'} · assigned by {entry.assigned_by?.name ?? 'system'} ·{' '}
                    {entry.started_at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    {entry.reason ? ` · ${entry.reason}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
