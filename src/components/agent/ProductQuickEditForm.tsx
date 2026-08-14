'use client';

/** AGT-02 "Products … Quick-edit allowed fields with audit". */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

interface ProductFields {
  capacity_value: string;
  capacity_unit: string;
  moq_value: string;
  moq_unit: string;
  price_target_amount: string;
  price_target_currency: string;
  lead_time_days: string;
  desired_order_size_amount: string;
  desired_order_size_currency: string;
  customization_capability: string;
  packaging_capability: string;
  packaging: string;
}

export function ProductQuickEditForm({ productId, initial }: { productId: string; initial: Partial<ProductFields> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<ProductFields>({
    capacity_value: initial.capacity_value ?? '',
    capacity_unit: initial.capacity_unit ?? '',
    moq_value: initial.moq_value ?? '',
    moq_unit: initial.moq_unit ?? '',
    price_target_amount: initial.price_target_amount ?? '',
    price_target_currency: initial.price_target_currency ?? '',
    lead_time_days: initial.lead_time_days ?? '',
    desired_order_size_amount: initial.desired_order_size_amount ?? '',
    desired_order_size_currency: initial.desired_order_size_currency ?? '',
    customization_capability: initial.customization_capability ?? '',
    packaging_capability: initial.packaging_capability ?? '',
    packaging: initial.packaging ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof ProductFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/products/${productId}`, {
        capacity_value: fields.capacity_value ? Number(fields.capacity_value) : null,
        capacity_unit: fields.capacity_unit || null,
        moq_value: fields.moq_value ? Number(fields.moq_value) : null,
        moq_unit: fields.moq_unit || null,
        price_target_amount: fields.price_target_amount ? Number(fields.price_target_amount) : null,
        price_target_currency: fields.price_target_currency || null,
        lead_time_days: fields.lead_time_days ? Number(fields.lead_time_days) : null,
        desired_order_size_amount: fields.desired_order_size_amount ? Number(fields.desired_order_size_amount) : null,
        desired_order_size_currency: fields.desired_order_size_currency || null,
        customization_capability: fields.customization_capability || null,
        packaging_capability: fields.packaging_capability || null,
        packaging: fields.packaging || null,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save those changes. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
        Quick-edit
      </button>
    );
  }

  return (
    <div className="mt-2 max-w-md rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <label className="col-span-2">
          Capacity
          <div className="mt-0.5 flex gap-1">
            <input value={fields.capacity_value} onChange={set('capacity_value')} placeholder="Value" inputMode="decimal" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
            <input value={fields.capacity_unit} onChange={set('capacity_unit')} placeholder="Unit (e.g. MT/month)" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </div>
        </label>
        <label className="col-span-2">
          MOQ
          <div className="mt-0.5 flex gap-1">
            <input value={fields.moq_value} onChange={set('moq_value')} placeholder="Value" inputMode="decimal" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
            <input value={fields.moq_unit} onChange={set('moq_unit')} placeholder="Unit" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </div>
        </label>
        <label className="col-span-2">
          Target price
          <div className="mt-0.5 flex gap-1">
            <input value={fields.price_target_amount} onChange={set('price_target_amount')} placeholder="Amount" inputMode="decimal" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
            <input value={fields.price_target_currency} onChange={set('price_target_currency')} placeholder="Currency (e.g. USD)" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </div>
        </label>
        <label className="col-span-2">
          Lead time (days)
          <input value={fields.lead_time_days} onChange={set('lead_time_days')} inputMode="numeric" className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
        <label className="col-span-2">
          Desired order size
          <div className="mt-0.5 flex gap-1">
            <input value={fields.desired_order_size_amount} onChange={set('desired_order_size_amount')} placeholder="Amount" inputMode="decimal" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
            <input value={fields.desired_order_size_currency} onChange={set('desired_order_size_currency')} placeholder="Currency" className="w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </div>
        </label>
        <label className="col-span-2">Customization capability<textarea value={fields.customization_capability} onChange={set('customization_capability')} className="mt-0.5 min-h-16 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" /></label>
        <label className="col-span-2">Packaging capability<textarea value={fields.packaging_capability} onChange={set('packaging_capability')} className="mt-0.5 min-h-16 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" /></label>
        <label className="col-span-2">
          Packaging
          <input value={fields.packaging} onChange={set('packaging')} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
      </div>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
