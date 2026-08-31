import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { rejectMarketScan } from '@/lib/country-discovery/scan-requests';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { zodFieldErrors } from '@/lib/validators';

/** The reason is shown to the exporter verbatim, so it is required rather than optional. */
const schema = z.object({ reason: z.string().min(1).max(1000) });

export async function POST(request: NextRequest, ctx: { params: Promise<{ requestId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const actor = await requirePrincipal();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { requestId } = await ctx.params;
    const updated = await rejectMarketScan({ actor, request_id: requestId, reason: parsed.data.reason, correlation_id: correlationId });
    return NextResponse.json(single({ id: updated.id, status: updated.status, rejection_reason: updated.rejection_reason }), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
