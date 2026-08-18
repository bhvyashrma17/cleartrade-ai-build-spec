/**
 * GET /api/v1/deals/:dealId/documents/:documentId/download — authorization-checked per request
 * rather than a public bucket link (docs/10 §1).
 *
 * Since Phase 6 a generated document has real stored bytes, so both branches now read from
 * storage rather than re-rendering. That matters beyond tidiness: the previous behaviour
 * re-ran the engine on every download, which was only safe while the renderer was
 * deterministic plain text. Re-rendering a PDF would produce a file whose checksum differed
 * from the one the approval was bound to.
 *
 * `?format=` selects between the artifacts of one version. Absent, it serves whichever the
 * Document row records as primary.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { readDocumentArtifact } from '@/lib/document-rendering';
import { readStoredFile } from '@/lib/document-storage';
import { loadDocumentScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, validationError } from '@/lib/errors';
import { canDownloadDocument } from '@/lib/permissions';
import type { DocumentOutputFormat } from '@/lib/document-generation';

const FORMATS: DocumentOutputFormat[] = ['pdf', 'docx', 'html'];

export async function GET(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);

    if (!(await canDownloadDocument(principal, { deal }))) {
      throw forbidden('You do not have access to this document.');
    }

    const requested = request.nextUrl.searchParams.get('format');
    if (requested && !FORMATS.includes(requested as DocumentOutputFormat)) {
      throw validationError([{ field: 'format', code: 'invalid', message: `Unknown format "${requested}".` }]);
    }

    if (document.source === 'uploaded') {
      if (!document.file_ref) {
        throw validationError([{ field: 'document', code: 'not_ready', message: 'This document has no stored file.' }]);
      }
      if (document.scan_status !== 'clean' && ['staging', 'production'].includes(process.env.APP_ENV ?? '')) {
        throw forbidden('This upload is quarantined until security scanning succeeds.');
      }
      const bytes = await readStoredFile(document.file_ref);
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          'Content-Type': document.mime_type ?? 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${document.file_name ?? documentId}"`,
          'x-correlation-id': correlationId,
        },
      });
    }

    if (document.generation_status !== 'generated') {
      throw validationError(
        [{ field: 'document', code: 'not_ready', message: 'This document has not been generated yet.' }],
        'Nothing to download yet.',
      );
    }

    const { artifact, bytes } = await readDocumentArtifact({
      actor: principal,
      dealId,
      documentId,
      format: (requested as DocumentOutputFormat) ?? 'pdf',
    });

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': artifact.mime_type,
        'Content-Disposition': `attachment; filename="${artifact.file_name}"`,
        // Lets a caller verify the bytes it received against what was approved.
        'x-document-checksum': artifact.checksum,
        'x-document-snapshot': artifact.input_snapshot_id,
        'x-correlation-id': correlationId,
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
