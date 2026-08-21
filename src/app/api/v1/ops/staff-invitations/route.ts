/**
 * POST /api/v1/ops/staff-invitations — generate a single-use, email-less Agent invitation link.
 *
 * Thin. Authorization, token generation and audit all live in `generateAgentInvitation`, which
 * is itself backed by a database CHECK pinning the role to `agent`. There is no `email` field
 * anywhere in this route: a bearer invitation carries no invited address, and the role is never
 * a request parameter — see `generateAgentInvitation`'s doc for why blurring this with the
 * email-bound "Add agent" flow is exactly what this design avoids.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { requirePrincipal } from '@/lib/auth';
import { generateAgentInvitation, revokeStaffInvitation } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';
import { z } from 'zod';

export async function POST(_request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { invitation, token } = await generateAgentInvitation({ actor: principal, correlationId });

    // The token is returned ONCE, to the inviting operator, and is never stored in readable
    // form or written to an audit payload.
    return NextResponse.json(
      single({ id: invitation.id, role: invitation.role, expires_at: invitation.expires_at, token }),
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
