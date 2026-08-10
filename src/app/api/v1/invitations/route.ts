/**
 * POST /api/v1/invitations — EXP-17 Team "Invite member".
 *
 * Owner-only, enforced by `canManageTeam()` — not just `assertCan()` — because the
 * matrix's `restricted` grant for `exporter_member` needs the second check to actually
 * close it (docs/04: "Invite member | Exporter owner", verbatim; see the predicate's own
 * comment for why there is no policy toggle here the way there is for document/
 * commercial-terms approval).
 *
 * "Prevent duplicate active invite": checked against `status: pending` for the same
 * email in this org — a REVOKED or EXPIRED prior invite to the same address must not
 * block re-inviting them, so the dedupe is scoped to the currently-open state, not the
 * email alone.
 */

import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { canManageTeam } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createInvitationSchema, zodFieldErrors } from '@/lib/validators';

const INVITE_TTL_DAYS = 14;

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    const orgId = principal.exporter_org_id as string;
    if (!(await canManageTeam(principal, orgId))) {
      throw forbidden('Only the account owner can invite team members.');
    }

    const body = await request.json().catch(() => null);
    const parsed = createInvitationSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { email, role } = parsed.data;

    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true, exporter_org_id: true } });
    if (existingUser) {
      throw validationError(
        [{ field: 'email', code: 'taken', message: 'This email already has an account.' }],
        'This person already has an account.',
      );
    }

    const existingInvite = await prisma.invitation.findFirst({
      where: { exporter_org_id: orgId, email, status: 'pending' },
    });
    if (existingInvite) {
      // Idempotent, not an error: re-submitting the same invite links to the pending one.
      return NextResponse.json(single(existingInvite), { headers: { 'x-correlation-id': correlationId } });
    }

    const invitation = await prisma.$transaction(async (tx) => {
      const created = await tx.invitation.create({
        data: {
          exporter_org_id: orgId,
          email,
          role,
          token: randomBytes(24).toString('hex'),
          invited_by_id: principal.id,
          expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000),
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'invitation',
        object_id: created.id,
        exporter_org_id: orgId,
        after_summary: { email, role },
        correlation_id: correlationId,
      });
      return created;
    });

    return NextResponse.json(single(invitation), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
