/**
 * PATCH /api/v1/payouts/:payoutId — OPS-05 "Approve payout" / "Mark payout paid".
 *
 * AGT-08-AC01 ("agent cannot edit the payout calculation") is enforced twice over, and
 * the second one is the load-bearing half:
 *
 *   1. `payout.approve` is `none` for the agent role, so an agent is refused here.
 *   2. `transitionPayoutSchema` has no money fields at all. Even a finance user cannot
 *      restate an amount through this route — the frozen snapshot columns are simply not
 *      writable by any handler in the codebase. Changing what is payable requires an
 *      additive `PayoutAdjustment` (sibling route), which leaves the original readable.
 *
 * The `disputed` transition is the one exception to finance-only: an agent raising a
 * query about their own payout is the AGT-08 "Raise payout query" action, and it moves
 * state without touching a single figure. That path lives in `./query/route.ts` so this
 * handler stays unambiguously finance-write-only.
 */

import { PayoutState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertPayoutTransition } from '@/lib/state-machines/payout';
import { transitionPayoutSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ payoutId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'payout.approve');
    const { payoutId } = await ctx.params;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: { deal: { select: { exporter_org_id: true } } },
    });
    if (!payout) throw notFound('That payout is not available.');

    const body = await request.json().catch(() => null);
    const parsed = transitionPayoutSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;
    const target = input.to as PayoutState;

    const effects = assertPayoutTransition(payout.state, target, {
      payment_reference: input.payment_reference,
      dispute_reason: input.dispute_reason,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payout.update({
        where: { id: payout.id },
        data: {
          state: target,
          ...(effects.set_approved_at ? { approved_at: new Date(), approved_by_id: principal.id } : {}),
          ...(effects.set_paid_at ? { paid_at: new Date(), payment_reference: input.payment_reference } : {}),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.state_change,
        object_type: 'payout',
        object_id: payout.id,
        exporter_org_id: payout.deal.exporter_org_id,
        before_summary: { state: payout.state },
        after_summary: {
          state: row.state,
          ...(effects.set_paid_at ? { payment_reference: row.payment_reference } : {}),
          // The amount is echoed for the audit trail, never re-derived or written.
          amount: row.amount.toString(),
          currency: row.currency,
        },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
