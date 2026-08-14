'use client';

/** AGT-04 "Verify contact | Update verification status with evidence | Audit". */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function VerifyContactForm({ contactId }: { contactId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<'unverified' | 'partially_verified' | 'verified'>('verified');
  const [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/buyer-contacts/${contactId}/verify`, { verification_status: status, evidence: evidence.trim() });
      setOpen(false);
      setEvidence('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save verification. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
        Verify contact
      </button>
    );
  }

  return (
    <div className="mt-1.5 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <label className="block text-xs text-primary">
        Verification status
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring">
          <option value="verified">Verified</option>
          <option value="partially_verified">Partially verified</option>
          <option value="unverified">Unverified</option>
        </select>
      </label>
      <textarea
        value={evidence}
        onChange={(e) => setEvidence(e.target.value)}
        rows={2}
        placeholder="What evidence supports this? (e.g. call confirmed, email replied from domain)"
        className="mt-1.5 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
      />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy || evidence.trim().length === 0} onClick={() => void submit()} className="min-h-7 px-2.5 text-xs">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-7 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
