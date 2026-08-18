'use client';

/**
 * Invite an agent.
 *
 * The one-time token is shown once, on success, and never fetched again — it is not stored in
 * readable form, so there is nothing to re-display. Making that explicit in the UI matters: an
 * operator who assumes they can come back for it will strand the invitee.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Input } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function InviteAgentForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; token: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ data: { email: string; token: string } }>(
        '/api/v1/ops/staff-invitations', { email: email.trim() },
      );
      setIssued({ email: result.data.email, token: result.data.token });
      setEmail('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not create the invitation.');
    } finally {
      setBusy(false);
    }
  };

  if (issued) {
    return (
      <div className="rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-3">
        <p className="text-sm font-semibold text-primary">Invitation created for {issued.email}</p>
        <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
          Send this link now. It is shown once and cannot be recovered — if it is lost, revoke the
          invitation and issue a new one.
        </p>
        <code className="mt-2 block break-all rounded bg-surface px-2 py-1.5 text-xs text-primary">
          /accept-staff-invitation?token={issued.token}
        </code>
        <Button type="button" variant="secondary" className="mt-2 min-h-8 px-3 text-xs" onClick={() => setIssued(null)}>
          Invite another
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[16rem] flex-1">
        <Input
          id="invite-agent-email"
          label="Agent email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="agent@cleartrade.example"
          error={error ?? undefined}
        />
      </div>
      <Button type="button" onClick={submit} disabled={busy || !email.trim()}>
        {busy ? 'Creating…' : 'Send invitation'}
      </Button>
    </div>
  );
}
