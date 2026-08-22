'use client';

/** EXP-16 "Accept resolution" — requires explicit confirmation, mirrors the two-step
 * pattern used elsewhere (e.g. DocumentApprovalPanel's request-changes flow). */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

export function AcceptResolutionButton({ dealId, disputeId }: { dealId: string; disputeId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, { action: 'accept', confirm: true });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not accept the resolution. Please retry.');
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (!confirming) {
    return (
      <div>
        <Button onClick={() => setConfirming(true)} className="min-h-8 px-3 text-xs">
          Accept resolution
        </Button>
        {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-2.5 text-xs">
      <p className="font-normal text-primary">Accepting closes this case. This cannot be undone.</p>
      {error ? <p className="mt-1 text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy} onClick={() => void accept()} className="min-h-8 px-2.5 text-xs">
          {busy ? 'Confirming…' : 'Confirm acceptance'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)} className="min-h-8 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
