/**
 * POST /api/v1/exporters/:exporterOrgId/buyer-discovery — find real buyers for one product in one
 * market from the market's official importer list (D-033, docs/38 §2). 202 with the job.
 *
 * Buyer discovery is agent-curated (docs/11 §7): the capability check and the org scope live in
 * `requestBuyerDiscovery`, so this route and the operator script apply the same rule.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { requestBuyerDiscovery } from '@/lib/buyer-discovery/service';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

const bodySchema = z.object({ product_id: z.string().min(1), country_code: z.string().regex(/^[A-Za-z]{2}$/) });

export async function POST(request: NextRequest, context: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { exporterOrgId } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const job = await requestBuyerDiscovery({
      exporter_org_id: exporterOrgId, product_id: parsed.data.product_id, country_code: parsed.data.country_code.toUpperCase(),
      actor: principal, trigger: 'requested', correlation_id: correlationId,
    });
    return NextResponse.json(single({ job_id: job.id, status: job.status }), { status: 202, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
