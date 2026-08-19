/**
 * POST /api/v1/ops/agents/convert — Case A of "Add agent": convert an existing ClearTrade
 * account to Agent immediately, by email, with no invitation link.
 *
 * Thin. The role constraint, the sole-owner safety check, and the audit write all live in
 * `adminConvertUserToAgent` — the route never decides who may be converted.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { adminConvertUserToAgent } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

const convertSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
});

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = convertSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const result = await adminConvertUserToAgent({
      actor: principal, targetEmail: parsed.data.email, correlationId,
    });
    return NextResponse.json(single(result), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
