'use client';

/**
 * EXP-15 "Record a payment update". Every submission requires `source` (provenance,
 * AC02) and, for a receipt, an amount — `partially_received` vs `received` is validated
 * server-side by `assertPaymentTransition` (EXP-15-AC03), this form just offers both.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';
import type { PaymentSource, PaymentStatus } from '@prisma/client';

const TARGET_OPTIONS: { value: PaymentStatus; label: string }[] = [
  { value: 'partially_received', label: 'Partially received' },
  { value: 'received', label: 'Received in full' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'disputed', label: 'Disputed' },
];

const SOURCE_OPTIONS: { value: PaymentSource; label: string }[] = [
  { value: 'exporter_update', label: 'Exporter update' },
  { value: 'AA', label: 'AA-verified' },
  { value: 'bank_partner', label: 'Bank partner' },
  { value: 'manual_ops', label: 'Ops (manual)' },
];

export function PaymentStatusForm({ dealId, paymentId }: { dealId: string; paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<PaymentStatus>('partially_received');
  const [source, setSource] = useState<PaymentSource>('bank_partner');
  const [amountReceived, setAmountReceived] = useState('');
  const [note, setNote] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsAmount = to === 'partially_received' || to === 'received';
  const needsDisputeReason = to === 'disputed';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/payment/${paymentId}`, {
        action: 'update_status',
        to,
        source,
        amount_received: needsAmount ? Number(amountReceived) : null,
        note: note.trim() || null,
        dispute_reason: needsDisputeReason ? disputeReason.trim() : null,
      });
      setOpen(false);
      setNote('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not record that update. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="min-h-8 px-3 text-xs">
        Record payment update
      </Button>
    );
  }

  const canSubmit = (!needsAmount || amountReceived.trim().length > 0) && (!needsDisputeReason || disputeReason.trim().length > 0);

  return (
    <div className="mt-2 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <label className="block text-xs font-medium text-primary">
        New status
        <select
          value={to}
          onChange={(e) => setTo(e.target.value as PaymentStatus)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          {TARGET_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      <label className="mt-2 block text-xs font-medium text-primary">
        Source (provenance)
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as PaymentSource)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          {SOURCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </label>
      {needsAmount ? (
        <label className="mt-2 block text-xs font-medium text-primary">
          Amount received
          <input
            type="number"
            min="0"
            step="0.01"
            value={amountReceived}
            onChange={(e) => setAmountReceived(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
      ) : null}
      {needsDisputeReason ? (
        <label className="mt-2 block text-xs font-medium text-primary">
          What is being disputed?
          <textarea
            value={disputeReason}
            onChange={(e) => setDisputeReason(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
      ) : null}
      <label className="mt-2 block text-xs font-medium text-primary">
        Note (optional)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p className="mt-2 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !canSubmit} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
