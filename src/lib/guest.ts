/**
 * Guest tier — minting, identity and the per-IP quota that bounds AI spend.
 *
 * The architectural rule this file exists to uphold: **there is no unauthenticated code
 * path.** A guest is a real ExporterOrg + User with tier='guest' and a real session, so
 * `tenantScope()` and every predicate in src/lib/permissions.ts apply to guests exactly
 * as they apply to a paying tenant. Nothing downstream needs to know a guest is special.
 *
 * The quota is the one genuinely new security surface. An anonymous caller triggering a
 * discovery run spends real money on every request, so:
 *
 *   - the quota is keyed on the caller's NETWORK identity, not on the guest row — a
 *     cleared cookie mints a new org, but the IP is unchanged;
 *   - it is checked and consumed BEFORE anything is written (see `consumeGuestRunQuota`),
 *     so a rejected request creates no rows at all;
 *   - the IP is read only from a trusted proxy header and stored only as a keyed HMAC.
 *
 * Limits come from config (`guest.policy`), never from constants here — they bound spend
 * and Ops must be able to retune them under load without a deploy (docs/01 §2).
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { OrgTier, UserRole, type Prisma } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { ERROR_CODES } from '@/types';

// ---------------------------------------------------------------------------
// Client IP — trusted sources only
// ---------------------------------------------------------------------------

/**
 * Headers we will believe, in priority order.
 *
 * `x-forwarded-for` is deliberately NOT in this list by default. Any client can set it,
 * so trusting it turns the quota into a suggestion: `curl -H 'X-Forwarded-For: <random>'`
 * would mint an unlimited number of fresh quota buckets. It is only consulted when
 * GUEST_TRUST_XFF is explicitly enabled for a deployment that terminates TLS behind a
 * proxy which overwrites (not appends to) the header.
 */
const TRUSTED_IP_HEADERS = ['x-vercel-forwarded-for', 'cf-connecting-ip', 'x-real-ip'] as const;

/**
 * Stand-in identity for local development, where nothing sits in front of the app to set
 * a trusted header.
 *
 * Without this the entire guest funnel is dead on a dev machine: the first search fails
 * with "Could not identify the request source" and a visitor can never be minted. Being
 * strict in production but unusable locally is not a security property, it's a broken
 * build.
 *
 * Safe because it is the *stricter* direction. Every local caller collapses into one
 * quota bucket, so the cap binds harder than it would in production — a misconfiguration
 * that leaked this into a real deployment would throttle everyone to a shared allowance,
 * never grant an attacker extra runs.
 */
const DEV_FALLBACK_IP = 'dev-local';

export function resolveClientIp(headers: Headers): string | null {
  for (const header of TRUSTED_IP_HEADERS) {
    const value = headers.get(header)?.trim();
    if (value) return value.split(',')[0]!.trim();
  }
  if (process.env.GUEST_TRUST_XFF === 'true') {
    // Left-most entry is the original client only if every hop is trusted. This is opt-in
    // precisely because that assumption is false on a default deployment.
    const xff = headers.get('x-forwarded-for');
    if (xff) return xff.split(',')[0]!.trim();
  }
  // Production fails closed: an unidentifiable caller must not get unmetered AI spend.
  if (process.env.NODE_ENV === 'production') return null;
  return DEV_FALLBACK_IP;
}

/**
 * Keyed hash of a client IP.
 *
 * An IP is personal data under DPDP/GDPR, and an *unkeyed* hash of the 32-bit IPv4 space
 * is trivially reversed by brute force — the keyed HMAC is what makes this table safe to
 * retain. A missing secret is a hard failure, not a silent fallback to plaintext.
 */
export function hashClientIp(ip: string): string {
  const secret = process.env.GUEST_IP_HASH_SECRET;
  if (!secret) {
    throw new Error('GUEST_IP_HASH_SECRET is not set — refusing to store client IPs unhashed.');
  }
  return createHmac('sha256', secret).update(ip).digest('hex');
}

