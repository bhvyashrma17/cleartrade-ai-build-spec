/**
 * POST /api/v1/tasks/:taskId/reassign-request — AGT-07 "Reassign request" quick action.
 *
 * This does not change `owner_user_id` itself — that would let any agent who can act on
 * a task hand it to someone else unilaterally, bypassing whoever actually manages team
 * assignment. It records an auditable request; Ops/lead reassignment is a separate,
 * deliberate action (the same restraint AGT-08 uses for payout: visible, not self-serve).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canTransitionTask } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { reassignRequestTaskSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { taskId } = await ctx.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound('That task is not available.');
    if (task.visibility === 'internal' && principal.role.startsWith('exporter')) throw notFound('That task is not available.');
    if (principal.role.startsWith('exporter')) throw forbidden('Raise this with your ClearTrade agent.');
    if (!(await canTransitionTask(principal, task))) throw forbidden('You cannot request reassignment of this task.');

    const body = await request.json().catch(() => null);
    const parsed = reassignRequestTaskSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    await writeAuditEvent({
      actor: principal,
      action: AUDIT_ACTIONS.reassign,
      object_type: 'task',
      object_id: task.id,
      exporter_org_id: task.exporter_org_id ?? undefined,
      before_summary: { owner_user_id: task.owner_user_id },
      after_summary: { reassignment_requested: true, reason: parsed.data.reason, requested_by: principal.id },
      correlation_id: correlationId,
    });

    return NextResponse.json(single({ task_id: task.id, requested: true }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
