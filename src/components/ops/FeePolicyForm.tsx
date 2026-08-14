'use client';

/** OPS-07 config registry — fee policy is a structured form (concrete numeric fields), unlike the generic JSON editor. */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export interface FeePolicyFields {
  commitment_fee_amount: string;
  commitment_fee_currency: string;
  success_fee_rate: string;
  small_shipment_threshold_amount: string;
  small_shipment_threshold_currency: string;
  small_shipment_rate: string;
  small_shipment_flat_amount: string;
  agent_share_rate: string;
  minimum_shipment_amount: string;
  minimum_shipment_currency: string;
}

export function FeePolicyForm({ initial }: { initial: FeePolicyFields }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof FeePolicyFields) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/v1/fee-policy', {
        commitment_fee_amount: Number(fields.commitment_fee_amount),
        commitment_fee_currency: fields.commitment_fee_currency,
        success_fee_rate: Number(fields.success_fee_rate),
        small_shipment_threshold_amount: Number(fields.small_shipment_threshold_amount),
        small_shipment_threshold_currency: fields.small_shipment_threshold_currency,
        small_shipment_rate: Number(fields.small_shipment_rate),
        small_shipment_flat_amount: Number(fields.small_shipment_flat_amount),
        agent_share_rate: Number(fields.agent_share_rate),
        minimum_shipment_amount: Number(fields.minimum_shipment_amount),
        minimum_shipment_currency: fields.minimum_shipment_currency,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save the new fee policy version. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
        New version
      </button>
    );
  }

  const FIELDS: { key: keyof FeePolicyFields; label: string }[] = [
    { key: 'commitment_fee_amount', label: 'Commitment fee amount' },
    { key: 'commitment_fee_currency', label: 'Commitment fee currency' },
    { key: 'success_fee_rate', label: 'Success fee rate (0-1)' },
    { key: 'small_shipment_threshold_amount', label: 'Small shipment threshold amount' },
    { key: 'small_shipment_threshold_currency', label: 'Small shipment threshold currency' },
    { key: 'small_shipment_rate', label: 'Small shipment rate (0-1)' },
    { key: 'small_shipment_flat_amount', label: 'Small shipment flat amount' },
    { key: 'agent_share_rate', label: 'Agent share rate (0-1)' },
    { key: 'minimum_shipment_amount', label: 'Minimum shipment amount' },
    { key: 'minimum_shipment_currency', label: 'Minimum shipment currency' },
  ];

  return (
    <div className="mt-2 rounded-md border border-[color-mix(in_srgb,var(--color-warning)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_6%,transparent)] p-3">
      <p className="text-xs font-semibold text-primary">High-risk: this becomes the active fee policy for every deal locked from now on.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        {FIELDS.map((f) => (
          <label key={f.key}>
            {f.label}
            <input value={fields[f.key]} onChange={set(f.key)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </label>
        ))}
      </div>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Saving…' : 'Save new version'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
