/**
 * POST /api/v1/buyer-contacts/:contactId/verify — AGT-04 "Verify contact … Update
 * verification status with evidence".
 *
 * `Buyer`/`BuyerContact` are global entities with no `exporter_org_id` of their own, so
 * there is no tenant scope to check on the contact itself — verification updates a
 * shared fact about the buyer, visible to every exporter working that buyer, the same
 * way a buyer's risk flags are shared. The gate is the capability
 * (`buyer_contact.verify`: agent/ops only), not tenancy.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, summarize, writeAuditEvent } from '@/lib/audit';
import { assertCan } from '@/lib/permissions';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { verifyBuyerContactSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ contactId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'buyer_contact.verify');
    const { contactId } = await ctx.params;

    const contact = await prisma.buyerContact.findUnique({ where: { id: contactId } });
    if (!contact) throw notFound('That contact is not available.');

    const body = await request.json().catch(() => null);
    const parsed = verifyBuyerContactSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const before = summarize(contact, ['verification_status', 'provenance']);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.buyerContact.update({
        where: { id: contactId },
        data: {
          verification_status: input.verification_status,
          provenance: input.evidence,
          verified_at: new Date(),
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'buyer_contact',
        object_id: row.id,
        before_summary: before,
        after_summary: summarize(row, ['verification_status', 'provenance']),
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
