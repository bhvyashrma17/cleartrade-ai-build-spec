/**
 * `document_generation` job handler.
 *
 * Reads the document's frozen `generated_from_snapshot_id` — never live Deal columns
 * (docs/13 E1, the same rule `buildDealLockContext` follows for the lock itself) — and
 * renders through the engine seam. The route that enqueues this job has already run
 * `collectMissingSnapshotFields()` and refused to enqueue if anything is missing, so a
 * failure here means something unexpected, not an incomplete snapshot.
 */

import { ApprovalStatus, FilingStatus, GenerationStatus, ReviewStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { getConfig } from '@/lib/config';
import { getDocumentGenerationEngine } from '@/lib/document-generation';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

export async function runDocumentGeneration(ctx: JobContext): Promise<JobOutcome> {
  const documentId = ctx.target_id;
  if (!documentId) throw new Error('document_generation job has no target document.');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, deal_id: true, doc_type: true, version: true, generated_from_snapshot_id: true },
  });
  if (!document) throw new Error(`Document ${documentId} no longer exists.`);
  if (!document.generated_from_snapshot_id) {
    throw new Error(`Document ${documentId} has no snapshot to generate from.`);
  }

  const snapshot = await prisma.dealSnapshot.findUnique({ where: { id: document.generated_from_snapshot_id } });
  if (!snapshot) throw new Error(`Snapshot ${document.generated_from_snapshot_id} no longer exists.`);

  await ctx.reportProgress(20);

  const engine = getDocumentGenerationEngine();
  let rendered;
  try {
    rendered = await engine.render({
      doc_type: document.doc_type,
      deal_id: document.deal_id!,
      version: document.version,
      snapshot: {
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
      },
    });
  } catch (error) {
    // The DOCUMENT's own generation_status is the durable record of "this attempt
    // failed" (docs/09 §3: state must survive refresh) — recorded here, then rethrown so
    // the JOB is also marked failed and the JobAttempt history captures the cause.
    const message = error instanceof Error ? error.message : 'Generation failed.';
    await prisma.document.update({
      where: { id: documentId },
      data: { generation_status: GenerationStatus.failed, generation_error: message },
    });
    throw error;
  }

  await ctx.reportProgress(70);

  const registry = await getConfig('documents.registry');
  const entry = registry.find((r) => r.doc_type === document.doc_type);
  const approvalRequired = entry?.approval_required ?? true;
  const filingApplicable = entry?.filing_applicable ?? false;

  const checksum = createHash('sha256').update(rendered.content).digest('hex');

  await prisma.document.update({
    where: { id: documentId },
    data: {
      generation_status: GenerationStatus.generated,
      generation_error: null,
      // A (re)generation always resets review — docs/07 §7.3 "a new version resets
      // relevant review state" applies just as much to regenerating the SAME version
      // after a failure as it does to a new one.
      review_status: ReviewStatus.not_reviewed,
      approval_status: approvalRequired ? ApprovalStatus.pending : ApprovalStatus.not_required,
      filing_status: filingApplicable ? FilingStatus.draft : FilingStatus.not_applicable,
      file_ref: `generated://${documentId}/v${document.version}`,
      file_name: `${document.doc_type}_v${document.version}.${rendered.file_extension}`,
      mime_type: rendered.mime_type,
      file_size_bytes: Buffer.byteLength(rendered.content, 'utf8'),
      checksum,
      generation_inputs: { provenance: rendered.provenance ?? null } as never,
    },
  });

  await ctx.reportProgress(100);

  return {
    status: 'completed',
    result: { document_id: documentId, checksum, provenance: rendered.provenance ?? {} } as never,
  };
}
