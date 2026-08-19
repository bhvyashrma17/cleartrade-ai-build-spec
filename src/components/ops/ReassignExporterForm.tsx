'use client';

/**
 * Move one active assignment to a different agent.
 *
 * Calls the PATCH reassign endpoint, which ends the old assignment and starts the new one in a
 * single transaction — there is no in-between where the exporter has no active agent.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

export function ReassignExporterForm({
  assignmentId,
  exporterName,
  currentAgentName,
  candidates,
}: {
  assignmentId: string;
  exporterName: string;
  currentAgentName: string;
  candidates: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newAgentId, setNewAgentId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" variant="secondary" className="min-h-8 px-2.5 text-xs" onClick={() => setOpen(true)}>
        Reassign
      </Button>
    );
  }

  const submit = async () => {
    if (!newAgentId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPatch('/api/v1/ops/agent-assignments', {
        assignment_id: assignmentId, new_agent_user_id: newAgentId, reason: reason.trim() || null,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not reassign this exporter.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5 text-left">
      <p className="text-xs text-primary">
        Move <strong>{exporterName}</strong> from {currentAgentName} to:
      </p>
      <select
        value={newAgentId}
        onChange={(e) => setNewAgentId(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
      >
        <option value="">Select an agent…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <label className="mt-2 block text-xs font-medium text-primary">
        Reason (optional)
        <input
          type="text"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        />
      </label>
      {error ? <p role="alert" className="mt-1.5 text-xs text-critical">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button type="button" disabled={busy || !newAgentId} className="min-h-8 px-2.5 text-xs" onClick={() => void submit()}>
          {busy ? 'Reassigning…' : 'Confirm reassign'}
        </Button>
        <Button type="button" variant="secondary" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
