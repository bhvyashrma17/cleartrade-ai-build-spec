'use client';

/** EXP-03 "Mark self-complete" — only ever rendered for self-attestable tasks by the
 * page, and refused server-side for anything else (see the route's own header). */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function SelfCompleteButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/tasks/${taskId}/self-complete`, {});
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not mark this complete. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Button disabled={busy} onClick={() => void complete()} className="min-h-8 px-3 text-xs">
        {busy ? 'Saving…' : 'Mark complete'}
      </Button>
      {error ? <p className="mt-1 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
    </div>
  );
}
