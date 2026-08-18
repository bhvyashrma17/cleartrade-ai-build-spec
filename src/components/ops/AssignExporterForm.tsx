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
}: {
  agentUserId: string;
  exporters?: { id: string; display_name: string }[];
  unassignAssignmentId?: string;
}) {
  const router = useRouter();
  const [orgId, setOrgId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    return (
      <div>
        <Button
          type="button"
          variant="secondary"
          className="min-h-8 px-3 text-xs"
          disabled={busy}
          onClick={() => {
            if (!window.confirm('Unassign this exporter? The agent immediately loses access to their data.')) return;
            void run(() => apiDelete('/api/v1/ops/agent-assignments', { assignment_id: unassignAssignmentId }));
          }}
        >
          {busy ? 'Removing…' : 'Unassign'}
        </Button>
        {error ? <p role="alert" className="mt-1 text-xs text-critical">{error}</p> : null}
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
