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
    const productId = typeof answers.product_id === 'string' ? answers.product_id : null;
    const optionalPositive = (key: string, integer = false) => {
      const raw = answers[key];
      if (raw == null || raw === '') return null;
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) throw validationError([{ field: key, code: 'invalid', message: integer ? 'Enter a positive whole number.' : 'Enter a positive number.' }]);
      return value;
    };
    const desiredAmount = optionalPositive('desired_order_size_amount');
    const desiredCurrency = typeof answers.desired_order_size_currency === 'string' && answers.desired_order_size_currency.trim() ? answers.desired_order_size_currency.trim().toUpperCase() : null;
    if ((desiredAmount == null) !== (desiredCurrency == null)) throw validationError([{ field: desiredAmount == null ? 'desired_order_size_amount' : 'desired_order_size_currency', code: 'required', message: 'Desired order size requires both amount and currency.' }]);
    if (desiredCurrency && !/^[A-Z]{3}$/.test(desiredCurrency)) throw validationError([{ field: 'desired_order_size_currency', code: 'invalid', message: 'Use a 3-letter currency code.' }]);
    if (productId) {
      const product = await prisma.product.findFirst({ where: { id: productId, exporter_org_id: orgId } });
      if (!product) throw validationError([{ field: 'product_id', code: 'invalid', message: 'That product is not available.' }]);
      const updated = await prisma.product.update({ where: { id: productId }, data: {
        lead_time_days: optionalPositive('lead_time_days', true),
        desired_order_size_amount: desiredAmount,
        desired_order_size_currency: desiredCurrency,
        customization_capability: typeof answers.customization_capability === 'string' && answers.customization_capability.trim() ? answers.customization_capability.trim() : null,
        packaging_capability: typeof answers.packaging_capability === 'string' && answers.packaging_capability.trim() ? answers.packaging_capability.trim() : null,
      } });
      await writeAuditEvent({ actor: principal, action: AUDIT_ACTIONS.update, object_type: 'product', object_id: productId, exporter_org_id: orgId, before_summary: { lead_time_days: product.lead_time_days, desired_order_size_amount: product.desired_order_size_amount?.toString() ?? null, desired_order_size_currency: product.desired_order_size_currency, customization_capability: product.customization_capability, packaging_capability: product.packaging_capability }, after_summary: { lead_time_days: updated.lead_time_days, desired_order_size_amount: updated.desired_order_size_amount?.toString() ?? null, desired_order_size_currency: updated.desired_order_size_currency, customization_capability: updated.customization_capability, packaging_capability: updated.packaging_capability }, correlation_id: correlationId });
    }
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
