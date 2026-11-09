/**
 * POST /api/v1/market-estimates — the observed-history market estimate (docs/14 §3).
 *
 * A synchronous, no-LLM read of the trade warehouse, returning observed historical import
 * values and unit-price bands only — never a projection. See `src/lib/market-estimate.ts`
 * for the framing rule this route must not violate.
 *
 * **Members only since 9 Nov 2026** (owner decision, docs/14 §3c, ledger E-052). This used
 * to be the guest "first search" that minted a guest tenant and session; it no longer mints
 * anything. A caller without a session gets 401 and a free account gets UPGRADE_REQUIRED,
 * both before the warehouse is read, so a visitor costs nothing. Visitors and free accounts
 * see the static sample on `/app/markets` instead.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { computeMarketEstimate } from '@/lib/market-estimate';
import { assertCan } from '@/lib/permissions';
import { marketEstimateSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    // Session and tier first: nothing is parsed, read or computed for a caller who may not run it.
    const principal = await requirePrincipal();
    assertCan(principal, 'market_estimate.run');

    const body = await request.json().catch(() => ({}));
    const parsed = marketEstimateSchema.safeParse(body);
    if (!parsed.success) return errorResponse(validationError(zodFieldErrors(parsed.error)), correlationId);
    const input = parsed.data;

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
