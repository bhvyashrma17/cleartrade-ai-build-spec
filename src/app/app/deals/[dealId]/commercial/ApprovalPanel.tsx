'use client';

/**
 * EXP-10 approval panel — the exporter's approve / request-changes actions.
 *
 * Both actions send the proposal `version` (EXP-10-AC01: approval references an
 * immutable version id) AND the `deal_version` optimistic-concurrency token. A stale
 * token comes back as 409 VERSION_CONFLICT, and this panel renders that as a plain
 * "these terms changed, reload" rather than retrying — a silent retry would approve the
 * version the user never actually read.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

export function ApprovalPanel({
  dealId,
  proposalVersion,
  dealVersion,
}: {
  dealId: string;
  proposalVersion: number;
  dealVersion: number;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'requesting'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleConflict, setStaleConflict] = useState(false);

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setStaleConflict(false);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/proposals`, { ...payload, version: proposalVersion, deal_version: dealVersion });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'VERSION_CONFLICT') {
        setStaleConflict(true);
        setError('These terms changed while this page was open. Reload to see the current version before approving.');
      } else {
        setError(e instanceof ApiClientError ? e.message : 'Could not complete that action. Please retry.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-primary">Your decision on version {proposalVersion}</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Approving records your acceptance of this exact version. Your agent cannot approve terms on your
        behalf.
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3 text-sm text-[var(--color-critical-text)]"
        >
          <p className="font-normal">{error}</p>
          {staleConflict ? (
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-2 font-medium underline underline-offset-2"
            >
              Reload the current version
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'idle' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || staleConflict} onClick={() => void run({ action: 'approve' })}>
            {busy ? 'Working…' : `Approve version ${proposalVersion}`}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('requesting')}>
            Request changes
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <label className="block text-sm font-medium text-primary" htmlFor="change-note">
            What needs to change?
          </label>
          <textarea
            id="change-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
            placeholder="e.g. We need 60 days to ship, not 30."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={busy || note.trim().length === 0 || staleConflict}
              onClick={() => void run({ action: 'request_changes', note: note.trim() })}
            >
              {busy ? 'Sending…' : 'Send to your agent'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setMode('idle'); setNote(''); }}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
            This creates a task for your agent and keeps the current version on record — nothing is
            overwritten.
          </p>
        </div>
      )}

      <div className="mt-4">
        <StatusChip
          label="Approval is version-specific"
          tone="info"
          icon="dot"
          size="sm"
          detail={`Your approval will be recorded against version ${proposalVersion} only.`}
        />
      </div>
    </div>
  );
}
