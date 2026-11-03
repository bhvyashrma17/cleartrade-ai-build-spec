import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { agentCountryTruthWork } from '@/lib/country-discovery/service';
import { errorResponse, list, newCorrelationId, pageMeta } from '@/lib/errors';

/** Outstanding ClearTrade-owned Country Truth work for one exporter's products. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { exporterOrgId } = await ctx.params;
    const work = await agentCountryTruthWork(actor, exporterOrgId);
    return NextResponse.json(list(work, { ...pageMeta({ page: 1, per_page: work.length || 1, total: work.length }) }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
