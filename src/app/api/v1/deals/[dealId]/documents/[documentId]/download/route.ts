/**
 * GET /api/v1/deals/:dealId/documents/:documentId/download — "secure signed URL"
 * (EXP-12/EXP-13), authorization-checked per request rather than a public bucket link
 * (docs/10 §1).
 *
 * There is no real object storage wired up (see `src/lib/document-storage.ts`), so this
 * is the honest dev-environment equivalent rather than a fabricated signed-URL flow:
 *   - an UPLOADED document's bytes are read back from local disk;
 *   - a GENERATED document is re-rendered on demand through the same deterministic
 *     engine that produced it — same (doc_type, snapshot, version) always yields the
 *     same bytes, so there is nothing to store in the first place.
 * A real deployment swaps the uploaded-file branch for a signed S3/GCS URL and can drop
 * the generated-file branch entirely in favour of a stored render; nothing that calls
 * this route needs to know which one is happening.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { getDocumentGenerationEngine } from '@/lib/document-generation';
import { readStoredFile } from '@/lib/document-storage';
import { loadDocumentScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, validationError } from '@/lib/errors';
import { canDownloadDocument } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);

    if (!(await canDownloadDocument(principal, { deal }))) {
      throw forbidden('You do not have access to this document.');
    }

    if (document.generation_status !== 'generated' || !document.file_ref) {
      throw validationError(
        [{ field: 'document', code: 'not_ready', message: 'This document has not been generated yet.' }],
        'Nothing to download yet.',
      );
    }
    if(document.source==='uploaded'&&document.scan_status!=='clean'&&['staging','production'].includes(process.env.APP_ENV??'')){
      throw forbidden('This upload is quarantined until security scanning succeeds.');
    }

    let bytes: Buffer;
    let mimeType = document.mime_type ?? 'application/octet-stream';

    if (document.source === 'uploaded') {
      bytes = await readStoredFile(document.file_ref);
    } else {
      const snapshot = document.generated_from_snapshot_id
        ? await prisma.dealSnapshot.findUnique({ where: { id: document.generated_from_snapshot_id } })
        : null;
      if (!snapshot) throw validationError([{ field: 'document', code: 'not_ready', message: 'The source snapshot for this document is no longer available.' }]);

      const engine = getDocumentGenerationEngine();
      const rendered = await engine.render({
        doc_type: document.doc_type,
        deal_id: dealId,
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
      bytes = Buffer.from(rendered.content, 'utf8');
      mimeType = rendered.mime_type;
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${document.file_name ?? documentId}"`,
        'x-correlation-id': correlationId,
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
