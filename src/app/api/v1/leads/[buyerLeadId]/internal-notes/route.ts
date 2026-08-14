/**
 * POST /api/v1/leads/:buyerLeadId/internal-notes — AGT-04 "Timeline … internal notes
 * distinct". Same pattern as the deal and exporter-account internal-notes routes.
 */

import { ScopeType } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadLeadScoped } from '@/lib/agent-leads';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createInternalNoteSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ buyerLeadId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { buyerLeadId } = await ctx.params;
    const lead = await loadLeadScoped(principal, buyerLeadId);

    if (!permits(principal, 'internal_note.edit')) {
      throw forbidden('You cannot write internal notes.');
    }

    const body = await request.json().catch(() => null);
    const parsed = createInternalNoteSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.internalNote.create({
        data: {
          scope_type: ScopeType.buyer_lead,
          scope_id: lead.id,
          buyer_lead_id: lead.id,
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
        exporter_org_id: lead.exporter_org_id,
        after_summary: { buyer_lead_id: lead.id },
        correlation_id: correlationId,
      });
      return note;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
