'use client';

/**
 * AGT-06/AGT-07 task quick actions. Only the transitions the task state machine actually
 * allows from the current state are offered — the same table the server enforces, so a
 * disallowed move is never presented and then rejected.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

const ALLOWED: Record<string, { value: string; label: string; needsReason?: 'blocked' | 'cancel' }[]> = {
  not_started: [
    { value: 'in_progress', label: 'Start' },
    { value: 'waiting', label: 'Waiting', needsReason: 'blocked' },
    { value: 'cancelled', label: 'Cancel', needsReason: 'cancel' },
  ],
  in_progress: [
    { value: 'done', label: 'Done' },
    { value: 'waiting', label: 'Waiting', needsReason: 'blocked' },
    { value: 'cancelled', label: 'Cancel', needsReason: 'cancel' },
  ],
  waiting: [
    { value: 'in_progress', label: 'Resume' },
    { value: 'done', label: 'Done' },
    { value: 'cancelled', label: 'Cancel', needsReason: 'cancel' },
  ],
  done: [],
  cancelled: [],
};

export function TaskActions({ taskId, state }: { taskId: string; state: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompting, setPrompting] = useState<{ to: string; kind: 'blocked' | 'cancel' } | null>(null);
  const [reason, setReason] = useState('');
  const options = ALLOWED[state] ?? [];

  if (options.length === 0) return null;

  const run = async (to: string, reasonText?: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/tasks/${taskId}`, {
        to,
        ...(prompting?.kind === 'blocked' ? { blocked_reason: reasonText, waiting_on: reasonText } : {}),
        ...(prompting?.kind === 'cancel' ? { cancel_reason: reasonText } : {}),
      });
      setPrompting(null);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update the task. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (prompting) {
    return (
      <div className="mt-1.5 max-w-xs">
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={prompting.kind === 'blocked' ? 'What is it waiting on?' : 'Why cancel?'}
          aria-label={prompting.kind === 'blocked' ? 'What is it waiting on?' : 'Why cancel?'}
          className="w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
        />
        {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button disabled={busy || reason.trim().length === 0} onClick={() => void run(prompting.to, reason.trim())} className="min-h-8 px-2.5 text-xs">
            {busy ? '…' : 'Confirm'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => { setPrompting(null); setReason(''); }} className="min-h-8 px-2.5 text-xs">
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <Button
            key={o.value}
            variant="secondary"
            disabled={busy}
            onClick={() => (o.needsReason ? setPrompting({ to: o.value, kind: o.needsReason }) : void run(o.value))}
            className="min-h-8 px-2.5 text-xs"
          >
            {o.label}
          </Button>
        ))}
      </div>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
