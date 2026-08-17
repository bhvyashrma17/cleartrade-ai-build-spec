/**
 * POST /api/v1/tasks/:taskId/evidence — EXP-03 "Upload evidence".
 *
 * Task moving to "waiting review" is NOT a `TaskState` change here — it is derived on
 * read from whether the task's latest evidence row is `review_status: pending`. A real
 * `waiting_review` TaskState would duplicate a signal `TaskEvidence.review_status`
 * already carries authoritatively, and the two could drift (task says waiting_review,
 * evidence says something else). One source of truth, read two ways.
 *
 * Authorization reuses `canTransitionTask()` — whoever may currently act on this task
 * (its owner, in practice) may attach evidence to it; review is a completely separate,
 * agent/ops-only capability (`task_evidence.review`, see the sibling route).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { readStoredFile, saveUploadedFile } from '@/lib/document-storage';
import { assertCan, canAccessOrg, canTransitionTask, isOps } from '@/lib/permissions';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';

async function loadTaskScoped(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) throw notFound('That task is not available.');
  return task;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'task_evidence.upload');
    const { taskId } = await ctx.params;
    const task = await loadTaskScoped(taskId);

    if (task.visibility === 'internal' && principal.role.startsWith('exporter')) throw notFound('That task is not available.');
    if (!(await canTransitionTask(principal, task))) throw forbidden('You cannot attach evidence to this task.');

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || !(file instanceof File)) {
      throw validationError([{ field: 'file', code: 'required', message: 'Choose a file to upload.' }]);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await saveUploadedFile(bytes, file.name,file.type);

    const evidence = await prisma.$transaction(async (tx) => {
      const row = await tx.taskEvidence.create({
        data: {
          task_id: task.id,
          file_ref: stored.file_ref,
          file_name: file.name,
          uploaded_by_id: principal.id,
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'task_evidence',
        object_id: row.id,
        exporter_org_id: task.exporter_org_id ?? undefined,
        after_summary: { task_id: task.id, file_name: file.name },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(evidence), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

/** GET ?evidence_id= — download a previously uploaded file. Same reviewer-visibility
 * check the document downloads use, since this is the same "an uploaded file that must
 * not leak to an unrelated tenant" shape. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { taskId } = await ctx.params;
    const task = await loadTaskScoped(taskId);
    if (task.visibility === 'internal' && principal.role.startsWith('exporter')) throw notFound('That task is not available.');

    const evidenceId = request.nextUrl.searchParams.get('evidence_id');
    if (!evidenceId) throw validationError([{ field: 'evidence_id', code: 'required', message: 'evidence_id is required.' }]);

    const evidence = await prisma.taskEvidence.findFirst({ where: { id: evidenceId, task_id: task.id } });
    if (!evidence) throw notFound('That evidence file is not available.');

    // Whoever could act on the task can see its evidence; Ops can see any task's
    // evidence (portfolio-wide oversight), same reasoning as `canTransitionTask`'s own
    // `isOps` carve-out.
    const canSee =
      (await canTransitionTask(principal, task)) ||
      isOps(principal) ||
      (task.exporter_org_id ? await canAccessOrg(principal, task.exporter_org_id) : false);
    if (!canSee) throw forbidden('You do not have access to this file.');

    const bytes = await readStoredFile(evidence.file_ref);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${evidence.file_name}"`,
        'x-correlation-id': correlationId,
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
