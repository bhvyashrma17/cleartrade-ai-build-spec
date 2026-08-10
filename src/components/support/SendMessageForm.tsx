'use client';

/**
 * EXP-16 "Send message". A rejected send keeps the draft in the textarea rather than
 * clearing it — "Draft preserved" per docs/04's failure-handling column — so a network
 * blip never costs the exporter what they typed.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function SendMessageForm({ dealId }: { dealId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/deals/${dealId}/messages`, { body: body.trim() });
      setBody('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not send that message. It has been kept as a draft — please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-primary" htmlFor="support-message-body">
        Message
      </label>
      <textarea
        id="support-message-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring"
        placeholder="Message your agent or ClearTrade support"
      />
      {error ? <p className="mt-1.5 text-sm text-[var(--color-critical-text)]">{error}</p> : null}
      <Button disabled={busy || body.trim().length === 0} onClick={() => void submit()} className="mt-2 min-h-9 px-4 text-sm">
        {busy ? 'Sending…' : 'Send'}
      </Button>
    </div>
  );
}
