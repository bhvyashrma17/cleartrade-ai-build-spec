import { DataDeletionRequestStatus, UserRole, type Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export async function createDataDeletionRequest(subjectReference: string, requestScope: Prisma.InputJsonValue) {
  if (subjectReference.trim().length < 3) throw new Error('A pseudonymous subject reference is required.');
  return prisma.dataDeletionRequest.create({ data: { subject_reference: subjectReference.trim(), request_scope: requestScope } });
}

export async function reviewDataDeletionRequest(args: { id: string; principal: Principal; status: 'under_review'|'approved'|'rejected'|'completed'; reason: string; correlationId: string }) {
  if (args.principal.role !== UserRole.admin && args.principal.role !== UserRole.ops_supervisor) throw new Error('Data-rights review is restricted to authorized Ops.');
  if (args.reason.trim().length < 10) throw new Error('A documented review reason is required.');
  return prisma.$transaction(async (tx) => {
    const before = await tx.dataDeletionRequest.findUniqueOrThrow({ where: { id: args.id } });
    const allowed: Record<DataDeletionRequestStatus, DataDeletionRequestStatus[]> = {
      requested: [DataDeletionRequestStatus.under_review], under_review: [DataDeletionRequestStatus.approved, DataDeletionRequestStatus.rejected], approved: [DataDeletionRequestStatus.completed], rejected: [], completed: [],
    };
    const to = args.status as DataDeletionRequestStatus;
    if (!allowed[before.status].includes(to)) throw new Error(`Invalid data deletion request transition ${before.status} -> ${to}.`);
    const history = Array.isArray(before.review_events) ? before.review_events : [];
    const row = await tx.dataDeletionRequest.update({ where: { id: before.id }, data: { status: to, reviewed_by_id: args.principal.id, decision_reason: args.reason.trim(), completed_at: to === DataDeletionRequestStatus.completed ? new Date() : null, review_events: [...history, { from: before.status, to, reviewer_user_id: args.principal.id, reason: args.reason.trim(), at: new Date().toISOString() }] } });
    await writeAuditEvent({ db: tx, actor: args.principal, action: AUDIT_ACTIONS.state_change, object_type: 'data_deletion_request', object_id: row.id, before_summary: { status: before.status }, after_summary: { status: row.status }, correlation_id: args.correlationId });
    return row;
  });
}
