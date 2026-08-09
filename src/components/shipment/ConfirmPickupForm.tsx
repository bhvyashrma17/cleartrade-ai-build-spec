'use client';

/**
 * EXP-14 "Confirm pickup". The request body this posts is `confirmPickupSchema` — pickup
 * fields only, structurally incapable of carrying `booking_ref`/`customs_ref`/
 * `shipping_bill_no`/`cha_partner_id`/`freight_partner_id` (EXP-14-AC03).
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ConfirmPickupForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    pickup_window_start: '',
    pickup_window_end: '',
    contact_name: '',
    contact_phone: '',
    address: '',
  });

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/shipment/pickup`, form);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not confirm pickup. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="min-h-8 px-3 text-xs">
        Confirm pickup
      </Button>
    );
  }

  const allFilled = Object.values(form).every((v) => v.trim().length > 0);

  return (
    <div className="mt-2 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <div className="space-y-2">
        <label className="block text-xs font-medium text-primary">
          Pickup window start
          <input
            type="datetime-local"
            value={form.pickup_window_start}
            onChange={(e) => setForm((f) => ({ ...f, pickup_window_start: e.target.value }))}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
        <label className="block text-xs font-medium text-primary">
          Pickup window end
          <input
            type="datetime-local"
            value={form.pickup_window_end}
            onChange={(e) => setForm((f) => ({ ...f, pickup_window_end: e.target.value }))}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
        <label className="block text-xs font-medium text-primary">
          Contact name
          <input
            type="text"
            value={form.contact_name}
            onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
        <label className="block text-xs font-medium text-primary">
          Contact phone
          <input
            type="text"
            value={form.contact_phone}
            onChange={(e) => setForm((f) => ({ ...f, contact_phone: e.target.value }))}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
        <label className="block text-xs font-medium text-primary">
          Pickup address
          <input
            type="text"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
      </div>
      {error ? <p className="mt-2 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <Button disabled={busy || !allFilled} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Confirming…' : 'Confirm'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
