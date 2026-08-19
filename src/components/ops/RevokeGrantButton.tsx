'use client';

/** Revoke a pending pre-authorization before anyone claims it. Same convention as revoking an invitation. */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiDelete } from '@/lib/api-client';

export function RevokeGrantButton({ grantId, email, grantedBy }: { grantId: string; email: string; grantedBy: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revoke = async () => {
    const confirmed = window.confirm(
      `Revoke the pending agent pre-authorization for ${email}?\n\nGranted by ${grantedBy}.\n\nIf that person signs in afterwards, they will get an ordinary exporter account instead. This cannot be undone — grant it again if needed.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete('/api/v1/ops/staff-access-grants', { grant_id: grantId });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not revoke this pre-authorization.');
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
