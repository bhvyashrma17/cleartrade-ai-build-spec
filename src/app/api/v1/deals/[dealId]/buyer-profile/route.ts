/**
 * PATCH /api/v1/deals/:dealId/buyer-profile — the buyer's address and tax identity.
 *
 * Writes to `BuyerCommercialProfile`, which is scoped to (exporter org, buyer). Not to
 * `Buyer`: that row is global — the same company discovered by twenty exporters is one row —
 * so an address written there would hand one tenant's operationally-gathered data to every
 * other tenant that ever found the same buyer.
 *
 * Nothing here reads or copies `RawImportIdentity`. That is encrypted trade-data identity held
 * under source-rights terms, reachable only through the authorised access service, and its
 * provenance says nothing about printing it on a customs declaration. These values are
 * supplied by the exporter or their agent as part of the transaction.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateBuyerCommercialProfileSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'exporter_master_data.edit');

    const body = await request.json().catch(() => null);
    const parsed = updateBuyerCommercialProfileSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const data = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    if (Object.keys(data).length === 0) {
      throw validationError([{ field: 'address_line1', code: 'required', message: 'Nothing to update.' }]);
    }

    const full = await prisma.deal.findUniqueOrThrow({ where: { id: dealId }, select: { buyer_id: true } });

    const saved = await prisma.$transaction(async (tx) => {
      const before = await tx.buyerCommercialProfile.findUnique({
        where: { exporter_org_id_buyer_id: { exporter_org_id: deal.exporter_org_id, buyer_id: full.buyer_id } },
      });

      const row = await tx.buyerCommercialProfile.upsert({
        where: { exporter_org_id_buyer_id: { exporter_org_id: deal.exporter_org_id, buyer_id: full.buyer_id } },
        create: { exporter_org_id: deal.exporter_org_id, buyer_id: full.buyer_id, ...data, updated_by_id: principal.id },
        update: { ...data, updated_by_id: principal.id },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: before ? AUDIT_ACTIONS.update : AUDIT_ACTIONS.create,
        object_type: 'buyer_commercial_profile',
        object_id: row.id,
        exporter_org_id: deal.exporter_org_id,
        // WHICH fields changed, not their values. An address and a contact phone are personal
        // data about a named counterparty, and the audit log is readable across all of Ops —
        // recording that the address was edited is the accountability that is actually needed.
        before_summary: { buyer_id: full.buyer_id, existed: Boolean(before) },
        after_summary: { buyer_id: full.buyer_id, fields_changed: Object.keys(data).sort() },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(saved), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
