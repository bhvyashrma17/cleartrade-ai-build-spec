/**
 * Shipment state machine — docs/07 §7.4.
 *
 * Two independent layers, deliberately never merged into one:
 *
 *   - `ShipmentStatus` is the pipeline position (planning -> ... -> delivered), with
 *     `exception` as an explicit stage the pipeline can halt in. This machine governs it.
 *   - `exception_state` (none/watch/blocked) + `exception_reason` is the SEVERITY signal
 *     Ops and the exporter actually watch (OPS-01's exception KPI reads this field, not
 *     `status`). A shipment can carry `exception_state=watch` while still progressing
 *     through `in_transit` — a minor issue does not have to halt the pipeline. Raising
 *     that severity signal does not go through `assertShipmentTransition` at all; see
 *     `assertExceptionStateChange` below.
 *
 * EXP-14-AC01 ("shipment status comes from Shipment state, not inferred from chat") is
 * what this file exists to make true in code, not just in a UI convention: nothing here
 * or in any caller derives `status` from anything but an explicit, guarded transition.
 */

import { ExceptionState, ShipmentStatus } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';

type Stage = ShipmentStatus;

/**
 * docs/07 §7.4 mermaid: the linear pipeline, plus "Any active -> exception" and the
 * single documented resume edge `exception -> customs: resolved`. No other resume target
 * is drawn, so none is implemented — inventing extra resume edges would be exactly the
 * kind of "reimplement instead of building to the contract" this file must not do.
 */
const TRANSITIONS: Record<Stage, Stage[]> = {
  planning: [ShipmentStatus.booking, ShipmentStatus.exception],
  booking: [ShipmentStatus.pickup, ShipmentStatus.exception],
  pickup: [ShipmentStatus.customs, ShipmentStatus.exception],
  customs: [ShipmentStatus.loaded, ShipmentStatus.exception],
  loaded: [ShipmentStatus.in_transit, ShipmentStatus.exception],
  in_transit: [ShipmentStatus.arrived, ShipmentStatus.exception],
  arrived: [ShipmentStatus.delivered, ShipmentStatus.exception],
  delivered: [],
  exception: [ShipmentStatus.customs],
};

/** Milestone codes in pipeline order — also the canonical timeline row order (EXP-14). */
export const MILESTONE_CODES = [
  'planning',
  'booking',
  'pickup',
  'customs',
  'loaded',
  'in_transit',
  'arrived',
  'delivered',
] as const;

export const MILESTONE_LABELS: Record<(typeof MILESTONE_CODES)[number], string> = {
  planning: 'Planning',
  booking: 'Booking confirmed',
  pickup: 'Pickup',
  customs: 'Customs clearance',
  loaded: 'Loaded',
  in_transit: 'In transit',
  arrived: 'Arrived',
  delivered: 'Delivered',
};

export function canTransitionShipment(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedShipmentTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

export interface ShipmentTransitionInput {
  /** Required entering `exception` — docs/07 "Any active -> exception: Reason + owner + remediation task/case". */
  exception_reason?: string | null;
  exception_owner_id?: string | null;
  /** Required leaving `exception` back to `customs` — "Resolution recorded; state transition explicit". */
  resolution_note?: string | null;
  /** The milestone this transition should mark actual/complete, if any (docs/07 §7.4 "minimum expected data/event" column). */
  milestone_evidence_present?: boolean;
}

export interface ShipmentTransitionEffects {
  /** Which milestone code should have its `actual_at`/`state` written by the caller. */
  milestone_code: (typeof MILESTONE_CODES)[number] | null;
  clear_exception: boolean;
  set_exception: boolean;
  audit: true;
}

/**
 * Validate a shipment pipeline transition. Throws `InvalidTransitionError` for an
 * illegal move, `VALIDATION_ERROR` for a legal move missing its required data — never
 * returns a boolean the caller could forget to check (same discipline as
 * `assertDealTransition`).
 */
export function assertShipmentTransition(
  from: Stage,
  to: Stage,
  input: ShipmentTransitionInput = {},
): ShipmentTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('shipment', from, to, 'The shipment is already at this stage.');
  }
  if (!canTransitionShipment(from, to)) {
    throw new InvalidTransitionError('shipment', from, to);
  }

  if (to === ShipmentStatus.exception && !input.exception_reason) {
    throw validationError(
      [{ field: 'exception_reason', code: 'required', message: 'Say what the exception is.' }],
      'Halting the shipment requires a reason.',
    );
  }

  if (from === ShipmentStatus.exception && !input.resolution_note) {
    throw validationError(
      [{ field: 'resolution_note', code: 'required', message: 'Record how the exception was resolved.' }],
      'Resuming from an exception requires a resolution note.',
    );
  }

  // `delivered` is terminal (docs/07 mermaid: delivered -> [*]) — TRANSITIONS already
  // has no outgoing edges for it, so canTransitionShipment() above refuses any attempt;
  // nothing further to guard here.

  const milestoneCode = (MILESTONE_CODES as readonly string[]).includes(to) ? (to as (typeof MILESTONE_CODES)[number]) : null;

  return {
    milestone_code: milestoneCode,
    clear_exception: from === ShipmentStatus.exception,
    set_exception: to === ShipmentStatus.exception,
    audit: true,
  };
}

// ---------------------------------------------------------------------------
// Exception severity — orthogonal to the pipeline stage (see file header)
// ---------------------------------------------------------------------------

const EXCEPTION_SEVERITY_ORDER: ExceptionState[] = [ExceptionState.none, ExceptionState.watch, ExceptionState.blocked];

export interface ExceptionStateChangeEffects {
  /** Whether this change requires a managed task/case (EXP-14-AC04) — true for any escalation into watch/blocked. */
  requires_managed_case: boolean;
  audit: true;
}

/**
 * Raising or clearing the exception SEVERITY (not the pipeline stage). Any move to
 * `watch` or `blocked` must carry a reason — "Exception: Visible owner + next step" is
 * not optional framing, it is the guard.
 */
export function assertExceptionStateChange(
  from: ExceptionState,
  to: ExceptionState,
  input: { reason?: string | null } = {},
): ExceptionStateChangeEffects {
  if (from === to) {
    throw new InvalidTransitionError('shipment_exception_state', from, to, 'The exception state is already set to this value.');
  }
  if (to !== ExceptionState.none && !input.reason) {
    throw validationError(
      [{ field: 'reason', code: 'required', message: 'Say what the issue is.' }],
      'Raising an exception requires a reason.',
    );
  }
  return {
    requires_managed_case: to !== ExceptionState.none && EXCEPTION_SEVERITY_ORDER.indexOf(to) >= EXCEPTION_SEVERITY_ORDER.indexOf(from),
    audit: true,
  };
}

export const SHIPMENT_STATUS_LABELS: Record<Stage, string> = {
  planning: 'Planning',
  booking: 'Booking confirmed',
  pickup: 'Pickup',
  customs: 'Customs clearance',
  loaded: 'Loaded',
  in_transit: 'In transit',
  arrived: 'Arrived',
  delivered: 'Delivered',
  exception: 'Exception',
};
