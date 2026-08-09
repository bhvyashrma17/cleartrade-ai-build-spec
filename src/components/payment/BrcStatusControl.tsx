'use client';

/**
 * EXP-15-AC04: this control only ever calls `action: 'update_brc'`, a completely
 * separate branch server-side from the payment-status update — it cannot touch
 * `status`/`received_at`/`realized_at` even if it wanted to.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';
import type { BrcStatus } from '@prisma/client';

const NEXT: Partial<Record<BrcStatus, BrcStatus>> = {
  not_applicable: 'pending',
  pending: 'available',
  available: 'verified',
};

const LABEL: Record<BrcStatus, string> = {
  not_applicable: 'Mark BRC pending',
  pending: 'Mark BRC available',
  available: 'Mark BRC verified',
  verified: 'BRC verified',
};

export function BrcStatusControl({ dealId, paymentId, brcStatus }: { dealId: string; paymentId: string; brcStatus: BrcStatus }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT[brcStatus];

  if (!next) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/payment/${paymentId}`, { action: 'update_brc', to: next });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update BRC status. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button variant="secondary" disabled={busy} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
        {busy ? 'Updating…' : LABEL[brcStatus]}
      </Button>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
