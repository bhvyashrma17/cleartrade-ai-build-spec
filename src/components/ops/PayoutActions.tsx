'use client';

/**
 * OPS-05 finance-only payout controls: approve, mark paid, and the additive adjustment.
 *
 * Only the transitions the payout state machine actually allows from the current state
 * are offered — the same table the server enforces, so a disallowed move is never
 * presented and then rejected.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch, apiPost } from '@/lib/api-client';

type Mode = 'paid' | 'adjust' | null;

export function PayoutActions({ payoutId, state }: { payoutId: string; state: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [reference, setReference] = useState('');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setMode(null);
      setReference('');
      setAdjustAmount('');
      setAdjustReason('');
      setConfirmed(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not complete that. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'paid') {
    return (
      <div className="mt-1.5 max-w-xs rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
        <label className="block text-xs font-medium text-primary" htmlFor={`ref-${payoutId}`}>
          Transfer reference
        </label>
        <input
          id={`ref-${payoutId}`}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          className="record mt-1 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring"
        />
        {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button
            disabled={busy || !reference.trim()}
            onClick={() => void run(() => apiPatch(`/api/v1/payouts/${payoutId}`, { to: 'paid', payment_reference: reference.trim() }))}
            className="min-h-7 px-2.5 text-xs"
          >
            {busy ? 'Saving…' : 'Confirm paid'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode(null)} className="min-h-7 px-2.5 text-xs">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (mode === 'adjust') {
    return (
      <div className="mt-1.5 max-w-xs rounded-md border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-2.5">
        <p className="text-xs font-semibold text-primary">
          High-risk: this appends an adjustment record. The original quote is never rewritten.
        </p>
        <label className="mt-1.5 block text-xs font-medium text-primary">
          Amount (negative to claw back)
          <input
            value={adjustAmount}
            onChange={(e) => setAdjustAmount(e.target.value)}
            inputMode="decimal"
            className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
          />
        </label>
        <label className="mt-1.5 block text-xs font-medium text-primary">
          Reason
          <input
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
          />
        </label>
        <label className="mt-1.5 flex items-center gap-1.5 text-xs text-primary">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm this adjustment.
        </label>
        {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button
            disabled={busy || !adjustAmount.trim() || adjustReason.trim().length < 5 || !confirmed || Number.isNaN(Number(adjustAmount))}
            onClick={() =>
              void run(() =>
                apiPost(`/api/v1/payouts/${payoutId}/adjustments`, {
                  amount: Number(adjustAmount),
                  reason: adjustReason.trim(),
                  confirm: true,
                }),
              )
            }
            className="min-h-7 px-2.5 text-xs"
          >
            {busy ? 'Saving…' : 'Add adjustment'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode(null)} className="min-h-7 px-2.5 text-xs">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {state === 'eligible' ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => apiPatch(`/api/v1/payouts/${payoutId}`, { to: 'approved' }))}
            className="min-h-8 px-2.5 text-xs"
          >
            Approve
          </Button>
        ) : null}
        {state === 'approved' ? (
          <Button variant="secondary" disabled={busy} onClick={() => setMode('paid')} className="min-h-8 px-2.5 text-xs">
            Mark paid
          </Button>
        ) : null}
        {state !== 'not_eligible' ? (
          <Button variant="secondary" disabled={busy} onClick={() => setMode('adjust')} className="min-h-8 px-2.5 text-xs">
            Adjust
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
