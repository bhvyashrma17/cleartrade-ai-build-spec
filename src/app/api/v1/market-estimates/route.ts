/**
 * POST /api/v1/market-estimates — the pre-membership estimate (docs/14 §3).
 *
 * The public replacement for full Demand Discovery at guest/free tier: a synchronous,
 * no-LLM read of the trade warehouse, returning observed historical import values and
 * unit-price bands only — never a projection. See `src/lib/market-estimate.ts` for the
 * framing rule this route must not violate.
 *
 * This is now the "first search" that mints a guest tenant (docs/14 §5) — full Demand
 * Discovery no longer does (it's paid-gated and rejects anonymous callers before any
 * write). Without this, nothing in the product ever mints a guest session again, and the
 * entire guest lifecycle docs/14 describes (registration upgrading a tenant in place,
 * the purge job, `guest_expires_at`) becomes unreachable dead code. Ordering mirrors
 * `discovery-runs` exactly and for the same reason: quota BEFORE mint, never the
 * reverse, so a cookie-clearing script can't grow `ExporterOrg` unbounded even while
 * every request is correctly rate-limited.
 *
 * Unlike `discovery-runs`, nothing about the ESTIMATE itself is persisted — no run row,
 * no job, no poll. The computation stays synchronous and cacheable
 * (`computeMarketEstimate()`); only the guest tenant/session is a durable write, and only
 * once per visitor (subsequent calls on the same session skip minting).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { OrgTier } from '@prisma/client';
import { getPrincipal, signIn } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { errorResponse, newCorrelationId, validationError } from '@/lib/errors';
import { consumeGuestRunQuota, guestMintProof, hashClientIp, mintGuest, resolveClientIp } from '@/lib/guest';
import { computeMarketEstimate } from '@/lib/market-estimate';
import { assertCan } from '@/lib/permissions';
import { single } from '@/lib/errors';
import { marketEstimateSchema, zodFieldErrors } from '@/lib/validators';
import type { Principal } from '@/types';

function requireClientIpHash(request: NextRequest): string {
  const ip = resolveClientIp(request.headers);
  if (!ip) {
    throw validationError([{ field: 'ip', code: 'unavailable', message: 'Could not identify the request source.' }]);
  }
  return hashClientIp(ip);
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = marketEstimateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(validationError(zodFieldErrors(parsed.error)), correlationId);
    const input = parsed.data;

    let principal = await getPrincipal();
    let mintedGuest = false;

    if (!principal) {
      // Quota FIRST — throws RATE_LIMITED before any tenant is minted. See discovery-runs
      // for why this ordering is a security control, not a style choice.
      const ipHash = requireClientIpHash(request);
      await consumeGuestRunQuota(ipHash);

      const guest = await mintGuest();
      await signIn('guest', { userId: guest.user_id, proof: guestMintProof(guest.user_id), redirect: false });
      principal = {
        id: guest.user_id,
        email: guest.email,
        name: 'Guest',
        role: 'exporter_owner',
        exporter_org_id: guest.org_id,
        tier: OrgTier.guest,
      } satisfies Principal;
      mintedGuest = true;
    }

    // Role + tier check for every caller, minted-this-request or returning.
    assertCan(principal, 'market_estimate.run');

    // A RETURNING guest (not the request that just minted them) still spends against the
    // IP budget — guest tier is exactly what the quota exists to meter. Free/paid/staff
    // are accountable via their own tenant and never hit this. Mirrors discovery-runs'
    // `if (!mintedGuest && principal.tier === OrgTier.guest)` exactly: without the
    // `mintedGuest` guard, a session that just consumed its quota to mint would be
    // charged the quota a second time on the very same request.
    if (!mintedGuest && principal.tier === OrgTier.guest) {
      await consumeGuestRunQuota(requireClientIpHash(request));
    }

    const policy = await getConfig('market_estimate.policy');
    const result = await computeMarketEstimate(
      {
        hs_code: input.hs_code,
        monthly_quantity: input.monthly_quantity ?? null,
        location: input.location ?? null,
      },
      policy,
    );

    return NextResponse.json(
      single({
        ...result,
        // Echoed, never used in the computation — see the module comment on why.
        monthly_quantity: input.monthly_quantity ?? null,
        location: input.location ?? null,
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
