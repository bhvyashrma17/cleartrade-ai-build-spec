'use client';

/**
 * Revoke a pending bearer invitation link.
 *
 * A binary, reversible-by-reissue action with nothing else to record, so this follows the
 * `window.confirm` convention `AssignExporterForm` already uses for unassign — the confirmation
 * text itself carries the target and consequence per item #20, rather than a separate dialog.
 *
 * No email in the prompt: a bearer invitation carries no invited address, so there is nothing
 * to name beyond who created it and when.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiDelete } from '@/lib/api-client';

export function RevokeInvitationButton({
  invitationId, createdBy, createdAt, expiresAt,
}: {
  invitationId: string; createdBy: string; createdAt: string; expiresAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    const confirmed = window.confirm(
      `Revoke this agent invitation link?\n\nCreated by ${createdBy} on ${createdAt} · expires ${expiresAt}.\n\nThe link will stop working immediately, whether or not anyone has already opened it. This cannot be undone — generate a new link if needed.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete('/api/v1/ops/staff-invitations', { invitation_id: invitationId });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not revoke the invitation.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-right">
      <Button type="button" variant="secondary" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={() => void revoke()}>
        {busy ? 'Revoking…' : 'Revoke'}
      </Button>
      {error ? <p role="alert" className="mt-1 text-xs text-critical">{error}</p> : null}
    </div>
  );
}
