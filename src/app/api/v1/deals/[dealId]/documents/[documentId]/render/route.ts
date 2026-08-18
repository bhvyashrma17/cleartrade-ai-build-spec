/**
 * POST /api/v1/deals/:dealId/documents/:documentId/render — render one format synchronously.
 *
 * Distinct from `.../generate`, which enqueues a job and returns 202. This exists because an
 * agent asking for the DOCX of an already-generated version should not wait on a queue for a
 * render that takes milliseconds. Both paths run the same `renderDocumentArtifact`, so they
 * cannot diverge on readiness, storage, audit or which snapshot is used.
 *
 * `draft: true` produces a watermarked rendering explicitly labelled as not issued. It is
 * stored as its own artifact and never becomes the Document's primary file, so a draft can
 * never be mistaken for — or approved as — the real thing.
 *
 * Thin: authorization, readiness, freezing, rendering, storage and audit are all in the service.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { renderDocumentArtifact } from '@/lib/document-rendering';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const renderSchema = z.object({
  format: z.enum(['pdf', 'docx', 'html']),
  draft: z.boolean().optional(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;

    const body = await request.json().catch(() => null);
    const parsed = renderSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const { artifact } = await renderDocumentArtifact({
      actor: principal,
      dealId,
      documentId,
      format: parsed.data.format,
      draft: parsed.data.draft ?? false,
      correlationId,
    });

    return NextResponse.json(
      single({
        id: artifact.id,
        format: artifact.format,
        file_name: artifact.file_name,
        mime_type: artifact.mime_type,
        file_size_bytes: artifact.file_size_bytes,
        checksum: artifact.checksum,
        content_hash: artifact.content_hash,
        engine: `${artifact.engine_name}@${artifact.engine_version}`,
        generated_at: artifact.generated_at,
      }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