/** Start of the current fixed window, so concurrent requests agree on one bucket row. */
export function currentWindowStart(windowHours: number, now = new Date()): Date {
  const windowMs = windowHours * 60 * 60 * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

export interface QuotaOutcome {
  allowed: boolean;
  used: number;
  limit: number;
  /** When the current window rolls over — surfaced so the UI can say when to come back. */
  resets_at: Date;
}

function rateLimited(outcome: QuotaOutcome): ApiError {
  const hours = Math.max(1, Math.ceil((outcome.resets_at.getTime() - Date.now()) / 3_600_000));
  return new ApiError(ERROR_CODES.RATE_LIMITED, {
    message:
      `You have used all ${outcome.limit} free searches. ` +
      `Create a free account to keep searching, or try again in about ${hours} hour${hours === 1 ? '' : 's'}.`,
  });
}

/**
 * Atomically consume one unit of guest run quota, or throw RATE_LIMITED.
 *
 * **Call this before creating anything.** The ordering is the whole control: if a guest
 * org were minted first and the quota checked second, a cookie-clearing loop would grow
 * ExporterOrg without bound even while every search was correctly rejected.
 *
 * The increment is a single conditional UPDATE rather than read-then-write, so two
 * concurrent requests on the same IP cannot both observe `used = limit - 1` and both
 * proceed.
 */
export async function consumeGuestRunQuota(ipHash: string): Promise<QuotaOutcome> {
  const policy = await getConfig('guest.policy');
  const windowStart = currentWindowStart(policy.quota_window_hours);
  const resetsAt = new Date(windowStart.getTime() + policy.quota_window_hours * 3_600_000);
  const limit = policy.discovery_runs_per_ip;

  // Ensure the bucket exists without disturbing an existing count.
  await prisma.guestRunQuota.upsert({
    where: { ip_hash_window_start: { ip_hash: ipHash, window_start: windowStart } },
    update: {},
    create: { ip_hash: ipHash, window_start: windowStart, runs_used: 0 },
  });

  // Conditional increment: only succeeds while the bucket is under the limit, so the
  // check and the consume are one atomic step.
  const claimed = await prisma.guestRunQuota.updateMany({
    where: { ip_hash: ipHash, window_start: windowStart, runs_used: { lt: limit } },
    data: { runs_used: { increment: 1 } },
  });

  const row = await prisma.guestRunQuota.findUnique({
    where: { ip_hash_window_start: { ip_hash: ipHash, window_start: windowStart } },
    select: { runs_used: true },
  });
  const outcome: QuotaOutcome = {
    allowed: claimed.count > 0,
    used: row?.runs_used ?? limit,
    limit,
    resets_at: resetsAt,
  };
  if (!outcome.allowed) throw rateLimited(outcome);
  return outcome;
}

/** Read-only view of remaining quota, for rendering "1 of 2 free searches left". */
export async function peekGuestRunQuota(ipHash: string): Promise<QuotaOutcome> {
  const policy = await getConfig('guest.policy');
  const windowStart = currentWindowStart(policy.quota_window_hours);
  const row = await prisma.guestRunQuota.findUnique({
    where: { ip_hash_window_start: { ip_hash: ipHash, window_start: windowStart } },
    select: { runs_used: true },
  });
  const used = row?.runs_used ?? 0;
  return {
    allowed: used < policy.discovery_runs_per_ip,
    used,
    limit: policy.discovery_runs_per_ip,
    resets_at: new Date(windowStart.getTime() + policy.quota_window_hours * 3_600_000),
  };
}

// ---------------------------------------------------------------------------
// Minting
// ---------------------------------------------------------------------------

/**
 * A guest's synthetic email.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve or be registered, so this can
 * never collide with a real address and can never accidentally be mailed. Keeping the
 * column non-null and UNIQUE means nothing downstream has to special-case a null identity.
 */
function guestEmail(orgId: string): string {
  return `guest-${orgId}@guest.invalid`;
}

export function isGuestEmail(email: string): boolean {
  return email.endsWith('@guest.invalid');
}

export interface MintedGuest {
  org_id: string;
  user_id: string;
  email: string;
}

/**
 * Create the guest tenant: one ExporterOrg + one User, in a single transaction.
 *
 * `password_hash` is left null — the row is deliberately not loggable-into. `authorize()`
 * rejects a null hash before bcrypt sees it, so a guest account cannot be signed into
 * even if someone learns the synthetic address.
 *
 * The User is an `exporter_owner`, not a separate guest role: the paywall is a tier, and
 * modelling it as a role would fork the permission matrix and change every existing
 * check. On upgrade this row is filled in, not replaced.
 */
export async function mintGuest(db: Prisma.TransactionClient | typeof prisma = prisma): Promise<MintedGuest> {
  const policy = await getConfig('guest.policy');
  const expiresAt = new Date(Date.now() + policy.run_retention_days * 86_400_000);

  const org = await db.exporterOrg.create({
    data: {
      display_name: 'Guest workspace',
      tier: OrgTier.guest,
      guest_expires_at: expiresAt,
    },
    select: { id: true },
  });

  const user = await db.user.create({
    data: {
      email: guestEmail(org.id),
      name: 'Guest',
      password_hash: null,
      role: UserRole.exporter_owner,
      exporter_org_id: org.id,
    },
    select: { id: true, email: true },
  });

  return { org_id: org.id, user_id: user.id, email: user.email };
}

/**
 * Constant-time compare, so the mint proof cannot be probed byte-by-byte via timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Proof that the server itself just minted this guest.
 *
 * The guest provider must never sign in a caller-supplied user id on trust: that would
 * be an impersonation hole — `signIn('guest', { userId: <any user> })` would hand out a
 * session for an arbitrary account, including a paying one. Only server code holds
 * AUTH_SECRET, so only server code can produce this HMAC, and the provider refuses
 * anything that fails verification.
 */
export function guestMintProof(userId: string): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set — cannot issue a guest session.');
  return createHmac('sha256', secret).update(`guest-mint:${userId}`).digest('hex');
}

export function verifyGuestMintProof(userId: string, proof: string): boolean {
  try {
    return safeEqual(guestMintProof(userId), proof);
  } catch {
    return false;
  }
}
