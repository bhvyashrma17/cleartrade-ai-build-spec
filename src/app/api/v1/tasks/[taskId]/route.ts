/**
 * PATCH /api/v1/tasks/:taskId — task state transitions (AGT-06 task board, AGT-07 quick
 * actions).
 *
 * Authorization is `canTransitionTask()`, which already encodes the ownership rule
 * (agents act on agent-owned tasks in their assigned orgs, exporters on exporter-owned
 * ones in their own org, ops on anything). This route adds one thing on top: an INTERNAL
 * task is invisible to an exporter principal, so it must also be un-actionable by one.
 * Returning `notFound()` rather than `forbidden()` keeps that consistent with how the
 * rest of the product handles out-of-scope ids — a 403 would confirm the task exists.
 */

import { TaskState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canTransitionTask } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertTaskTransition, deriveSlaState } from '@/lib/state-machines/task';
import { transitionTaskSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { taskId } = await ctx.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound('That task is not available.');

    // Internal tasks do not exist as far as an exporter is concerned — not on their
    // screens, and not through a hand-crafted request either.
    if (task.visibility === 'internal' && principal.role.startsWith('exporter')) {
      throw notFound('That task is not available.');
    }
    if (!(await canTransitionTask(principal, task))) {
      throw forbidden('You cannot change this task.');
    }

    const body = await request.json().catch(() => null);
    const parsed = transitionTaskSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const effects = assertTaskTransition(task.state, input.to as TaskState, {
      blocked_reason: input.blocked_reason,
      waiting_on: input.waiting_on,
      cancel_reason: input.cancel_reason,
    });

    const thresholds = await getConfig('sla.thresholds');

    const updated = await prisma.$transaction(async (tx) => {
      const nextState = input.to as TaskState;
      const row = await tx.task.update({
        where: { id: task.id },
        data: {
          state: nextState,
          ...(effects.set_completed_at ? { completed_at: new Date() } : {}),
          ...(effects.clear_blocked_reason ? { blocked_reason: null, waiting_on: null } : {}),
          ...(nextState === TaskState.waiting
            ? { blocked_reason: input.blocked_reason ?? null, waiting_on: input.waiting_on ?? null }
            : {}),
          ...(nextState === TaskState.cancelled ? { cancel_reason: input.cancel_reason ?? null } : {}),
          // SLA is derived, never user-set (AGT-07-AC03) — recomputed here because a
          // completed task stops accruing overdue-ness.
          sla_state: deriveSlaState({ due_at: task.due_at, warning_at: task.warning_at, state: nextState }, thresholds.default),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.state_change,
        object_type: 'task',
        object_id: task.id,
        exporter_org_id: task.exporter_org_id ?? undefined,
        before_summary: { state: task.state },
        after_summary: { state: row.state },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
