/**
 * POST/DELETE /api/v1/ops/staff-access-grants — pre-authorize (or revoke) an email for the
 * agent role with no invitation link and no token.
 *
 * Thin, same shape as /api/v1/ops/staff-invitations: authorization, the role constraint
 * (agent only — see the `StaffAccessGrant_role_is_agent` CHECK), and the audit write all live
 * in `grantStaffAccess` / `revokeStaffAccessGrant`.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { grantStaffAccess, revokeStaffAccessGrant } from '@/lib/staff-provisioning';
import { zodFieldErrors } from '@/lib/validators';

const grantSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
});

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = grantSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const grant = await grantStaffAccess({ actor: principal, email: parsed.data.email, correlationId });
    return NextResponse.json(
      single({ id: grant.id, email: grant.email, role: grant.role, status: grant.status, granted_at: grant.granted_at }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

const revokeSchema = z.object({ grant_id: z.string().min(1) });

export async function DELETE(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = revokeSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const revoked = await revokeStaffAccessGrant({ actor: principal, grantId: parsed.data.grant_id, correlationId });
    return NextResponse.json(single({ id: revoked.id, status: revoked.status }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
