/**
 * PATCH /api/v1/products/:productId — AGT-02 "Products … Quick-edit allowed fields with
 * audit". A deliberate whitelist (`quickEditProductSchema`): HS code and certifications
 * are shown but not quick-editable here, same reasoning as `/api/v1/exporter-org`
 * keeping IEC/GST out of its own whitelist — those are status-aware fields owned by
 * their own verification flow, not free text a quick-edit form should be able to touch.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, summarize, writeAuditEvent } from '@/lib/audit';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { quickEditProductSchema, zodFieldErrors } from '@/lib/validators';

const EDITABLE_FIELDS: (
  | 'capacity_value'
  | 'capacity_unit'
  | 'moq_value'
  | 'moq_unit'
  | 'price_target_amount'
  | 'price_target_currency'
  | 'lead_time_days'
  | 'desired_order_size_amount'
  | 'desired_order_size_currency'
  | 'customization_capability'
  | 'packaging_capability'
  | 'packaging'
)[] = ['capacity_value', 'capacity_unit', 'moq_value', 'moq_unit', 'price_target_amount', 'price_target_currency', 'lead_time_days', 'desired_order_size_amount', 'desired_order_size_currency', 'customization_capability', 'packaging_capability', 'packaging'];

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { productId } = await ctx.params;

    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound('That product is not available.');
    await assertOrgAccess(principal, product.exporter_org_id);
    assertCan(principal, 'exporter_master_data.edit');

    const body = await request.json().catch(() => null);
    const parsed = quickEditProductSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    if (Object.keys(input).length === 0) {
      throw validationError([{ field: 'packaging', code: 'required', message: 'Nothing to update.' }]);
    }

    const before = summarize(product, EDITABLE_FIELDS);

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.product.update({
        where: { id: productId },
        data: {
          ...(input.capacity_value !== undefined ? { capacity_value: input.capacity_value } : {}),
          ...(input.capacity_unit !== undefined ? { capacity_unit: input.capacity_unit } : {}),
          ...(input.moq_value !== undefined ? { moq_value: input.moq_value } : {}),
          ...(input.moq_unit !== undefined ? { moq_unit: input.moq_unit } : {}),
          ...(input.price_target_amount !== undefined ? { price_target_amount: input.price_target_amount } : {}),
          ...(input.price_target_currency !== undefined ? { price_target_currency: input.price_target_currency } : {}),
          ...(input.lead_time_days !== undefined ? { lead_time_days: input.lead_time_days } : {}),
          ...(input.desired_order_size_amount !== undefined ? { desired_order_size_amount: input.desired_order_size_amount } : {}),
          ...(input.desired_order_size_currency !== undefined ? { desired_order_size_currency: input.desired_order_size_currency?.toUpperCase() } : {}),
          ...(input.customization_capability !== undefined ? { customization_capability: input.customization_capability } : {}),
          ...(input.packaging_capability !== undefined ? { packaging_capability: input.packaging_capability } : {}),
          ...(input.packaging !== undefined ? { packaging: input.packaging } : {}),
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'product',
        object_id: row.id,
        exporter_org_id: row.exporter_org_id,
        before_summary: before,
        after_summary: summarize(row, EDITABLE_FIELDS),
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
