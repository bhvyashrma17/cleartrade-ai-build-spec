/**
 * POST /api/v1/payouts/:payoutId/adjustments — OPS-05-AC03 "Adjustments are
 * additive/audited, not destructive rewrites."
 *
 * This route only ever INSERTS. It contains no `payout.update` call touching a money
 * column, which is what makes the acceptance criterion structural rather than a promise:
 * `Payout.amount` keeps saying what was originally quoted for the life of the record,
 * and the net payable is recomputed on read from the immutable base plus these rows
 * (`netPayable()` in src/lib/payouts.ts).
 *
 * A correction to a correction is likewise another row, never an edit — there is no
 * PATCH or DELETE handler here.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { netPayable } from '@/lib/payouts';
import { prisma } from '@/lib/prisma';
import { createPayoutAdjustmentSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ payoutId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'payout.adjust');
    const { payoutId } = await ctx.params;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: { deal: { select: { exporter_org_id: true } }, adjustments: true },
    });
    if (!payout) throw notFound('That payout is not available.');

    const body = await request.json().catch(() => null);
    const parsed = createPayoutAdjustmentSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const before = netPayable(payout, payout.adjustments);
    const after = netPayable(payout, [...payout.adjustments, { amount: input.amount }]);

    if (Number(after.amount) < 0) {
      throw validationError(
        [{ field: 'amount', code: 'invalid', message: `That clawback would make the net payable negative (${after.amount}).` }],
        'An adjustment cannot take the net payable below zero.',
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const adjustment = await tx.payoutAdjustment.create({
        data: {
          payout_id: payout.id,
          amount: input.amount,
          currency: payout.currency,
          reason: input.reason,
          created_by_id: principal.id,
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'payout_adjustment',
        object_id: adjustment.id,
        exporter_org_id: payout.deal.exporter_org_id,
        // The ORIGINAL quote is deliberately in the audit summary next to the delta:
        // the point of an additive adjustment is that both remain legible afterwards.
        before_summary: { payout_id: payout.id, original_amount: payout.amount.toString(), net_before: before.amount },
        after_summary: { adjustment: input.amount, net_after: after.amount, reason: input.reason },
        correlation_id: correlationId,
      });

      return adjustment;
    });

    return NextResponse.json(
      single({ adjustment: created, original_amount: payout.amount.toString(), net_payable: after }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
