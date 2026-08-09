/**
 * Payment state machine — docs/07 §7.5.
 *
 * Three independent layers on `Payment`, guarded separately and never allowed to imply
 * one another:
 *
 *   - `status` — the lifecycle this file's `assertPaymentTransition` governs.
 *   - `brc_status` — EXP-15-AC04 is explicit that this is independent of received/
 *     realized. `assertBrcTransition` is a SEPARATE guard with no path back into
 *     `assertPaymentTransition`'s effects; nothing in this file ever writes brc_status
 *     as a side effect of a status change.
 *   - `source` (provenance) — EXP-15-AC02. Required on every transition that claims
 *     money moved, not optional metadata.
 *
 * EXP-15-AC01 ("never imply ClearTrade holds/settles funds") is enforced by what this
 * file refuses to model: there is no "ClearTrade receives" transition, no escrow state,
 * no settlement action. Every status here describes the BUYER's payment to the
 * EXPORTER; ClearTrade's own commercial fee is a completely separate object
 * (`FeePolicy`/`Deal.quoted_fee_policy`) that this machine never touches.
 */

import { BrcStatus, InsuranceCaseStatus, PaymentSource, PaymentStatus } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';

type Stage = PaymentStatus;

/** docs/07 §7.5 mermaid, transcribed exactly — including both resolution edges off `disputed`. */
const TRANSITIONS: Record<Stage, Stage[]> = {
  not_due: [PaymentStatus.due],
  due: [PaymentStatus.partially_received, PaymentStatus.received, PaymentStatus.overdue, PaymentStatus.disputed],
  partially_received: [PaymentStatus.received, PaymentStatus.overdue, PaymentStatus.disputed],
  overdue: [PaymentStatus.received, PaymentStatus.disputed],
  received: [PaymentStatus.realized],
  disputed: [PaymentStatus.due, PaymentStatus.received],
  realized: [],
};

/** Transitions that assert money actually moved — provenance is mandatory on these. */
const REQUIRES_PROVENANCE: Stage[] = [PaymentStatus.partially_received, PaymentStatus.received, PaymentStatus.realized];

export function canTransitionPayment(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedPaymentTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

export interface PaymentTransitionInput {
  /** EXP-15-AC02: mandatory on any transition in REQUIRES_PROVENANCE. */
  source?: PaymentSource | null;
  /** Required for partially_received/received — what actually arrived. */
  amount_received?: string | number | null;
  /** The payment's full expected amount, for the partial-vs-full comparison below. */
  amount?: string | number | null;
  /** Required moving into `disputed`. */
  dispute_reason?: string | null;
}

export interface PaymentTransitionEffects {
  set_received_at: boolean;
  set_realized_at: boolean;
  audit: true;
}

export function assertPaymentTransition(
  from: Stage,
  to: Stage,
  input: PaymentTransitionInput = {},
): PaymentTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('payment', from, to, 'The payment is already in this state.');
  }
  if (!canTransitionPayment(from, to)) {
    throw new InvalidTransitionError('payment', from, to);
  }

  if (REQUIRES_PROVENANCE.includes(to) && !input.source) {
    throw validationError(
      [{ field: 'source', code: 'required', message: 'Say where this update came from (exporter, AA, bank partner, or Ops).' }],
      'Provenance is required whenever a payment update claims money moved.',
    );
  }

  if (to === PaymentStatus.disputed && !input.dispute_reason) {
    throw validationError(
      [{ field: 'dispute_reason', code: 'required', message: 'Say what is being disputed.' }],
      'Marking a payment disputed requires a reason.',
    );
  }

  // EXP-15-AC03: partial receipt is a first-class transition, not a workaround — but
  // "partial" only means something if the arithmetic actually says so. Guarding this
  // here means the UI cannot mislabel a full receipt as partial (or vice versa) by
  // sending the wrong target status.
  if (to === PaymentStatus.partially_received || to === PaymentStatus.received) {
    const received = toNumber(input.amount_received);
    const expected = toNumber(input.amount);
    if (received === null) {
      throw validationError(
        [{ field: 'amount_received', code: 'required', message: 'Enter the amount actually received.' }],
        'An amount is required to record a receipt.',
      );
    }
    if (expected !== null) {
      if (to === PaymentStatus.partially_received && received >= expected) {
        throw validationError(
          [{ field: 'amount_received', code: 'invalid', message: 'This covers the full amount — record it as received, not partially received.' }],
          'The received amount matches or exceeds the total; this is not a partial receipt.',
        );
      }
      if (to === PaymentStatus.received && received < expected) {
        throw validationError(
          [{ field: 'amount_received', code: 'invalid', message: 'This is less than the full amount — record it as partially received.' }],
          'The received amount is less than the total; this is not a full receipt.',
        );
      }
    }
  }

  return {
    set_received_at: to === PaymentStatus.received || to === PaymentStatus.partially_received,
    set_realized_at: to === PaymentStatus.realized,
    audit: true,
  };
}

function toNumber(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export const PAYMENT_STATUS_LABELS: Record<Stage, string> = {
  not_due: 'Not due yet',
  due: 'Due',
  partially_received: 'Partially received',
  received: 'Received',
  realized: 'Realized',
  overdue: 'Overdue',
  disputed: 'Disputed',
};

// ---------------------------------------------------------------------------
// BRC status — EXP-15-AC04: independent of received/realized, never derived from it
// ---------------------------------------------------------------------------

const BRC_TRANSITIONS: Record<BrcStatus, BrcStatus[]> = {
  not_applicable: [BrcStatus.pending],
  pending: [BrcStatus.available],
  available: [BrcStatus.verified],
  verified: [],
};

export function assertBrcTransition(from: BrcStatus, to: BrcStatus): { audit: true } {
  if (from === to) {
    throw new InvalidTransitionError('brc_status', from, to, 'BRC status is already set to this value.');
  }
  if (!BRC_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError('brc_status', from, to);
  }
  return { audit: true };
}

export const BRC_STATUS_LABELS: Record<BrcStatus, string> = {
  not_applicable: 'Not applicable',
  pending: 'Pending',
  available: 'Available',
  verified: 'Verified',
};

// ---------------------------------------------------------------------------
// Insurance case — EXP-15 "Insurance: separate case state"
// ---------------------------------------------------------------------------

const INSURANCE_TRANSITIONS: Record<InsuranceCaseStatus, InsuranceCaseStatus[]> = {
  not_started: [InsuranceCaseStatus.quote_requested],
  quote_requested: [InsuranceCaseStatus.quoted, InsuranceCaseStatus.declined],
  quoted: [InsuranceCaseStatus.bound, InsuranceCaseStatus.declined],
  bound: [InsuranceCaseStatus.claim_open],
  claim_open: [InsuranceCaseStatus.claim_settled],
  claim_settled: [],
  declined: [InsuranceCaseStatus.quote_requested],
};

export function assertInsuranceCaseTransition(from: InsuranceCaseStatus, to: InsuranceCaseStatus): { audit: true } {
  if (from === to) {
    throw new InvalidTransitionError('insurance_case', from, to, 'This insurance case is already at this status.');
  }
  if (!INSURANCE_TRANSITIONS[from].includes(to)) {
    throw new InvalidTransitionError('insurance_case', from, to);
  }
  return { audit: true };
}

export const INSURANCE_STATUS_LABELS: Record<InsuranceCaseStatus, string> = {
  not_started: 'No policy',
  quote_requested: 'Quote requested',
  quoted: 'Quoted',
  bound: 'Active',
  claim_open: 'Claim open',
  claim_settled: 'Claim settled',
  declined: 'Declined',
};
