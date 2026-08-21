'use client';

/**
 * Assign an unassigned exporter to an agent, from the exporter side of the relationship.
 *
 * The reverse of `AssignExporterForm` (which fixes the agent and picks the exporter, for the
 * per-agent detail page) — this fixes the exporter and picks the agent, for the org-wide
 * Unassigned queue on `/ops/assignments`. Both call the same `POST /api/v1/ops/agent-assignments`
 * route and the same `assignExporterToAgent` service; nothing here duplicates that logic.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function AssignAgentToExporterForm({
  exporterOrgId,
  exporterName,
  agents,
}: {
  exporterOrgId: string;
  exporterName: string;
  agents: { id: string; name: string; assignedCount: number }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <Button type="button" className="min-h-8 px-2.5 text-xs" onClick={() => setOpen(true)}>
        Assign
      </Button>
    );
  }

  const submit = async () => {
    if (!agentId) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost('/api/v1/ops/agent-assignments', {
        agent_user_id: agentId, exporter_org_id: exporterOrgId, reason: reason.trim() || null,
      });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not assign this exporter.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5 text-left">
      <p className="text-xs text-primary">
        Exporter: <strong>{exporterName}</strong>
      </p>
      <label className="mt-2 block text-xs font-medium text-primary">
        Assign to agent
        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
        >
          <option value="">Select an agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.assignedCount} exporter{a.assignedCount === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>
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
        <Button type="button" disabled={busy || !agentId} className="min-h-8 px-2.5 text-xs" onClick={() => void submit()}>
          {busy ? 'Assigning…' : 'Assign exporter'}
        </Button>
        <Button type="button" variant="secondary" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
