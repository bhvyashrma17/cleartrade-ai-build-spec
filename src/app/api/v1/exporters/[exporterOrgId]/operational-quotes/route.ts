import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { recordOperationalQuote } from '@/lib/exporter-facts/service';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

/** An agent records a partner or operational quote. Provenance is fixed as partner_quote. */
const schema = z.object({
  component: z.enum(['packaging', 'inland_transport', 'origin_charges', 'international_freight', 'insurance', 'destination_charges', 'financing', 'cleartrade_fee']),
  quote_type: z.enum(['cha', 'inland_transport', 'cargo_insurance', 'financing', 'destination_handling', 'packaging', 'international_freight', 'cleartrade_fee']),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  currency: z.string().length(3),
  rate_basis: z.enum(['per_unit', 'per_shipment', 'per_container', 'percent_of_value']),
  quantity_unit: z.string().min(1).nullish(),
  percent_of_value: z.string().nullish(),
  percent_basis: z.string().min(1).nullish(),
  cost_owner: z.enum(['exporter', 'buyer']).optional(),
  destination_country: z.string().length(2).nullish(),
  hs6_code: z.string().regex(/^\d{6}$/).nullish(),
  hs_revision: z.string().min(1).nullish(),
  product_id: z.string().min(1).nullish(),
  route_evidence_id: z.string().min(1).nullish(),
  transport_mode: z.string().min(1).nullish(),
  equipment_code: z.string().min(1).nullish(),
  carrier_name: z.string().min(1).nullish(),
  partner_name: z.string().min(1).nullish(),
  quote_reference: z.string().min(1).nullish(),
  coverage_terms: z.string().min(1).nullish(),
  coverage_percent: z.string().nullish(),
  observed_at: z.string().datetime(),
  effective_from: z.string().datetime(),
  valid_until: z.string().datetime(),
  source: z.string().min(1),
  source_reference: z.string().min(1),
  document_id: z.string().min(1).nullish(),
});

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { exporterOrgId } = await ctx.params;
    const created = await recordOperationalQuote({
      actor, exporter_org_id: exporterOrgId, correlation_id: correlationId,
      quote: { ...parsed.data, observed_at: new Date(parsed.data.observed_at), effective_from: new Date(parsed.data.effective_from), valid_until: new Date(parsed.data.valid_until) },
    });
    return NextResponse.json(single({ id: created.id, component: created.component, rate_basis: created.rate_basis, valid_until: created.valid_until, assertion_class: created.assertion_class }), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
