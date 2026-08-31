import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { marketScanQueue } from '@/lib/country-discovery/scan-requests';
import { errorResponse, list, newCorrelationId, pageMeta } from '@/lib/errors';

/** The ClearTrade staff review queue, scoped to the actor's assigned exporters. */
export async function GET(_request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const queue = await marketScanQueue(actor);
    return NextResponse.json(
      list(queue, { ...pageMeta({ page: 1, per_page: queue.length || 1, total: queue.length }) }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
