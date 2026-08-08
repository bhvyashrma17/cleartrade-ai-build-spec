import { JobType, ReadinessStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { enqueueJob, findInFlightJob } from '@/lib/jobs';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { readinessAnswersSchema, zodFieldErrors } from '@/lib/validators';

export async function GET() {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'readiness.run');
    const [current, history, tasks] = await Promise.all([
      prisma.readinessAssessment.findFirst({ where: { exporter_org_id: principal.exporter_org_id, is_current: true }, orderBy: { updated_at: 'desc' } }),
      prisma.readinessAssessment.findMany({ where: { exporter_org_id: principal.exporter_org_id, is_current: false }, select: { id: true, score: true, status: true, completed_at: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 10 }),
      prisma.task.findMany({ where: { exporter_org_id: principal.exporter_org_id, task_type: { startsWith: 'readiness_' } }, orderBy: [{ priority: 'desc' }, { due_at: 'asc' }], select: { id: true, title: true, description: true, state: true, owner_role: true, due_at: true, task_type: true } }),
    ]);
    return NextResponse.json(single({ current, history, tasks }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) { return errorResponse(error, correlationId); }
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'readiness.run');
    const parsed = readinessAnswersSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { answers, action } = parsed.data;
    const orgId = principal.exporter_org_id;
    let assessment = await prisma.readinessAssessment.findFirst({ where: { exporter_org_id: orgId, is_current: true }, orderBy: { updated_at: 'desc' } });
    // A completed assessment is immutable history. Editing starts a new draft/current view.
    if (!assessment || assessment.completed_at) {
      assessment = await prisma.$transaction(async (tx) => {
        await tx.readinessAssessment.updateMany({ where: { exporter_org_id: orgId, is_current: true }, data: { is_current: false } });
        return tx.readinessAssessment.create({ data: { exporter_org_id: orgId, answers } });
      });
    } else {
      assessment = await prisma.readinessAssessment.update({ where: { id: assessment.id }, data: { answers } });
    }
    await writeAuditEvent({ actor: principal, action: action === 'submit' ? AUDIT_ACTIONS.create : AUDIT_ACTIONS.update, object_type: 'readiness_assessment', object_id: assessment.id, exporter_org_id: orgId, after_summary: { action, answer_keys: Object.keys(answers) }, correlation_id: correlationId });
    if (action === 'save') return NextResponse.json(single({ assessment, saved: true }), { headers: { 'x-correlation-id': correlationId } });

    const dedupeKey = `readiness_assessment:${assessment.id}`;
    const active = await findInFlightJob(dedupeKey);
    if (active) return NextResponse.json({ job_id: active.id, status: active.status, target: { type: 'readiness_assessment', id: assessment.id } }, { status: 202, headers: { 'x-correlation-id': correlationId } });
    assessment = await prisma.readinessAssessment.update({ where: { id: assessment.id }, data: { submitted_at: new Date(), status: ReadinessStatus.in_progress } });
    const job = await enqueueJob({ type: JobType.readiness_assessment, payload: { readiness_assessment_id: assessment.id }, exporter_org_id: orgId, requested_by_id: principal.id, target_type: 'readiness_assessment', target_id: assessment.id, dedupe_key: dedupeKey, correlation_id: correlationId });
    return NextResponse.json({ job_id: job.id, status: job.status, target: { type: 'readiness_assessment', id: assessment.id } }, { status: 202, headers: { 'x-correlation-id': correlationId } });
  } catch (error) { return errorResponse(error, correlationId); }
}
