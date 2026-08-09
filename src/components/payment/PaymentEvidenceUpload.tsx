'use client';

/** EXP-15 payment evidence upload — appends to `Payment.evidence_refs`, mirrors shipment's. */

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ApiClientError } from '@/lib/api-client';

export function PaymentEvidenceUpload({ dealId, paymentId }: { dealId: string; paymentId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/v1/deals/${dealId}/payment/${paymentId}/evidence`, { method: 'POST', body: form });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new ApiClientError(body ?? { error: { code: 'INTERNAL_ERROR', message: 'Upload failed.' }, correlation_id: 'client_unknown' }, res.status);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not upload that file. Please retry.');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="block text-xs text-primary file:mr-2 file:rounded file:border-0 file:bg-surface-muted file:px-2 file:py-1 file:text-xs file:font-medium file:text-primary"
      />
      {busy ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Uploading…</p> : null}
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
