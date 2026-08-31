import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { currentScanRequest, reconcileScanRequest, requestMarketScan } from '@/lib/country-discovery/scan-requests';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** Where this product's market scan request stands, reconciled against its screening job. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId } = await ctx.params;
    const existing = await currentScanRequest(actor, exporterOrgId, productId);
    const reconciled = existing ? await reconcileScanRequest(existing.id) : null;
    return NextResponse.json(single(reconciled), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

/**
 * Request a market scan.
 *
 * Takes NO body. A global screen's markets, provider mode, quota and policy are all derived
 * server-side, so there is deliberately no field here through which a caller could shape the
 * metered work — and repeated submits return the existing request rather than queueing more.
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId } = await ctx.params;
    const outcome = await requestMarketScan({ actor, exporter_org_id: exporterOrgId, product_id: productId, correlation_id: correlationId });
    return NextResponse.json(
      single({
        id: outcome.request.id, status: outcome.request.status,
        requested_at: outcome.request.requested_at, resolution_note: outcome.request.resolution_note,
        screening_run_id: outcome.request.screening_run_id,
        created: outcome.created, satisfied_by_existing_run: outcome.satisfied_by_existing_run,
      }),
      { status: outcome.created ? 201 : 200, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
