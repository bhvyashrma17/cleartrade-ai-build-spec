'use client';

/**
 * Assign or unassign an exporter for one agent.
 *
 * Both directions call the Ops API, which authorizes in `assertCanProvisionStaff` and writes the
 * audit event in the same transaction. Nothing here decides who may act.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiDelete, apiPost } from '@/lib/api-client';

export function AssignExporterForm({
  agentUserId,
  exporters,
  unassignAssignmentId,
  exporterName,
}: {
  agentUserId: string;
  exporters?: { id: string; display_name: string }[];
  unassignAssignmentId?: string;
  /** Shown in the unassign confirmation panel, for the org-wide `/ops/assignments` view. */
  exporterName?: string;
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not update the assignment.');
    } finally {
      setBusy(false);
    }
  };

  if (unassignAssignmentId) {
    if (!confirming) {
      return (
        <div>
          <Button type="button" variant="secondary" className="min-h-8 px-3 text-xs" disabled={busy} onClick={() => setConfirming(true)}>
            Unassign
          </Button>
          {error ? <p role="alert" className="mt-1 text-xs text-critical">{error}</p> : null}
        </div>
      );
    }
    return (
      <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5 text-left">
        <p className="text-xs text-primary">
          Unassign {exporterName ? <strong>{exporterName}</strong> : 'this exporter'}? The agent immediately loses
          access to their data. This does not delete assignment history.
        </p>
        <label className="mt-2 block text-xs font-medium text-primary">
          Reason (required)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
          />
        </label>
        {error ? <p role="alert" className="mt-1.5 text-xs text-critical">{error}</p> : null}
        <div className="mt-2 flex gap-1.5">
          <Button
            type="button"
            disabled={busy || !reason.trim()}
            className="min-h-8 px-2.5 text-xs"
            onClick={() => void run(() => apiDelete('/api/v1/ops/agent-assignments', { assignment_id: unassignAssignmentId, reason: reason.trim() }))}
          >
            {busy ? 'Removing…' : 'Confirm unassign'}
          </Button>
          <Button type="button" variant="secondary" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-[16rem] flex-1">
        <label htmlFor={`assign-${agentUserId}`} className="block text-sm font-medium text-primary">
          Exporter
        </label>
        <select
          id={`assign-${agentUserId}`}
          value={orgId}
          onChange={(e) => setOrgId(e.target.value)}
          className="focus-visible-ring mt-1 w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 py-2 text-sm text-primary"
        >
          <option value="">Select an exporter…</option>
          {(exporters ?? []).map((org) => (
            <option key={org.id} value={org.id}>{org.display_name}</option>
          ))}
        </select>
      </div>
      <Button
        type="button"
        disabled={busy || !orgId}
        onClick={() => void run(() => apiPost('/api/v1/ops/agent-assignments', {
          agent_user_id: agentUserId, exporter_org_id: orgId,
        }))}
      >
        {busy ? 'Assigning…' : 'Assign'}
      </Button>
      {error ? <p role="alert" className="w-full text-xs text-critical">{error}</p> : null}
    </div>
  );
}
