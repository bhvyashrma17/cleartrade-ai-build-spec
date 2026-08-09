/**
 * PATCH /api/v1/deals/:dealId/payment/:paymentId — EXP-15 "Update payment status" and
 * the BRC status update, on the same route but through completely separate branches.
 *
 * EXP-15-AC04 is enforced structurally by that separation: `action: 'update_brc'` never
 * touches `status`/`received_at`/`realized_at`, and `action: 'update_status'` never
 * touches `brc_status`. Neither branch's guard (`assertPaymentTransition` /
 * `assertBrcTransition`) can see or influence the other.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertBrcTransition, assertPaymentTransition } from '@/lib/state-machines/payment';
import { updateBrcStatusSchema, updatePaymentStatusSchema, zodFieldErrors } from '@/lib/validators';

async function loadPaymentScoped(dealId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, deal_id: dealId } });
  if (!payment) throw notFound('That payment is not available.');
  return payment;
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string; paymentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, paymentId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'payment.update');
    const payment = await loadPaymentScoped(dealId, paymentId);

    const body = await request.json().catch(() => null);
    const action = (body as { action?: string } | null)?.action;

    if (action === 'update_brc') {
      const parsed = updateBrcStatusSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

      assertBrcTransition(payment.brc_status, parsed.data.to);

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.payment.update({ where: { id: payment.id }, data: { brc_status: parsed.data.to } });
        await writeAuditEvent({
          db: tx,
          actor: principal,
          action: AUDIT_ACTIONS.update,
          object_type: 'payment',
          object_id: payment.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { brc_status: payment.brc_status },
          after_summary: { brc_status: row.brc_status },
          correlation_id: correlationId,
        });
        return row;
      });

      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    const parsed = updatePaymentStatusSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const effects = assertPaymentTransition(payment.status, input.to, {
      source: input.source,
      amount_received: input.amount_received ?? payment.amount_received?.toString(),
      amount: payment.amount.toString(),
      dispute_reason: input.dispute_reason,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const evidenceRefs = Array.isArray(payment.evidence_refs) ? payment.evidence_refs : [];
      const row = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: input.to,
          source: input.source,
          ...(input.amount_received !== null && input.amount_received !== undefined ? { amount_received: input.amount_received } : {}),
          ...(effects.set_received_at ? { received_at: new Date() } : {}),
          ...(effects.set_realized_at ? { realized_at: new Date() } : {}),
          ...(input.note
            ? { evidence_refs: [...evidenceRefs, { note: input.note, recorded_by: principal.id, recorded_at: new Date().toISOString() }] as never }
            : {}),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.state_change,
        object_type: 'payment',
        object_id: payment.id,
        exporter_org_id: deal.exporter_org_id,
        before_summary: { status: payment.status },
        // Provenance travels with every audit entry, not just the row — EXP-15-AC02.
        after_summary: { status: row.status, source: row.source, amount_received: row.amount_received?.toString() },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
