'use client';

/**
 * Internal note composer, generalized over scope (exporter account / lead / deal).
 * Writes to `InternalNote` — a different table from `Message`, never a flag on it
 * (AGT-02-AC02 / AGT-04-AC02: the two composition modes must be unmistakable).
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function InternalNoteForm({ endpoint }: { endpoint: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(endpoint, { body: body.trim() });
      setBody('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save the note. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border-2 border-dashed border-[var(--color-border-strong)] bg-surface-muted p-3">
      <label className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]" htmlFor={`internal-note-${endpoint}`}>
        Internal note — never shown to the exporter
      </label>
      <textarea
        id={`internal-note-${endpoint}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Visible to agents and Ops only"
        className="mt-1 w-full rounded-md border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
      />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <Button disabled={busy || body.trim().length === 0} onClick={() => void submit()} variant="secondary" className="mt-1.5 min-h-8 px-3 text-xs">
        {busy ? 'Saving…' : 'Save internal note'}
      </Button>
    </div>
  );
}
