/**
 * `document_generation` job handler.
 *
 * Thin since Phase 6: it resolves the actor and delegates to `renderDocumentArtifact`, which
 * owns freezing, readiness, rendering, storage and audit. Everything this file used to do
 * inline — building an engine input out of DealSnapshot columns, hashing content, writing
 * file metadata — now happens in one place that the route, the UI and this job all share, so
 * they cannot drift.
 *
 * The output format is whatever the configured engine can produce for this document type. PDF
 * where available; the mock engine renders text and says so.
 */

import { GenerationStatus } from '@prisma/client';
import { getDocumentGenerationEngine, type DocumentOutputFormat } from '@/lib/document-generation';
import { renderDocumentArtifact } from '@/lib/document-rendering';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const PREFERRED_FORMATS: DocumentOutputFormat[] = ['pdf', 'docx', 'html'];

export async function runDocumentGeneration(ctx: JobContext): Promise<JobOutcome> {
  const documentId = ctx.target_id;
  if (!documentId) throw new Error('document_generation job has no target document.');

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, deal_id: true, doc_type: true, version: true },
  });
  if (!document) throw new Error(`Document ${documentId} no longer exists.`);
  if (!document.deal_id) throw new Error(`Document ${documentId} is not attached to a deal.`);

  // The job runs on behalf of whoever requested it. The requester is read from the Job row
  // rather than from the payload, and their role and tenancy are re-resolved from the database
  // — `renderDocumentArtifact` then re-checks access, so a queued job is not a way around
  // authorization if an agent's assignment was revoked between request and run.
  const job = await prisma.job.findUniqueOrThrow({
    where: { id: ctx.job_id },
    select: { requested_by_id: true },
  });
  const requester = job.requested_by_id
    ? await prisma.user.findUnique({
        where: { id: job.requested_by_id },
        select: { id: true, email: true, name: true, role: true, exporter_org_id: true, exporter_org: { select: { tier: true } } },
      })
    : null;
  if (!requester) throw new Error('The user who requested this generation no longer exists.');

  const actor: Principal = {
    id: requester.id, email: requester.email, name: requester.name, role: requester.role,
    exporter_org_id: requester.exporter_org_id,
    tier: requester.exporter_org?.tier ?? 'paid',
  };

  await ctx.reportProgress(20);

  const engine = getDocumentGenerationEngine();
  const format = PREFERRED_FORMATS.find((f) => engine.supports(document.doc_type, f));
  if (!format) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        generation_status: GenerationStatus.failed,
        generation_error: `The ${engine.name} engine cannot render ${document.doc_type}.`,
      },
    });
    throw new Error(`No supported format for ${document.doc_type} on engine ${engine.name}.`);
  }

  const { artifact } = await renderDocumentArtifact({
    actor,
    dealId: document.deal_id,
    documentId,
    format,
    correlationId: ctx.correlation_id,
  });

  await ctx.reportProgress(100);

  return {
    status: 'completed',
    result: {
      document_id: documentId,
      artifact_id: artifact.id,
      format: artifact.format,
      checksum: artifact.checksum,
      content_hash: artifact.content_hash,
      engine: `${artifact.engine_name}@${artifact.engine_version}`,
    } as never,
  };
}
