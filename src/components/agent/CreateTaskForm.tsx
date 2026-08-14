'use client';

/** AGT-02 "Create task | Task scoped to exporter … | Required fields". */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function CreateTaskForm({ exporterOrgId }: { exporterOrgId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [ownerRole, setOwnerRole] = useState<'exporter_owner' | 'agent' | 'ops_supervisor'>('agent');
  const [visibility, setVisibility] = useState<'exporter_visible' | 'internal'>('internal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/exporters/${exporterOrgId}/tasks`, {
        title: title.trim(),
        owner_role: ownerRole,
        priority: 'normal',
        visibility,
      });
      setTitle('');
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not create that task. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)} className="min-h-8 px-3 text-xs">
        Create task
      </Button>
    );
  }

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <label className="block text-xs font-medium text-primary" htmlFor="new-task-title">
        Title
      </label>
      <input
        id="new-task-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="mt-1 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
      />
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <label>
          Owner
          <select value={ownerRole} onChange={(e) => setOwnerRole(e.target.value as typeof ownerRole)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring">
            <option value="agent">Agent</option>
            <option value="exporter_owner">Exporter</option>
            <option value="ops_supervisor">Ops</option>
          </select>
        </label>
        <label>
          Visibility
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring">
            <option value="internal">Internal only</option>
            <option value="exporter_visible">Exporter-visible</option>
          </select>
        </label>
      </div>
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <div className="mt-2 flex gap-1.5">
        <Button disabled={busy || title.trim().length === 0} onClick={() => void submit()} className="min-h-8 px-3 text-xs">
          {busy ? 'Creating…' : 'Create'}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
