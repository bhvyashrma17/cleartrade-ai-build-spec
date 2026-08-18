/**
 * Document rendering orchestration.
 *
 * Everything between "an agent pressed Generate" and "an artifact exists" lives here, so route
 * handlers stay thin and every caller gets the same guarantees:
 *
 *     authorize -> locate document version -> read the FROZEN snapshot -> render -> store
 *               -> record the artifact -> audit
 *
 * Two rules are structural rather than conventional.
 *
 * **The snapshot is the source.** Rendering reads `DocumentInputSnapshot.context` and never
 * rebuilds a live context. That is what makes an issued document reproducible while the
 * canonical data underneath it stays editable — correcting a buyer's address changes what the
 * NEXT version will say and cannot change what an issued one already says. It is also why
 * every format of one version renders from one snapshot: a preview and a PDF that read
 * different data would disagree.
 *
 * **Rendering never issues.** Nothing in this file allocates an invoice number. If a document
 * needs one, readiness fails and the number is issued deliberately through
 * `src/lib/invoice-numbering.ts`. A failed render therefore costs nothing and leaves no gap in
 * the series — the failure mode the legacy system had, where allocation happened on record
 * creation.
 */

import { createHash } from 'node:crypto';
import {
  DocType, DocumentFormat, GenerationStatus, Prisma, type Document, type DocumentArtifact,
} from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import {
  DocumentNotReadyError, documentReadiness, freezeDocumentInput,
  type DocumentGenerationContext, type DocumentReadiness,
} from '@/lib/document-data';
import {
  getDocumentGenerationEngine, supportsFormat,
  type DocumentOutputFormat, type DocumentRenderMetadata,
} from '@/lib/document-generation';
import { getDocumentStorage } from '@/lib/document-storage';
import { loadDocumentScoped } from '@/lib/documents';
import { forbidden, notFound, prerequisitesNotMet, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Blocker, Principal } from '@/types';

export const BRAND_NAME = 'ClearTrade AI';

const FORMAT_BY_NAME: Record<DocumentOutputFormat, DocumentFormat> = {
  pdf: DocumentFormat.pdf, docx: DocumentFormat.docx, html: DocumentFormat.html,
};

/**
 * A stable identifier for the artifact, printed in the document footer.
 *
 * Derived from the document version and the content hash, so the same version of the same
 * frozen input always carries the same id — it identifies the DOCUMENT, not the act of
 * rendering it, which is what makes it useful on a piece of paper someone is holding.
 */
export function auditIdFor(document: { doc_type: DocType; version: number }, contentHash: string): string {
  return `${document.doc_type.toUpperCase()}-V${document.version}-${contentHash.slice(0, 8).toUpperCase()}`;
}

/** Readiness issues in the shape the API already uses for prerequisites. */
function readinessBlockers(dealId: string, readiness: DocumentReadiness): Blocker[] {
  return [...readiness.invalid, ...readiness.missing].map((issue) => ({
    object_type: issue.owner,
    object_id: dealId,
    reason: issue.detail ?? issue.condition ?? `${issue.label} is not set.`,
    deep_link: `/agent/deals/${dealId}/document-data`,
  }));
}

/**
 * Ensure the document version has a frozen input, and return it.
 *
 * Freezes once. A second format for the same version reuses the existing snapshot rather than
 * taking a new one — otherwise the PDF and the DOCX of one version could be built from data
 * that changed in between, which is exactly the disagreement this design exists to prevent.
 */
async function snapshotFor(input: {
  actor: Principal;
  document: Document;
  dealId: string;
  correlationId: string;
}) {
  if (input.document.input_snapshot_id) {
    const existing = await prisma.documentInputSnapshot.findUnique({
      where: { id: input.document.input_snapshot_id },
    });
    if (existing) return existing;
  }

  const { snapshot } = await freezeDocumentInput({
    actor: input.actor,
    dealId: input.dealId,
    docType: input.document.doc_type,
    documentId: input.document.id,
    documentVersion: input.document.version,
    correlationId: input.correlationId,
  });
  return snapshot;
}

export interface RenderedArtifact {
  artifact: DocumentArtifact;
  bytes: Buffer;
}

/**
 * Render one format of one document version and store it.
 *
 * Fail-closed: readiness is re-evaluated against the frozen context immediately before the
 * engine is invoked. A snapshot could only have been frozen while ready, but re-checking costs
 * nothing and means a renderer is never handed an input that would print blanks into an
 * official form.
 */
