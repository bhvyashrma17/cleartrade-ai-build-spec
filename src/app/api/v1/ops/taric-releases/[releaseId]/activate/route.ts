import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { activateTaricRelease } from '@/lib/market-access/taric/service';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';

/** Make an imported release the one EU evidence resolves against. */
export async function POST(_request: NextRequest, ctx: { params: Promise<{ releaseId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const { releaseId } = await ctx.params;
    const release = await activateTaricRelease({ actor, release_id: releaseId, correlation_id: correlationId });
    return NextResponse.json(single({ id: release.id, label: release.label, status: release.status, activated_at: release.activated_at }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
