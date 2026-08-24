/**
 * Membership -> tier. The ONLY writer of `ExporterOrg.tier` for a subscription.
 *
 * `CAPABILITY_MIN_TIER` (docs/14 §2) reads `principal.tier` and nothing else. That stays
 * true: nothing in the permission layer learned what a subscription is, and nothing in it
 * should. This module is the seam that turns a commercial fact into the one field the
 * authorization layer already understood.
 *
 * THE TWO-KEY RULE. Access requires BOTH an access-granting status AND a `paid_until` in
 * the future. Neither alone is sufficient, and the reason is asymmetric failure:
 *
 *   - status alone: a webhook that never arrives (provider outage, misconfigured endpoint,
 *     our own 500) leaves the row `active` forever. A member who stopped paying six months
 *     ago keeps full access, and nothing in the system ever notices.
 *   - date alone: a member who cancels mid-period, or whose subscription Razorpay marks
 *     `expired` early for mandate reasons, keeps access until an arbitrary future date.
 *
 * Requiring both means the failure mode of a missed webhook is "access lapses on the date
 * we were actually paid through" — which is correct, not merely safe.
 *
 * TIER IS NEVER DERIVED AT READ TIME. It is written here and read from the row. Deriving
 * it inside `getPrincipal()` would put a subscription join on the hot path of every
 * request, and would make the JWT's tier claim disagree with the database in a way the
 * existing session code has no way to reconcile.
 */

import {
  OrgTier,
  Prisma,
  SubscriptionProvider,
  SubscriptionStatus,
  type Subscription,
} from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import {
  assertSubscriptionTransition,
  grantsAccess,
  isTerminalSubscriptionStatus,
} from '@/lib/state-machines/subscription';
import type { Principal } from '@/types';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * A grace window after `paid_until` before access is cut.
 *
 * Not generosity — clock skew and webhook latency. Razorpay charges at the period boundary
 * and the `subscription.charged` webhook that carries the NEW `current_end` lands seconds
 * to minutes later. Without a grace window, every member on every renewal briefly has a
 * `paid_until` in the past, and a sweep running in that window would downgrade a paying
 * customer mid-renewal.
 */
export const RENEWAL_GRACE_HOURS = 72;

export function accessEndsAt(paidUntil: Date): Date {
  return new Date(paidUntil.getTime() + RENEWAL_GRACE_HOURS * 3_600_000);
}

// ---------------------------------------------------------------------------
// Entitlement
// ---------------------------------------------------------------------------

export interface EntitlementInput {
  status: SubscriptionStatus;
  paid_until: Date | null;
}

/**
 * Does this subscription entitle its tenant to `paid` right now?
 *
 * A null `paid_until` on an access-granting status means the provider has not told us a
 * period yet — a mandate authorized seconds ago, before the first charge. That grants
 * access: refusing it would show a member who just paid a locked product, and the
 * subsequent `subscription.charged` webhook fills the date in. It is bounded by the fact
 * that an unpaid subscription moves to `halted`/`expired` rather than sitting in
 * `authenticated` indefinitely.
 */
export function entitlesToPaid(input: EntitlementInput, now = new Date()): boolean {
  if (!grantsAccess(input.status)) return false;
  if (input.paid_until === null) return input.status === SubscriptionStatus.authenticated;
  return accessEndsAt(input.paid_until).getTime() > now.getTime();
}

/**
 * The tier an org should hold, resolving BOTH grant paths.
 *
 * The one-time commitment fee (docs/01 §2) and an Ops waiver are non-expiring grants; a
 * subscription is time-bounded. An org holding either keeps `paid`. This is why a lapsed
 * subscription cannot downgrade a tenant that paid the commitment fee — a real case for
 * the pilot cohort, who paid the fee before memberships existed.
 */
export function resolveTier(
  org: { commitment_fee_status: string; tier: OrgTier },
  subscription: EntitlementInput | null,
  now = new Date(),
): OrgTier {
  if (org.commitment_fee_status === 'paid' || org.commitment_fee_status === 'waived') {
    return OrgTier.paid;
  }
  if (subscription && entitlesToPaid(subscription, now)) return OrgTier.paid;
  // Never below `free`: a registered tenant whose membership lapsed is a free member, not
  // a guest. Dropping them to `guest` would make them purgeable by `purge-guests.ts`.
  return org.tier === OrgTier.guest ? OrgTier.guest : OrgTier.free;
}

