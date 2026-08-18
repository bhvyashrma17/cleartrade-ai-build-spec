/**
 * POST /api/v1/deals/:dealId/documents/:documentId/amend — create the next version.
 *
 * The only way a corrected document comes into existence. The prior version is never mutated:
 * it stops being current and keeps its snapshot, artifacts, approval and history exactly as
 * they were, which is what makes an approved document permanently reproducible.
 *
 * A reason is required. It is a human sentence for the audit trail, not a field dump — the
 * service never fills it in from canonical values, which would leak buyer details into a
 * column that appears in lists.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { createDocumentAmendment } from '@/lib/document-lifecycle';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const amendSchema = z.object({
  reason: z.string().trim().min(1, 'Say why a new version is needed.').max(500),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;

    const body = await request.json().catch(() => null);
    const parsed = amendSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const document = await createDocumentAmendment({
      actor: principal, dealId, documentId, reason: parsed.data.reason, correlationId,
    });

    return NextResponse.json(
      single({
        id: document.id, version: document.version,
        amended_from_version: document.amended_from_version,
        generation_status: document.generation_status,
        approval_status: document.approval_status,
      }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
