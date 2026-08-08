'use client';

/**
 * EXP-12 "Upload replacement/supporting file". Always creates a NEW version server-side
 * (EXP-12-AC04) — this component just posts the file and refreshes; it has no way to
 * target an existing row even if it wanted to.
 */

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { ApiClientError } from '@/lib/api-client';

export function UploadReplacement({ dealId, documentId }: { dealId: string; documentId: string }) {
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
      const res = await fetch(`/api/v1/deals/${dealId}/documents/${documentId}/upload`, { method: 'POST', body: form });
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
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-primary">Upload a replacement</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Uploading always creates a new version — this one stays exactly as it is.
      </p>
      {error ? <p className="mt-2 text-sm text-[var(--color-critical-text)]">{error}</p> : null}
      <input
        ref={inputRef}
        type="file"
        disabled={busy}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
        className="mt-3 block text-sm text-primary file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-primary"
      />
      {busy ? <p className="mt-2 text-xs text-[var(--color-text-secondary)]">Uploading…</p> : null}
    </div>
  );
}
