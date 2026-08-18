/**
 * PATCH /api/v1/deals/:dealId/documents/:documentId — EXP-13 approval panel actions:
 * `approve` and `request_changes`. Both exporter-only (docs/07 §7.3 "cannot impersonate
 * exporter" — same rule as commercial-terms approval).
 *
 * GET returns one document with its full version history (EXP-13 "Version history").
 */

import { ApprovalStatus, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { DOCUMENT_APPROVAL_POLICY, loadDocumentHistory, loadDocumentScoped } from '@/lib/documents';
import { errorResponse, forbidden, list, newCorrelationId, single, validationError, versionConflict } from '@/lib/errors';
import { assertDocumentApprovable } from '@/lib/document-lifecycle';
import { canApproveDocument } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { approveDocumentSchema, requestDocumentChangesSchema, zodFieldErrors } from '@/lib/validators';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { document } = await loadDocumentScoped(principal, dealId, documentId);
    const history = await loadDocumentHistory(dealId, document.doc_type);

    return NextResponse.json(
      single(document, { history: list(history, { page: 1, per_page: history.length, total: history.length, total_pages: 1 }).data }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);

    const body = (await request.json().catch(() => null)) as { action?: string } | null;

    // EXP-13-AC01: a superseded version can never be approved (or have changes
    // requested against it — the exporter's decision only makes sense on the version
    // they are actually looking at).
    if (!document.is_current_version) {
      throw forbidden('This version has been superseded. Only the current version can be reviewed.');
    }

    if (body?.action === 'request_changes') {
      const parsed = requestDocumentChangesSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
      return await requestChanges({ correlationId, dealId, deal, document, principal, input: parsed.data });
    }

    const parsed = approveDocumentSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const mayApprove = await canApproveDocument(principal, { deal }, DOCUMENT_APPROVAL_POLICY);
    if (!mayApprove) {
      throw forbidden('Only the exporter can approve this document.');
    }
    if (document.approval_status !== ApprovalStatus.pending) {
      throw validationError(
        [{ field: 'action', code: 'invalid', message: `This document is "${document.approval_status}", not awaiting approval.` }],
        'This document is not awaiting approval.',
      );
    }

    // Bound to version AND checksum (docs/07 §7.3) — a stale client (looking at a
    // version that has since been regenerated) 409s with the current state rather than
    // silently approving content the exporter never actually saw.
    if (document.version !== parsed.data.version || document.checksum !== parsed.data.checksum) {
      throw versionConflict(document.version, document.updated_at);
    }

    // Phase 7 gate. Generation succeeding is not sufficient: the snapshot must exist, the
    // authoritative artifact must exist and match the checksum the approval will record, the
    // frozen input must still be complete, and a PDF whose text the font cannot represent must
    // not be approvable. Shared with the agent workspace, so the exporter is never shown an
    // Approve button the server would refuse.
    await assertDocumentApprovable(principal, dealId, documentId);

    const approved = await prisma.$transaction(async (tx) => {
      const row = await tx.document.update({
        where: { id: document.id },
        data: {
          approval_status: ApprovalStatus.exporter_approved,
          approved_by_id: principal.id,
          approved_at: new Date(),
          approved_version: document.version,
          approved_checksum: document.checksum,
          rejection_reason: null,
          changes_requested_reason: null,
        },
      });

      await tx.task.updateMany({
        where: { deal_id: dealId, task_type: `review_${document.doc_type}`, state: { notIn: [TaskState.done, TaskState.cancelled] } },
        data: { state: TaskState.done, completed_at: new Date() },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.approve,
        object_type: 'document',
        object_id: row.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, doc_type: row.doc_type, version: row.version, checksum: row.checksum },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(approved), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

async function requestChanges(args: {
  correlationId: string;
  dealId: string;
  deal: { exporter_org_id: string; owner_agent_id: string | null };
  document: { id: string; doc_type: string; version: number; checksum: string | null };
  principal: Awaited<ReturnType<typeof requirePrincipal>>;
  input: { version: number; checksum: string; note: string };
}) {
  const { correlationId, dealId, deal, document, principal, input } = args;

  if (document.version !== input.version || document.checksum !== input.checksum) {
    throw versionConflict(document.version, new Date());
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.document.update({
      where: { id: document.id },
      data: { approval_status: ApprovalStatus.rejected, changes_requested_reason: input.note, rejection_reason: null },
    });

    // AC04: the reason reaches the agent/document owner as a real task, not just text
    // sitting on the document row.
    const thresholds = await getConfig('sla.thresholds');
    const schedule = scheduleFromThreshold(thresholds.agent_document_review ?? thresholds.default);
    await tx.task.create({
      data: {
        scope_type: 'document',
        scope_id: document.id,
        deal_id: dealId,
        exporter_org_id: deal.exporter_org_id,
        title: `Revise ${document.doc_type} (changes requested)`,
        description: input.note,
        owner_user_id: deal.owner_agent_id,
        owner_role: UserRole.agent,
        state: TaskState.not_started,
        priority: TaskPriority.high,
        due_at: schedule.due_at,
        warning_at: schedule.warning_at,
        visibility: Visibility.exporter_visible,
        task_type: `revise_${document.doc_type}`,
      },
    });

    if (deal.owner_agent_id) {
      const dedupeKey = `document-changes:${document.id}:v${document.version}`;
      await tx.notification.upsert({
        where: { user_id_dedupe_key: { user_id: deal.owner_agent_id, dedupe_key: dedupeKey } },
        update: { read_at: null, created_at: new Date(), body: input.note.slice(0, 240) },
        create: {
          user_id: deal.owner_agent_id,
          type: 'document_changes_requested',
          title: `Exporter requested changes to ${document.doc_type}`,
          body: input.note.slice(0, 240),
          severity: 'action_required',
          object_type: 'document',
          object_id: document.id,
          // Straight to the agent's review surface for this exact version.
          deep_link: `/agent/deals/${dealId}/documents/${document.id}`,
          dedupe_key: dedupeKey,
        },
      });
    }

    await writeAuditEvent({
      db: tx,
      actor: principal,
      action: AUDIT_ACTIONS.request_changes,
      object_type: 'document',
      object_id: row.id,
      exporter_org_id: deal.exporter_org_id,
      after_summary: { deal_id: dealId, doc_type: row.doc_type, version: row.version, note: input.note },
      correlation_id: correlationId,
    });

    return row;
  });

  return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
}
