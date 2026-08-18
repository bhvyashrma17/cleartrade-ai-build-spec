'use client';

/**
 * Agent review actions for one document version.
 *
 * Deliberately offers "Mark reviewed" and "Flag changes needed" — not Approve. ClearTrade
 * separates duties: the permission matrix records `document.approve: { agent: \'none\' }` with
 * the note "Cannot impersonate exporter", so approval belongs to the exporter and the split is
 * stated here rather than left implicit in an absent button.
 *
 * Review notes are internal. They go to `InternalNote` and are never printed on a generated
 * document, which is why the field says so.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function ReviewPanel({
  dealId, documentId, canReview, canAmend, reviewStatus, approvalStatus,
}: {
  dealId: string;
  documentId: string;
  canReview: boolean;
  canAmend: boolean;
  reviewStatus: string;
  approvalStatus: string;
}) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (kind: string, fn: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      setNote('');
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'That did not work. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const review = (outcome: 'reviewed' | 'changes_needed') =>
    run(outcome, () => apiPost(`/api/v1/deals/${dealId}/documents/${documentId}/review`, {
      outcome, note: note.trim() || undefined,
    }));

  const amend = () =>
    run('amend', async () => {
      const created = await apiPost<{ data: { id: string } }>(
        `/api/v1/deals/${dealId}/documents/${documentId}/amend`, { reason: reason.trim() },
      );
      router.push(`/agent/deals/${dealId}/documents/${created.data.id}`);
    });

  return (
    <section className="rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card">
      <h2 className="text-sm font-semibold text-primary">Agent review</h2>
      <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
        Your review says this version is fit to put in front of the exporter. Approval is the
        exporter&apos;s decision — agents cannot approve on their behalf.
      </p>

      {canReview ? (
        <div className="mt-3">
          <label className="block text-sm font-medium text-primary" htmlFor="review-note">
            <span className="mb-1 block">Internal note (optional)</span>
            <textarea
              id="review-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Visible to agents and Ops only. Never printed on the document."
              className="focus-visible-ring w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary"
            />
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" onClick={() => review('reviewed')} disabled={busy !== null}>
              {busy === 'reviewed' ? 'Saving…' : 'Mark reviewed'}
            </Button>
            <Button type="button" variant="secondary" onClick={() => review('changes_needed')} disabled={busy !== null}>
              {busy === 'changes_needed' ? 'Saving…' : 'Flag changes needed'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          {approvalStatus === 'exporter_approved'
            ? 'This version is approved and frozen. Create an amendment to correct it.'
            : `Review is available once this version is generated (currently ${reviewStatus}).`}
        </p>
      )}

      {canAmend ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <h3 className="text-sm font-semibold text-primary">Create amendment</h3>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            Produces the next version from current canonical data. This version stays exactly as
            it is, with its files and approval intact.
          </p>
          <label className="mt-2 block text-sm font-medium text-primary" htmlFor="amend-reason">
            <span className="mb-1 block">Reason</span>
            <input
              id="amend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Buyer address corrected"
              className="focus-visible-ring w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary"
            />
          </label>
          <Button type="button" variant="secondary" className="mt-2" onClick={amend} disabled={busy !== null || !reason.trim()}>
            {busy === 'amend' ? 'Creating…' : 'Create amendment'}
          </Button>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-2 text-sm text-[var(--color-danger)]">{error}</p> : null}
    </section>
  );
}
