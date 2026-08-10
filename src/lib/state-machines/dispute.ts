/**
 * Dispute state machine — docs/07 §7.7.
 *
 * ```
 * open -> investigating -> waiting_external -> proposed_resolution -> resolved -> closed
 *                       \_______________________/
 * ```
 * plus a reopen edge from any non-terminal state back to `investigating`, and from
 * `resolved` back to `investigating` (mermaid: "resolved --> investigating: reopen").
 *
 * EXP-16-AC01 ("chat and dispute are separate object types — a message must never be the
 * only record of a blocker") is enforced elsewhere, structurally: `Message` and `Dispute`
 * are different Prisma models with no shared row, and nothing in this file or its callers
 * ever writes dispute state from message content. What THIS file is responsible for is
 * the second half of that same discipline once a Dispute exists: every transition is
 * guarded, and — per docs/07 cross-machine table — "Dispute -> resolved/closed: linked
 * financial/operational impact recorded; corresponding risk cleared only via explicit
 * domain rule." That rule lives here as `applyDisputeOpenedRiskEffect` /
 * `applyDisputeClosedRiskEffect`, called explicitly by the route handler inside the same
 * transaction as the status write — never as an ORM hook, and never inferred from the
 * status change alone.
 */

import { DisputeSeverity, DisputeStatus, RiskState } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';

type Stage = DisputeStatus;

const TRANSITIONS: Record<Stage, Stage[]> = {
  open: [DisputeStatus.investigating],
  investigating: [DisputeStatus.waiting_external, DisputeStatus.proposed_resolution],
  waiting_external: [DisputeStatus.proposed_resolution, DisputeStatus.investigating],
  proposed_resolution: [DisputeStatus.resolved, DisputeStatus.investigating],
  resolved: [DisputeStatus.closed, DisputeStatus.investigating],
  closed: [],
};

export function canTransitionDispute(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}
export function allowedDisputeTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

export interface DisputeTransitionInput {
  /** Required for `open -> investigating` — "owner assigned". */
  owner_user_id?: string | null;
  /** Required for `-> waiting_external` — "waiting party + follow-up date". */
  waiting_on?: string | null;
  follow_up_at?: Date | null;
  /** Required for `-> proposed_resolution` — "resolution proposal + impact". */
  resolution?: string | null;
  /** Required for `-> resolved` — "acceptance/authority basis recorded". */
  accepted?: boolean;
  closure_basis?: string | null;
  /** Required for `-> closed` — "closure summary and linked domain updates complete". */
  closure_summary?: string | null;
  /** Required for a reopen (any edge landing back on `investigating`) — "reason". */
  reopen_reason?: string | null;
}

export interface DisputeTransitionEffects {
  set_accepted_at: boolean;
  set_closed_at: boolean;
  is_reopen: boolean;
  audit: true;
}

export function assertDisputeTransition(
  from: Stage,
  to: Stage,
  input: DisputeTransitionInput = {},
): DisputeTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('dispute', from, to, 'This case is already at this status.');
  }
  if (!canTransitionDispute(from, to)) {
    throw new InvalidTransitionError('dispute', from, to);
  }

  const isReopen = to === DisputeStatus.investigating && from !== DisputeStatus.open;
  if (isReopen && !input.reopen_reason) {
    throw validationError(
      [{ field: 'reopen_reason', code: 'required', message: 'Say why this case is reopening.' }],
      'Reopening a case requires a reason — history is preserved, not overwritten.',
    );
  }

  if (to === DisputeStatus.investigating && from === DisputeStatus.open && !input.owner_user_id) {
    throw validationError(
      [{ field: 'owner_user_id', code: 'required', message: 'Assign an owner before moving this case into investigation.' }],
      'An owner is required to start investigating.',
    );
  }

  if (to === DisputeStatus.waiting_external) {
    if (!input.waiting_on) {
      throw validationError(
        [{ field: 'waiting_on', code: 'required', message: 'Say who or what this case is waiting on.' }],
        'Waiting on an external party requires saying who.',
      );
    }
    if (!input.follow_up_at) {
      throw validationError(
        [{ field: 'follow_up_at', code: 'required', message: 'Set a follow-up date.' }],
        'Waiting on an external party requires a follow-up date.',
      );
    }
  }

  if (to === DisputeStatus.proposed_resolution && !input.resolution) {
    throw validationError(
      [{ field: 'resolution', code: 'required', message: 'Describe the proposed resolution and its impact.' }],
      'A resolution proposal is required.',
    );
  }

  if (to === DisputeStatus.resolved) {
    if (!input.accepted && !input.closure_basis) {
      throw validationError(
        [{ field: 'closure_basis', code: 'required', message: 'Record acceptance or the authority basis for this resolution.' }],
        'Marking a case resolved requires either exporter acceptance or a recorded authority basis.',
      );
    }
  }

  if (to === DisputeStatus.closed && !input.closure_summary) {
    throw validationError(
      [{ field: 'closure_summary', code: 'required', message: 'Summarize the outcome before closing.' }],
      'Closing a case requires a closure summary.',
    );
  }

  return {
    set_accepted_at: to === DisputeStatus.resolved && Boolean(input.accepted),
    set_closed_at: to === DisputeStatus.closed,
    is_reopen: isReopen,
    audit: true,
  };
}

