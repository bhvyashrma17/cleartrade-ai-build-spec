"use client";

/**
 * Explicit confirmation before an account changes role.
 *
 * The whole point of this component is that it is a second, deliberate act. Opening the
 * invitation link renders it; nothing converts until the operator presses the button, so a
 * link that gets prefetched, previewed or scanned cannot change anyone's role.
 *
 * The only thing sent to the server is the token. The account being converted is whoever the
 * session says is signed in, resolved server-side — this is a bearer invitation, so that is the
 * entire identity check: there is no invited address on the link to compare against.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ConvertToAgentPanel({ token, currentEmail }: { token: string; currentEmail: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/v1/staff-invitations/convert', { token });
      // Server-authoritative: the session's role has changed, so refresh before navigating
      // rather than trusting a client-side guess about what the agent portal will allow.
      router.refresh();
      router.push('/agent');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not accept the invitation. Try again.');
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">You are signed in as:</p>
      <p className="mt-1 text-sm font-normal text-primary">{currentEmail}</p>

      <div className="mt-4 rounded border border-[var(--color-border)] bg-surface-muted px-3 py-2">
        <p className="text-sm text-primary">
          This invitation will convert this ClearTrade account to an <strong>Agent</strong> account.
        </p>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          After conversion you will use the Agent workspace instead of the Exporter workspace.
          Your sign-in details do not change.
        </p>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] px-3 py-2 text-sm text-[var(--color-critical-text)]">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => router.push('/')} disabled={busy}>
          Cancel
        </Button>
        <Button type="button" onClick={confirm} disabled={busy}>
          {busy ? 'Converting…' : 'Confirm and become an Agent'}
        </Button>
      </div>
    </div>
  );
}
