import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { productDiscoveryState, startMarketDiscovery } from '@/lib/country-discovery/service';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** Where this product stands: can it be discovered with, is a screen running, is there analysis. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId } = await ctx.params;
    const state = await productDiscoveryState(actor, exporterOrgId, productId);
    return NextResponse.json(single(state), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

/**
 * "Find best export markets".
 *
 * Deliberately takes NO body. Stage A derives its candidate markets from world trade, so there
 * is no field here — present or future — through which a caller could name the countries it
 * wants screened.
 */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId } = await ctx.params;
    const { job, created } = await startMarketDiscovery(actor, exporterOrgId, productId, correlationId);
    return NextResponse.json(
      single({ job_id: job.id, status: job.status, already_running: !created }),
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