// ---------------------------------------------------------------------------
// Applying provider state
// ---------------------------------------------------------------------------

export interface ProviderSubscriptionState {
  status: SubscriptionStatus;
  current_period_start?: Date | null;
  current_period_end?: Date | null;
  cancel_at_period_end?: boolean;
}

export interface ApplyResult {
  subscription: Subscription;
  tier_before: OrgTier;
  tier_after: OrgTier;
  /** False when the event was legal but changed nothing — a duplicate or a no-op refresh. */
  changed: boolean;
}

/**
 * Apply one provider state onto a subscription and re-resolve its tenant's tier, in a
 * single transaction.
 *
 * One transaction because a subscription row saying `active` while its org still says
 * `free` is a support ticket that looks like a billing bug, and the reverse is unpaid
 * access. They are one fact and must commit together.
 */
export async function applyProviderState(
  subscriptionId: string,
  state: ProviderSubscriptionState,
  context: { actor: Principal | null; correlationId: string; reason: string },
  db: Db = prisma,
): Promise<ApplyResult> {
  const runner = async (tx: Prisma.TransactionClient): Promise<ApplyResult> => {
    const existing = await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: {
        exporter_org: { select: { id: true, tier: true, commitment_fee_status: true, paid_until: true } },
      },
    });

    // Throws INVALID_TRANSITION for a late event on an ended membership — the control that
    // stops an out-of-order webhook retry from resurrecting a cancelled subscription.
    const effects = assertSubscriptionTransition(existing.status, state.status);

    const periodEnd =
      state.current_period_end === undefined ? existing.current_period_end : state.current_period_end;
    const periodStart =
      state.current_period_start === undefined ? existing.current_period_start : state.current_period_start;

    const updated = await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        status: state.status,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        ...(state.cancel_at_period_end === undefined
          ? {}
          : { cancel_at_period_end: state.cancel_at_period_end }),
        ...(state.status === SubscriptionStatus.cancelled && !existing.cancelled_at
          ? { cancelled_at: new Date() }
          : {}),
        ...(effects.terminal && !existing.ended_at ? { ended_at: new Date() } : {}),
      },
    });

    const org = existing.exporter_org;
    const tierBefore = org.tier;
    const tierAfter = resolveTier(org, { status: updated.status, paid_until: periodEnd });

    // `paid_until` mirrors the subscription's paid-through date so the lapse sweep can find
    // expiring orgs with one indexed query instead of joining every subscription.
    await tx.exporterOrg.update({
      where: { id: org.id },
      data: {
        paid_until: periodEnd,
        ...(tierAfter === tierBefore ? {} : { tier: tierAfter }),
        ...(tierBefore === OrgTier.paid && tierAfter !== OrgTier.paid
          ? { downgraded_at: new Date() }
          : {}),
      },
    });

    const changed =
      existing.status !== updated.status ||
      existing.current_period_end?.getTime() !== periodEnd?.getTime() ||
      tierBefore !== tierAfter;

    if (changed) {
      await writeAuditEvent({
        db: tx,
        actor: context.actor,
        action: AUDIT_ACTIONS.state_change,
        object_type: 'subscription',
        object_id: updated.id,
        exporter_org_id: org.id,
        before_summary: {
          status: existing.status,
          tier: tierBefore,
          current_period_end: existing.current_period_end?.toISOString() ?? null,
        },
        after_summary: {
          status: updated.status,
          tier: tierAfter,
          current_period_end: periodEnd?.toISOString() ?? null,
          plan_code: updated.plan_code,
          reason: context.reason,
        },
        correlation_id: context.correlationId,
      });
    }

    return { subscription: updated, tier_before: tierBefore, tier_after: tierAfter, changed };
  };

  return '$transaction' in db ? db.$transaction(runner) : runner(db as Prisma.TransactionClient);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The subscription that currently governs an org's access, or null.
 *
 * "Governs" is not "most recent": a member who cancelled and resubscribed has two rows,
 * and the new one governs even though the old one may have been updated more recently by
 * a trailing webhook. Access-granting rows are preferred, newest first; only if none
 * grants access does the newest row win, so the UI can still say "your membership ended
 * on the 3rd" rather than showing nothing.
 */
