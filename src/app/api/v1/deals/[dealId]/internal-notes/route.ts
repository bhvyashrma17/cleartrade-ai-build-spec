/**
 * POST /api/v1/deals/:dealId/internal-notes — AGT-06 "Internal details visible to agent".
 *
 * `InternalNote` is its own table, not a `Message` with a flag (prisma/schema.prisma
 * header rule: "Internal notes are a separate table from exporter-visible messages, not a
 * flag"). That separation is what makes the leak structurally impossible rather than
 * conditionally avoided: `GET /api/v1/messages` queries `Message` and physically cannot
 * return an `InternalNote`, no matter what filter it forgets.
 *
 * There is deliberately no GET here. Internal notes reach the agent through the
 * server-rendered execution workspace (`loadExecutionView`), which already gates them on
 * `canViewInternalNote()`. Adding a fetchable JSON endpoint would create a second, weaker
 * path to the same content for no benefit.
 */

import { ScopeType } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createInternalNoteSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);

    // `internal_note.edit` is `none` for both exporter roles in the matrix, so this one
    // check is the whole gate — no role string comparison needed.
    if (!permits(principal, 'internal_note.edit')) {
      throw forbidden('You cannot write internal notes.');
    }

    const body = await request.json().catch(() => null);
    const parsed = createInternalNoteSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.internalNote.create({
        data: {
          scope_type: ScopeType.deal,
          scope_id: dealId,
          deal_id: dealId,
          author_user_id: principal.id,
          body: parsed.data.body,
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'internal_note',
        object_id: note.id,
        exporter_org_id: deal.exporter_org_id,
        // The note BODY is deliberately not in the audit summary. An audit event is
        // readable by ops_finance and admin; the note itself is scoped more narrowly.
        after_summary: { deal_id: dealId },
        correlation_id: correlationId,
      });
      return note;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
