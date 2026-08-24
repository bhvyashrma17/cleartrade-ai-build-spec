/**
 * Subscription state machine.
 *
 * Same separation every other machine in this directory keeps: this file answers "is this
 * transition legal and what does it cause", and knows nothing about tiers, Prisma or
 * Razorpay. The wiring lives in `src/lib/billing/subscription-service.ts`.
 *
 * The states are Razorpay's own (see `SubscriptionStatus` in the schema for why they were
 * adopted verbatim rather than translated). The transitions below are ours: they encode
 * which of the provider's moves we are willing to apply, which matters because a webhook
 * is an untrusted-ordering input. Razorpay retries, and retries can arrive out of order —
 * an `active` delivered after a `cancelled` must not resurrect a dead membership.
 *
 * `grants_access` is the one fact the rest of the system reads. Note `halted` grants
 * access: a halted subscription is one whose renewal payment FAILED, and the member has
 * usually already paid through a date that has not passed yet. Revoking on `halted` would
 * cut off a paying member because their card expired, before the retry window closes.
 * `paid_until` is what actually ends access — see `ExporterOrg.paid_until`.
 */

import { SubscriptionStatus } from '@prisma/client';
import { InvalidTransitionError } from '@/lib/errors';

type Stage = SubscriptionStatus;

/**
 * Legal moves. Terminal states have no outbound edges, which is what stops a late webhook
 * from reviving a membership the member already ended.
 */
const TRANSITIONS: Record<Stage, Stage[]> = {
  // `none` is our own "never subscribed" marker, not a Razorpay state; a row is created
  // straight into `created`, so nothing ever transitions out of `none`.
  none: [],
  created: [
    SubscriptionStatus.authenticated,
    SubscriptionStatus.active,
    SubscriptionStatus.cancelled,
    SubscriptionStatus.expired,
  ],
  // Mandate authorized, first charge not yet taken.
  authenticated: [
    SubscriptionStatus.active,
    SubscriptionStatus.pending,
    SubscriptionStatus.cancelled,
    SubscriptionStatus.expired,
  ],
  active: [
    SubscriptionStatus.pending,
    SubscriptionStatus.halted,
    SubscriptionStatus.cancelled,
    SubscriptionStatus.completed,
    SubscriptionStatus.expired,
    // Renewal succeeded: same status, new period. Handled as a period update rather than
    // a transition — see `assertSubscriptionTransition`'s same-state branch.
  ],
  // A charge failed and Razorpay is retrying.
  pending: [
    SubscriptionStatus.active,
    SubscriptionStatus.halted,
    SubscriptionStatus.cancelled,
    SubscriptionStatus.expired,
  ],
  // Retries exhausted. Recoverable: the member can update their card and Razorpay resumes.
  halted: [
    SubscriptionStatus.active,
    SubscriptionStatus.cancelled,
    SubscriptionStatus.expired,
  ],
  cancelled: [],
  completed: [],
  expired: [],
};

export function canTransitionSubscription(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedSubscriptionTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

export function isTerminalSubscriptionStatus(status: Stage): boolean {
  return TRANSITIONS[status].length === 0 && status !== SubscriptionStatus.none;
}

/**
 * Statuses under which a member keeps access, ASSUMING their paid-through date has not
 * passed. This is never the whole answer on its own — `paid_until` is the other half, and
 * `subscription-service.ts` requires both.
 */
const ACCESS_GRANTING: readonly Stage[] = [
  SubscriptionStatus.authenticated,
  SubscriptionStatus.active,
  SubscriptionStatus.pending,
  SubscriptionStatus.halted,
  // Cancelled-but-not-yet-expired: the member paid through a date and keeps it. The date
  // check in `subscription-service.ts` is what ends it.
  SubscriptionStatus.cancelled,
];

export function grantsAccess(status: Stage): boolean {
  return ACCESS_GRANTING.includes(status);
}

export interface SubscriptionTransitionEffects {
  /** Whether this status can still grant `paid`, subject to `paid_until`. */
  grants_access: boolean;
  /** Nothing further will come from the provider for this subscription. */
  terminal: boolean;
  /** A renewal or re-authorization landing on the same status — a period update, not a move. */
  same_state_refresh: boolean;
  audit: true;
}

/**
 * A same-state event is NOT an error here, unlike every other machine in this directory.
 *
 * That is a deliberate divergence and the reason is specific to recurring billing: the
 * `subscription.charged` webhook for a successful renewal reports `active` on a
 * subscription that is already `active`. It carries the new `current_end`, which is the
 * single most important field in the whole system — it is the member's new paid-through
 * date. Treating it as an invalid transition, the way `assertCommitmentFeeTransition`
 * correctly does for a one-shot fee, would reject every renewal and expire every member
 * at the end of their first period.
 */
export function assertSubscriptionTransition(from: Stage, to: Stage): SubscriptionTransitionEffects {
  const sameState = from === to;

  if (!sameState && !canTransitionSubscription(from, to)) {
    throw new InvalidTransitionError(
      'subscription',
      from,
      to,
      isTerminalSubscriptionStatus(from)
        ? 'This membership has already ended; a later provider event cannot reopen it.'
        : undefined,
    );
  }

  return {
    grants_access: grantsAccess(to),
    terminal: isTerminalSubscriptionStatus(to),
    same_state_refresh: sameState,
    audit: true,
  };
}

/**
 * Map a Razorpay status string onto our enum.
 *
 * Returns null for anything unrecognised rather than defaulting. Defaulting an unknown
 * status to `active` would grant access on a status we do not understand; defaulting it to
 * `expired` would revoke a paying member's access because Razorpay shipped a new state
 * name. Null means "record the event, change nothing", which is the only safe answer.
 */
export function toSubscriptionStatus(providerStatus: string): Stage | null {
  const normalized = providerStatus.trim().toLowerCase();
  return (Object.values(SubscriptionStatus) as string[]).includes(normalized)
    ? (normalized as Stage)
    : null;
}
