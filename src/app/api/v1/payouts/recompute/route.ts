/**
 * POST /api/v1/payouts/recompute — manual, finance-triggered fallback.
 *
 * The primary path is now event-driven: `triggerPayoutRecompute()` enqueues a
 * `payout_recompute` job from the route handlers for the events that actually change
 * eligibility (payment status — most importantly realization — and dispute open/close),
 * so recomputation normally happens off the queue within moments of the triggering
 * write, without finance needing to press anything.
 *
 * This route stays as the deliberate fallback for what the event wiring cannot cover:
 * a job that failed all its retries, a fact that changed outside those specific routes
 * (a direct DB fix, a future trigger not yet wired), or simply finance wanting to force
 * a check without waiting. It runs synchronously and inline rather than via the job
 * queue — appropriate for an explicit, low-frequency admin action, unlike the
 * high-frequency automatic path.
 *
 * `recomputePayoutForDeal()` is idempotent and never rewrites a frozen snapshot, so
 * calling this repeatedly — or racing it against the automatic job — is safe by
 * construction — the guarantee lives in the helper, not in this route remembering to be
 * careful.
 */

import { DealStage } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';
import { recomputePayoutForDeal } from '@/lib/payouts';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const TRACKED: DealStage[] = [DealStage.deal_locked, DealStage.executing, DealStage.shipped, DealStage.closed_won];

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'payout.approve');

    const body = (await request.json().catch(() => null)) as { deal_id?: string } | null;

    const deals = body?.deal_id
      ? [{ id: body.deal_id }]
      : await prisma.deal.findMany({
          where: { stage: { in: TRACKED }, owner_agent_id: { not: null } },
          select: { id: true },
        });

    const results = [];
    for (const deal of deals) {
      results.push(await recomputePayoutForDeal(deal.id, principal, correlationId));
    }

    return NextResponse.json(
      single({
        deals_examined: deals.length,
        became_eligible: results.filter((r) => r.became_eligible).length,
        created: results.filter((r) => r.created).length,
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
