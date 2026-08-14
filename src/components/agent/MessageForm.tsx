'use client';

/**
 * Exporter-visible message composer, generalized over scope. Deliberately styled as
 * the visual opposite of `InternalNoteForm` — solid border, action-tinted background,
 * explicit "The exporter will see this" line — so the two composition modes can never
 * be mistaken for each other (AGT-02-AC02 / AGT-04-AC02).
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function MessageForm({ endpoint }: { endpoint: string }) {
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
      setError(e instanceof ApiClientError ? e.message : 'Could not send that message. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-[var(--color-action)] bg-[color-mix(in_srgb,var(--color-action)_6%,transparent)] p-3">
      <label className="block text-xs font-semibold uppercase tracking-wide text-primary" htmlFor={`message-${endpoint}`}>
        Message to exporter — the exporter will see this
      </label>
      <textarea
        id={`message-${endpoint}`}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="Exporter-visible"
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
      />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <Button disabled={busy || body.trim().length === 0} onClick={() => void submit()} className="mt-1.5 min-h-8 px-3 text-xs">
        {busy ? 'Sending…' : 'Send to exporter'}
      </Button>
    </div>
  );
}
