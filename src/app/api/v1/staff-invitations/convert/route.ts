/**
 * POST /api/v1/staff-invitations/convert — an existing ClearTrade user becomes the invited agent.
 *
 * The counterpart to `/accept`, which creates a brand-new staff account. This one converts the
 * account that is ALREADY signed in, which is why it requires a session and `/accept` does not.
 *
 * The body carries exactly one field: the token. Not the email, not the role, not a user id.
 * Which account is converted comes from the session; which role it becomes comes from the
 * invitation row. There is deliberately no way for the browser to influence either — that is
 * the whole privilege-escalation surface this endpoint has to not have.
 *
 * Thin: expiry, single-use consumption, email matching, the Ops/admin refusal, the sole-owner
 * guard and the audit event all live in `convertUserToAgent`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { convertUserToAgent } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

const convertSchema = z.object({
  token: z.string().min(1, 'This link is missing its invitation token.'),
});

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();

    const body = await request.json().catch(() => null);
    const parsed = convertSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const result = await convertUserToAgent({
      actor: principal, token: parsed.data.token, correlationId,
    });

    // The role actually granted is echoed from what the service did, so the UI states the
    // outcome rather than assuming it. The token is never echoed back.
    return NextResponse.json(
      single({ role: result.role, already_agent: result.alreadyAgent }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
