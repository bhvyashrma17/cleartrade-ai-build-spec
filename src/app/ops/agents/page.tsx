/**
 * `/ops/agents` — the agent roster and staff invitations.
 *
 * The provisioning path that replaces editing Postgres by hand. Ops invites an agent, the
 * invitee accepts with a one-time token, and the account is created with `role = agent` and no
 * exporter org — access arrives separately through assignments.
 */

import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { InviteAgentForm } from '@/components/ops/InviteAgentForm';
import { requirePortalAccess } from '@/lib/auth';
import { isOps } from '@/lib/permissions';
import { agentRoster, pendingStaffInvitations, AGENT_CAPACITY_TARGET } from '@/lib/staff-provisioning';

const fmt = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);

export default async function OpsAgentsPage() {
  const principal = await requirePortalAccess('/ops');
  if (!isOps(principal)) return <AccessDenied message="Agent provisioning is available to Ops and administrators." />;

  const [agents, invitations] = await Promise.all([
    agentRoster(principal),
    pendingStaffInvitations(principal),
  ]);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-6">
      <header className="mb-4">
        <p className="text-sm font-medium text-primary">Ops</p>
        <h1 className="text-2xl font-semibold text-primary">Agents</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Internal staff. Agents are provisioned by invitation only — there is no self-registration
          path to this role.
        </p>
      </header>

      <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Invite an agent</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Creates a single-use invitation. The link is shown once — it is not recoverable afterwards.
        </p>
        <div className="mt-3"><InviteAgentForm /></div>
      </section>

      {invitations.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Pending invitations</h2>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {invitations.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium text-primary">{invite.email}</span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                    {invite.role} · invited by {invite.invited_by?.name ?? 'Ops'} · expires {fmt(invite.expires_at)}
                  </span>
                </div>
                <StatusChip label="pending" tone="warning" icon="clock" size="sm" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-lg border border-[var(--color-border)] bg-surface shadow-card">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-primary text-[var(--color-text-inverse)]">
              <th scope="col" className="px-4 py-3 text-left font-medium">Agent</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Status</th>
              <th scope="col" className="px-4 py-3 text-right font-medium">Assigned</th>
              <th scope="col" className="px-4 py-3 text-left font-medium">Exporters</th>
            </tr>
          </thead>
          <tbody>
            {agents.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-[var(--color-text-secondary)]">
                No agents yet. Invite one above.
              </td></tr>
            ) : agents.map((agent) => (
              <tr key={agent.id} className="border-t border-[var(--color-border)] hover:bg-surface-muted">
                <td className="px-4 py-3">
                  <Link href={`/ops/agents/${agent.id}`} className="focus-visible-ring rounded font-medium text-primary underline underline-offset-2">
                    {agent.name}
                  </Link>
                  <div className="text-xs text-[var(--color-text-muted)]">{agent.email}</div>
                </td>
                <td className="px-4 py-3">
                  <StatusChip
                    label={agent.is_active ? 'Active' : 'Deactivated'}
                    tone={agent.is_active ? 'positive' : 'neutral'}
                    icon={agent.is_active ? 'check' : 'pause'}
                    size="sm"
                  />
                </td>
                <td className="px-4 py-3 text-right text-primary">
                  {/* Capacity is guidance, not a cap — assignment 11 is allowed and flagged. */}
                  {agent.assignedCount} / target ~{AGENT_CAPACITY_TARGET}
                  {agent.overTarget ? <div className="text-xs text-critical">over target</div> : null}
                </td>
                <td className="px-4 py-3 text-xs text-[var(--color-text-secondary)]">
                  {agent.agent_assignments.length === 0
                    ? '—'
                    : agent.agent_assignments.map((a) => a.exporter_org.display_name).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
