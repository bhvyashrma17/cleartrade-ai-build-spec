/**
 * POST /api/v1/payouts/:payoutId/query — AGT-08 "Raise payout query | Agent | Create
 * finance query/case | Track status".
 *
 * The single write an agent has on their own payout, and it deliberately changes no
 * money: it moves state to `disputed` and opens a `Dispute` case for finance to work.
 * Authorization is `canViewPayout` (the `restricted` grant scopes an agent to their own
 * rows) — an agent cannot raise a query against someone else's payout, and holding
 * `payout.view` still confers no ability to approve, pay, or adjust.
 *
 * Reuses `findOrCreateDispute()` so raising the same query twice links the open case
 * instead of opening a second, exactly like every other escalation path in the product.
 */

import { DisputeSeverity, DisputeType, PayoutState, ScopeType } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { findOrCreateDispute } from '@/lib/disputes';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canViewPayout } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertPayoutTransition } from '@/lib/state-machines/payout';
import { raisePayoutQuerySchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ payoutId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { payoutId } = await ctx.params;

    const payout = await prisma.payout.findUnique({
      where: { id: payoutId },
      include: { deal: { select: { id: true, exporter_org_id: true } } },
    });
    if (!payout) throw notFound('That payout is not available.');
    if (!canViewPayout(principal, payout)) throw notFound('That payout is not available.');
    if (payout.state === PayoutState.not_eligible) {
      throw forbidden('This payout is not eligible yet — there is no calculation to query.');
    }

    const body = await request.json().catch(() => null);
    const parsed = raisePayoutQuerySchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { reason } = parsed.data;

    assertPayoutTransition(payout.state, PayoutState.disputed, { dispute_reason: reason });

    const result = await prisma.$transaction(async (tx) => {
      const { dispute, created } = await findOrCreateDispute({
        principal,
        exporterOrgId: payout.deal.exporter_org_id,
        dealId: payout.deal.id,
        scopeType: ScopeType.deal,
        type: DisputeType.payment,
        severity: DisputeSeverity.medium,
        summary: `Agent payout query: ${reason}`,
        ownerUserId: null,
        correlationId,
        db: tx,
      });

      const row = await tx.payout.update({
        where: { id: payout.id },
        data: { state: PayoutState.disputed, dispute_id: dispute.id },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.state_change,
        object_type: 'payout',
        object_id: payout.id,
        exporter_org_id: payout.deal.exporter_org_id,
        before_summary: { state: payout.state },
        after_summary: { state: row.state, dispute_id: dispute.id, reason },
        correlation_id: correlationId,
      });

      return { payout: row, dispute, created };
    });

    return NextResponse.json(
      single({ payout: result.payout, dispute_id: result.dispute.id, dispute_created: result.created }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
