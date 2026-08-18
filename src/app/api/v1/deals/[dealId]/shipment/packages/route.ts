/**
 * PUT /api/v1/deals/:dealId/shipment/packages — replace the package manifest.
 *
 * A whole-list replace, not per-line CRUD. A packing list is only meaningful as a complete
 * manifest: a partial update that leaves a stale line behind produces totals that disagree
 * with the goods, and since totals are derived from these lines the disagreement would be
 * invisible until it appeared on a customs document.
 *
 * These lines are the ONLY owner of package counts, weights and volume. There is no stored
 * total anywhere — `shipmentPackageTotals()` sums them at read time, so a total can never
 * drift from its parts.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { replaceShipmentPackagesSchema, zodFieldErrors } from '@/lib/validators';

const dec = (v: string | null | undefined) => (v ? new Prisma.Decimal(v) : null);

export async function PUT(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'shipment.update');

    const body = await request.json().catch(() => null);
    const parsed = replaceShipmentPackagesSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const shipment = await prisma.shipment.findFirst({ where: { deal_id: dealId }, orderBy: { created_at: 'asc' } });
    if (!shipment) throw notFound('This deal has no shipment yet.');

    // Checked here as well as by the database CHECK, so the caller gets a field-level message
    // naming the line instead of a constraint violation.
    parsed.data.packages.forEach((p, i) => {
      if (p.net_weight_kg && p.gross_weight_kg && new Prisma.Decimal(p.gross_weight_kg).lt(new Prisma.Decimal(p.net_weight_kg))) {
        throw validationError([{
          field: `packages.${i}.gross_weight_kg`, code: 'invalid',
          message: 'Gross weight includes the packaging, so it cannot be below net weight.',
        }]);
      }
    });

    const saved = await prisma.$transaction(async (tx) => {
      const previousCount = await tx.shipmentPackage.count({ where: { shipment_id: shipment.id } });
      await tx.shipmentPackage.deleteMany({ where: { shipment_id: shipment.id } });

      // `sequence` is assigned from the submitted order rather than accepted from the client:
      // it is a display ordinal, and letting a caller pick it invites collisions with the
      // unique index for no benefit.
      await tx.shipmentPackage.createMany({
        data: parsed.data.packages.map((p, index) => ({
          shipment_id: shipment.id,
          sequence: index + 1,
          package_type: p.package_type,
          package_count: p.package_count,
          net_weight_kg: dec(p.net_weight_kg),
          gross_weight_kg: dec(p.gross_weight_kg),
          length_cm: dec(p.length_cm),
          width_cm: dec(p.width_cm),
          height_cm: dec(p.height_cm),
          volume_cbm: dec(p.volume_cbm),
          contents_description: p.contents_description ?? null,
        })),
      });

      const rows = await tx.shipmentPackage.findMany({ where: { shipment_id: shipment.id }, orderBy: { sequence: 'asc' } });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'shipment',
        object_id: shipment.id,
        exporter_org_id: deal.exporter_org_id,
        before_summary: { package_lines: previousCount },
        after_summary: {
          package_lines: rows.length,
          total_packages: rows.reduce((sum, r) => sum + r.package_count, 0),
        },
        correlation_id: correlationId,
      });

      return rows;
    });

    return NextResponse.json(single(saved), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
