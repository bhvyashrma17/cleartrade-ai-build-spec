/** Readiness assessment worker: turns a frozen answer snapshot into canonical tasks. */

import { Prisma, ReadinessStatus, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { scheduleFromThreshold } from '@/lib/state-machines/task';

type Answers = Record<string, unknown>;
type Finding = { code: string; title: string; summary: string; severity: 'required' | 'recommended' };
const text = (answers: Answers, key: string) => typeof answers[key] === 'string' ? answers[key].trim() : '';

function assess(answers: Answers): Finding[] {
  const findings: Finding[] = [];
  if (text(answers, 'product_description').length < 10) findings.push({ code: 'product', title: 'Describe your export product', summary: 'Add a useful product description before market matching.', severity: 'required' });
  if (!text(answers, 'capacity_value') || !text(answers, 'capacity_unit')) findings.push({ code: 'capacity', title: 'Confirm monthly capacity', summary: 'Add a positive monthly capacity and unit.', severity: 'required' });
  // Identifier presence and verification are intentionally independent. A filled string
  // remains unverified until the structured verification state says otherwise.
  for (const [code, label, field] of [['iec', 'IEC', 'iec_status'], ['gst', 'GSTIN', 'gst_status'], ['ad_code', 'AD code', 'ad_code_status']] as const) {
    if (text(answers, field) !== 'verified') findings.push({ code, title: `Verify your ${label}`, summary: `Record and verify the ${label}; a number entered on its own is not verification.`, severity: 'required' });
  }
  if (text(answers, 'packaging_qc') === 'unknown' || !text(answers, 'packaging_qc')) findings.push({ code: 'packaging_qc', title: 'Confirm packaging and QC process', summary: 'Document how the product will be packed and quality checked.', severity: 'recommended' });
  if (text(answers, 'sample_ready') === 'no') findings.push({ code: 'samples', title: 'Plan an export sample', summary: 'Prepare a sample plan before buyer outreach.', severity: 'recommended' });
  return findings;
}

export async function runReadinessAssessment(ctx: JobContext): Promise<JobOutcome> {
  const assessmentId = ctx.target_id;
  if (!assessmentId) throw new Error('readiness_assessment job has no target assessment.');
  const assessment = await prisma.readinessAssessment.findUnique({ where: { id: assessmentId } });
  if (!assessment) throw new Error(`Readiness assessment ${assessmentId} no longer exists.`);
  const answers = (assessment.answers ?? {}) as Answers;
  const findings = assess(answers);
  const required = findings.filter((finding) => finding.severity === 'required');
  const score = Math.max(0, 100 - required.length * 15 - (findings.length - required.length) * 5);
  const status = required.length === 0 ? ReadinessStatus.ready : ReadinessStatus.blocked;
  const thresholds = await getConfig('sla.thresholds');
  const schedule = scheduleFromThreshold(thresholds.exporter_input_request);

  await ctx.reportProgress(35);
  await prisma.$transaction(async (tx) => {
    const owner = await tx.user.findFirst({ where: { exporter_org_id: assessment.exporter_org_id, role: UserRole.exporter_owner, is_active: true }, select: { id: true } });
    const existing = await tx.task.findMany({ where: { exporter_org_id: assessment.exporter_org_id, task_type: { startsWith: 'readiness_' } } });
    const currentCodes = new Set(findings.map((finding) => finding.code));

    for (const task of existing) {
      const code = task.task_type?.replace('readiness_', '');
      if (code && !currentCodes.has(code) && task.state !== TaskState.done && task.state !== TaskState.cancelled) {
        await tx.task.update({ where: { id: task.id }, data: { state: TaskState.cancelled, cancel_reason: 'No longer required after readiness reassessment.' } });
      }
    }

    const blockerRows: { code: string; severity: string; summary: string; remediation_task_id: string }[] = [];
    for (const finding of findings) {
      const taskType = `readiness_${finding.code}`;
      const prior = existing.find((task) => task.task_type === taskType && task.state !== TaskState.cancelled);
      const task = prior
        ? await tx.task.update({ where: { id: prior.id }, data: { title: finding.title, description: finding.summary, owner_user_id: owner?.id ?? null, owner_role: UserRole.exporter_owner, priority: finding.severity === 'required' ? TaskPriority.high : TaskPriority.normal, due_at: schedule.due_at, warning_at: schedule.warning_at } })
        : await tx.task.create({ data: { scope_type: 'exporter_org', scope_id: assessment.exporter_org_id, exporter_org_id: assessment.exporter_org_id, title: finding.title, description: finding.summary, owner_user_id: owner?.id ?? null, owner_role: UserRole.exporter_owner, priority: finding.severity === 'required' ? TaskPriority.high : TaskPriority.normal, due_at: schedule.due_at, warning_at: schedule.warning_at, visibility: Visibility.exporter_visible, task_type: taskType } });
      if (finding.severity === 'required') blockerRows.push({ code: finding.code, severity: finding.severity, summary: finding.summary, remediation_task_id: task.id });
    }

    await tx.readinessAssessment.update({ where: { id: assessmentId }, data: { score, status, blockers: blockerRows as unknown as Prisma.InputJsonValue, recommendations: findings.filter((finding) => finding.severity === 'recommended') as unknown as Prisma.InputJsonValue, completed_at: new Date() } });
    await tx.exporterOrg.update({ where: { id: assessment.exporter_org_id }, data: { readiness_status: status } });
    await writeAuditEvent({ db: tx, actor: null, action: AUDIT_ACTIONS.update, object_type: 'readiness_assessment', object_id: assessmentId, exporter_org_id: assessment.exporter_org_id, after_summary: { score, status, blocker_codes: blockerRows.map((row) => row.code) }, correlation_id: ctx.correlation_id });
  });
  await ctx.reportProgress(100);
  return { status: 'completed', result: { assessment_id: assessmentId, score, status, blockers: required.length } as Prisma.InputJsonValue };
}
