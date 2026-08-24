/**
 * POST /api/v1/billing/razorpay/webhook — the ONLY path by which paying money becomes
 * `paid` tier.
 *
 * This endpoint is public and unauthenticated: Razorpay's servers call it and carry no
 * session. Everything that makes it safe is in this file, so it is worth stating the
 * controls plainly rather than leaving them to be inferred:
 *
 *   1. SIGNATURE FIRST, over the RAW body, before the JSON is even parsed. An HMAC that
 *      cannot be forged is the entire authentication story here. `request.text()` is read
 *      once and the parse is done on that same string — calling `request.json()` and
 *      re-serializing would digest different bytes than were signed, which fails every
 *      legitimate call and is the reason this check tends to get "fixed" by removal.
 *   2. IDEMPOTENCY IN THE DATABASE, not in application logic. `SubscriptionEvent.
 *      provider_event_id` is unique; a replayed delivery loses the insert race and is
 *      acknowledged as already-applied. Razorpay retries aggressively and delivers
 *      concurrently — a check-then-act in JavaScript would not hold.
 *   3. THE SUBSCRIPTION IS LOOKED UP BY THE PROVIDER'S ID, never by anything in the body
 *      that a forger could choose, and never by a tenant id in the payload. The
 *      `notes.exporter_org_id` we set at creation is used only to detect a mismatch, never
 *      to select the row to update.
 *
 * ALWAYS 200 ONCE THE SIGNATURE PASSES. A non-2xx makes Razorpay retry, and retrying a
 * request that failed for a permanent reason (an event about a subscription we do not
 * have, a status we do not recognise) produces an infinite retry loop that buries the real
 * failures. Permanent problems are recorded and acknowledged; only genuinely transient
 * ones return 5xx so a retry can help.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma, SubscriptionStatus } from '@prisma/client';
import { newCorrelationId } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { fromUnixSeconds, razorpayConfig, verifyWebhookSignature } from '@/lib/billing/razorpay';
import { applyProviderState } from '@/lib/billing/subscription-service';
import { toSubscriptionStatus } from '@/lib/state-machines/subscription';
import { InvalidTransitionError } from '@/lib/errors';
import { log } from '@/lib/observability';

/** Node runtime: the signature check needs `node:crypto`, not the Edge subset. */
export const runtime = 'nodejs';
/** Never cached, never statically analysed — every delivery is a distinct mutation. */
export const dynamic = 'force-dynamic';

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    subscription?: {
      entity?: {
        id?: string;
        status?: string;
        current_start?: number | null;
        current_end?: number | null;
        notes?: Record<string, string> | null;
      };
    };
  };
}

/**
 * Events that carry a subscription entity we act on.
 *
 * An allowlist rather than "handle everything with a subscription in it": Razorpay adds
 * event types over time, and silently acting on an unfamiliar one is how an unexpected
 * state change reaches a member's access. Anything not listed is recorded and ignored.
 */
const HANDLED_EVENTS = new Set([
  'subscription.authenticated',
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.expired',
  'subscription.updated',
]);

