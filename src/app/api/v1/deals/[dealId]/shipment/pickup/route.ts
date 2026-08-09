/**
 * POST /api/v1/deals/:dealId/shipment/pickup — EXP-14 "Confirm pickup details".
 *
 * The request schema is a WHITELIST: `confirmPickupSchema` accepts exactly pickup
 * window/contact/address and nothing else. That is what makes EXP-14-AC03 ("exporter
 * cannot edit CHA filing reference fields") true here — there is no code path in this
 * handler that could read `booking_ref`, `customs_ref`, `shipping_bill_no`,
 * `cha_partner_id` or `freight_partner_id` off the request body, because the schema
 * would already have stripped them before this function runs.
 */

import { ShipmentStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertShipmentTransition } from '@/lib/state-machines/shipment';
import { confirmPickupSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'shipment.update');

    const shipment = await prisma.shipment.findFirst({ where: { deal_id: dealId } });
    if (!shipment) throw notFound('This deal has no shipment yet.');

    const body = await request.json().catch(() => null);
    const parsed = confirmPickupSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    // Merge into `origin` rather than replace it — origin may already carry port/country
    // data set when the shipment was created, which pickup confirmation must not erase.
    const origin = (shipment.origin ?? {}) as Record<string, unknown>;
    const mergedOrigin = {
      ...origin,
      pickup_window_start: input.pickup_window_start,
      pickup_window_end: input.pickup_window_end,
      pickup_contact_name: input.contact_name,
      pickup_contact_phone: input.contact_phone,
      pickup_address: input.address,
    };

    // Only transition the pipeline if pickup is actually the next stage. Re-confirming
    // details later (e.g. a contact number correction) must not attempt an illegal
    // transition from wherever the shipment already is.
    let effects = null;
    if (shipment.status === ShipmentStatus.booking) {
      effects = assertShipmentTransition(shipment.status, ShipmentStatus.pickup, { milestone_evidence_present: true });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.shipment.update({
        where: { id: shipment.id },
        data: {
          origin: mergedOrigin as never,
          ...(effects ? { status: ShipmentStatus.pickup } : {}),
        },
      });

      if (effects?.milestone_code) {
        await tx.shipmentMilestone.updateMany({
          where: { shipment_id: shipment.id, code: effects.milestone_code },
          data: { state: 'complete', actual_at: new Date() },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'shipment',
        object_id: shipment.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, pickup_confirmed: true, status: row.status },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
