'use client';

/**
 * EXP-14 "Raise issue" (AC04). The server dedupes — this component just shows what came
 * back (`dispute_created: false` means it linked the existing open case) so the exporter
 * knows a duplicate wasn't opened.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function RaiseIssueButton({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [severity, setSeverity] = useState<'watch' | 'blocked'>('blocked');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ dispute_created: boolean } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: { dispute_id: string; dispute_created: boolean } }>(
        `/api/v1/deals/${dealId}/shipment/issue`,
        { reason, severity },
      );
      setResult({ dispute_created: res.data.dispute_created });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not raise the issue. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => { setOpen(true); setResult(null); }} className="min-h-8 px-3 text-xs">
          Raise issue
        </Button>
        {result ? (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {result.dispute_created ? 'A new case was opened.' : 'Linked to the case already open for this shipment.'}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <label className="block text-xs font-medium text-primary">
        Severity
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as 'watch' | 'blocked')}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          <option value="watch">Watch — worth flagging, not yet blocking</option>
          <option value="blocked">Blocked — this is halting the shipment</option>
        </select>
      </label>
      <label className="mt-2 block text-xs font-medium text-primary">
        What is the issue?
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p className="mt-2 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || reason.trim().length === 0} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Sending…' : 'Submit'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
