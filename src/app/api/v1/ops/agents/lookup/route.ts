/**
 * GET /api/v1/ops/agents/lookup?email=… — read-only classification for the "Add agent" flow.
 *
 * Tells the UI whether the email belongs to an existing ClearTrade account (Case A: direct
 * conversion), already has a pending pre-authorization (nothing to do), or has neither (Case B:
 * grant one). Never mutates — see `lookupStaffCandidate`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';
import { lookupStaffCandidate } from '@/lib/staff-provisioning';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const email = request.nextUrl.searchParams.get('email') ?? '';
    const result = await lookupStaffCandidate(principal, email);
    return NextResponse.json(single(result), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
