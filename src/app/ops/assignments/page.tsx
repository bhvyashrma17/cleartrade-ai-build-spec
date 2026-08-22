/** OPS-02 — Assignments & agent capacity (docs/06). Prevents invisible ownership gaps. */

import { UserRole } from '@prisma/client';
import { AccessDenied } from '@/components/access-denied';
import { EmptyState, PageHeader, StatusChip, Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui';
import { AssignAgentToExporterForm } from '@/components/ops/AssignAgentToExporterForm';
import { AssignExporterForm } from '@/components/ops/AssignExporterForm';
import { ReassignExporterForm } from '@/components/ops/ReassignExporterForm';
import { requirePortalAccess } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const age = (date: Date) => {
  const hours = Math.max(0, Math.floor((Date.now() - date.getTime()) / 3_600_000));
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
};

export default async function OpsAssignmentsPage() {
  const principal = await requirePortalAccess('/ops');
  if (!([UserRole.ops_supervisor, UserRole.admin] as readonly UserRole[]).includes(principal.role)) {
    return <AccessDenied message="Assignments are available to Ops supervisors and administrators." />;
  }

  const [unassigned, agents, active, history] = await Promise.all([
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
      where: { status: 'active' },
      orderBy: { started_at: 'desc' },
      include: { exporter_org: true, agent: true, assigned_by: true },
    }),
    prisma.agentAssignment.findMany({
      orderBy: { started_at: 'desc' },
      take: 20,
      include: { exporter_org: true, agent: true, assigned_by: true },
    }),
  ]);

  // Only active agents are ever offered — Assign/Reassign both refuse an inactive one
  // server-side too, but there is no reason to let the operator pick a dead end.
  const assignCandidates = agents.map((agent) => ({ id: agent.id, name: agent.name, assignedCount: agent._count.agent_assignments }));

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <PageHeader
        className="mb-6"
        eyebrow="Operations"
        title="Assignments & agent capacity"
        description="Every exporter, lead and deal must have a visible owner. No hard capacity cap — advisory load only."
      />

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
            <EmptyState bordered title="No newly active exporter is currently unassigned." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[680px]">
              <Thead className="text-xs uppercase text-[var(--color-text-muted)]">
                <Tr>
                  <Th>Exporter</Th>
                  <Th>Journey stage</Th>
                  <Th>Readiness</Th>
                  <Th>Age</Th>
                  <Th align="right">Action</Th>
                </Tr>
              </Thead>
              <Tbody>
                {unassigned.map((org) => (
                  <Tr key={org.id}>
                    <Td className="font-medium text-primary">{org.display_name}</Td>
                    <Td className="text-[var(--color-text-secondary)]">{org.journey_stage.replace(/_/g, ' ')}</Td>
                    <Td className="text-[var(--color-text-secondary)]">{org.readiness_status.replace(/_/g, ' ')}</Td>
                    <Td className="text-[var(--color-text-secondary)]">{age(org.created_at)}</Td>
                    <Td align="right">
                      {assignCandidates.length > 0 ? (
                        <AssignAgentToExporterForm exporterOrgId={org.id} exporterName={org.display_name} agents={assignCandidates} />
                      ) : (
                        <span className="text-xs text-[var(--color-text-muted)]">No active agents</span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
        <div className="p-5 pb-0">
          <h2 className="text-lg font-semibold text-primary">
            Current assignments <span className="font-normal text-[var(--color-text-secondary)]">({active.length})</span>
          </h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Every exporter with a live agent, and the controls to move them.</p>
        </div>
        {active.length === 0 ? (
          <div className="p-5">
            <EmptyState bordered title="No active assignments yet." />
          </div>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <Table className="min-w-[820px]">
              <Thead>
                <Tr className="bg-primary text-[var(--color-text-inverse)]">
                  <Th className="font-medium">Exporter</Th>
                  <Th className="font-medium">Agent</Th>
                  <Th className="font-medium">Started</Th>
                  <Th className="font-medium">Assigned by</Th>
                  <Th className="font-medium">Reason</Th>
                  <Th align="right" className="font-medium">Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {active.map((entry) => (
                  <Tr key={entry.id}>
                    <Td className="font-medium text-primary">{entry.exporter_org.display_name}</Td>
                    <Td className="text-primary">{entry.agent.name}</Td>
                    <Td className="text-[var(--color-text-secondary)]">
                      {entry.started_at.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Td>
                    <Td className="text-[var(--color-text-secondary)]">{entry.assigned_by?.name ?? 'system'}</Td>
                    <Td className="text-[var(--color-text-secondary)]">{entry.reason ?? '—'}</Td>
                    <Td>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <AssignExporterForm agentUserId={entry.agent_user_id} unassignAssignmentId={entry.id} exporterName={entry.exporter_org.display_name} />
                        {assignCandidates.filter((c) => c.id !== entry.agent_user_id).length > 0 ? (
                          <ReassignExporterForm
                            assignmentId={entry.id}
                            exporterName={entry.exporter_org.display_name}
                            currentAgentName={entry.agent.name}
                            candidates={assignCandidates.filter((c) => c.id !== entry.agent_user_id)}
                          />
                        ) : null}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Agent capacity</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Advisory load signal — not a hard cap.</p>
          {agents.length === 0 ? (
            <div className="mt-4">
              <EmptyState bordered title="No active agents are available for assignment." />
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
              <EmptyState bordered title="No assignments have been recorded yet." />
            </div>
          ) : (
            <ul className="mt-4 space-y-3">
              {history.map((entry) => (
                <li key={entry.id} className="border-b border-[var(--color-border)] pb-3 text-sm last:border-0">
                  <p className="font-normal text-primary">
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
