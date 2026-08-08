'use client';

/**
 * EXP-13 approval panel. Approve / request-changes are bound to the exact
 * (version, checksum) the exporter is looking at (docs/07 §7.3) — a 409 VERSION_CONFLICT
 * means the document changed underneath them (regenerated, most likely) and they must
 * reload before deciding, never a silent retry against content they never saw.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, StatusChip } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

export function DocumentApprovalPanel({
  dealId,
  documentId,
  version,
  checksum,
}: {
  dealId: string;
  documentId: string;
  version: number;
  checksum: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'requesting'>('idle');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setStale(false);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/documents/${documentId}`, { ...payload, version, checksum });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'VERSION_CONFLICT') {
        setStale(true);
        setError('This document changed since you opened it. Reload before approving or requesting changes.');
      } else {
        setError(e instanceof ApiClientError ? e.message : 'Could not complete that action. Please retry.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-surface p-5 shadow-card">
      <h2 className="text-lg font-semibold text-primary">Your decision</h2>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        Approving is recorded against this exact version and checksum.
      </p>

      {error ? (
        <div role="alert" className="mt-3 rounded-md border border-[color-mix(in_srgb,var(--color-critical)_25%,transparent)] bg-[color-mix(in_srgb,var(--color-critical)_5%,transparent)] p-3 text-sm text-[var(--color-critical-text)]">
          <p className="font-medium">{error}</p>
          {stale ? (
            <button type="button" onClick={() => router.refresh()} className="mt-2 font-medium underline underline-offset-2">
              Reload
            </button>
          ) : null}
        </div>
      ) : null}

      {mode === 'idle' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button disabled={busy || stale} onClick={() => void run({ action: 'approve' })}>
            {busy ? 'Working…' : `Approve version ${version}`}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('requesting')}>
            Request changes
          </Button>
        </div>
      ) : (
        <div className="mt-4">
          <label className="block text-sm font-medium text-primary" htmlFor="doc-change-note">
            What needs to change?
          </label>
          <textarea
            id="doc-change-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy || note.trim().length === 0 || stale} onClick={() => void run({ action: 'request_changes', note: note.trim() })}>
              {busy ? 'Sending…' : 'Send to your agent'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => { setMode('idle'); setNote(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4">
        <StatusChip label="Bound to this version" tone="info" icon="dot" size="sm" detail={`Checksum ${checksum.slice(0, 12)}…`} />
      </div>
    </div>
  );
}
