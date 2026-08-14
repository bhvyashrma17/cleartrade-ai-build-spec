/**
 * POST /api/v1/deals/:dealId/documents/:documentId/override — OPS-04 "Override
 * requirement | Restricted Ops | Policy-controlled with reason/audit | High-risk
 * confirm".
 *
 * Deliberately bypasses `FILING_TRANSITIONS` (the state machine `file/route.ts`
 * enforces) — that machine exists to keep NORMAL filing honest; an override is, by
 * definition, an exception to it, not a transition within it. What still applies:
 * a mandatory reason, an explicit `confirm: true` (the "high-risk confirm" the docs
 * call for), and a dedicated `AUDIT_ACTIONS.override` event so it is never mistaken
 * for a routine filing update in the audit trail (AC03).
 *
 * Sets `filing_status: not_applicable` — the existing enum value that already means
 * "this requirement does not apply to this document" — rather than adding a new
 * status. The document's normal history (prior versions, prior filing attempts) is
 * untouched; only this document's filing requirement is waived.
 */

import { FilingStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDocumentScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { overrideDocumentRequirementSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; documentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, documentId } = await ctx.params;
    const { deal, document } = await loadDocumentScoped(principal, dealId, documentId);
    assertCan(principal, 'document.override_requirement');

    const body = await request.json().catch(() => null);
    const parsed = overrideDocumentRequirementSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { reason } = parsed.data;

    if (!document.is_current_version) {
      throw validationError([{ field: 'documentId', code: 'stale_version', message: 'Override the current version, not a superseded one.' }]);
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.document.update({
        where: { id: document.id },
        data: { filing_status: FilingStatus.not_applicable },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.override,
        object_type: 'document',
        object_id: document.id,
        exporter_org_id: deal.exporter_org_id,
        before_summary: { filing_status: document.filing_status, doc_type: document.doc_type },
        after_summary: { filing_status: row.filing_status, reason },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
