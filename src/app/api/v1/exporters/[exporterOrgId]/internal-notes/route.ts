/**
 * POST /api/v1/exporters/:exporterOrgId/internal-notes — AGT-02 account-level internal
 * notes. Same pattern as `/api/v1/deals/:dealId/internal-notes`: `InternalNote` is its
 * own table, never a `Message` with a visibility flag, so an exporter-facing query
 * physically cannot return one. No GET here for the same reason — the SSR account page
 * reads it directly, gated by `internal_note.view`.
 */

import { ScopeType } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadExporterAccountScoped } from '@/lib/agent-accounts';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createInternalNoteSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { exporterOrgId } = await ctx.params;
    const { org } = await loadExporterAccountScoped(principal, exporterOrgId);

    if (!permits(principal, 'internal_note.edit')) {
      throw forbidden('You cannot write internal notes.');
    }

    const body = await request.json().catch(() => null);
    const parsed = createInternalNoteSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const created = await prisma.$transaction(async (tx) => {
      const note = await tx.internalNote.create({
        data: {
          scope_type: ScopeType.exporter_org,
          scope_id: org.id,
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
        exporter_org_id: org.id,
        after_summary: { exporter_org_id: org.id },
        correlation_id: correlationId,
      });
      return note;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
