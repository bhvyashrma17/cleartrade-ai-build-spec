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

type Action =
  | 'promote' | 'demote' | 'qualify' | 'unqualify' | 'request_review'
  | 'shortlist' | 'disqualify' | 'restore'
  | 'pause_automation' | 'resume_automation';

type Consequence = 'decision' | 'canonical' | 'advisory';

interface Spec {
  action: Action;
  label: string;
  consequence: Consequence;
  priority?: boolean;
  needsDisqualificationReason?: boolean;
  /** Shown before the agent commits, so the effect is never a surprise. */
  consequenceNote: string;
}

/**
 * Wording for the automation controls.
 *
 * Verified in Phase 2b and unchanged: nothing outside the decision layer reads AgentDecision,
 * so no worker, route or scheduler consults a pause. Saying "automation paused" would describe
 * a capability the system does not have, and an agent who believed it might leave outreach
 * running they thought they had stopped.
 */
const ADVISORY_NOTE =
  'Records the instruction and flags this buyer for the team. No backend job reads it yet, so outreach and automation do NOT stop on their own.';

const SPECS: Spec[] = [
  {
    action: 'promote', label: 'Promote', consequence: 'decision', priority: true,
    consequenceNote: 'Sets your operational priority above the AI ordering. Does not change the pipeline stage or the AI score.',
  },
  {
    action: 'demote', label: 'Demote', consequence: 'decision', priority: true,
    consequenceNote: 'Lowers your operational priority. Does not change the pipeline stage or the AI score.',
  },
  {
    action: 'qualify', label: 'Qualify', consequence: 'decision',
    // Deliberately not a pipeline move: BuyerLeadStage has no `qualified` member, and
    // `interested` means the BUYER expressed interest, which is a different fact.
    consequenceNote: 'Records your judgement that this buyer is suitable. There is no canonical "qualified" pipeline stage, so nothing moves.',
  },
  {
    action: 'unqualify', label: 'Unqualify', consequence: 'decision',
    consequenceNote: 'Records your judgement that this buyer is not suitable. Nothing moves in the pipeline — use Disqualify for that.',
  },
  {
    action: 'request_review', label: 'Request review', consequence: 'decision',
    consequenceNote: 'Flags this buyer for compliance or Ops attention. Stays in the working order.',
  },
  {
    action: 'shortlist', label: 'Shortlist', consequence: 'canonical', priority: true,
    consequenceNote: 'Adds this buyer to the shortlist AND puts them in the pipeline: if no lead exists one is created and moved to Shortlisted. A lead already further along is not moved back.',
  },
  {
    action: 'disqualify', label: 'Disqualify', consequence: 'canonical', needsDisqualificationReason: true,
    consequenceNote: 'Moves the canonical lead to Disqualified and records the reason. The buyer leaves the active working order. The AI score and evidence are kept and stay visible.',
  },
  {
    action: 'restore', label: 'Restore', consequence: 'canonical',
    consequenceNote: 'Returns a disqualified lead to Shortlisted and clears the disqualification reason.',
  },
  { action: 'pause_automation', label: 'Pause automation', consequence: 'advisory', consequenceNote: ADVISORY_NOTE },
  { action: 'resume_automation', label: 'Resume automation', consequence: 'advisory', consequenceNote: ADVISORY_NOTE },
];

const CONSEQUENCE_LABEL: Record<Consequence, string> = {
  decision: 'Decision only',
  canonical: 'Changes pipeline state',
  advisory: 'Records an instruction',
};

const DISQUALIFICATION_REASONS = [
  'no_response', 'not_importing_category', 'volume_too_small',
  'price_mismatch', 'risk_flag', 'duplicate', 'other',
] as const;

export function BuyerDecisionControls({
  assessmentId,
  buyerName,
}: {
  assessmentId: string;
  buyerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('');
  const [disqReason, setDisqReason] = useState<string>('no_response');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = SPECS.find((s) => s.action === open) ?? null;
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
        {(['canonical', 'decision', 'advisory'] as Consequence[]).map((group) => (
          <div key={group}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              {CONSEQUENCE_LABEL[group]}
            </p>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {SPECS.filter((s) => s.consequence === group).map((s) => (
                <button
                  key={s.action}
                  type="button"
                  onClick={() => { setOpen(s.action); setError(null); }}
                  className={`focus-visible-ring rounded border px-2 py-1 text-xs font-medium hover:bg-surface-muted ${
                    s.consequence === 'canonical'
                      ? 'border-[var(--color-border-strong)] text-primary'
                      : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'
                  }`}
                >
                  {s.label}
                </button>
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
          {CONSEQUENCE_LABEL[spec.consequence]}
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
            {DISQUALIFICATION_REASONS.map((r) => (
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
        <p role="alert" className="rounded border border-[color-mix(in_srgb,var(--color-critical)_30%,transparent)] bg-red-50 px-2 py-1 text-xs text-critical">
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
