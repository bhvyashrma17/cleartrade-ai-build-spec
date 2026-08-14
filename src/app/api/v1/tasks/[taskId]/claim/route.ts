/**
 * POST /api/v1/tasks/:taskId/claim — AGT-07-AC01 "no active task lacks an accountable
 * owner". `owner_role` alone (e.g. every agent-owned task pre-assignment) is a role, not
 * a person; this is how a role-owned task becomes an actually-accountable one. Only
 * fills a null `owner_user_id` — claiming an already-owned task is a reassignment, which
 * goes through the "Reassign request" action instead so the current owner isn't silently
 * displaced.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, notFound, single } from '@/lib/errors';
import { canTransitionTask } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function POST(_request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { taskId } = await ctx.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound('That task is not available.');
    if (task.visibility === 'internal' && principal.role.startsWith('exporter')) throw notFound('That task is not available.');
    if (!(await canTransitionTask(principal, task))) throw forbidden('You cannot claim this task.');
    if (task.owner_user_id) throw forbidden('This task already has an owner.');

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({ where: { id: task.id }, data: { owner_user_id: principal.id } });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.reassign,
        object_type: 'task',
        object_id: task.id,
        exporter_org_id: task.exporter_org_id ?? undefined,
        before_summary: { owner_user_id: null },
        after_summary: { owner_user_id: principal.id },
        correlation_id: correlationId,
      });
      return updated;
    });

    return NextResponse.json(single(row), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
