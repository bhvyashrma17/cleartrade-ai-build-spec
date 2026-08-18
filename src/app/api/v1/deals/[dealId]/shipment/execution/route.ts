/**
 * PATCH /api/v1/deals/:dealId/shipment/execution — ports, transport references, freight.
 *
 * These are shipment facts, so they are written to `Shipment`. The pre-existing `origin` and
 * `destination` JSON columns are left alone: they carry pickup logistics (window, contact,
 * address) and are not a place to hide port identity, which needs its own validated columns
 * to be usable on a customs document.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateShipmentExecutionSchema, zodFieldErrors } from '@/lib/validators';

const DATE_FIELDS = ['transport_document_date', 'shipping_bill_date', 'shipped_on_date'] as const;
const DECIMAL_FIELDS = ['freight_amount', 'other_charges_amount'] as const;

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'shipment.update');

    const body = await request.json().catch(() => null);
    const parsed = updateShipmentExecutionSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const shipment = await prisma.shipment.findFirst({ where: { deal_id: dealId }, orderBy: { created_at: 'asc' } });
    if (!shipment) throw notFound('This deal has no shipment yet.');

    const raw = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined));
    if (Object.keys(raw).length === 0) {
      throw validationError([{ field: 'port_of_loading_name', code: 'required', message: 'Nothing to update.' }]);
    }

    // Strings on the wire become the types the column actually holds. Money arrives as a
    // string and becomes Decimal — it is never parsed through a JS number on the way in.
    const data: Record<string, unknown> = { ...raw };
    for (const field of DATE_FIELDS) {
      if (field in data) data[field] = data[field] ? new Date(data[field] as string) : null;
    }
    for (const field of DECIMAL_FIELDS) {
      if (field in data) data[field] = data[field] ? new Prisma.Decimal(data[field] as string) : null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.shipment.update({ where: { id: shipment.id }, data });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'shipment',
        object_id: shipment.id,
        exporter_org_id: deal.exporter_org_id,
        before_summary: Object.fromEntries(
          Object.keys(raw).map((k) => [k, (shipment as Record<string, unknown>)[k] ?? null]),
        ) as never,
        after_summary: Object.fromEntries(
          Object.keys(raw).map((k) => [k, (row as Record<string, unknown>)[k] ?? null]),
        ) as never,
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
