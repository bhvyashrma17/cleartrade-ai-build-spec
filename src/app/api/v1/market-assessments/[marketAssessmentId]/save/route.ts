/**
 * POST /api/v1/market-assessments/:id/save — "Save market" (docs/04 EXP-04).
 *
 * A lightweight, non-exclusive bookmark, independent of `select`. Idempotent per the
 * spec: setting `saved: true` twice is a no-op the second time, not an error.
 *
 * A MarketAssessment has no `exporter_org_id` column of its own — tenancy is reached
 * through its parent DiscoveryRun, so the scope check joins through that relation rather
 * than trusting the id in the URL.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, tenantScopeVia } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { zodFieldErrors } from '@/lib/validators';

const bodySchema = z.object({ saved: z.boolean() });

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ marketAssessmentId: string }> },
) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'market_assessment.save');

    const { marketAssessmentId } = await context.params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return errorResponse(validationError(zodFieldErrors(parsed.error)), correlationId);

    // Reached through the parent DiscoveryRun — a MarketAssessment carries no
    // exporter_org_id of its own, so tenancy is enforced via the relation.
    const scope = await tenantScopeVia(principal, 'run');
    const assessment = await prisma.marketAssessment.findFirst({
      where: { id: marketAssessmentId, ...scope },
      select: { id: true, saved_at: true },
    });
    if (!assessment) throw notFound('That market is not available.');

    const updated = await prisma.marketAssessment.update({
      where: { id: assessment.id },
      data: { saved_at: parsed.data.saved ? new Date() : null },
      select: { id: true, saved_at: true },
    });

    return NextResponse.json(
      single({ id: updated.id, saved: updated.saved_at !== null }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
