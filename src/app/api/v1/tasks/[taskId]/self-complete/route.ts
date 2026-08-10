/**
 * POST /api/v1/tasks/:taskId/self-complete — EXP-03 "Mark self-complete".
 *
 * "Allowed only for self-attested tasks" / "Server rejects protected tasks" (docs/04,
 * verbatim) is `isSelfAttestableReadinessTask()` from `src/lib/enablement.ts` — the SAME
 * classification the generic task-transition route checks the inverse of
 * (`isEvidenceRequiredReadinessTask`), so the two routes can never disagree about which
 * bucket a given task falls into.
 *
 * Scoped to readiness tasks specifically: this is the Enablement Center's own action,
 * not a general "mark any task done without evidence" shortcut — a non-readiness task
 * (e.g. an AGT-06 execution task) has no self-attestable/evidence-required
 * classification at all here and is refused.
 *
 * `TRANSITIONS` in `src/lib/state-machines/task.ts` has no `not_started -> done` edge —
 * every task must pass through `in_progress` first, which is the right invariant for
 * the machine in general (it is evidence that SOMETHING happened before completion).
 * A self-attested readiness task is fresh out of the job handler at `not_started`, so a
 * literal single-hop `assertTaskTransition(from, done)` call fails with
 * `InvalidTransitionError` for the most common case this route exists to handle. Rather
 * than loosen the shared machine (which every OTHER consumer relies on to keep that
 * invariant), this route takes the `not_started -> in_progress -> done` hop itself when
 * needed — both asserted and written in the same transaction, so the exporter's one
 * click is still one atomic action from their side, and the "something happened" record
 * the intermediate state exists for is IS true: they just self-attested it.
 */

import { TaskState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { isReadinessTask, isSelfAttestableReadinessTask } from '@/lib/enablement';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canTransitionTask } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertTaskTransition, canTransitionTaskState } from '@/lib/state-machines/task';

export async function POST(_request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    if (!principal.role.startsWith('exporter')) {
      throw forbidden('Self-completion is an exporter action.');
    }

    const { taskId } = await ctx.params;
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound('That task is not available.');

    if (!isReadinessTask(task.task_type)) {
      throw forbidden('This task is not part of the Enablement Center.');
    }
    if (!isSelfAttestableReadinessTask(task.task_type)) {
      throw forbidden('This task requires reviewed evidence and cannot be self-completed.');
    }
    if (!(await canTransitionTask(principal, task))) {
      throw forbidden('You cannot change this task.');
    }
    if (task.state === TaskState.done) {
      // Idempotent: a repeated click (double-tap, retry) is a no-op, not an error.
      return NextResponse.json(single(task), { headers: { 'x-correlation-id': correlationId } });
    }

    // `not_started` has no direct edge to `done` in the shared machine — see file
    // header. Every other starting state (in_progress, waiting) already has one.
    const needsIntermediateHop = task.state === TaskState.not_started;
    if (!needsIntermediateHop && !canTransitionTaskState(task.state, TaskState.done)) {
      throw validationError(
        [{ field: 'state', code: 'invalid', message: `A task in state "${task.state}" cannot be self-completed.` }],
        'This task cannot be completed from its current state.',
      );
    }

    const effects = assertTaskTransition(
      needsIntermediateHop ? TaskState.in_progress : task.state,
      TaskState.done,
      { domain_prerequisite_met: true },
    );

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.task.update({
        where: { id: task.id },
        data: { state: TaskState.done, ...(effects.set_completed_at ? { completed_at: new Date() } : {}) },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.approve,
        object_type: 'task',
        object_id: task.id,
        exporter_org_id: task.exporter_org_id ?? undefined,
        before_summary: { state: task.state },
        after_summary: { state: row.state, self_attested: true, intermediate_hop: needsIntermediateHop },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
