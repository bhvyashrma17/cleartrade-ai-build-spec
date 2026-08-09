/**
 * POST /api/v1/deals/:dealId/payment/issue — EXP-15 "Open payment dispute". Same dedup
 * discipline as the shipment issue route: `findOrCreateDispute` links the existing open
 * case for this payment instead of creating a second one.
 */

import { DisputeSeverity, DisputeType, ScopeType } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { findOrCreateDispute } from '@/lib/disputes';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { openPaymentDisputeSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'payment.update');

    const body = await request.json().catch(() => null);
    const parsed = openPaymentDisputeSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const payment = await prisma.payment.findFirst({ where: { id: parsed.data.payment_id, deal_id: dealId } });
    if (!payment) throw notFound('That payment is not available.');

    const { dispute, created } = await findOrCreateDispute({
      principal,
      exporterOrgId: deal.exporter_org_id,
      dealId,
      scopeType: ScopeType.payment,
      paymentId: payment.id,
      type: DisputeType.payment,
      severity: DisputeSeverity.high,
      summary: parsed.data.reason,
      ownerUserId: deal.owner_agent_id,
      correlationId,
    });

    return NextResponse.json(
      single({ payment_id: payment.id, dispute_id: dispute.id, dispute_created: created }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
