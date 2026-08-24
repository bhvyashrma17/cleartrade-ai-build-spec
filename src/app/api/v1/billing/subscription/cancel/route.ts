/**
 * POST /api/v1/billing/subscription/cancel — stop a recurring membership.
 *
 * Cancelling is NOT the same fact as losing access, and this route keeps them separate.
 * The member has paid through `current_period_end`; the default is to stop future charges
 * and let them keep what they bought until that date. `ExporterOrg.paid_until` already
 * encodes this, so no tier change happens here at all — the lapse sweep in
 * `subscription-service.ts` performs the downgrade when the clock actually runs out.
 *
 * `immediate: true` is exposed for ops_finance handling a refund, where access should end
 * with the money. An exporter cannot reach that branch: it is refused for `own_org`
 * grants, because a member clicking "cancel" is not asking to lose four weeks they already
 * paid for, and a UI that made that easy to do by accident would be a support burden and
 * arguably a consumer-protection problem.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { SubscriptionProvider, SubscriptionStatus } from '@prisma/client';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, grantFor } from '@/lib/permissions';
import { RazorpayError, cancelSubscription, razorpayConfig } from '@/lib/billing/razorpay';
import { applyProviderState, governingSubscription } from '@/lib/billing/subscription-service';
import { isTerminalSubscriptionStatus } from '@/lib/state-machines/subscription';
import { cancelSubscriptionSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'membership.manage');

    const orgId = principal.exporter_org_id;
    if (!orgId) {
      // Staff have no tenant of their own. Cancelling on BEHALF of an org would need an
      // org id in the path; this self-scoped route deliberately does not take one, the
      // same posture `PATCH /api/v1/exporter-org/commitment-fee` documents.
      throw validationError([
        { field: 'exporter_org_id', code: 'required', message: 'This route cancels your own membership only.' },
      ]);
    }

    const parsed = cancelSubscriptionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { immediate = false, reason } = parsed.data;

    // Immediate revocation is an ops_finance action ('all'), never an exporter one.
    if (immediate && grantFor(principal.role, 'membership.manage') !== 'all') {
      throw forbidden('Ending a membership immediately is an Operations action. Your membership will run to the end of the period you have paid for.');
    }

    const subscription = await governingSubscription(orgId);
    if (!subscription) throw notFound('There is no membership to cancel.');
    if (isTerminalSubscriptionStatus(subscription.status)) {
      throw validationError(
        [{ field: 'status', code: 'already_ended', message: 'This membership has already ended.' }],
      );
    }
    if (subscription.cancel_at_period_end && !immediate) {
      // Idempotent: a second click is not an error, it is the same outcome.
      return NextResponse.json(
        single({
          status: subscription.status,
          cancel_at_period_end: true,
          access_until: subscription.current_period_end?.toISOString() ?? null,
        }),
        { headers: { 'x-correlation-id': correlationId } },
      );
    }

    // A manual (Ops-granted) membership has no gateway object; cancelling it is purely a
    // local state change.
    if (subscription.provider === SubscriptionProvider.manual) {
      const result = await applyProviderState(
        subscription.id,
        {
          status: SubscriptionStatus.cancelled,
          cancel_at_period_end: !immediate,
          ...(immediate ? { current_period_end: new Date() } : {}),
        },
        { actor: principal, correlationId, reason: reason ?? 'manual_membership_cancelled' },
      );
      return NextResponse.json(
        single({
          status: result.subscription.status,
          cancel_at_period_end: result.subscription.cancel_at_period_end,
          access_until: result.subscription.current_period_end?.toISOString() ?? null,
          tier: result.tier_after,
        }),
        { headers: { 'x-correlation-id': correlationId } },
      );
    }

    if (!razorpayConfig() || !subscription.provider_subscription_id) {
      throw validationError([
        { field: 'provider', code: 'unavailable', message: 'Card payments are not available right now. Please contact support.' },
      ]);
    }

    // Gateway first: stopping the CHARGE is the part that must not be lost. If our own
    // write failed after this, the member is left billed-correctly with a stale local row,
    // which the next webhook repairs. The reverse order could leave us showing "cancelled"
    // while the card keeps being charged — the one outcome that is never acceptable.
    await cancelSubscription(subscription.provider_subscription_id, { atCycleEnd: !immediate });

    const result = await applyProviderState(
      subscription.id,
      immediate
        ? { status: SubscriptionStatus.cancelled, current_period_end: new Date(), cancel_at_period_end: false }
        : // Not `cancelled` yet — the member keeps access to the end of the period, and
          // Razorpay will send `subscription.cancelled` when it actually ends.
          { status: subscription.status, cancel_at_period_end: true },
      { actor: principal, correlationId, reason: reason ?? 'member_cancelled' },
    );

    await writeAuditEvent({
      actor: principal,
      action: AUDIT_ACTIONS.cancel,
      object_type: 'subscription',
      object_id: subscription.id,
      exporter_org_id: orgId,
      before_summary: { status: subscription.status, cancel_at_period_end: subscription.cancel_at_period_end },
      after_summary: { immediate, reason: reason ?? null, access_until: result.subscription.current_period_end?.toISOString() ?? null },
      correlation_id: correlationId,
    });

    return NextResponse.json(
      single({
        status: result.subscription.status,
        cancel_at_period_end: result.subscription.cancel_at_period_end,
        access_until: result.subscription.current_period_end?.toISOString() ?? null,
        tier: result.tier_after,
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    if (error instanceof RazorpayError) {
      return NextResponse.json(
        { error: { code: 'PAYMENT_GATEWAY_ERROR', message: 'Could not cancel with the payment gateway. Please try again or contact support.' } },
        { status: 502, headers: { 'x-correlation-id': correlationId } },
      );
    }
    return errorResponse(error, correlationId);
  }
}
