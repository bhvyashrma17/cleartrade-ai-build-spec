/**
 * POST /api/v1/deals/:dealId/documents/:documentId/generate — EXP-12 "Generate" action.
 *
 * Two shapes depending on the document's current state:
 *   - queued/failed, same version -> fills THIS row in place (nothing has been approved
 *     or filed against it yet, so there is no history to disturb).
 *   - already generated AND (approved or filed) -> creates a NEW version instead. Docs/07
 *     §7.3 is explicit that approval is bound to a version/checksum and a version is
 *     never mutated after it has been acted on — regenerating an approved document must
 *     not retroactively change what was approved.
 *
 * Missing snapshot data is checked HERE, synchronously, before anything is enqueued
 * (EXP-12-AC05) — `collectMissingSnapshotFields` returns the same `Blocker[]` shape the
 * deal-lock gate uses, each with a deep link to the exact field.
 */

import { GenerationStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { collectMissingSnapshotFields } from '@/lib/document-generation';
import { freshVersionStatuses, loadDocumentScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, prerequisitesNotMet, single } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { enqueueJob } from '@/lib/jobs';
import { getConfig } from '@/lib/config';

export async function POST(_request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);

    assertCan(principal, 'document.generate');

    if (!document.is_current_version) {
      throw forbidden('Only the current version of a document can be generated.');
    }
    if (document.generation_status === GenerationStatus.processing) {
      // "Generating: progress; prevent duplicate" (EXP-12 required UI states).
      throw forbidden('This document is already generating.');
    }

    // A generated-and-acted-on version is never overwritten in place — that is exactly
    // AC04's rule ("filed/accepted versions are never overwritten") generalised to
    // approval too, since approval carries the same version/checksum binding.
    const mustCreateNewVersion =
      document.generation_status === GenerationStatus.generated &&
      (document.approval_status === 'exporter_approved' || document.filing_status === 'filed' || document.filing_status === 'accepted');

    const snapshot = await prisma.dealSnapshot.findFirst({
      where: { deal_id: dealId },
      orderBy: { version: 'desc' },
    });
    if (!snapshot) {
      throw prerequisitesNotMet(
        [{ object_type: 'deal', object_id: dealId, reason: 'This deal has no locked snapshot yet.', deep_link: `/app/deals/${dealId}/commercial` }],
        'Documents generate from the deal snapshot, which does not exist until the deal is locked.',
      );
    }

    const blockers = collectMissingSnapshotFields(dealId, document.doc_type, {
      buyer_legal_name: snapshot.buyer_legal_name,
      product_name: snapshot.product_name,
      sku: snapshot.sku,
      quantity: snapshot.quantity?.toString() ?? null,
      unit: snapshot.unit,
      unit_price_amount: snapshot.unit_price_amount?.toString() ?? null,
      unit_price_currency: snapshot.unit_price_currency,
      total_amount: snapshot.total_amount?.toString() ?? null,
      total_currency: snapshot.total_currency,
      incoterm: snapshot.incoterm,
      incoterm_place: snapshot.incoterm_place,
      payment_terms: snapshot.payment_terms,
      ship_window_start: snapshot.ship_window_start,
      ship_window_end: snapshot.ship_window_end,
      special_conditions: snapshot.special_conditions,
    });
    if (blockers.length > 0) {
      throw prerequisitesNotMet(blockers, `${document.doc_type} cannot be generated until the commercial terms are complete.`);
    }

    const registry = await getConfig('documents.registry');
    const entry = registry.find((r) => r.doc_type === document.doc_type);

    const targetDocumentId = await prisma.$transaction(async (tx) => {
      let target: { id: string; version: number };

      if (mustCreateNewVersion) {
        await tx.document.update({ where: { id: document.id }, data: { is_current_version: false } });
        target = await tx.document.create({
          data: {
            deal_id: dealId,
            doc_type: document.doc_type,
            version: document.version + 1,
            is_current_version: true,
            source: 'generated',
            generated_from_snapshot_id: snapshot.id,
            ...freshVersionStatuses(entry?.approval_required ?? true, entry?.filing_applicable ?? false),
            generation_status: GenerationStatus.queued,
          },
        });
      } else {
        target = await tx.document.update({
          where: { id: document.id },
          data: { generation_status: GenerationStatus.processing, generation_error: null, generated_from_snapshot_id: snapshot.id },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: mustCreateNewVersion ? AUDIT_ACTIONS.create : AUDIT_ACTIONS.generate,
        object_type: 'document',
        object_id: target.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, doc_type: document.doc_type, version: target.version },
        correlation_id: correlationId,
      });

      return target.id;
    });

    if (mustCreateNewVersion) {
      await prisma.document.update({ where: { id: targetDocumentId }, data: { generation_status: GenerationStatus.processing } });
    }

    // dedupe_key scopes to (document row, its version) — a second click while the same
    // version is mid-generation attaches to the in-flight job rather than double-running.
    const job = await enqueueJob({
      type: 'document_generation',
      payload: { document_id: targetDocumentId },
      exporter_org_id: deal.exporter_org_id,
      requested_by_id: principal.id,
      target_type: 'document',
      target_id: targetDocumentId,
      dedupe_key: `document_generation:${targetDocumentId}`,
      correlation_id: correlationId,
    });

    return NextResponse.json(
      single({ document_id: targetDocumentId, job_id: job.id, status: job.status, new_version: mustCreateNewVersion }),
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