function acknowledged(reason: string, correlationId: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { received: true, applied: false, reason, ...extra },
    { status: 200, headers: { 'x-correlation-id': correlationId } },
  );
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  const config = razorpayConfig();
  if (!config) {
    // Not configured here. 503 (not 200) because this IS transient from the provider's
    // point of view — an operator setting the secret makes the retry succeed.
    return NextResponse.json(
      { received: false, reason: 'payments_not_configured' },
      { status: 503, headers: { 'x-correlation-id': correlationId } },
    );
  }

  // --- 1. Raw body, then signature. Nothing above this line trusts the payload. ---
  const rawBody = await request.text();
  const signature = request.headers.get('x-razorpay-signature');

  if (!verifyWebhookSignature(rawBody, signature, config.webhookSecret)) {
    // 400, and deliberately no detail. A verbose response here is an oracle that helps an
    // attacker converge on a valid signature.
    return NextResponse.json(
      { received: false },
      { status: 400, headers: { 'x-correlation-id': correlationId } },
    );
  }

  // Razorpay's delivery id. Absent means we cannot deduplicate, and applying a state
  // change we might apply again is worse than skipping it.
  const eventId = request.headers.get('x-razorpay-event-id');
  if (!eventId) return acknowledged('missing_event_id', correlationId);

  let body: RazorpayWebhookBody;
  try {
    body = JSON.parse(rawBody) as RazorpayWebhookBody;
  } catch {
    return acknowledged('unparseable_body', correlationId);
  }

  const eventType = body.event ?? 'unknown';
  const entity = body.payload?.subscription?.entity;

  if (!HANDLED_EVENTS.has(eventType) || !entity?.id) {
    return acknowledged('event_not_handled', correlationId, { event: eventType });
  }

  const subscription = await prisma.subscription.findUnique({
    where: { provider_subscription_id: entity.id },
    select: { id: true, exporter_org_id: true, status: true },
  });

  if (!subscription) {
    // Permanent, not transient: an event for a subscription created against different
    // credentials (a shared test account, a restored database). Acknowledged so Razorpay
    // stops retrying, and observed so it is visible rather than silently dropped.
    log('warn', 'billing_webhook_unknown_subscription', {
      correlation_id: correlationId,
      event: eventType,
    });
    return acknowledged('unknown_subscription', correlationId, { event: eventType });
  }

  // The note we set at creation. A mismatch means the provider object was re-pointed at a
  // different tenant, which must never be allowed to move access between orgs.
  const notedOrgId = entity.notes?.exporter_org_id;
  if (notedOrgId && notedOrgId !== subscription.exporter_org_id) {
    log('error', 'billing_webhook_tenant_mismatch', {
      correlation_id: correlationId,
      event: eventType,
      subscription_id: subscription.id,
    });
    return acknowledged('tenant_mismatch', correlationId);
  }

  const status = entity.status ? toSubscriptionStatus(entity.status) : null;
  if (!status || status === SubscriptionStatus.none) {
    // Unrecognised provider status. Recording the event without acting is the only safe
    // answer — see `toSubscriptionStatus` for why neither default is acceptable.
    return acknowledged('unrecognised_status', correlationId, { event: eventType });
  }

  // --- 2. Claim the delivery. The unique index, not a prior read, is what deduplicates. ---
  try {
    await prisma.subscriptionEvent.create({
      data: {
        subscription_id: subscription.id,
        provider_event_id: eventId,
        event_type: eventType,
        resulting_status: status,
        payload: JSON.parse(rawBody) as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // Already applied. 200 — this is success, not failure.
      return acknowledged('duplicate_event', correlationId, { event: eventType });
    }
    throw error;
  }

  // --- 3. Apply. ---
  try {
    const result = await applyProviderState(
      subscription.id,
      {
        status,
        current_period_start: fromUnixSeconds(entity.current_start),
        current_period_end: fromUnixSeconds(entity.current_end),
        ...(status === SubscriptionStatus.cancelled ? { cancel_at_period_end: false } : {}),
      },
      // No actor: the provider acted, not a user. A fabricated actor in the audit trail
      // would be worse than an honest null.
      { actor: null, correlationId, reason: `razorpay:${eventType}` },
    );

    return NextResponse.json(
      {
        received: true,
        applied: result.changed,
        tier: result.tier_after,
      },
      { status: 200, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    if (error instanceof InvalidTransitionError) {
      // An out-of-order or late retry against an ended membership. Permanent: retrying
      // will never make it legal, so acknowledge rather than loop.
      return acknowledged('illegal_transition', correlationId, {
        event: eventType,
        from: error.from,
        to: error.to,
      });
    }
    // Genuinely transient (database unavailable). 500 so Razorpay retries — and the event
    // row we just claimed is rolled back with nothing else, since `applyProviderState`
    // runs in its own transaction and the claim above is a separate committed row.
    // That combination would suppress the retry, so the claim is released here.
    await prisma.subscriptionEvent.deleteMany({ where: { provider_event_id: eventId } });
    throw error;
  }
}
