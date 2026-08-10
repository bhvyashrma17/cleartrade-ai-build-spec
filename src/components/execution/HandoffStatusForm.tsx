'use client';

/** AGT-06-AC02: capture what the partner sent back — status + their reference. */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

const NEXT_STATUS: Record<string, { value: string; label: string }[]> = {
  pending: [{ value: 'sent', label: 'Mark sent' }],
  sent: [
    { value: 'acknowledged', label: 'Partner acknowledged' },
    { value: 'rejected', label: 'Partner declined' },
  ],
  acknowledged: [
    { value: 'completed', label: 'Mark complete' },
    { value: 'rejected', label: 'Partner declined' },
  ],
  completed: [],
  rejected: [],
};

export function HandoffStatusForm({
  dealId,
  handoffId,
  status,
  reference,
}: {
  dealId: string;
  handoffId: string;
  status: string;
  reference: string | null;
}) {
  const router = useRouter();
  const [ref, setRef] = useState(reference ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = NEXT_STATUS[status] ?? [];

  const submit = async (to: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/partners`, {
        handoff_id: handoffId,
        status: to,
        reference: ref.trim() || null,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update the handoff. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (options.length === 0) return null;

  return (
    <div className="mt-2">
      <label className="block text-xs font-medium text-primary">
        Partner reference
        <input
          type="text"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          placeholder="Job / booking number they quoted"
          className="mt-1 w-full max-w-xs rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((o) => (
          <Button
            key={o.value}
            variant="secondary"
            disabled={busy}
            onClick={() => void submit(o.value)}
            className="min-h-8 px-3 text-xs"
          >
            {busy ? 'Saving…' : o.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
