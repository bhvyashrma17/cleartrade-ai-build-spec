/**
 * Freezing a document's generation input.
 *
 * The lifecycle problem this solves: canonical business data is mutable by design — an agent
 * correcting a buyer's postal code must be able to correct it — but a document already issued
 * has to stay reproducible exactly as issued. The naive fix is to give every document its own
 * copy of every field, which is how a document system becomes a second database. The fix here
 * is one frozen copy, taken once, at the moment of generation.
 *
 * Layering on top of what already exists rather than beside it:
 *
 *   - `Document` is already the version model — `version`, `is_current_version`, and a unique
 *     (deal, doc_type, version). No parallel DocumentVersion table is introduced.
 *   - `DealSnapshot` is already the frozen COMMERCIAL TERMS from deal lock, and remains so.
 *   - `DocumentInputSnapshot` is the missing layer: everything else a document consumes —
 *     exporter master data, buyer address, ports, packages, FX — which keeps changing after
 *     the lock and has no other frozen home.
 *
 * An amendment is a new Document version with a new snapshot. The prior version keeps its own
 * snapshot untouched, which is what makes "correcting data does not rewrite an issued
 * artifact" structurally true rather than a rule somebody has to remember.
 */

import type { DocType, DocumentInputSnapshot, Prisma } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { notFound } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { buildDocumentContext, hashContext } from './context';
import { documentReadiness } from './readiness';
import type { DocumentGenerationContext } from './types';

export class DocumentNotReadyError extends Error {
  readonly readiness: ReturnType<typeof documentReadiness>;
  constructor(readiness: ReturnType<typeof documentReadiness>) {
    super(`Document ${readiness.documentType} is not ready: ${readiness.status}.`);
    this.name = 'DocumentNotReadyError';
    this.readiness = readiness;
  }
}

/**
 * Build, verify and freeze the input for one document version.
 *
 * Readiness is checked HERE, immediately before freezing, rather than only in the route.
 * A route check can be bypassed by a new caller; this one cannot, so a snapshot never records
 * an input that would have rendered blanks into an official form.
 *
 * Note what this does NOT do: it does not issue an invoice number. If the document needs one,
 * readiness fails and the caller issues it deliberately. Freezing must never have the side
 * effect of consuming an official number.
 */
export async function freezeDocumentInput(input: {
  actor: Principal;
  dealId: string;
  docType: DocType;
  documentId?: string;
  documentVersion?: number;
  correlationId: string;
  db?: Prisma.TransactionClient;
}): Promise<{ snapshot: DocumentInputSnapshot; context: DocumentGenerationContext }> {
  const context = await buildDocumentContext(input.actor, input.dealId, input.docType, {
    documentVersion: input.documentVersion,
  });

  const readiness = documentReadiness(context, input.docType);
  if (readiness.status !== 'ready') throw new DocumentNotReadyError(readiness);

  const db = input.db ?? prisma;
  const snapshot = await db.documentInputSnapshot.create({
    data: {
      exporter_org_id: context.exporter.org_id,
      deal_id: input.dealId,
      doc_type: input.docType,
      builder_version: context.builder_version,
      context: context as unknown as Prisma.InputJsonValue,
      content_hash: hashContext(context),
      created_by_id: input.actor.id,
      correlation_id: input.correlationId,
    },
  });

  if (input.documentId) {
    // The Document row points AT the snapshot; the snapshot never points back and is never
    // rewritten. The FK is unique, so one snapshot serves exactly one document version.
    await db.document.update({
      where: { id: input.documentId },
      data: { input_snapshot_id: snapshot.id },
    });
  }

  await writeAuditEvent({
    db,
    actor: input.actor,
    action: AUDIT_ACTIONS.generate,
    object_type: 'document_input_snapshot',
    object_id: snapshot.id,
    exporter_org_id: context.exporter.org_id,
    after_summary: {
      deal_id: input.dealId,
      doc_type: input.docType,
      // The hash, not the context: the payload would otherwise duplicate buyer address and
      // contact details into the audit log, which is broadly readable by Ops.
      content_hash: snapshot.content_hash,
      builder_version: snapshot.builder_version,
      document_version: input.documentVersion ?? null,
    },
    correlation_id: input.correlationId,
  });

  return { snapshot, context };
}

/** Read a frozen snapshot back. Returns the context exactly as it was at generation time. */
export async function readDocumentSnapshot(
  principal: Principal,
  snapshotId: string,
): Promise<{ snapshot: DocumentInputSnapshot; context: DocumentGenerationContext }> {
  const snapshot = await prisma.documentInputSnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot) throw notFound('Document snapshot not found.');
  const { assertOrgAccess } = await import('@/lib/permissions');
  await assertOrgAccess(principal, snapshot.exporter_org_id);
  return { snapshot, context: snapshot.context as unknown as DocumentGenerationContext };
}

/**
 * Whether a stored snapshot still matches its own hash.
 *
 * The trigger makes tampering impossible through Postgres, so a mismatch here means the row
 * was written by something that bypassed it or the builder's canonical form changed. Either
 * way an issued document's provenance is in question, which is worth being able to check.
 */
export function verifySnapshotIntegrity(snapshot: DocumentInputSnapshot): boolean {
  return hashContext(snapshot.context as unknown as DocumentGenerationContext) === snapshot.content_hash;
}
