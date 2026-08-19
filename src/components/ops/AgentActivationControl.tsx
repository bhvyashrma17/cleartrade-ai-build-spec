'use client';

/**
 * Deactivate or reactivate one agent.
 *
 * Deactivation is the more consequential direction — it immediately blocks portal access — so
 * it gets an inline confirm panel with an optional reason, following `DisputeActions`'
 * mode-toggle pattern. `deactivateAgent` itself refuses server-side while active assignments
 * remain; that refusal surfaces here as an ordinary error rather than something this component
 * pre-checks, so the one rule lives in one place.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

export function AgentActivationControl({ agentId, agentName, isActive }: { agentId: string; agentName: string; isActive: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = async (action: 'deactivate' | 'reactivate', body: Record<string, unknown> = {}) => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/ops/agents/${agentId}`, { action, ...body });
      setConfirming(false);
      setReason('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update this agent.');
    } finally {
      setBusy(false);
    }
  };

  if (!isActive) {
    return (
      <div>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Reactivate ${agentName}? They will regain portal access immediately.`)) return;
            void patch('reactivate');
          }}
        >
          {busy ? 'Reactivating…' : 'Reactivate agent'}
        </Button>
        {error ? <p role="alert" className="mt-1 text-xs text-critical">{error}</p> : null}
      </div>
    );
  }

  if (!confirming) {
    return (
      <div>
        <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
          Deactivate agent
        </Button>
        {error ? <p role="alert" className="mt-1 text-xs text-critical">{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="max-w-md rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <p className="text-sm text-primary">
        Deactivate <strong>{agentName}</strong>? They immediately lose portal access. Their
        history (decisions, assignments, audit trail) is preserved and stays attributed to them.
        Any active assignments must be reassigned or unassigned first.
      </p>
      <label className="mt-2 block text-xs font-medium text-primary">
        Reason (optional)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p role="alert" className="mt-1.5 text-xs text-critical">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button
          type="button"
          disabled={busy}
          className="min-h-8 px-3 text-xs"
          onClick={() => void patch('deactivate', { reason: reason.trim() || null })}
        >
          {busy ? 'Deactivating…' : 'Confirm deactivate'}
        </Button>
        <Button type="button" variant="secondary" className="min-h-8 px-3 text-xs" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