export async function renderDocumentArtifact(input: {
  actor: Principal;
  dealId: string;
  documentId: string;
  format: DocumentOutputFormat;
  correlationId: string;
  /** Marks the output as a draft: watermarked, and labelled as not issued. */
  draft?: boolean;
  now?: Date;
}): Promise<RenderedArtifact> {
  const { deal, document } = await loadDocumentScoped(input.actor, input.dealId, input.documentId);
  assertCan(input.actor, 'document.generate');

  if (document.source !== 'generated') {
    throw validationError(
      [{ field: 'document', code: 'not_generated', message: 'Uploaded documents are stored, not rendered.' }],
      'This document was uploaded, so there is nothing to generate.',
    );
  }
  if (!supportsFormat(document.doc_type, input.format)) {
    throw validationError(
      [{ field: 'format', code: 'unsupported', message: `${document.doc_type} cannot be rendered as ${input.format}.` }],
      'That format is not available for this document.',
    );
  }

  const engine = getDocumentGenerationEngine();
  if (!engine.supports(document.doc_type, input.format)) {
    throw validationError(
      [{ field: 'format', code: 'unsupported', message: `The ${engine.name} engine cannot render ${document.doc_type} as ${input.format}.` }],
      'The configured document engine cannot produce that format.',
    );
  }

  let snapshot;
  try {
    snapshot = await snapshotFor({
      actor: input.actor, document, dealId: input.dealId, correlationId: input.correlationId,
    });
  } catch (error) {
    // Freezing refuses an input that is not ready. Translated here into the same
    // `prerequisitesNotMet` envelope every other gate uses, with a deep link per issue —
    // otherwise the caller gets an opaque 500 for an ordinary "fill this in" situation.
    if (error instanceof DocumentNotReadyError) {
      throw prerequisitesNotMet(
        readinessBlockers(input.dealId, error.readiness),
        `${document.doc_type} cannot be generated until its canonical data is complete.`,
      );
    }
    throw error;
  }
  const context = snapshot.context as unknown as DocumentGenerationContext;

  const readiness = documentReadiness(context, document.doc_type);
  if (readiness.status !== 'ready' && !input.draft) {
    throw prerequisitesNotMet(
      readinessBlockers(input.dealId, readiness),
      `${document.doc_type} cannot be generated until its canonical data is complete.`,
    );
  }

  const now = input.now ?? new Date();
  const metadata: DocumentRenderMetadata = {
    brand_name: BRAND_NAME,
    generated_at: now,
    audit_id: auditIdFor(document, snapshot.content_hash),
    draft: input.draft ?? false,
  };

  let rendered;
  try {
    rendered = await engine.render({
      doc_type: document.doc_type,
      format: input.format,
      snapshot_id: snapshot.id,
      content_hash: snapshot.content_hash,
      version: document.version,
      context,
      metadata,
    });
  } catch (error) {
    // A render failure touches nothing canonical and nothing frozen. It is recorded on the
    // DOCUMENT's own generation_status, which is where the UI reads "this attempt failed" from,
    // and the message is generic — a stack trace could carry buyer names and addresses.
    await prisma.document.update({
      where: { id: document.id },
      data: {
        generation_status: GenerationStatus.failed,
        generation_error: `Rendering ${input.format.toUpperCase()} failed.`,
      },
    });
    console.error('[document-rendering] render failed', {
      document_id: document.id, doc_type: document.doc_type, format: input.format,
      engine: engine.name, engine_version: engine.version,
      correlation_id: input.correlationId,
      message: error instanceof Error ? error.message : 'unknown',
    });
    throw error;
  }

  const checksum = createHash('sha256').update(rendered.bytes).digest('hex');
  const fileName = `${document.doc_type}_v${document.version}${input.draft ? '_draft' : ''}.${rendered.file_extension}`;

  // Stored through the SAME abstraction uploads use — local on dev, S3 when configured. No
  // second file store, and no public URL: the download route authorises every read.
  //
  // The key is content-addressed by the full checksum, so re-rendering an unchanged version
  // lands on the same object. Local storage writes with `wx` and refuses to clobber, which is
  // the right default for uploads; here a collision means the identical bytes are already
  // stored, so the existing object is reused rather than treated as an error.
  const objectKey = `documents/${document.id}/v${document.version}/${input.format}-${checksum}`;
  const storage = getDocumentStorage();
  let stored;
  try {
    stored = await storage.put({ bytes: rendered.bytes, contentType: rendered.mime_type, sha256: checksum, objectKey });
  } catch (error) {
    const alreadyStored = (error as NodeJS.ErrnoException)?.code === 'EEXIST';
    if (!alreadyStored) throw error;
    stored = { provider: storage.provider, objectKey, contentType: rendered.mime_type, sizeBytes: rendered.bytes.length, sha256: checksum };
  }

  const artifact = await prisma.$transaction(async (tx) => {
    const row = await tx.documentArtifact.upsert({
      where: { document_id_format: { document_id: document.id, format: FORMAT_BY_NAME[input.format] } },
      create: {
        document_id: document.id,
        format: FORMAT_BY_NAME[input.format],
        file_ref: stored.objectKey,
        file_name: fileName,
        mime_type: rendered.mime_type,
        file_size_bytes: rendered.bytes.length,
        checksum,
        engine_name: engine.name,
        engine_version: engine.version,
        input_snapshot_id: snapshot.id,
        content_hash: snapshot.content_hash,
        generated_by_id: input.actor.id,
        generated_at: now,
      },
      update: {
        file_ref: stored.objectKey,
        file_name: fileName,
        mime_type: rendered.mime_type,
        file_size_bytes: rendered.bytes.length,
        checksum,
        engine_name: engine.name,
        engine_version: engine.version,
        input_snapshot_id: snapshot.id,
        content_hash: snapshot.content_hash,
        generated_by_id: input.actor.id,
        generated_at: now,
      },
    });

    // The Document's own file fields track the PRIMARY artifact so the existing download route
    // and UI keep working. PDF wins where present; otherwise the first format rendered.
    const isPrimary = input.format === 'pdf' || !document.file_ref;
    if (isPrimary && !input.draft) {
      await tx.document.update({
        where: { id: document.id },
        data: {
          generation_status: GenerationStatus.generated,
          generation_error: null,
          file_ref: stored.objectKey,
          file_name: fileName,
          mime_type: rendered.mime_type,
          file_size_bytes: rendered.bytes.length,
          checksum,
          storage_provider: stored.provider,
          generation_inputs: {
            engine: engine.name,
            engine_version: engine.version,
            snapshot_id: snapshot.id,
            content_hash: snapshot.content_hash,
            provenance: rendered.provenance,
          } as Prisma.InputJsonValue,
        },
      });
    }

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.generate,
      object_type: 'document_artifact',
      object_id: row.id,
      exporter_org_id: deal.exporter_org_id,
      after_summary: {
        document_id: document.id,
        doc_type: document.doc_type,
        version: document.version,
        format: input.format,
        draft: input.draft ?? false,
        engine: `${engine.name}@${engine.version}`,
        // Hashes, not content: the audit log is broadly readable across Ops, and the context
        // carries a named counterparty's address and contact details.
        content_hash: snapshot.content_hash,
        checksum,
        size_bytes: rendered.bytes.length,
      },
      correlation_id: input.correlationId,
    });

    return row;
  });

  return { artifact, bytes: rendered.bytes };
}

