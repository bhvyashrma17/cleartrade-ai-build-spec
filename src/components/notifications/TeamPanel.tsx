'use client';

/**
 * EXP-17 Team. "Invite pending | Visible status + resend/revoke" is the literal required
 * UI state this renders — every pending `Invitation` row gets both actions inline, not
 * behind a menu, so the state is genuinely visible rather than merely reachable.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input, StatusChip } from '@/components/ui';
import { ApiClientError, apiPatch, apiPost } from '@/lib/api-client';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
}

interface Invite {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at: string;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function TeamPanel({
  isOwner,
  members,
  invitations,
}: {
  isOwner: boolean;
  members: Member[];
  invitations: Invite[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'exporter_member' | 'exporter_owner'>('exporter_member');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const invite = async () => {
    setBusy('invite');
    setError(null);
    try {
      await apiPost('/api/v1/invitations', { email: email.trim(), role });
      setEmail('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not send that invitation.');
    } finally {
      setBusy(null);
    }
  };

  const invitationAction = async (id: string, action: 'resend' | 'revoke') => {
    setBusy(id + action);
    setError(null);
    try {
      await apiPatch(`/api/v1/invitations/${id}`, { action });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update that invitation.');
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (userId: string) => {
    setBusy(userId);
    setError(null);
    try {
      await apiPatch(`/api/v1/exporter-org/members/${userId}`, {});
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not remove that member.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-primary">Team</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">Members of your organization.</p>

      {error ? <p className="mt-2 text-sm text-[var(--color-critical-text)]">{error}</p> : null}

      <ul className="mt-4 space-y-2">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--color-border)] p-2.5">
            <div>
              <p className="text-sm font-normal text-primary">{m.name}</p>
              <p className="text-xs text-[var(--color-text-secondary)]">{m.email} · {m.role === 'exporter_owner' ? 'Owner' : 'Member'}</p>
            </div>
            {isOwner ? (
              <Button
                variant="secondary"
                disabled={busy === m.id}
                onClick={() => void removeMember(m.id)}
                className="min-h-8 px-3 text-xs"
              >
                {busy === m.id ? 'Removing…' : 'Remove'}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {invitations.length > 0 ? (
        <>
          <h3 className="mt-5 text-sm font-semibold text-primary">Pending invitations</h3>
          <ul className="mt-2 space-y-2">
            {invitations.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-[var(--color-border-strong)] p-2.5">
                <div>
                  <p className="text-sm font-normal text-primary">{inv.email}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <StatusChip label="Invite pending" tone="warning" icon="clock" size="sm" />
                    <span className="text-xs text-[var(--color-text-secondary)]">Expires {fmt(inv.expires_at)}</span>
                  </div>
                </div>
                {isOwner ? (
                  <div className="flex gap-1.5">
                    <Button
                      variant="secondary"
                      disabled={busy === inv.id + 'resend'}
                      onClick={() => void invitationAction(inv.id, 'resend')}
                      className="min-h-8 px-2.5 text-xs"
                    >
                      Resend
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy === inv.id + 'revoke'}
                      onClick={() => void invitationAction(inv.id, 'revoke')}
                      className="min-h-8 px-2.5 text-xs"
                    >
                      Revoke
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {isOwner ? (
        <div className="mt-5 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
          <p className="text-xs font-normal text-primary">Invite a team member</p>
          <div className="mt-2 space-y-2">
            <Input label="Email address" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="block">
              <span className="eyebrow mb-2 block">Account role</span>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as typeof role)}
                className="min-h-control w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
              >
                <option value="exporter_member">Member</option>
                <option value="exporter_owner">Owner</option>
              </select>
            </label>
          </div>
          <Button disabled={busy === 'invite' || !email.trim()} onClick={() => void invite()} className="mt-2 min-h-8 px-3 text-xs">
            {busy === 'invite' ? 'Sending…' : 'Send invite'}
          </Button>
        </div>
      ) : (
        <p className="mt-5 text-sm text-[var(--color-text-secondary)]">Only the account owner can invite or remove team members.</p>
      )}
    </section>
  );
}
