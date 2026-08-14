/**
 * Payout state machine + eligibility derivation — AGT-08 / OPS-05.
 *
 * ```
 * not_eligible -> eligible -> approved -> paid
 *                     \___________\__________\__> disputed -> (back to eligible/approved)
 * ```
 *
 * Two things live here and are deliberately kept apart:
 *
 *   1. `assertPayoutTransition` — who may move a payout where, and what each move
 *      requires. Pure; performs no IO.
 *   2. `deriveEligibility` — whether the DOMAIN facts (payment realized, deal stage,
 *      open disputes) satisfy the configured policy. Also pure: the caller loads the
 *      facts and the policy and passes them in, so the rule is testable without a
 *      database and can never quietly read different config than the caller thinks.
 *
 * The split matters because eligibility is *derived* while the later states are
 * *decided*: nobody approves a payout into existence, and nobody's judgement makes a
 * payment realize. Collapsing the two would let a finance user "approve" a payout whose
 * underlying money never arrived.
 */

import { PayoutState } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';
import type { PayoutEligibilityPolicy } from '@/lib/config';

const TRANSITIONS: Record<PayoutState, PayoutState[]> = {
  // Derived, not decided — `eligible` is reached by recomputation, never by a button.
  not_eligible: [PayoutState.eligible],
  eligible: [PayoutState.approved, PayoutState.disputed, PayoutState.not_eligible],
  approved: [PayoutState.paid, PayoutState.disputed],
  // Terminal. A correction after payment is an additive PayoutAdjustment, never a
  // state rewind that would make the paid record disappear from history.
  paid: [PayoutState.disputed],
  // A raised query returns to whichever state it interrupted once resolved.
  disputed: [PayoutState.eligible, PayoutState.approved, PayoutState.paid],
};

export function canTransitionPayout(from: PayoutState, to: PayoutState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedPayoutTransitions(from: PayoutState): PayoutState[] {
  return [...TRANSITIONS[from]];
}

export interface PayoutTransitionInput {
  /** Required for `-> paid` — OPS-05 "Mark payout paid | Reference/date". */
  payment_reference?: string | null;
  /** Required for `-> disputed` — a query with no reason is not a query. */
  dispute_reason?: string | null;
}

export interface PayoutTransitionEffects {
  set_approved_at: boolean;
  set_paid_at: boolean;
  audit: true;
}

export function assertPayoutTransition(
  from: PayoutState,
  to: PayoutState,
  input: PayoutTransitionInput = {},
): PayoutTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('payout', from, to, 'The payout is already in this state.');
  }
  if (!canTransitionPayout(from, to)) {
    throw new InvalidTransitionError('payout', from, to);
  }

  if (to === PayoutState.paid && !input.payment_reference) {
    throw validationError(
      [{ field: 'payment_reference', code: 'required', message: 'Record the transfer reference.' }],
      'Marking a payout paid requires the payment reference.',
    );
  }

  if (to === PayoutState.disputed && !input.dispute_reason) {
    throw validationError(
      [{ field: 'dispute_reason', code: 'required', message: 'Say what is being queried.' }],
      'A payout query needs a reason.',
    );
  }

  return {
    set_approved_at: to === PayoutState.approved,
    set_paid_at: to === PayoutState.paid,
    audit: true,
  };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/** The domain facts the configured policy is evaluated against. */
export interface EligibilityFacts {
  /** Any payment on the deal reached `realized`. */
  payment_realized: boolean;
  /** Any payment reached `received` but not yet `realized` — drives the "pending realization" copy. */
  payment_received_not_realized: boolean;
  deal_stage: string;
  open_dispute_count: number;
}

export interface EligibilityOutcome {
  eligible: boolean;
  /** Which rule was satisfied, recorded on the row when it flips (`eligibility_rule`). */
  rule: string;
  /** Plain-language dependency for the "Not eligible | Explain dependency" state. */
  reason: string | null;
}

const CLOSED_WON_STAGES = new Set(['shipped', 'closed_won']);
// NOTE on event-driven recompute (`triggerPayoutRecompute`, src/lib/payouts.ts): this
// flag's trigger event is "deal reaches shipped/closed_won", but no route in this
// codebase currently writes `Deal.stage` to either of those — the deal lifecycle stops
// being advanced by any handler after `deal_locked`. There is nothing to wire the
// trigger call INTO yet. When a shipment-delivery or deal-closing route is built, add
// `await triggerPayoutRecompute(dealId, correlationId)` there, after its transaction
// commits, the same way the payment and dispute routes call it today. The default
// policy also ships with `require_deal_closed_won: false`, so this gap does not affect
// the payout behaviour exercised by anything currently in the product.

/**
 * Evaluate the configured policy against the facts.
 *
 * Every unmet requirement produces a specific reason string rather than a generic
 * "not eligible": OPS-05 requires the UI to explain the dependency, and a UI can only
 * do that if the rule engine tells it which dependency is missing.
 */
export function deriveEligibility(
  facts: EligibilityFacts,
  policy: PayoutEligibilityPolicy,
): EligibilityOutcome {
  const unmet: string[] = [];

  if (policy.require_payment_realized && !facts.payment_realized) {
    unmet.push(
      facts.payment_received_not_realized
        ? 'Buyer payment received but not yet realized — commission becomes payable once the bank confirms realization.'
        : 'Buyer payment has not been realized yet.',
    );
  }
  if (policy.require_deal_closed_won && !CLOSED_WON_STAGES.has(facts.deal_stage)) {
    unmet.push(`Deal has not reached a closed-won state (currently ${facts.deal_stage.replace(/_/g, ' ')}).`);
  }
  if (policy.require_no_open_dispute && facts.open_dispute_count > 0) {
    unmet.push(`${facts.open_dispute_count} open dispute(s) on this deal must be resolved first.`);
  }

  // The rule name records WHICH policy was in force when eligibility flipped, so a later
  // config change is visibly a different rule rather than an unexplained difference
  // between two payouts.
  const rule = [
    policy.require_payment_realized ? 'payment_realized' : null,
    policy.require_deal_closed_won ? 'deal_closed_won' : null,
    policy.require_no_open_dispute ? 'no_open_dispute' : null,
  ]
    .filter(Boolean)
    .join('+') || 'no_conditions';

  return unmet.length === 0
    ? { eligible: true, rule, reason: null }
    : { eligible: false, rule, reason: unmet.join(' ') };
}

export const PAYOUT_STATE_LABELS: Record<PayoutState, string> = {
  not_eligible: 'Not eligible yet',
  eligible: 'Eligible — awaiting finance approval',
  approved: 'Approved — awaiting payment',
  paid: 'Paid',
  disputed: 'Query raised',
};