/**
 * Read a stored artifact back.
 *
 * Tenancy comes from `loadDocumentScoped`, which resolves the document through its deal — an
 * artifact id alone is never enough, so a guessed id cannot reach another tenant's file.
 */
export async function readDocumentArtifact(input: {
  actor: Principal;
  dealId: string;
  documentId: string;
  format: DocumentOutputFormat;
}): Promise<{ artifact: DocumentArtifact; bytes: Buffer }> {
  const { deal } = await loadDocumentScoped(input.actor, input.dealId, input.documentId);
  const { canDownloadDocument } = await import('@/lib/permissions');
  if (!(await canDownloadDocument(input.actor, { deal }))) {
    throw forbidden('You do not have access to this document.');
  }

  const artifact = await prisma.documentArtifact.findUnique({
    where: { document_id_format: { document_id: input.documentId, format: FORMAT_BY_NAME[input.format] } },
  });
  if (!artifact) throw notFound('That document has not been generated in this format.');

  // Stored bytes, always. Nothing on this path re-renders — a regenerated PDF would carry a
  // different checksum from the one an approval is bound to, so "download" would quietly stop
  // meaning "the file that was approved".
  const bytes = await getDocumentStorage().get(artifact.file_ref);

  // For an approved version, the served bytes are verified against the checksum the approval
  // actually recorded. Triggers make an in-place replacement impossible; this catches the
  // remaining case where storage itself returned something else.
  const document = await prisma.document.findUniqueOrThrow({
    where: { id: input.documentId },
    select: { approval_status: true, approved_checksum: true },
  });
  const served = createHash('sha256').update(bytes).digest('hex');
  if (served !== artifact.checksum) {
    throw validationError(
      [{ field: 'document', code: 'checksum_mismatch', message: 'The stored file no longer matches its recorded checksum.' }],
      'This file failed its integrity check and was not served.',
    );
  }
  if (
    document.approval_status === 'exporter_approved'
    && artifact.format === DocumentFormat.pdf
    && document.approved_checksum
    && document.approved_checksum !== served
  ) {
    throw validationError(
      [{ field: 'document', code: 'approval_mismatch', message: 'The stored file is not the file that was approved.' }],
      'This file does not match the approved version and was not served.',
    );
  }

  return { artifact, bytes };
}

/** Every artifact for a document version, for the UI's format list. */
export async function documentArtifacts(documentId: string): Promise<DocumentArtifact[]> {
  return prisma.documentArtifact.findMany({
    where: { document_id: documentId },
    orderBy: { format: 'asc' },
  });
}
