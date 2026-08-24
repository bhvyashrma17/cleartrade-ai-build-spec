/**
 * POST /api/v1/billing/subscription — start a membership and get the Razorpay page to
 * redirect to.
 *
 * This route creates the gateway object and OUR row, and grants nothing. Tier is not
 * touched here and must never be: at this point the member has authorized nothing and paid
 * nothing — they have merely been handed a URL. The only thing that grants `paid` is a
 * signature-verified webhook (`../razorpay/webhook`) or an Ops manual grant.
 *
 * ORDERING. The gateway call happens BEFORE our row is written, which is the opposite of
 * the quota-before-mint rule in `discovery-runs`, and deliberately so. The risks are
 * different: there, an unmetered write was the abuse surface; here, a `Subscription` row
 * with no gateway object behind it is an orphan no webhook can ever reach, which would
 * show a member a membership that can never activate. If Razorpay fails we write nothing
 * and the member simply retries. The reverse ordering would leak dead rows on every
 * gateway blip.
 *
 * An in-flight or active membership is returned rather than duplicated — a double-clicked
 * Upgrade button must not create two mandates against the same card.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma, SubscriptionStatus, type SubscriptionPlanCode } from '@prisma/client';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { PLAN_PERIOD } from '@/lib/billing/plans';
import { governingSubscription } from '@/lib/billing/subscription-service';
import {
  RazorpayError,
  createSubscription,
  fromUnixSeconds,
  requireRazorpayConfig,
} from '@/lib/billing/razorpay';
import { entitlesToPaid } from '@/lib/billing/subscription-service';
import { startSubscriptionSchema, zodFieldErrors } from '@/lib/validators';

/**
 * Billing cycles authorized up front. Razorpay's model has no unbounded mandate, so
 * "until you cancel" is expressed as a long horizon: 10 years either way.
 */
const TOTAL_COUNT: Record<SubscriptionPlanCode, number> = {
  premium_monthly: 120,
  premium_annual: 10,
};

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requireExporterPrincipal();
    // Role + tier first, so a guest gets UPGRADE_REQUIRED (register first) rather than a
    // bare FORBIDDEN — the distinction docs/14 §3 calls load-bearing for rendering upsells.
    assertCan(principal, 'membership.manage');
    const orgId = principal.exporter_org_id as string;

    const parsed = startSubscriptionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const planCode = parsed.data.plan_code as SubscriptionPlanCode;

    // 503 rather than 500: "the gateway is not switched on here" is a configuration state
    // an operator fixes, not a bug in this request. `requireRazorpayConfig` carries the
    // list of missing variables in its message.
    const config = requireRazorpayConfig();

    // Idempotency at the product level. A member who already has a live membership is sent
    // back to it; one mid-checkout gets the same hosted page rather than a second mandate.
    const existing = await governingSubscription(orgId);
    if (existing) {
      if (entitlesToPaid({ status: existing.status, paid_until: existing.current_period_end })) {
        throw validationError(
          [{ field: 'plan_code', code: 'already_subscribed', message: 'This account already has an active membership.' }],
          'You are already a member.',
        );
      }
      if (existing.status === SubscriptionStatus.created && existing.short_url) {
        return NextResponse.json(
          single({
            subscription_id: existing.id,
            plan_code: existing.plan_code,
            redirect_url: existing.short_url,
            resumed: true,
          }),
          { headers: { 'x-correlation-id': correlationId } },
        );
      }
    }

    const pricing = await getConfig('billing.plans');
    const price = pricing[planCode];
    if (!price) {
      throw validationError([{ field: 'plan_code', code: 'unpriced', message: 'That plan has no price configured.' }]);
    }

    const providerPlanId =
      planCode === 'premium_annual' ? config.annualPlanId : config.monthlyPlanId;

    const gateway = await createSubscription(
      {
        planId: providerPlanId,
        totalCount: TOTAL_COUNT[planCode],
        exporterOrgId: orgId,
        email: principal.email,
        notes: { plan_code: planCode, correlation_id: correlationId },
      },
      config,
    );

    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.subscription.create({
        data: {
          exporter_org_id: orgId,
          plan_code: planCode,
          status: SubscriptionStatus.created,
          provider_subscription_id: gateway.id,
          provider_customer_id: gateway.customer_id ?? null,
          provider_plan_id: gateway.plan_id,
          // Snapshotted, never re-read from the catalogue later — a reprice must not reach
          // backward into an existing member's agreed terms.
          amount: new Prisma.Decimal(price.amount),
          currency: price.currency,
          current_period_start: fromUnixSeconds(gateway.current_start),
          current_period_end: fromUnixSeconds(gateway.current_end),
          short_url: gateway.short_url,
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'subscription',
        object_id: row.id,
        exporter_org_id: orgId,
        after_summary: {
          plan_code: planCode,
          provider: 'razorpay',
          // The provider id is an opaque handle, not a credential — safe and necessary in
          // the trail, since it is the only key that joins our row to theirs in support.
          provider_subscription_id: gateway.id,
          amount: price.amount,
          currency: price.currency,
          status: SubscriptionStatus.created,
        },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(
      single({
        subscription_id: created.id,
        plan_code: planCode,
        redirect_url: gateway.short_url,
        resumed: false,
      }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    if (error instanceof RazorpayError) {
      // Never leak a gateway stack trace to the browser; the correlation id is the join
      // key into our own logs, which is what support actually needs.
      return NextResponse.json(
        {
          error: {
            code: error.status === 503 ? 'PAYMENTS_UNAVAILABLE' : 'PAYMENT_GATEWAY_ERROR',
            message:
              error.status === 503
                ? 'Card payments are not available right now. Please contact support.'
                : 'The payment gateway could not start this membership. Please try again.',
          },
        },
        { status: error.status === 503 ? 503 : 502, headers: { 'x-correlation-id': correlationId } },
      );
    }
    return errorResponse(error, correlationId);
  }
}

/** GET — the current membership, for the plans page to render state without a client fetch. */
export async function GET() {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'membership.manage');
    const subscription = await governingSubscription(principal.exporter_org_id as string);
    return NextResponse.json(
      single(
        subscription
          ? {
              id: subscription.id,
              plan_code: subscription.plan_code,
              status: subscription.status,
              current_period_end: subscription.current_period_end?.toISOString() ?? null,
              cancel_at_period_end: subscription.cancel_at_period_end,
              interval_months: PLAN_PERIOD[subscription.plan_code].interval_months,
              amount: subscription.amount.toString(),
              currency: subscription.currency,
            }
          : null,
      ),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
