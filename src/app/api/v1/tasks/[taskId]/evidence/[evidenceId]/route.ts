/**
 * PATCH /api/v1/tasks/:taskId/evidence/:evidenceId — EXP-03-AC03 "auditable review
 * outcome, linked to the task."
 *
 * Agent/ops only — `task_evidence.review` has no exporter grant at all (see
 * permissions.ts: an exporter approving their own uploaded proof would defeat the
 * entire point of review). This is deliberately NOT the same authorization path as
 * `canTransitionTask()`: that predicate is about who owns a task's day-to-day state
 * (which, for a readiness task, is the exporter), not who may review evidence attached
 * to it — those are different questions with different answers on the same object.
 *
 * Approve moves the underlying Task straight to `done` in the SAME transaction as the
 * evidence write — the review outcome and the task completion cannot land as two
 * separate, potentially-inconsistent writes. Reject moves the task to `waiting` with
 * the reviewer's note as `blocked_reason`, which is exactly EXP-03's required UI state:
 * "Rejected evidence → show reason + re-upload CTA."
 */

import { TaskState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, canAccessOrg, isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertTaskTransition } from '@/lib/state-machines/task';
import { reviewTaskEvidenceSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(
  request: NextRequest,
  ctx: { params: Promise<{ taskId: string; evidenceId: string }> },
) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'task_evidence.review');
    const { taskId, evidenceId } = await ctx.params;

    const evidence = await prisma.taskEvidence.findFirst({ where: { id: evidenceId, task_id: taskId } });
    if (!evidence) throw notFound('That evidence is not available.');
    const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId } });

    if (!isOps(principal) && !(task.exporter_org_id && (await canAccessOrg(principal, task.exporter_org_id)))) {
      throw forbidden('You are not assigned to this exporter.');
    }
    if (evidence.review_status !== 'pending') {
      throw validationError(
        [{ field: 'action', code: 'invalid', message: `This evidence was already reviewed ("${evidence.review_status}").` }],
        'This evidence has already been reviewed.',
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = reviewTaskEvidenceSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const now = new Date();
      const updatedEvidence = await tx.taskEvidence.update({
        where: { id: evidence.id },
        data: {
          review_status: input.action === 'approve' ? 'approved' : 'rejected',
          review_note: input.action === 'reject' ? input.review_note : null,
          reviewed_by_id: principal.id,
          reviewed_at: now,
        },
      });

      let updatedTask = task;
      if (input.action === 'approve') {
        assertTaskTransition(task.state, TaskState.done, { domain_prerequisite_met: true });
        updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { state: TaskState.done, completed_at: now, blocked_reason: null, waiting_on: null },
        });
      } else if (task.state !== TaskState.waiting) {
        assertTaskTransition(task.state, TaskState.waiting, { blocked_reason: input.review_note, waiting_on: 'Re-upload requested' });
        updatedTask = await tx.task.update({
          where: { id: task.id },
          data: { state: TaskState.waiting, blocked_reason: input.review_note, waiting_on: 'Re-upload requested' },
        });
      } else {
        updatedTask = await tx.task.update({ where: { id: task.id }, data: { blocked_reason: input.review_note } });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: input.action === 'approve' ? AUDIT_ACTIONS.approve : AUDIT_ACTIONS.reject,
        object_type: 'task_evidence',
        object_id: evidence.id,
        exporter_org_id: task.exporter_org_id ?? undefined,
        before_summary: { review_status: evidence.review_status },
        after_summary: { review_status: updatedEvidence.review_status, task_state: updatedTask.state },
        correlation_id: correlationId,
      });

      return { evidence: updatedEvidence, task: updatedTask };
    });

    return NextResponse.json(single(result), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
