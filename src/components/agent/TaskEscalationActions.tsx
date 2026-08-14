'use client';

/**
 * AGT-07 quick actions that aren't state transitions: Claim (AC01 — turn a role-owned
 * task into a person-accountable one), Escalate (AC04) and Reassign request. Kept apart
 * from `TaskActions` (the state-machine transitions) because these three hit their own
 * routes and have no `TaskState` of their own to gate on.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

type Prompt = 'escalate' | 'reassign' | null;

export function TaskEscalationActions({
  taskId,
  hasOwner,
  isEscalated,
}: {
  taskId: string;
  hasOwner: boolean;
  isEscalated: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prompting, setPrompting] = useState<Prompt>(null);
  const [reason, setReason] = useState('');

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/tasks/${taskId}/claim`, {});
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not claim this task. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const path = prompting === 'escalate' ? 'escalate' : 'reassign-request';
      await apiPost(`/api/v1/tasks/${taskId}/${path}`, { reason });
      setPrompting(null);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not submit that. Please retry.');
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
          placeholder={prompting === 'escalate' ? 'Why does Ops need to step in?' : 'Why reassign this?'}
          aria-label={prompting === 'escalate' ? 'Why does Ops need to step in?' : 'Why reassign this?'}
          className="w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring"
        />
        {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-1.5 flex gap-1.5">
          <Button disabled={busy || reason.trim().length === 0} onClick={() => void submit()} className="min-h-8 px-2.5 text-xs">
            {busy ? '…' : 'Submit'}
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
        {!hasOwner ? (
          <Button variant="secondary" disabled={busy} onClick={() => void claim()} className="min-h-8 px-2.5 text-xs">
            Claim
          </Button>
        ) : null}
        {!isEscalated ? (
          <Button variant="secondary" disabled={busy} onClick={() => setPrompting('escalate')} className="min-h-8 px-2.5 text-xs">
            Escalate
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={() => setPrompting('reassign')} className="min-h-8 px-2.5 text-xs">
          Reassign request
        </Button>
      </div>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