export async function governingSubscription(
  exporterOrgId: string,
  db: Db = prisma,
  now = new Date(),
): Promise<Subscription | null> {
  const rows = await db.subscription.findMany({
    where: { exporter_org_id: exporterOrgId },
    orderBy: { created_at: 'desc' },
  });
  if (rows.length === 0) return null;
  const live = rows.find((row) =>
    entitlesToPaid({ status: row.status, paid_until: row.current_period_end }, now),
  );
  return live ?? rows[0]!;
}

/**
 * Downgrade every tenant whose membership clock has run out.
 *
 * This is the control that makes a missed webhook safe. Razorpay does not guarantee
 * delivery, so "we were never told they stopped paying" must not mean "they keep access
 * forever" — the date we were paid through is a fact we already hold, and this sweep acts
 * on it without needing the provider to say anything.
 *
 * Scheduled from `scripts/worker.ts`. Idempotent: an org already at `free` is not selected.
 */
export async function expireLapsedMemberships(
  options: { now?: Date; correlationId: string; limit?: number } = { correlationId: 'lapse-sweep' },
): Promise<{ downgraded: string[] }> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RENEWAL_GRACE_HOURS * 3_600_000);

  const candidates = await prisma.exporterOrg.findMany({
    where: {
      tier: OrgTier.paid,
      paid_until: { not: null, lt: cutoff },
      // A non-expiring grant is not a lapse. Excluded in the query rather than filtered
      // afterwards so the pilot cohort never appears in this sweep's candidate set at all.
      commitment_fee_status: { notIn: ['paid', 'waived'] },
    },
    select: { id: true, tier: true, paid_until: true, commitment_fee_status: true },
    take: options.limit ?? 500,
  });

  const downgraded: string[] = [];
  for (const org of candidates) {
    const subscription = await governingSubscription(org.id, prisma, now);
    const tier = resolveTier(org, subscription ? { status: subscription.status, paid_until: subscription.current_period_end } : null, now);
    if (tier === OrgTier.paid) continue;

    await prisma.$transaction(async (tx) => {
      await tx.exporterOrg.update({
        where: { id: org.id },
        data: { tier, downgraded_at: now },
      });
      await writeAuditEvent({
        db: tx,
        actor: null,
        action: AUDIT_ACTIONS.state_change,
        object_type: 'exporter_org',
        object_id: org.id,
        exporter_org_id: org.id,
        before_summary: { tier: OrgTier.paid, paid_until: org.paid_until?.toISOString() ?? null },
        after_summary: { tier, reason: 'membership_lapsed' },
        correlation_id: options.correlationId,
      });
    });
    downgraded.push(org.id);
  }

  return { downgraded };
}

/**
 * Ops-granted membership with no gateway behind it (pilot accounts, comped partners).
 *
 * Separate from the Razorpay path on purpose: it takes an explicit end date and an actor,
 * so a comped membership is as auditable and as time-bounded as a paid one. A comp with no
 * end date is how tenants quietly accumulate free access forever.
 */
export async function grantManualMembership(input: {
  exporterOrgId: string;
  planCode: Subscription['plan_code'];
  amount: string;
  currency: string;
  paidUntil: Date;
  actor: Principal;
  correlationId: string;
  reason: string;
}): Promise<Subscription> {
  return prisma.$transaction(async (tx) => {
    const created = await tx.subscription.create({
      data: {
        exporter_org_id: input.exporterOrgId,
        plan_code: input.planCode,
        provider: SubscriptionProvider.manual,
        status: SubscriptionStatus.active,
        amount: new Prisma.Decimal(input.amount),
        currency: input.currency,
        current_period_start: new Date(),
        current_period_end: input.paidUntil,
      },
    });

    await tx.exporterOrg.update({
      where: { id: input.exporterOrgId },
      data: { tier: OrgTier.paid, paid_until: input.paidUntil },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.create,
      object_type: 'subscription',
      object_id: created.id,
      exporter_org_id: input.exporterOrgId,
      after_summary: {
        provider: SubscriptionProvider.manual,
        plan_code: input.planCode,
        paid_until: input.paidUntil.toISOString(),
        reason: input.reason,
      },
      correlation_id: input.correlationId,
    });

    return created;
  });
}

export { isTerminalSubscriptionStatus };
