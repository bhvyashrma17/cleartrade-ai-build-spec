/**
 * `/ops/agents/[agentId]` — one agent, their assignments, and the controls to change them.
 *
 * Assignment history is shown in full, ended rows included: "who was responsible in March" is an
 * operational question, and `AgentAssignment` ends rows rather than deleting them precisely so
 * it stays answerable.
 */

import Link from 'next/link';
import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { AgentActivationControl } from '@/components/ops/AgentActivationControl';
import { AssignExporterForm } from '@/components/ops/AssignExporterForm';
import { ReassignExporterForm } from '@/components/ops/ReassignExporterForm';
import { requirePortalAccess } from '@/lib/auth';
import { isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { agentDetail } from '@/lib/staff-provisioning';

const fmt = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d) : '—');

export default async function OpsAgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const principal = await requirePortalAccess('/ops');
  if (!isOps(principal)) return <AccessDenied message="Agent provisioning is available to Ops and administrators." />;
  const { agentId } = await params;

  const agent = await agentDetail(principal, agentId);
  const assignedIds = agent.agent_assignments.filter((a) => a.status === 'active').map((a) => a.exporter_org.id);
  // Only orgs this agent is not already working, so the control cannot create a duplicate.
  const [assignable, otherActiveAgents] = await Promise.all([
    prisma.exporterOrg.findMany({
      where: { id: { notIn: assignedIds.length ? assignedIds : ['__none__'] } },
      orderBy: { display_name: 'asc' },
      select: { id: true, display_name: true },
      take: 200,
    }),
    prisma.user.findMany({
      where: { role: UserRole.agent, is_active: true, id: { not: agent.id } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-6">
      <Link href="/ops/agents" className="focus-visible-ring rounded text-xs font-medium text-primary underline underline-offset-2">
        ← All agents
      </Link>
      <header className="mt-2 mb-4">
        <h1 className="text-2xl font-semibold text-primary">{agent.name}</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          {agent.email} · {agent.is_active ? 'Active' : 'Deactivated'} · joined {fmt(agent.created_at)}
        </p>
        <p className="mt-1 text-sm text-primary">
          Assigned exporters: <strong>{agent.activeCount}</strong>{' '}
          <span className="text-[var(--color-text-muted)]">/ target ~{agent.capacityTarget}</span>
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Administrative actions</h2>
        <div className="mt-3">
          <AgentActivationControl agentId={agent.id} agentName={agent.name} isActive={agent.is_active} />
        </div>
      </section>

      <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Assign an exporter</h2>
        <div className="mt-3">
          <AssignExporterForm agentUserId={agent.id} exporters={assignable} />
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-[var(--color-text-inverse)]">
              <th scope="col" className="px-4 py-3 text-left font-medium">Exporter</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Started</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Ended</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Assigned by</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {agent.agent_assignments.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                No assignments yet.
              </td></tr>
            ) : agent.agent_assignments.map((a) => (
              <tr key={a.id} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-3 text-primary">{a.exporter_org.display_name}</td>
                <td className="px-4 py-3">
                  <StatusChip
                    label={a.status}
                    tone={a.status === 'active' ? 'positive' : 'neutral'}
                    icon={a.status === 'active' ? 'check' : 'clock'}
                    size="sm"
                  />
                </td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{fmt(a.started_at)}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{fmt(a.ended_at)}</td>
                <td className="px-4 py-3 text-[var(--color-text-secondary)]">{a.assigned_by?.name ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  {a.status === 'active' ? (
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                      <AssignExporterForm agentUserId={agent.id} unassignAssignmentId={a.id} />
                      {otherActiveAgents.length > 0 ? (
                        <ReassignExporterForm
                          assignmentId={a.id}
                          exporterName={a.exporter_org.display_name}
                          currentAgentName={agent.name}
                          candidates={otherActiveAgents}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--color-text-muted)]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
