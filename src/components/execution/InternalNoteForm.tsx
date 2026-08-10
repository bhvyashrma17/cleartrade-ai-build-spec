'use client';

/** Internal note composer. Writes to InternalNote — a different table from Message. */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function InternalNoteForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/internal-notes`, { body: body.trim() });
      setBody('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save the note. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-primary" htmlFor="internal-note-body">
        Add an internal note
      </label>
      <textarea
        id="internal-note-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Not visible to the exporter"
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
      />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <Button disabled={busy || body.trim().length === 0} onClick={() => void submit()} className="mt-1.5 min-h-8 px-3 text-xs">
        {busy ? 'Saving…' : 'Save note'}
      </Button>
    </div>
  );
}
