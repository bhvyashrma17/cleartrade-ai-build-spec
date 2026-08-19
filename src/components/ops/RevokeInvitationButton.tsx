'use client';

/**
 * Revoke a pending staff invitation.
 *
 * A binary, reversible-by-reissue action with nothing else to record, so this follows the
 * `window.confirm` convention `AssignExporterForm` already uses for unassign — the confirmation
 * text itself carries the target and consequence per item #20, rather than a separate dialog.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiDelete } from '@/lib/api-client';

export function RevokeInvitationButton({
  invitationId, email, role, invitedBy, expiresAt,
}: {
  invitationId: string; email: string; role: string; invitedBy: string; expiresAt: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    const confirmed = window.confirm(
      `Revoke the invitation for ${email} (${role})?\n\nInvited by ${invitedBy} · expires ${expiresAt}.\n\nThe invitation link will stop working immediately. This cannot be undone — send a new invitation if needed.`,
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
