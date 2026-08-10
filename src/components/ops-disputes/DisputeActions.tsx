'use client';

/**
 * OPS-06 resolution workflow controls. Only the actions the CURRENT status actually
 * allows are rendered — the same guarded machine the server enforces
 * (`assertDisputeTransition`), so there is no button here that the API would refuse.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPatch } from '@/lib/api-client';

interface AssignableUser {
  id: string;
  name: string;
  role: string;
}

export function DisputeActions({
  dealId,
  disputeId,
  status,
  assignableUsers,
}: {
  dealId: string;
  disputeId: string;
  status: string;
  assignableUsers: AssignableUser[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'idle' | 'assign' | 'wait' | 'propose' | 'close' | 'reopen'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ownerId, setOwnerId] = useState(assignableUsers[0]?.id ?? '');
  const [waitingOn, setWaitingOn] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [resolution, setResolution] = useState('');
  const [closureBasis, setClosureBasis] = useState('');
  const [closureSummary, setClosureSummary] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/v1/deals/${dealId}/disputes/${disputeId}`, payload);
      setMode('idle');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not complete that action. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (status === 'closed') return null;

  if (mode === 'idle') {
    return (
      <div>
        {error ? <p className="mb-2 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="flex flex-wrap gap-1.5">
          {status === 'open' ? (
            <Button variant="secondary" disabled={busy} onClick={() => setMode('assign')} className="min-h-8 px-2.5 text-xs">
              Assign owner
            </Button>
          ) : null}
          {(status === 'investigating' || status === 'waiting_external') ? (
            <Button variant="secondary" disabled={busy} onClick={() => setMode('wait')} className="min-h-8 px-2.5 text-xs">
              Waiting on external party
            </Button>
          ) : null}
          {(status === 'investigating' || status === 'waiting_external') ? (
            <Button variant="secondary" disabled={busy} onClick={() => setMode('propose')} className="min-h-8 px-2.5 text-xs">
              Propose resolution
            </Button>
          ) : null}
          {(status === 'proposed_resolution' || status === 'resolved') ? (
            <Button variant="secondary" disabled={busy} onClick={() => setMode('close')} className="min-h-8 px-2.5 text-xs">
              Close (authority basis)
            </Button>
          ) : null}
          {status !== 'open' ? (
            <Button variant="secondary" disabled={busy} onClick={() => setMode('reopen')} className="min-h-8 px-2.5 text-xs">
              Reopen
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  if (mode === 'assign') {
    return (
      <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
        <label className="block text-xs font-medium text-primary">
          Owner
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring">
            {assignableUsers.map((u) => (
              <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
            ))}
          </select>
        </label>
        {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-2 flex gap-1.5">
          <Button disabled={busy || !ownerId} onClick={() => void run({ action: 'assign', owner_user_id: ownerId })} className="min-h-8 px-2.5 text-xs">
            {busy ? 'Saving…' : 'Assign'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('idle')} className="min-h-8 px-2.5 text-xs">Cancel</Button>
        </div>
      </div>
    );
  }

  if (mode === 'wait') {
    return (
      <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
        <label className="block text-xs font-medium text-primary">
          Waiting on
          <input type="text" value={waitingOn} onChange={(e) => setWaitingOn(e.target.value)} placeholder="e.g. buyer's bank" className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="mt-2 block text-xs font-medium text-primary">
          Follow-up date
          <input type="date" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-2 flex gap-1.5">
          <Button disabled={busy || !waitingOn.trim() || !followUpAt} onClick={() => void run({ action: 'wait_external', waiting_on: waitingOn.trim(), follow_up_at: followUpAt })} className="min-h-8 px-2.5 text-xs">
            {busy ? 'Saving…' : 'Save'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('idle')} className="min-h-8 px-2.5 text-xs">Cancel</Button>
        </div>
      </div>
    );
  }

  if (mode === 'propose') {
    return (
      <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
        <label className="block text-xs font-medium text-primary">
          Proposed resolution
          <textarea value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-2 flex gap-1.5">
          <Button disabled={busy || resolution.trim().length === 0} onClick={() => void run({ action: 'propose_resolution', resolution: resolution.trim() })} className="min-h-8 px-2.5 text-xs">
            {busy ? 'Sending…' : 'Send to exporter'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('idle')} className="min-h-8 px-2.5 text-xs">Cancel</Button>
        </div>
      </div>
    );
  }

  if (mode === 'close') {
    return (
      <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
        <label className="block text-xs font-medium text-primary">
          Authority basis
          <input type="text" value={closureBasis} onChange={(e) => setClosureBasis(e.target.value)} placeholder="e.g. inspection report, arbitration outcome" className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        <label className="mt-2 block text-xs font-medium text-primary">
          Closure summary
          <textarea value={closureSummary} onChange={(e) => setClosureSummary(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
        </label>
        {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
        <div className="mt-2 flex gap-1.5">
          <Button disabled={busy || !closureBasis.trim() || !closureSummary.trim()} onClick={() => void run({ action: 'close', closure_basis: closureBasis.trim(), closure_summary: closureSummary.trim() })} className="min-h-8 px-2.5 text-xs">
            {busy ? 'Closing…' : 'Close case'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setMode('idle')} className="min-h-8 px-2.5 text-xs">Cancel</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-sm rounded-md border border-[var(--color-border)] bg-surface-muted p-2.5">
      <label className="block text-xs font-medium text-primary">
        Why reopen this case?
        <textarea value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} rows={2} className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring" />
      </label>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy || reopenReason.trim().length === 0} onClick={() => void run({ action: 'reopen', reopen_reason: reopenReason.trim() })} className="min-h-8 px-2.5 text-xs">
          {busy ? 'Saving…' : 'Reopen'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setMode('idle')} className="min-h-8 px-2.5 text-xs">Cancel</Button>
      </div>
    </div>
  );
}
