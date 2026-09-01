'use client';

/**
 * Market decision controls — the write half of the Demand Discovery control surface.
 *
 * Every rule lives on the server. This component chooses which actions to *offer* and collects
 * a reason and an optional priority; it does not decide who may act, which actions are legal,
 * or what supersedes what. A disabled button here is an affordance, not a control — the route
 * re-validates through `recordAgentDecision`, which is itself backed by database constraints.
 *
 * After a successful write it calls `router.refresh()` and renders nothing optimistically. The
 * new operational order depends on the whole run (a promotion to 1 reorders every peer) and on
 * supersession the server resolves, so any client-side guess would be a different answer
 * briefly displayed as if it were the real one.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { ApiClientError, apiPost } from '@/lib/api-client';
import { OverflowMenu } from '@/components/discovery';
import { availableDecisions } from '@/lib/country-discovery/work-queue';

type Action =
  | 'promote' | 'demote' | 'reject' | 'restore'
  | 'mark_selected' | 'mark_not_selected'
  | 'pause_automation' | 'resume_automation' | 'request_review';

interface ActionSpec {
  action: Action;
  label: string;
  /** Priority is only meaningful where the service accepts one (PRIORITY_ACTIONS). */
  priority?: boolean;
  /** Terminal actions remove the market from the active list, so they confirm first. */
  confirm?: string;
  hint?: string;
}

/**
 * Pause/resume wording is deliberately narrow.
 *
 * Nothing in the backend currently reads `AgentDecision` — no job, route or scheduler gates on
 * it — so a pause records an operational instruction and does not itself stop any automated
 * behaviour. Saying "automation paused" would describe a capability the system does not have,
 * and an agent who believed it might leave a market running they thought they had stopped.
 */
const PAUSE_HINT = 'Records the instruction and flags the market for the team. No automated job reads this yet, so nothing stops on its own.';

const ACTIONS: ActionSpec[] = [
  { action: 'promote', label: 'Promote', priority: true, hint: 'Sets an operational priority above the AI ordering.' },
  { action: 'demote', label: 'Demote', priority: true },
  { action: 'mark_selected', label: 'Mark selected', priority: true },
  {
    action: 'mark_not_selected', label: 'Mark not selected',
    confirm: 'Mark this market as not selected? It leaves the active list and shows no operational order.',
  },
  {
    action: 'reject', label: 'Reject',
    confirm: 'Reject this market? It leaves the active list and shows no operational order. The AI score and rank are kept and stay visible.',
  },
  { action: 'restore', label: 'Restore', priority: true, hint: 'Returns the market to the active list.' },
  { action: 'pause_automation', label: 'Pause automation', hint: PAUSE_HINT },
  { action: 'resume_automation', label: 'Resume automation', hint: PAUSE_HINT },
  { action: 'request_review', label: 'Request review', hint: 'Flags for compliance/Ops attention; stays in the operational order.' },
];

export function MarketDecisionControls({
  assessmentId,
  countryCode,
  bucket,
  currentAction,
}: {
  assessmentId: string;
  countryCode: string;
  /** Where the market currently sits, derived by `bucketFor` from the decision in force. */
  bucket: 'active' | 'flagged' | 'terminal';
  /** The action currently in force, if any. Decides which moves are still possible. */
  currentAction: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [priority, setPriority] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = ACTIONS.find((a) => a.action === open) ?? null;

  const reset = () => { setOpen(null); setReason(''); setPriority(''); setError(null); };

  const submit = async () => {
    if (!spec) return;
    const trimmed = reason.trim();
    if (!trimmed) { setError('A reason is required for every decision.'); return; }
    if (spec.confirm && !window.confirm(spec.confirm)) return;

    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/market-assessments/${assessmentId}/decisions`, {
        action: spec.action,
        reason: trimmed,
        // Only send a priority where the action carries one; the service rejects it otherwise.
        agent_priority: spec.priority && priority.trim() ? Number(priority) : null,
      });
      reset();
      // Re-read from the server: operational order is a property of the whole run.
      router.refresh();
    } catch (e) {
      // Surface the server's own message — it distinguishes a validation failure from an
      // authorization one, and inventing a generic string here would hide which occurred.
      setError(e instanceof ApiClientError ? e.message : 'Could not record the decision. Please retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!spec) {
    // Only the moves that are actually possible right now. The previous surface rendered all
    // nine unconditionally, so "Pause automation" sat beside "Resume automation" and "Reject"
    // beside "Restore" — pairs that can never both apply. `availableDecisions` reads the state
    // the decision model already derives rather than inventing new state.
    const available = availableDecisions({ bucket, current_action: currentAction });
    const specOf = (action: string) => ACTIONS.find((a) => a.action === action);
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {available.primary.map((action) => {
          const a = specOf(action);
          if (!a) return null;
          return (
            <Button
              key={action} type="button" variant="secondary" size="sm"
              onClick={() => { setOpen(a.action); setError(null); }}
            >
              {a.label}
            </Button>
          );
        })}
        <OverflowMenu
          label={`More actions for ${countryCode}`}
          items={available.overflow.flatMap((action) => {
            const a = specOf(action);
            return a ? [{ key: action, label: a.label, hint: a.hint, onSelect: () => { setOpen(a.action); setError(null); } }] : [];
          })}
        />
      </div>
    );
  }

  const reasonId = `reason-${assessmentId}`;
  const priorityId = `priority-${assessmentId}`;

  return (
    <div className="space-y-2 rounded-md border border-[var(--color-border-strong)] bg-surface-muted p-2.5">
      <p className="text-xs font-semibold text-primary">
        {spec.label} — {countryCode}
      </p>
      {spec.hint ? <p className="text-xs text-[var(--color-text-secondary)]">{spec.hint}</p> : null}

      <div>
        <label htmlFor={reasonId} className="block text-xs font-medium text-primary">
          Reason <span aria-hidden="true">*</span>
          <span className="sr-only">(required)</span>
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
          <label htmlFor={priorityId} className="block text-xs font-medium text-primary">
            Operational priority (optional)
          </label>
          <input
            id={priorityId}
            type="number"
            min={1}
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="focus-visible-ring mt-1 w-24 rounded border border-[var(--color-border-strong)] bg-surface px-2 py-1.5 text-sm text-primary"
          />
          {/* Naming both numbers keeps them separate concepts in the agent's head. */}
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Your ordering for workflow. Leave blank to keep the AI rank as the operational order.
            The AI rank and score are never changed.
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
          {busy ? 'Recording…' : `Record ${spec.label.toLowerCase()}`}
        </Button>
        <Button type="button" variant="secondary" onClick={reset} disabled={busy} className="min-h-8 px-3 text-xs">
          Cancel
        </Button>
      </div>
    </div>
  );
}
