/**
 * POST /api/v1/deals/:dealId/documents/:documentId/upload — "Upload replacement/supporting
 * file" (EXP-12).
 *
 * ALWAYS creates a new version row; NEVER mutates the one it is replacing. That is not a
 * style choice, it is the entire mechanism behind EXP-12-AC04 ("filed/accepted versions
 * are never overwritten by an upload") — a filed document's row is simply never touched
 * by this handler, regardless of its filing_status, because upload never targets an
 * existing row at all.
 */

import { createHash } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { freshVersionStatuses, loadDocumentScoped } from '@/lib/documents';
import { saveUploadedFile } from '@/lib/document-storage';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { isExporter } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);

    // Docs anatomy: "Upload replacement/supporting file | Exporter". An agent prepares
    // documents through Generate; only the exporter supplies their own supporting file.
    if (!isExporter(principal)) {
      throw forbidden('Only the exporter can upload a replacement document.');
    }
    if (!document.is_current_version) {
      throw forbidden('Only the current version accepts a replacement upload.');
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || !(file instanceof File)) {
      throw validationError([{ field: 'file', code: 'required', message: 'Choose a file to upload.' }]);
    }

    const policy = await getConfig('uploads.policy');
    if (!policy.allowed_mime_types.includes(file.type)) {
      throw validationError([
        { field: 'file', code: 'invalid', message: `File type ${file.type || 'unknown'} is not accepted. Allowed: ${policy.allowed_mime_types.join(', ')}.` },
      ]);
    }
    const maxBytes = policy.max_size_mb * 1024 * 1024;
    if (file.size > maxBytes) {
      throw validationError([{ field: 'file', code: 'too_large', message: `File exceeds the ${policy.max_size_mb}MB limit.` }]);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const checksum = createHash('sha256').update(bytes).digest('hex');
    const stored = await saveUploadedFile(bytes, file.name);

    const registry = await getConfig('documents.registry');
    const entry = registry.find((r) => r.doc_type === document.doc_type);

    const created = await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: document.id }, data: { is_current_version: false } });
      const row = await tx.document.create({
        data: {
          deal_id: dealId,
          doc_type: document.doc_type,
          version: document.version + 1,
          is_current_version: true,
          source: 'uploaded',
          ...freshVersionStatuses(entry?.approval_required ?? true, entry?.filing_applicable ?? false),
          // Uploaded content exists already — there is nothing to "generate".
          generation_status: 'generated',
          file_ref: stored.file_ref,
          file_name: file.name,
          file_size_bytes: stored.size_bytes,
          mime_type: file.type,
          checksum,
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'document',
        object_id: row.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, doc_type: row.doc_type, version: row.version, source: 'uploaded', checksum },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
