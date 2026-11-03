import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { approveMarketScan } from '@/lib/country-discovery/scan-requests';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** Approve and hand off to the canonical screening service. No body: nothing is configurable. */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ requestId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { requestId } = await ctx.params;
    const { request, job, created } = await approveMarketScan({ actor, request_id: requestId, correlation_id: correlationId });
    return NextResponse.json(
      single({ id: request.id, status: request.status, screening_job_id: job.id, job_status: job.status, screening_launched: created }),
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
