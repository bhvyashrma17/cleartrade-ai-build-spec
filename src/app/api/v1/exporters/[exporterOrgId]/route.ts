/**
 * GET /api/v1/exporters/:exporterOrgId — AGT-02 Exporter 360 account summary.
 *
 * AC01: an agent unassigned to this exporter gets 404, not 403 — `loadExporterAccountScoped()`
 * enforces this the same way for the SSR page and this route, so there is exactly one
 * access-control decision to verify, not two that could drift.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadExporterAccountScoped } from '@/lib/agent-accounts';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { exporterOrgId } = await ctx.params;
    const { org } = await loadExporterAccountScoped(principal, exporterOrgId);

    return NextResponse.json(
      single({
        id: org.id,
        display_name: org.display_name,
        legal_name: org.legal_name,
        country: org.country,
        state: org.state,
        city: org.city,
        iec: org.iec,
        gstin: org.gstin,
        readiness_status: org.readiness_status,
        journey_stage: org.journey_stage,
        tier: org.tier,
        assigned_agent: org.assigned_agent,
        readiness_score: org.readiness_assessments[0]?.score ?? null,
        products: org.products.map((p) => ({
          id: p.id,
          name: p.name,
          hs_code: p.hs_code,
          capacity_value: p.capacity_value,
          capacity_unit: p.capacity_unit,
          moq_value: p.moq_value,
          moq_unit: p.moq_unit,
          price_target_amount: p.price_target_amount,
          price_target_currency: p.price_target_currency,
          packaging: p.packaging,
          certifications: p.certifications.map((c) => ({ code: c.code, name: c.name, status: c.status })),
        })),
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
