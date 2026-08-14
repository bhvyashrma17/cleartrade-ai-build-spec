'use client';

/** OPS-04-AC03 "Override requirement | Restricted Ops | reason/audit | High-risk confirm". */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function OverrideRequirementForm({ dealId, documentId }: { dealId: string; documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/documents/${documentId}/override`, { reason: reason.trim(), confirm: true });
      setOpen(false);
      setReason('');
      setConfirmed(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save the override. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-[var(--color-critical-text)] underline underline-offset-2">
        Override requirement
      </button>
    );
  }

  return (
    <div className="mt-1.5 max-w-sm rounded-md border border-[color-mix(in_srgb,var(--color-critical)_35%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_6%,transparent)] p-2.5">
      <p className="text-xs font-semibold text-[var(--color-critical-text)]">High-risk: waives this document's filing requirement.</p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="Why does this requirement not apply? (minimum 10 characters)"
        className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
      />
      <label className="mt-1.5 flex items-center gap-1.5 text-xs text-primary">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I understand this bypasses the normal filing check.
      </label>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy || reason.trim().length < 10 || !confirmed} onClick={() => void submit()} className="min-h-7 px-2.5 text-xs">
          {busy ? 'Saving…' : 'Confirm override'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-7 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
