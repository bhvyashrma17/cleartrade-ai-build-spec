/**
 * `/ops/agents` — the agent roster and the two, deliberately separate, provisioning paths.
 *
 *   A. Generate invitation link — no email. A single-use bearer link; whoever opens it,
 *      authenticates and confirms becomes the Agent. Possession of the link is the authority.
 *   B. Add agent directly — email required. Converts an existing account immediately, or
 *      pre-authorizes an email that hasn't signed up yet (`StaffAccessGrant`, no token/link).
 *
 * The roster below is never derived from either provisioning queue: `agentRoster` reads
 * `User.role = agent` directly, so an account's Active/Deactivated status here can never
 * disagree with whether it actually holds the role.
 */

import Link from 'next/link';
import { AccessDenied } from '@/components/access-denied';
import { StatusChip } from '@/components/ui';
import { AddAgentForm } from '@/components/ops/AddAgentForm';
import { GenerateInvitationLinkForm } from '@/components/ops/GenerateInvitationLinkForm';
import { RevokeGrantButton } from '@/components/ops/RevokeGrantButton';
import { RevokeInvitationButton } from '@/components/ops/RevokeInvitationButton';
import { requirePortalAccess } from '@/lib/auth';
import { isOps } from '@/lib/permissions';
import {
  agentRoster, pendingStaffAccessGrants, pendingStaffInvitations,
} from '@/lib/staff-provisioning';

const fmt = (d: Date) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(d);

export default async function OpsAgentsPage() {
  const principal = await requirePortalAccess('/ops');
  if (!isOps(principal)) return <AccessDenied message="Agent provisioning is available to Ops and administrators." />;

  const [agents, invitations, grants] = await Promise.all([
    agentRoster(principal),
    pendingStaffInvitations(principal),
    pendingStaffAccessGrants(principal),
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
        <h2 className="text-lg font-semibold text-primary">Generate invitation link</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Creates a single-use Agent invitation link. Anyone with this link can claim the
          invitation, so send it only to the intended person.
        </p>
        <div className="mt-3"><GenerateInvitationLinkForm /></div>
      </section>

      <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold text-primary">Add agent directly</h2>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          No link, no email sent. Converts an existing ClearTrade account directly, or
          pre-authorizes an email that hasn&apos;t signed up yet.
        </p>
        <div className="mt-3"><AddAgentForm /></div>
      </section>

      {invitations.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Pending invitation links</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Bearer links — not bound to any email address.
          </p>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {invitations.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium text-primary">Agent invitation</span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                    created by {invite.invited_by?.name ?? 'Ops'} · created {fmt(invite.created_at)} ·
                    expires {fmt(invite.expires_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip label="pending" tone="warning" icon="clock" size="sm" />
                  <RevokeInvitationButton
                    invitationId={invite.id}
                    createdBy={invite.invited_by?.name ?? 'Ops'}
                    createdAt={fmt(invite.created_at)}
                    expiresAt={fmt(invite.expires_at)}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {grants.length > 0 ? (
        <section className="mb-6 rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
          <h2 className="text-lg font-semibold text-primary">Pending direct access grants</h2>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Pre-authorized emails with no account yet. Claimed automatically at their next
            verified sign-in.
          </p>
          <ul className="mt-2 divide-y divide-[var(--color-border)]">
            {grants.map((grant) => (
              <li key={grant.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <span className="font-medium text-primary">{grant.email}</span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                    {grant.role} · granted by {grant.granted_by?.name ?? 'Ops'} · {fmt(grant.granted_at)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusChip label="pending" tone="warning" icon="clock" size="sm" />
                  <RevokeGrantButton grantId={grant.id} email={grant.email} grantedBy={grant.granted_by?.name ?? 'Ops'} />
                </div>
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
                  {agent.assignedCount} / target ~{agent.capacityTarget}
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
