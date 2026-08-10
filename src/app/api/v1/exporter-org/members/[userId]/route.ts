/**
 * PATCH /api/v1/exporter-org/members/:userId — EXP-17 Team "Remove" (owner-only).
 *
 * Deactivates (`is_active: false`) rather than deleting — every row this user ever
 * touched (tasks, audit events, proposals) keeps a valid actor reference. Two hard
 * refusals: cannot remove yourself (there is no self-service "leave the org" flow, and
 * an owner removing themselves mid-session is exactly the kind of foot-gun this route
 * exists to prevent), and cannot remove the last active owner (an org with no owner has
 * nobody left who could ever restore one — `canManageTeam()` is owner-gated all the way
 * down).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canManageTeam } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function PATCH(_request: NextRequest, ctx: { params: Promise<{ userId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    const orgId = principal.exporter_org_id as string;
    if (!(await canManageTeam(principal, orgId))) {
      throw forbidden('Only the account owner can remove team members.');
    }

    const { userId } = await ctx.params;
    if (userId === principal.id) {
      throw validationError([{ field: 'userId', code: 'self', message: 'You cannot remove yourself.' }], 'You cannot remove yourself from the team.');
    }

    const member = await prisma.user.findFirst({ where: { id: userId, exporter_org_id: orgId, is_active: true } });
    if (!member) throw notFound('That team member is not available.');

    if (member.role === 'exporter_owner') {
      const otherActiveOwners = await prisma.user.count({
        where: { exporter_org_id: orgId, role: 'exporter_owner', is_active: true, id: { not: member.id } },
      });
      if (otherActiveOwners === 0) {
        throw validationError(
          [{ field: 'userId', code: 'last_owner', message: 'An org must always have at least one active owner.' }],
          'This is the only active owner — remove yourself last, or promote another member first.',
        );
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.user.update({ where: { id: member.id }, data: { is_active: false } });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'user',
        object_id: member.id,
        exporter_org_id: orgId,
        after_summary: { is_active: false },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single({ id: updated.id, is_active: updated.is_active }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
