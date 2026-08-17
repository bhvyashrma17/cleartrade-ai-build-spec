'use client';

/**
 * EXP-03 evidence upload. "Rejected evidence → show reason + re-upload CTA" is the
 * `latestEvidence.review_status === 'rejected'` branch below — the reason renders
 * inline and the SAME upload control is the re-upload CTA, not a separate button.
 * "Waiting review → task locked from duplicate submission" is why the upload control
 * disappears entirely while `review_status === 'pending'`.
 */

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { StatusChip } from '@/components/ui';
import { ApiClientError } from '@/lib/api-client';
import { EVIDENCE_REVIEW_DISPLAY, enablementChip } from './statusDisplay';

interface EvidenceDTO {
  id: string;
  file_name: string;
  review_status: string;
  review_note: string | null;
  uploaded_at: string;
}

export function EvidenceUploadForm({ taskId, latestEvidence }: { taskId: string; latestEvidence: EvidenceDTO | null }) {
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
      const res = await fetch(`/api/v1/tasks/${taskId}/evidence`, { method: 'POST', body: form });
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

  const isPendingReview = latestEvidence?.review_status === 'pending';

  return (
    <div>
      {latestEvidence ? (
        <div className="mb-2 rounded-md border border-[var(--color-border)] bg-surface-muted p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-primary">{latestEvidence.file_name}</span>
            <StatusChip {...enablementChip(EVIDENCE_REVIEW_DISPLAY, latestEvidence.review_status)} size="sm" />
          </div>
          {latestEvidence.review_status === 'rejected' && latestEvidence.review_note ? (
            <p className="mt-1 text-xs text-[var(--color-critical-text)]">{latestEvidence.review_note}</p>
          ) : null}
        </div>
      ) : null}

      {isPendingReview ? (
        <p className="text-xs text-[var(--color-text-secondary)]">
          Your evidence is waiting on review — you&apos;ll see the outcome here.
        </p>
      ) : (
        <>
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
          {latestEvidence?.review_status === 'rejected' ? (
            <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Upload a corrected file above to re-submit.</p>
          ) : null}
        </>
      )}
      {busy ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Uploading…</p> : null}
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
