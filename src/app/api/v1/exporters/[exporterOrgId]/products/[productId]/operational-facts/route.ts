import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { declareProductOperationalFacts } from '@/lib/exporter-facts/service';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const decimalString = z.string().regex(/^\d+(\.\d+)?$/);

/**
 * The exporter's own operational facts. Provenance is never accepted from the caller: the
 * service decides it from who is asking.
 */
const schema = z.object({
  price_target_amount: decimalString.nullish(),
  price_target_currency: z.string().length(3).nullish(),
  price_target_quantity_unit: z.string().min(1).nullish(),
  price_target_incoterm: z.string().length(3).nullish(),
  capacity_value: decimalString.nullish(),
  capacity_unit: z.string().min(1).nullish(),
  available_capacity_value: decimalString.nullish(),
  capacity_period: z.string().min(1).nullish(),
  moq_value: decimalString.nullish(),
  moq_unit: z.string().min(1).nullish(),
  lead_time_days: z.number().int().positive().nullish(),
  delivery_commitment_days: z.number().int().positive().nullish(),
  packaging_format: z.string().min(1).nullish(),
  pack_size_value: decimalString.nullish(),
  pack_size_unit: z.string().min(1).nullish(),
  units_per_carton: z.number().int().positive().nullish(),
  cartons_per_pallet: z.number().int().positive().nullish(),
  palletized: z.boolean().nullish(),
  container_compatibility: z.array(z.string().min(1)).optional(),
  special_handling_codes: z.array(z.string().min(1)).optional(),
  temperature_controlled: z.boolean().nullish(),
  temperature_min_celsius: z.string().nullish(),
  temperature_max_celsius: z.string().nullish(),
  shipment_quantity_value: decimalString.nullish(),
  shipment_quantity_unit: z.string().min(1).nullish(),
  shipment_container_count: z.number().int().positive().nullish(),
  shipment_container_type: z.string().min(1).nullish(),
  origin_city: z.string().min(1).nullish(),
  origin_state: z.string().min(1).nullish(),
  origin_country: z.string().length(2).nullish(),
  origin_postal_code: z.string().min(1).nullish(),
  origin_location_code: z.string().min(1).nullish(),
  origin_gateway_code: z.string().min(1).nullish(),
});

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { exporterOrgId, productId } = await ctx.params;
    const product = await declareProductOperationalFacts({ actor, exporter_org_id: exporterOrgId, product_id: productId, facts: parsed.data, correlation_id: correlationId });
    return NextResponse.json(single({ product_id: product.id, origin_provenance: product.origin_provenance, updated_at: product.updated_at }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
