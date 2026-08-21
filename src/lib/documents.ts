/**
 * Server-side document-center domain logic shared by every `/api/v1/deals/:dealId/documents*`
 * route (EXP-12/EXP-13) — one place that loads a document tenant-scoped and knows the
 * rules a route must not re-derive differently: which version is "current", what happens
 * to review/approval/filing across a version boundary, and who may approve.
 */

import {
  ApprovalStatus, DocType, DocumentSource, FilingStatus, GenerationStatus, ReviewStatus,
} from '@prisma/client';
import { NEW_DOCUMENT_LIFECYCLE_MATRIX } from '@/lib/document-lifecycle-policy';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound } from '@/lib/errors';
import { assertCan, canReadDeal } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/** Same default as commercial-terms approval (docs/11 §7): owner-only until configured otherwise. */
export const DOCUMENT_APPROVAL_POLICY = {
  member_can_approve: false,
  ops_override_allowed: false,
} as const;

export async function loadDealScoped(principal: Principal, dealId: string) {
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, exporter_org_id: true, owner_agent_id: true, stage: true },
  });
  if (!deal) throw notFound('That deal is not available.');
  if (!(await canReadDeal(principal, deal))) throw forbidden('That deal is not available.');
  return deal;
}

/** A document plus enough of its deal to authorize and act on it. */
export async function loadDocumentScoped(principal: Principal, dealId: string, documentId: string) {
  const deal = await loadDealScoped(principal, dealId);
  const document = await prisma.document.findFirst({
    where: { id: documentId, deal_id: dealId },
    include: {
      reviewer: { select: { name: true } },
      approver: { select: { name: true } },
    },
  });
  if (!document) throw notFound('That document is not available.');
  return { deal, document };
}

/** Every version of one document type on one deal, newest first. */
export async function loadDocumentHistory(dealId: string, docType: DocType) {
  return prisma.document.findMany({
    where: { deal_id: dealId, doc_type: docType },
    orderBy: { version: 'desc' },
    include: {
      reviewer: { select: { name: true } },
      approver: { select: { name: true } },
    },
  });
}

/**
 * Idempotent repair primitive for a single pre-expansion deal.
 *
 * The deployment migration performs the bulk backfill. Keeping the same operation available
 * here makes retries and targeted repairs transactionally safe without creating a UI-side
 * document-creation path. Any historical version suppresses insertion; nothing is rewritten.
 */
export async function backfillDealDocumentCapabilities(input: {
  actor: Principal;
  dealId: string;
  correlationId: string;
}): Promise<number> {
  const deal = await loadDealScoped(input.actor, input.dealId);
  assertCan(input.actor, 'document.generate');
  return prisma.$transaction(async (tx) => {
    const snapshot = await tx.dealSnapshot.findFirst({
      where: { deal_id: input.dealId }, orderBy: { version: 'desc' }, select: { id: true },
    });
    if (!snapshot) return 0;

    const docTypes = Object.keys(NEW_DOCUMENT_LIFECYCLE_MATRIX) as DocType[];
    const existing = await tx.document.findMany({
      where: { deal_id: input.dealId, doc_type: { in: docTypes } }, select: { doc_type: true },
    });
    const existingTypes = new Set(existing.map((row) => row.doc_type));
    const missing = docTypes.filter((docType) => !existingTypes.has(docType));
    if (missing.length === 0) return 0;

    const result = await tx.document.createMany({
      data: missing.map((docType) => ({
        deal_id: input.dealId, doc_type: docType, version: 1, is_current_version: true,
        source: DocumentSource.generated, generation_status: GenerationStatus.queued,
        review_status: ReviewStatus.not_reviewed, approval_status: ApprovalStatus.pending,
        filing_status: FilingStatus.not_applicable, generated_from_snapshot_id: snapshot.id,
      })),
      skipDuplicates: true,
    });
    if (result.count > 0) {
      await writeAuditEvent({
        db: tx, actor: input.actor, action: AUDIT_ACTIONS.create,
        object_type: 'deal_document_capabilities', object_id: input.dealId,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { document_types_added: missing, count: result.count },
        correlation_id: input.correlationId,
      });
    }
    return result.count;
  });
}

/**
 * Reset the fields that must start fresh on a NEW version (docs/07 §7.3: "a new version
 * resets relevant review state"; approval and filing are equally version-scoped —
 * approval is explicitly "bound to version/checksum", and filing an old version's
 * reference has no meaning once a newer version exists).
 */
export function freshVersionStatuses(approvalRequired: boolean, filingApplicable: boolean) {
  return {
    generation_status: GenerationStatus.queued,
    review_status: ReviewStatus.not_reviewed,
    approval_status: approvalRequired ? ApprovalStatus.pending : ApprovalStatus.not_required,
    filing_status: filingApplicable ? FilingStatus.draft : FilingStatus.not_applicable,
  };
}
