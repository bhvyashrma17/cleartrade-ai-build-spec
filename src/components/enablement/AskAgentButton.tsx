'use client';

/** EXP-03 "Ask agent" — starts a scoped message; draft preserved on failure. */

import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function AskAgentButton({ taskId }: { taskId: string }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/tasks/${taskId}/ask-agent`, { body: body.trim() });
      setSent(true);
      setOpen(false);
      setBody('');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not send that message. Your draft is kept below — please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div>
        <button type="button" onClick={() => { setOpen(true); setSent(false); }} className="focus-visible-ring text-xs font-medium text-primary underline underline-offset-2">
          Ask agent
        </button>
        {sent ? <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Sent — check Messages for a reply.</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-1.5 max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        placeholder="What do you need help with?"
        className="w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-xs text-primary focus-visible-ring"
      />
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-1.5 flex gap-1.5">
        <Button disabled={busy || body.trim().length === 0} onClick={() => void send()} className="min-h-7 px-2.5 text-xs">
          {busy ? 'Sending…' : 'Send'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-7 px-2.5 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
