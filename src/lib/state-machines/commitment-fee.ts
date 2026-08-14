/**
 * Commitment fee state machine — docs/01 §2: "support status: not_due / due / paid /
 * waived / refunded".
 *
 * This is the SAME commitment fee docs/01 always specified, now load-bearing: paying it
 * is what flips `ExporterOrg.tier` from `free` to `paid`, which is what unlocks full
 * Demand Discovery (ranked markets, market detail, save/select) per the docs/14 tier
 * change. The state machine itself knows nothing about tiers — that wiring lives in the
 * route (`PATCH /api/v1/exporter-org/commitment-fee`), same separation `payout.ts` keeps
 * between "is this transition legal" and "what does it cause".
 *
 * `waived`/`refunded` are represented here for completeness — docs/01 names them as real
 * states — but only `due -> paid` (self/ops reported) and `due -> waived` (ops override)
 * have a route wired to them today. `paid -> refunded` exists as a legal transition with
 * no route yet, same "hook built, path not exposed" posture docs/11 recommends for open
 * decisions: adding the route later is additive, not a redesign.
 */

import { CommitmentFeeStatus, PaymentSource } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';

type Stage = CommitmentFeeStatus;

const TRANSITIONS: Record<Stage, Stage[]> = {
  not_due: [CommitmentFeeStatus.due],
  due: [CommitmentFeeStatus.paid, CommitmentFeeStatus.waived],
  paid: [CommitmentFeeStatus.refunded],
  waived: [],
  refunded: [],
};

export function canTransitionCommitmentFee(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedCommitmentFeeTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

export interface CommitmentFeeTransitionInput {
  /** Required moving into `paid` — the same provenance vocabulary Payment.source uses. */
  source?: PaymentSource | null;
  /** Required moving into `waived` — an override needs a stated reason, not a bare flag. */
  waive_reason?: string | null;
}

export interface CommitmentFeeTransitionEffects {
  /** Whether this transition is what unlocks `paid` tier — the route reads this, doesn't re-derive it. */
  unlocks_paid_tier: boolean;
  audit: true;
}

export function assertCommitmentFeeTransition(
  from: Stage,
  to: Stage,
  input: CommitmentFeeTransitionInput = {},
): CommitmentFeeTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('commitment_fee', from, to, 'The commitment fee is already in this state.');
  }
  if (!canTransitionCommitmentFee(from, to)) {
    throw new InvalidTransitionError('commitment_fee', from, to);
  }

  if (to === CommitmentFeeStatus.paid && !input.source) {
    throw validationError(
      [{ field: 'source', code: 'required', message: 'Say where this payment was confirmed (self-reported or Ops-confirmed).' }],
      'Marking the commitment fee paid requires a source.',
    );
  }

  if (to === CommitmentFeeStatus.waived && !input.waive_reason) {
    throw validationError(
      [{ field: 'waive_reason', code: 'required', message: 'Say why the fee is being waived.' }],
      'Waiving the commitment fee requires a reason.',
    );
  }

  return {
    unlocks_paid_tier: to === CommitmentFeeStatus.paid || to === CommitmentFeeStatus.waived,
    audit: true,
  };
}
