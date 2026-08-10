/**
 * POST /api/v1/deals/:dealId/partners — AGT-06 CHA/freight partner assignment.
 * PATCH — record what the partner sent back (AC02's reference/evidence).
 *
 * Two things happen on assignment, and both are required by AC02:
 *   1. `Shipment.cha_partner_id` / `freight_partner_id` is set — WHO is assigned.
 *   2. A `PartnerHandoff` row is created — WHO handed off, WHEN, at what status, under
 *      what reference. The FK on Shipment alone cannot express a handoff event, and a
 *      re-assignment would silently erase the previous one.
 *
 * "No free-text phantom partner in structured assignment": `partner_id` is validated
 * against the active Partner directory here AND is a foreign key in the database, so an
 * invented partner fails twice over. There is no name field on this request at all.
 */

import { PartnerType, Prisma } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertActionAllowed } from '@/lib/execution-plan';
import { loadChecklistForEnforcement } from '@/lib/execution-view';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assignPartnerSchema, updateHandoffSchema, zodFieldErrors } from '@/lib/validators';

/** Which Shipment column each lane assigns, or null for lanes that only get a handoff. */
const LANE_COLUMN: Partial<Record<PartnerType, 'cha_partner_id' | 'freight_partner_id'>> = {
  cha: 'cha_partner_id',
  freight: 'freight_partner_id',
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    // Partner assignment is an agent/ops operation. An exporter has no capability for it
    // at all — the matrix says `shipment.update` is `own_org` for exporters, so this
    // route additionally refuses anyone who is not acting in an agent/ops capacity.
    assertCan(principal, 'shipment.update');
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Partner assignment is handled by your ClearTrade agent.');
    }

    const body = await request.json().catch(() => null);
    const parsed = assignPartnerSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    // AC01 enforced server-side, re-derived from live data rather than trusting whatever
    // the page computed when it rendered.
    const checklist = await loadChecklistForEnforcement(dealId);
    assertActionAllowed(checklist, 'partner.assign');

    const shipment = await prisma.shipment.findFirst({ where: { deal_id: dealId } });
    if (!shipment) throw notFound('This deal has no shipment yet, so a partner cannot be assigned.');

    // The directory check. A partner that is not active, or whose type does not match the
    // lane, is refused — assigning an insurance broker as your CHA is a data error, not a
    // preference.
    const partner = await prisma.partner.findFirst({
      where: { id: input.partner_id, partner_status: 'active', type: input.lane as PartnerType },
    });
    if (!partner) {
      throw validationError(
        [{ field: 'partner_id', code: 'invalid', message: `No active ${input.lane} partner with that id is in the approved directory.` }],
        'Choose a partner from the approved directory.',
      );
    }

    const column = LANE_COLUMN[input.lane as PartnerType];

    const result = await prisma.$transaction(async (tx) => {
      if (column) {
        await tx.shipment.update({ where: { id: shipment.id }, data: { [column]: partner.id } as Prisma.ShipmentUpdateInput });
      }

      const handoff = await tx.partnerHandoff.create({
        data: {
          deal_id: dealId,
          shipment_id: shipment.id,
          partner_id: partner.id,
          lane: input.lane as PartnerType,
          status: 'sent',
          owner_user_id: principal.id,
          notes: input.notes ?? null,
          sent_at: new Date(),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'partner_handoff',
        object_id: handoff.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, lane: input.lane, partner_id: partner.id, partner: partner.display_name },
        correlation_id: correlationId,
      });

      return handoff;
    });

    return NextResponse.json(single({ ...result, partner_name: partner.display_name }), {
      status: 201,
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'shipment.update');
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Partner handoffs are managed by your ClearTrade agent.');
    }

    const body = await request.json().catch(() => null);
    const parsed = updateHandoffSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const handoff = await prisma.partnerHandoff.findFirst({ where: { id: input.handoff_id, deal_id: dealId } });
    if (!handoff) throw notFound('That handoff is not available.');

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.partnerHandoff.update({
        where: { id: handoff.id },
        data: {
          status: input.status,
          ...(input.reference !== undefined && input.reference !== null ? { reference: input.reference } : {}),
          ...(input.notes !== undefined && input.notes !== null ? { notes: input.notes } : {}),
          ...(input.status === 'acknowledged' ? { acknowledged_at: new Date() } : {}),
          ...(input.status === 'completed' ? { completed_at: new Date() } : {}),
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'partner_handoff',
        object_id: handoff.id,
        exporter_org_id: deal.exporter_org_id,
        before_summary: { status: handoff.status, reference: handoff.reference },
        after_summary: { status: row.status, reference: row.reference },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
