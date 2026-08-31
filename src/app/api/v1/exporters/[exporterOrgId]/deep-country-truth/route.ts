import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { requestDeepCountryTruthFromScreening } from '@/lib/country-truth-deep-request';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

/**
 * The request names a completed screening run and a product — never a country list. There is no
 * field here through which the shortlist frozen by Stage A could be altered.
 */
const requestSchema = z.object({ product_id: z.string().min(1), screening_run_id: z.string().min(1) });

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const body = await request.json().catch(() => null);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { exporterOrgId } = await ctx.params;
    const result = await requestDeepCountryTruthFromScreening({
      actor,
      exporter_org_id: exporterOrgId,
      product_id: parsed.data.product_id,
      screening_run_id: parsed.data.screening_run_id,
      correlation_id: correlationId,
    });
    return NextResponse.json(
      single({
        job_id: result.job.id,
        status: result.job.status,
        screening_run_id: result.payload.provenance?.screening_run_id ?? null,
        country_evidence_plan_id: result.plan.id,
        shortlisted_markets: result.payload.candidates,
        product: { id: result.payload.product_id, classification: { id: result.payload.product_classification_id, hs6: result.payload.hs6, hs_revision: result.payload.hs_revision } },
        duplicate: !result.created,
      }),
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
