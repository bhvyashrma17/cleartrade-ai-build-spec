import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { marketResults } from '@/lib/country-discovery/service';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** Ranked market results for a product, in the order the product ranks them. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId, productId } = await ctx.params;
    const results = await marketResults(actor, exporterOrgId, productId);
    return NextResponse.json(single(results), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
