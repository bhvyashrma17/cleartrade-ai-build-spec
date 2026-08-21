'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

export function AgentCapacityForm({ currentTarget }: { currentTarget: number }) {
  const router = useRouter();
  const [target, setTarget] = useState(String(currentTarget));
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function submit() {
    const value = Number(target);
    if (!Number.isInteger(value) || value < 1 || value > 500 || !reason.trim() || !confirmed) {
      setMessage('Enter a whole-number target, record a reason, and confirm the change.');
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await apiPost('/api/v1/config', {
        key: 'agent.capacity',
        value: { target_exporters_per_agent: value },
        description: reason.trim(),
      });
      setMessage('The new advisory capacity version is active.');
      setConfirmed(false);
      setReason('');
      router.refresh();
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : 'Could not save the advisory capacity target.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-[var(--color-border)] p-3">
      <label className="text-sm font-medium text-primary">
        Target exporters per agent
        <input type="number" min={1} max={500} step={1} value={target} onChange={(e) => setTarget(e.target.value)} className="mt-1 block w-40 rounded border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring" />
      </label>
      <p className="mt-1 text-xs text-[var(--color-text-secondary)]">Advisory only. This value changes workload displays and never blocks an assignment.</p>
      <label className="mt-3 block text-xs font-medium text-primary">Change reason
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-surface px-3 py-2 text-sm text-primary focus-visible-ring" />
      </label>
      <label className="mt-2 flex items-start gap-2 text-xs text-primary"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />Confirm creation of a new active configuration version.</label>
      {message ? <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{message}</p> : null}
      <Button className="mt-3" disabled={busy || !confirmed || !reason.trim()} onClick={() => void submit()}>{busy ? 'Saving…' : 'Save new version'}</Button>
    </div>
  );
}
