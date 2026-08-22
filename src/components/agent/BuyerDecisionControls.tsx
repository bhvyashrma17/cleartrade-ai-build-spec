'use client';

/**
 * Buyer decision controls.
 *
 * Actions are grouped and labelled by CONSEQUENCE, because the single most important thing an
 * agent needs to know before clicking is whether this changes what ClearTrade is operationally
 * doing or merely records what they think:
 *
 *   Decision only        — appends an AgentDecision. No pipeline state moves.
 *   Changes pipeline     — moves canonical state (shortlist membership, lead stage) atomically.
 *   Records an instruction — automation controls. Nothing in the backend reads these yet.
 *
 * Every rule stays on the server. This component chooses what to offer and collects a reason;
 * `runBuyerCommand` decides who may act, whether the action is legal for the current lead stage,
 * and what canonical state moves. A disabled control here is an affordance, not a gate.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import {
  BUYER_ACTION_SPECS,
  BUYER_CONSEQUENCE_LABEL,
  DISQUALIFICATION_REASON_OPTIONS,
  type BuyerActionConsequence,
  type BuyerActionName,
} from '@/lib/buyer-actions';

export function BuyerDecisionControls({
  assessmentId,
  buyerName,
}: {
  assessmentId: string;
  buyerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<BuyerActionName | null>(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('');
  const [disqReason, setDisqReason] = useState<string>('no_response');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = BUYER_ACTION_SPECS.find((s) => s.action === open) ?? null;
  const reset = () => { setOpen(null); setReason(''); setPriority(''); setError(null); };

  const submit = async () => {
    if (!spec) return;
    const trimmed = reason.trim();
    if (!trimmed) { setError('A reason is required for every decision.'); return; }

    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/buyer-fit-assessments/${assessmentId}/decisions`, {
        action: spec.action,
        reason: trimmed,
        agent_priority: spec.priority && priority.trim() ? Number(priority) : null,
        disqualification_reason: spec.needsDisqualificationReason ? disqReason : null,
      });
      reset();
      // Re-read everything: one action can move the decision chain, shortlist membership, the
      // lead stage, a transition row, the outcome row and the operational ordering of peers.
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not record the decision. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!spec) {
    return (
      <div className="space-y-1.5">
        {(['canonical', 'decision', 'automation'] as BuyerActionConsequence[]).map((group) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {BUYER_CONSEQUENCE_LABEL[group]}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {BUYER_ACTION_SPECS.filter((s) => s.consequence === group).map((s) => (
                <Button
                  key={s.action}
                  type="button"
                  variant="secondary"
                  onClick={() => { setOpen(s.action); setError(null); }}
                  className={`min-h-0 rounded px-2 py-1 text-xs font-medium ${
                    s.consequence === 'canonical'
                      ? ''
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  {s.label}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const reasonId = `buyer-reason-${assessmentId}`;

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-2.5">
      <div>
        <p className="text-xs font-semibold text-primary">{spec.label} — {buyerName}</p>
        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          {BUYER_CONSEQUENCE_LABEL[spec.consequence]}
        </p>
      </div>
      {/* The consequence is stated before the agent commits, not after. */}
      <p className="rounded border border-[var(--color-border)] bg-surface px-2 py-1.5 text-xs text-[var(--color-text-secondary)]">
        {spec.consequenceNote}
      </p>

      {spec.needsDisqualificationReason ? (
        <div>
          <label htmlFor={`disq-${assessmentId}`} className="block text-xs font-medium text-primary">
            Canonical disqualification reason <span aria-hidden="true">*</span>
          </label>
          <select
            id={`disq-${assessmentId}`}
            value={disqReason}
            onChange={(e) => setDisqReason(e.target.value)}
            className="focus-visible-ring mt-1 w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary"
          >
            {DISQUALIFICATION_REASON_OPTIONS.map((r) => (
              <option key={r} value={r}>{r.replaceAll('_', ' ')}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Stored on the lead itself, separately from your written explanation below.
          </p>
        </div>
      ) : null}

      <div>
        <label htmlFor={reasonId} className="block text-xs font-medium text-primary">
          Reason <span aria-hidden="true">*</span><span className="sr-only">(required)</span>
        </label>
        <textarea
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          required
          aria-required="true"
          placeholder="Why this decision? Recorded permanently against your name."
          className="focus-visible-ring mt-1 w-full rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary"
        />
      </div>

      {spec.priority ? (
        <div>
          <label htmlFor={`prio-${assessmentId}`} className="block text-xs font-medium text-primary">
            Operational priority (optional)
          </label>
          <input
            id={`prio-${assessmentId}`}
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="focus-visible-ring mt-1 w-24 rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Your ordering for workflow. Blank keeps the AI position. The BuyerFit score is never changed.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="rounded border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-[color-mix(in_srgb,var(--crit-fill)_8%,var(--card))] px-2 py-1 text-xs text-critical">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <Button type="button" onClick={submit} disabled={busy} className="min-h-8 px-3 text-xs">
          {busy ? 'Recording…' : `Confirm ${spec.label.toLowerCase()}`}
        </Button>
        <Button type="button" variant="secondary" onClick={reset} disabled={busy} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
