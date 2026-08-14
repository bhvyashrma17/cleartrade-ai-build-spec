'use client';

/** AGT-04 "No fit → Disqualify with reason". */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

const REASONS = [
  { value: 'no_response', label: 'No response' },
  { value: 'not_importing_category', label: 'Not importing this category' },
  { value: 'volume_too_small', label: 'Volume too small' },
  { value: 'price_mismatch', label: 'Price mismatch' },
  { value: 'risk_flag', label: 'Risk flag' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Other' },
];

export function DisqualifyLeadForm({ buyerLeadId }: { buyerLeadId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('no_response');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/leads/${buyerLeadId}/disqualify`, {
        disqualification_reason: reason,
        disqualification_reason_text: text.trim() || undefined,
      });
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not disqualify this lead. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="min-h-8 px-3 text-xs">
        Disqualify
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3">
      <label className="block text-xs font-medium text-primary">
        Reason
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-sm text-primary focus-visible-ring">
          {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="Additional detail (optional)" className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Disqualifying…' : 'Confirm disqualify'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
