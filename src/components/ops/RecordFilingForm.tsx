'use client';

/**
 * OPS-04 "Record filing/reference | External reference + evidence + date | Required
 * fields by doc type". Reuses the same `.../documents/:id/file` route AGT-06's agent
 * workspace calls — one filing state machine, one server-side gate, two portals.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

const TARGETS = [
  { value: 'ready', label: 'Mark ready to file' },
  { value: 'filed', label: 'Mark filed' },
  { value: 'accepted', label: 'Mark accepted' },
  { value: 'rejected', label: 'Mark rejected' },
];

export function RecordFilingForm({ dealId, documentId, allowedTargets }: { dealId: string; documentId: string; allowedTargets: string[] }) {
  const router = useRouter();
  const options = TARGETS.filter((t) => allowedTargets.includes(t.value));
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(options[0]?.value ?? '');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (options.length === 0) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/documents/${documentId}/file`, {
        action: 'mark_filed',
        filing_status: target,
        filing_reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      });
      setOpen(false);
      setReference('');
      setNote('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not record that. Your entry is kept above — please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="min-h-8 px-3 text-xs">
        Record filing
      </Button>
    );
  }

  return (
    <div className="mt-1.5 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <label className="block text-xs font-medium text-primary">
        Outcome
        <select value={target} onChange={(e) => setTarget(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring">
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {target !== 'rejected' ? (
        <label className="mt-1.5 block text-xs font-medium text-primary">
          Authority reference
          <input value={reference} onChange={(e) => setReference(e.target.value)} className="record mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
        </label>
      ) : (
        <label className="mt-1.5 block text-xs font-medium text-primary">
          Rejection reason
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring" />
        </label>
      )}
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy} onClick={() => void submit()} className="min-h-7 px-2.5 text-xs">
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-7 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
