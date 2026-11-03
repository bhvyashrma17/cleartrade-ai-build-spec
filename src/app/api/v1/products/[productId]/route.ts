/**
 * PATCH /api/v1/products/:productId — AGT-02 "Products … Quick-edit allowed fields with
 * audit". A deliberate whitelist (`quickEditProductSchema`): HS code and certifications
 * are shown but not quick-editable here, same reasoning as `/api/v1/exporter-org`
 * keeping IEC/GST out of its own whitelist — those are status-aware fields owned by
 * their own verification flow, not free text a quick-edit form should be able to touch.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { quickEditProductSchema, zodFieldErrors } from '@/lib/validators';
import { declareProductOperationalFacts } from '@/lib/exporter-facts/service';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { productId } = await ctx.params;

    const product = await prisma.product.findUnique({ where: { id: productId }, select: { exporter_org_id: true } });
    if (!product) throw notFound('That product is not available.');

    const body = await request.json().catch(() => null);
    const parsed = quickEditProductSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    if (Object.keys(input).length === 0) {
      throw validationError([{ field: 'packaging', code: 'required', message: 'Nothing to update.' }]);
    }

    const decimal = (value: { toString(): string } | null | undefined) => value == null ? value : value.toString();
    // Compatibility alias only: the canonical service owns validation, scope, audit and the
    // exporter_declared provenance decision. There is no second master-data write path here.
    const updated = await declareProductOperationalFacts({
      actor: principal,
      exporter_org_id: product.exporter_org_id,
      product_id: productId,
      correlation_id: correlationId,
      facts: {
        ...input,
        capacity_value: decimal(input.capacity_value),
        moq_value: decimal(input.moq_value),
        price_target_amount: decimal(input.price_target_amount),
        desired_order_size_amount: decimal(input.desired_order_size_amount),
      },
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
