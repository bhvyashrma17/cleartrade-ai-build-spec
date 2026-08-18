/**
 * POST /api/v1/ops/staff-invitations — invite internal staff (today: agents).
 *
 * Thin. Authorization, role constraint, duplicate handling, token generation and audit all live
 * in `inviteStaff`, which is itself backed by database CHECKs that refuse a non-staff role.
 * The route never chooses a role from the request body — see the schema below.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { inviteStaff, revokeStaffInvitation } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

/**
 * No `role` field, deliberately.
 *
 * Phase 4 provisions agents, and a client-supplied role is precisely the privilege-escalation
 * vector this endpoint must not have. Widening to other staff roles is a server-side decision,
 * not a request parameter.
 */
const inviteSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
});

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const { invitation, token } = await inviteStaff({
      actor: principal, email: parsed.data.email, correlationId,
    });

    // The token is returned ONCE, to the inviting operator, and is never stored in readable
    // form or written to an audit payload.
    return NextResponse.json(
      single({ id: invitation.id, email: invitation.email, role: invitation.role, expires_at: invitation.expires_at, token }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

const revokeSchema = z.object({ invitation_id: z.string().min(1) });

export async function DELETE(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = revokeSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const revoked = await revokeStaffInvitation({
      actor: principal, invitationId: parsed.data.invitation_id, correlationId,
    });
    return NextResponse.json(single({ id: revoked.id, status: revoked.status }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
