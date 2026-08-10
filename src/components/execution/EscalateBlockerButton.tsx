'use client';

/**
 * AGT-06 "Escalate blocker → Exception to Ops → Dedup / open case link".
 *
 * When the server dedupes (`dispute_created: false`) this says so and links the open
 * case, rather than pretending a second escalation was raised.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function EscalateBlockerButton({ dealId, gate, gateLabel }: { dealId: string; gate: string; gateLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ created: boolean; link: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiPost<{ data: { dispute_created: boolean; case_link: string } }>(
        `/api/v1/deals/${dealId}/escalate`,
        { reason: reason.trim(), gate, severity: 'high' },
      );
      setResult({ created: res.data.dispute_created, link: res.data.case_link });
      setOpen(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not escalate. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => { setOpen(true); setResult(null); }} className="min-h-8 px-2.5 text-xs">
          Escalate to Ops
        </Button>
        {result ? (
          <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
            {result.created ? 'Ops exception opened. ' : 'Linked to the Ops case already open for this deal. '}
            <Link href={result.link} className="font-medium text-primary underline underline-offset-2">
              Open case
            </Link>
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-1.5 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <label className="block text-xs font-medium text-primary">
        Why does Ops need to step in on “{gateLabel}”?
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy || reason.trim().length === 0} onClick={() => void submit()} className="min-h-8 px-2.5 text-xs">
          {busy ? 'Sending…' : 'Escalate'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