export const DISPUTE_STATUS_LABELS: Record<Stage, string> = {
  open: 'Open',
  investigating: 'Investigating',
  waiting_external: 'Waiting on external party',
  proposed_resolution: 'Resolution proposed',
  resolved: 'Resolved',
  closed: 'Closed',
};

// ---------------------------------------------------------------------------
// Explicit domain rule: dispute severity <-> deal risk_state
// ---------------------------------------------------------------------------

const RISK_RANK: Record<RiskState, number> = {
  [RiskState.normal]: 0,
  [RiskState.watch]: 1,
  [RiskState.at_risk]: 2,
  [RiskState.blocked]: 3,
};

function riskFromDisputeSeverity(severity: DisputeSeverity): RiskState {
  switch (severity) {
    case DisputeSeverity.critical:
      return RiskState.blocked;
    case DisputeSeverity.high:
      return RiskState.at_risk;
    case DisputeSeverity.medium:
      return RiskState.watch;
    case DisputeSeverity.low:
    default:
      return RiskState.normal;
  }
}

/** Highest risk implied by a set of still-open disputes. `[]` implies no dispute risk. */
export function deriveRiskFloorFromOpenDisputes(disputes: { severity: DisputeSeverity }[]): RiskState {
  return disputes.reduce<RiskState>((worst, d) => {
    const candidate = riskFromDisputeSeverity(d.severity);
    return RISK_RANK[candidate] > RISK_RANK[worst] ? candidate : worst;
  }, RiskState.normal);
}

/**
 * A stable marker prefixed onto `Deal.risk_reason` whenever THIS rule is the one that
 * raised it. That marker is what lets the closing half of the rule tell "this risk was
 * caused by this dispute" apart from "this risk has some other cause (a shipment
 * exception, a commercial-terms issue) and must not be touched" — the deal's risk_state
 * is a single field with a single reason, so clearing it correctly requires knowing which
 * rule wrote it, not just that a dispute happened to close.
 */
export const disputeRiskMarker = (disputeId: string): string => `[dispute:${disputeId}]`;

export interface DealRiskState {
  risk_state: RiskState;
  risk_reason: string | null;
}

export interface DealRiskEffect extends DealRiskState {
  changed: boolean;
}

/**
 * Called when a dispute is opened (or its severity escalates). Only ever RAISES risk —
 * never lowers it, and never overwrites a reason this rule didn't write, because a higher
 * floor from some other cause must not be silently downgraded by a lower-severity dispute.
 */
export function applyDisputeOpenedRiskEffect(
  deal: DealRiskState,
  dispute: { id: string; severity: DisputeSeverity; summary: string },
): DealRiskEffect {
  const floor = riskFromDisputeSeverity(dispute.severity);
  if (RISK_RANK[floor] <= RISK_RANK[deal.risk_state]) {
    return { ...deal, changed: false };
  }
  return { risk_state: floor, risk_reason: `${disputeRiskMarker(dispute.id)} ${dispute.summary}`, changed: true };
}

/**
 * Called when a dispute resolves or closes. Recomputes the risk floor from whatever
 * OTHER disputes on this deal are still open, and only touches `Deal.risk_state` at all
 * if the deal's current reason is attributable to THIS dispute (via the marker) — a risk
 * raised by a shipment exception or a commercial-terms issue is never cleared just
 * because an unrelated dispute closed.
 */
export function applyDisputeClosedRiskEffect(
  deal: DealRiskState,
  dispute: { id: string },
  remainingOpenDisputes: { id: string; severity: DisputeSeverity; summary: string }[],
): DealRiskEffect {
  const attributableToThisDispute = deal.risk_reason?.startsWith(disputeRiskMarker(dispute.id)) ?? false;
  if (!attributableToThisDispute) {
    return { ...deal, changed: false };
  }

  if (remainingOpenDisputes.length === 0) {
    return { risk_state: RiskState.normal, risk_reason: null, changed: true };
  }

  const worst = remainingOpenDisputes.reduce((a, b) =>
    RISK_RANK[riskFromDisputeSeverity(b.severity)] > RISK_RANK[riskFromDisputeSeverity(a.severity)] ? b : a,
  );
  return {
    risk_state: riskFromDisputeSeverity(worst.severity),
    risk_reason: `${disputeRiskMarker(worst.id)} ${worst.summary}`,
    changed: true,
  };
}
