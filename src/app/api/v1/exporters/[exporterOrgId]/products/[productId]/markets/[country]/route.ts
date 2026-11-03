import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { countryDetail } from '@/lib/country-discovery/service';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** One market, explained: pillars, deterministic reasons, and what would improve the analysis. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string; country: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId, country } = await ctx.params;
    const detail = await countryDetail(actor, exporterOrgId, productId, country);
    return NextResponse.json(single(detail), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
