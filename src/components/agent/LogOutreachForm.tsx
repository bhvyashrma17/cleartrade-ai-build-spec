'use client';

/**
 * AGT-04 "Log outreach/reply | Activity + optional stage/next action | Failure retains
 * composition/log". The composed text and selected fields stay in state on a failed
 * submit — nothing is cleared until the request actually succeeds.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';

const STAGE_OPTIONS = ['shortlisted', 'contacted', 'replied', 'interested', 'negotiation'] as const;
const REQUIRES_NEXT_ACTION = new Set(['contacted', 'replied', 'interested']);

export function LogOutreachForm({ buyerLeadId, currentStage }: { buyerLeadId: string; currentStage: string }) {
  const router = useRouter();
  const [type, setType] = useState<'call' | 'email' | 'message' | 'meeting' | 'note'>('call');
  const [summary, setSummary] = useState('');
  const [visibility, setVisibility] = useState<'internal' | 'exporter_visible'>('internal');
  const [toStage, setToStage] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionAt, setNextActionAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stageRequiresNextAction = toStage && REQUIRES_NEXT_ACTION.has(toStage);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/leads/${buyerLeadId}/activities`, {
        type,
        summary: summary.trim(),
        visibility,
        to_stage: toStage || undefined,
        next_action: nextAction || undefined,
        next_action_at: nextActionAt ? new Date(nextActionAt).toISOString() : undefined,
      });
      setSummary('');
      setToStage('');
      setNextAction('');
      setNextActionAt('');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not log that activity. Your entry is kept above — please retry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-[var(--color-border)] bg-surface-muted p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">Log outreach / reply</p>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
        <label>
          Type
          <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring">
            <option value="call">Call</option>
            <option value="email">Email</option>
            <option value="message">Message</option>
            <option value="meeting">Meeting</option>
            <option value="note">Note</option>
          </select>
        </label>
        <label>
          Visible to
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring">
            <option value="internal">Internal only</option>
            <option value="exporter_visible">Exporter-visible</option>
          </select>
        </label>
      </div>
      <textarea
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        rows={2}
        placeholder="What happened?"
        className="mt-2 w-full rounded-md border border-[var(--color-border)] bg-surface px-2 py-1.5 text-sm text-primary focus-visible-ring"
      />
      <div className="mt-2">
        <label className="block text-xs text-primary">
          Move stage to (optional)
          <select value={toStage} onChange={(e) => setToStage(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-xs text-primary focus-visible-ring">
            <option value="">No stage change</option>
            {STAGE_OPTIONS.filter((s) => s !== currentStage).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      {stageRequiresNextAction ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <label>
            Next action
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </label>
          <label>
            Next action date
            <input type="date" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} className="mt-0.5 w-full rounded border border-[var(--color-border)] bg-surface px-2 py-1 text-primary focus-visible-ring" />
          </label>
        </div>
      ) : null}
      {error ? <p className="mt-1.5 text-xs text-[var(--color-critical-text)]">{error}</p> : null}
      <Button
        disabled={busy || summary.trim().length === 0 || (Boolean(stageRequiresNextAction) && !nextActionAt)}
        onClick={() => void submit()}
        className="mt-2 min-h-8 px-3 text-xs"
      >
        {busy ? 'Logging…' : 'Log activity'}
      </Button>
    </div>
  );
}
