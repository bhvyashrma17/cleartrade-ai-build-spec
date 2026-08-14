'use client';

/**
 * AGT-08 "Raise payout query". The ONLY payout write an agent has, and it changes no
 * figure — it opens a finance case. There is deliberately no amount input anywhere in
 * this component (AGT-08-AC01).
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function RaisePayoutQueryButton({ payoutId }: { payoutId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/payouts/${payoutId}/query`, { reason: reason.trim() });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not raise that query. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
        Raise a query
      </button>
    );
  }

  return (
    <div className="mt-1.5 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <label className="block text-xs font-medium text-primary" htmlFor={`payout-query-${payoutId}`}>
        What looks wrong with this payout?
      </label>
      <textarea
        id={`payout-query-${payoutId}`}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
      />
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">This opens a finance case. It does not change the calculation.</p>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy || reason.trim().length < 5} onClick={() => void submit()} className="min-h-7 px-2.5 text-xs">
          {busy ? 'Sending…' : 'Raise query'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-7 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
