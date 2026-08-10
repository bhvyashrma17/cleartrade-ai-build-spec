/** PATCH /api/v1/invitations/:invitationId — EXP-17 "Invite pending" resend/revoke. Owner-only. */

import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canManageTeam } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { invitationActionSchema, zodFieldErrors } from '@/lib/validators';

const INVITE_TTL_DAYS = 14;

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ invitationId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    const orgId = principal.exporter_org_id as string;
    if (!(await canManageTeam(principal, orgId))) {
      throw forbidden('Only the account owner can manage invitations.');
    }

    const { invitationId } = await ctx.params;
    const invitation = await prisma.invitation.findFirst({ where: { id: invitationId, exporter_org_id: orgId } });
    if (!invitation) throw notFound('That invitation is not available.');

    const body = await request.json().catch(() => null);
    const parsed = invitationActionSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    if (invitation.status !== 'pending') {
      throw validationError(
        [{ field: 'action', code: 'invalid', message: `This invitation is already "${invitation.status}".` }],
        'Only a pending invitation can be resent or revoked.',
      );
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row =
        parsed.data.action === 'revoke'
          ? await tx.invitation.update({ where: { id: invitation.id }, data: { status: 'revoked', revoked_at: new Date() } })
          : await tx.invitation.update({
              where: { id: invitation.id },
              data: { token: randomBytes(24).toString('hex'), expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000) },
            });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: parsed.data.action === 'revoke' ? AUDIT_ACTIONS.cancel : AUDIT_ACTIONS.update,
        object_type: 'invitation',
        object_id: invitation.id,
        exporter_org_id: orgId,
        after_summary: { action: parsed.data.action, email: invitation.email },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
