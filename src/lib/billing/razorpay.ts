/**
 * Razorpay Subscriptions — the only module that talks to the gateway.
 *
 * Deliberately built on `fetch` and the documented REST endpoints rather than the
 * `razorpay` npm package. Three reasons, in order of weight:
 *
 *   1. The webhook signature check must not depend on a vendor SDK's own idea of what a
 *      valid signature is. It is nine lines of HMAC against the RAW request body, and it
 *      is the single control standing between an unauthenticated public endpoint and
 *      "anyone can grant themselves a paid membership by POSTing JSON". That code should
 *      be readable in full, here, by whoever is auditing it.
 *   2. The SDK ships a callback/promise hybrid surface and its own HTTP stack, neither of
 *      which composes with the timeout-and-correlation-id posture the rest of this
 *      codebase uses for outbound calls.
 *   3. One fewer dependency on the path that moves money.
 *
 * CONFIGURATION IS OPTIONAL BY DESIGN. `isRazorpayConfigured()` is false when the keys
 * are unset, which is the normal state locally and in tests. Nothing here throws at import
 * time; callers branch on the predicate. What must NOT happen is a real environment
 * silently running unconfigured — `validateRuntimeEnvironment()` enforces that separately.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.razorpay.com/v1';
const REQUEST_TIMEOUT_MS = 15_000;

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Razorpay's own error code, when it sent one. Never contains credentials. */
    readonly providerCode: string | null = null,
  ) {
    super(message);
    this.name = 'RazorpayError';
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  /** Provider-side plan ids, created once in the Razorpay dashboard. */
  monthlyPlanId: string;
  annualPlanId: string;
}

function read(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

/**
 * True only when EVERY value needed to complete a checkout AND verify its webhook is
 * present.
 *
 * All-or-nothing on purpose. A half-configured gateway is the dangerous state: keys set
 * but no webhook secret means checkouts start, money moves, and nothing can ever verify
 * the confirmation — so the membership silently never activates and support cannot tell
 * a failed payment from a dropped webhook.
 */
export function isRazorpayConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return razorpayConfig(env) !== null;
}

export function razorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig | null {
  const keyId = read(env, 'RAZORPAY_KEY_ID');
  const keySecret = read(env, 'RAZORPAY_KEY_SECRET');
  const webhookSecret = read(env, 'RAZORPAY_WEBHOOK_SECRET');
  const monthlyPlanId = read(env, 'RAZORPAY_PLAN_ID_MONTHLY');
  const annualPlanId = read(env, 'RAZORPAY_PLAN_ID_ANNUAL');
  if (!keyId || !keySecret || !webhookSecret || !monthlyPlanId || !annualPlanId) return null;
  return { keyId, keySecret, webhookSecret, monthlyPlanId, annualPlanId };
}

export function requireRazorpayConfig(env: NodeJS.ProcessEnv = process.env): RazorpayConfig {
  const config = razorpayConfig(env);
  if (!config) {
    throw new RazorpayError(
      'Razorpay is not configured. Set RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, RAZORPAY_PLAN_ID_MONTHLY and RAZORPAY_PLAN_ID_ANNUAL.',
      503,
    );
  }
  return config;
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------

/**
 * Verify `X-Razorpay-Signature` against the RAW request body.
 *
 * `rawBody` must be the exact bytes received. Re-serializing parsed JSON changes key order
 * and whitespace, which changes the digest, which fails every legitimate webhook — the
 * classic way this check gets "fixed" by disabling it.
 *
 * `timingSafeEqual` rather than `===`: signature comparison is the textbook timing-oracle,
 * and an attacker who can measure it can forge a membership. Lengths are compared first
 * because `timingSafeEqual` throws on a length mismatch.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const provided = signature.trim();
  if (provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(provided, 'utf8'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// REST calls
// ---------------------------------------------------------------------------

async function call<T>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown },
  config: RazorpayConfig,
): Promise<T> {
  const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (error) {
    // An abort and a DNS failure are both "we do not know whether the gateway acted".
    // Surfaced as 502 so the caller renders "try again", never "payment failed".
    throw new RazorpayError(
      error instanceof Error && error.name === 'AbortError'
        ? 'The payment gateway did not respond in time.'
        : 'Could not reach the payment gateway.',
      502,
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

  if (!response.ok) {
    const detail = (parsed.error ?? {}) as { code?: string; description?: string };
    // Razorpay's `description` is operator-facing and never contains our credentials, so
    // it is safe to propagate. The Authorization header is never echoed back.
    throw new RazorpayError(
      detail.description ?? `Razorpay returned ${response.status}.`,
      response.status,
      detail.code ?? null,
    );
  }
  return parsed as T;
}

export interface RazorpaySubscription {
  id: string;
  plan_id: string;
  customer_id?: string | null;
  status: string;
  short_url: string;
  current_start: number | null;
  current_end: number | null;
  charge_at: number | null;
  notes?: Record<string, string> | null;
}

/**
 * Start a subscription and get back the hosted page to redirect the member to.
 *
 * `notes.exporter_org_id` is the join key back to our tenant. It matters because Razorpay
 * webhooks identify the subscription by THEIR id, and a webhook can arrive before our own
 * `Subscription` row commits — the note lets a late or replayed event still be attributed
 * without guessing. `total_count` is the number of billing cycles authorized up front;
 * a long horizon is how "until cancelled" is expressed in their model.
 */
export async function createSubscription(
  input: {
    planId: string;
    totalCount: number;
    exporterOrgId: string;
    /** Prefilled on the hosted page. Never used as an identity claim on our side. */
    email?: string | null;
    notes?: Record<string, string>;
  },
  config: RazorpayConfig = requireRazorpayConfig(),
): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(
    '/subscriptions',
    {
      method: 'POST',
      body: {
        plan_id: input.planId,
        total_count: input.totalCount,
        // The member authorizes the mandate on Razorpay's page; we never see card data.
        customer_notify: 1,
        notes: {
          exporter_org_id: input.exporterOrgId,
          ...(input.notes ?? {}),
        },
        ...(input.email ? { notify_info: { notify_email: input.email } } : {}),
      },
    },
    config,
  );
}

export async function fetchSubscription(
  providerSubscriptionId: string,
  config: RazorpayConfig = requireRazorpayConfig(),
): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(
    `/subscriptions/${encodeURIComponent(providerSubscriptionId)}`,
    { method: 'GET' },
    config,
  );
}

/**
 * Cancel at the end of the paid-through period by default.
 *
 * `cancel_at_cycle_end: 1` is the honest default for a member who clicked "cancel": they
 * paid through a date and keep access until it. Immediate cancellation would revoke access
 * the member already paid for, which is a refund question, not a cancellation one.
 */
export async function cancelSubscription(
  providerSubscriptionId: string,
  options: { atCycleEnd?: boolean } = {},
  config: RazorpayConfig = requireRazorpayConfig(),
): Promise<RazorpaySubscription> {
  return call<RazorpaySubscription>(
    `/subscriptions/${encodeURIComponent(providerSubscriptionId)}/cancel`,
    { method: 'POST', body: { cancel_at_cycle_end: options.atCycleEnd === false ? 0 : 1 } },
    config,
  );
}

/** Razorpay sends money in the smallest currency unit (paise for INR). */
export function toSmallestUnit(amount: string): number {
  return Math.round(Number(amount) * 100);
}

/** Unix seconds -> Date, tolerating the nulls Razorpay sends before the first charge. */
export function fromUnixSeconds(value: number | null | undefined): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return new Date(value * 1000);
}
