/**
 * POST /api/v1/staff-invitations/accept — an invited staff member creates their account.
 *
 * Unauthenticated by necessity: the invitee has no account yet. The token IS the authorization,
 * and it only ever grants the role Ops already chose and stored on the invitation — the request
 * body carries no role, and nothing here reads one. That is what keeps this endpoint from being
 * a self-service route to staff privileges.
 *
 * Thin: expiry, single-use, revocation, email collision and audit all live in
 * `acceptStaffInvitation`, which resolves the role from the stored row inside one transaction.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { hashPassword } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { acceptStaffInvitation } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

const acceptSchema = z.object({
  token: z.string().min(1, 'This link is missing its invitation token.'),
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const body = await request.json().catch(() => null);
    const parsed = acceptSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const result = await acceptStaffInvitation({
      token: parsed.data.token,
      name: parsed.data.name,
      passwordHash: await hashPassword(parsed.data.password),
      correlationId,
    });

    // Role is echoed from what the service actually provisioned, so the UI states the granted
    // role rather than one it assumed. No session is issued here: the new password should be
    // exercised at /login immediately, exactly as registration does it.
    return NextResponse.json(single({ role: result.role }), {
      status: 201,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
