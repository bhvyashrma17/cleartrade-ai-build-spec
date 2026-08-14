/**
 * PATCH /api/v1/partners/:partnerId — "Deactivate config item | Future use disabled;
 * history retained | Dependency check". Setting `partner_status` away from `active`
 * only stops FUTURE assignment (`/api/v1/deals/:dealId/partners` filters on
 * `partner_status: active`); every existing `PartnerHandoff` row referencing this
 * partner is untouched, so past assignment history is retained exactly as-is.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updatePartnerStatusSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ partnerId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'partner.manage');
    const { partnerId } = await ctx.params;

    const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
    if (!partner) throw notFound('That partner is not available.');

    const body = await request.json().catch(() => null);
    const parsed = updatePartnerStatusSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.partner.update({ where: { id: partnerId }, data: { partner_status: input.partner_status } });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'partner',
        object_id: row.id,
        before_summary: { partner_status: partner.partner_status },
        after_summary: { partner_status: row.partner_status, reason: input.reason },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
