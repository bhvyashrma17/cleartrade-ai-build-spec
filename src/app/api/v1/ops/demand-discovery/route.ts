import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { demandDiscoveryOperations } from '@/lib/country-discovery/scan-requests';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** Counts for the ops Demand Discovery landing page. Detail lives in the tabs beneath it. */
export async function GET(_request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const overview = await demandDiscoveryOperations(actor);
    return NextResponse.json(single(overview), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
