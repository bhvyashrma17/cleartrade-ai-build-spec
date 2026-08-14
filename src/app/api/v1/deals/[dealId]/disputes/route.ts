/**
 * POST /api/v1/deals/:dealId/disputes — EXP-16 "Open dispute".
 *
 * Three things happen together, in one transaction:
 *   1. `findOrCreateDispute()` — the SAME dedup helper EXP-14/EXP-15/AGT-06 already use.
 *      "Prevent obvious duplicates / link existing" is this call, not a new rule.
 *   2. An owner task + notification, but ONLY when a new case was actually created —
 *      linking to an existing case must never re-notify or re-task its owner as if a
 *      second problem had appeared.
 *   3. `applyDisputeOpenedRiskEffect()` — the explicit domain rule (docs/07 cross-machine
 *      table) that may raise `Deal.risk_state`. Called here, by name, in this handler —
 *      never as a side effect the caller has no visibility into.
 */

import { DisputeSeverity, DisputeType, ScopeType, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { findOrCreateDispute } from '@/lib/disputes';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { triggerPayoutRecompute } from '@/lib/payouts';
import { prisma } from '@/lib/prisma';
import { applyDisputeOpenedRiskEffect } from '@/lib/state-machines/dispute';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { openDisputeSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    // Org-scoping first (loadDealScoped -> canReadDeal -> canAccessOrg): `dispute.open`
    // in the role matrix only says WHICH ROLES can open a dispute, not which tenant's
    // deals a given principal may open one against. Same two-step every other route in
    // this codebase follows.
    await loadDealScoped(principal, dealId);
    assertCan(principal, 'dispute.open');
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: dealId },
      select: { id: true, exporter_org_id: true, owner_agent_id: true, risk_state: true, risk_reason: true, version: true },
    });

    const body = await request.json().catch(() => null);
    const parsed = openDisputeSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    // Prefill context is trusted only after re-validating it actually belongs to this
    // deal — a client-supplied shipment/payment id is a hint about intent, never a bare
    // foreign key the server writes blind.
    let shipmentId: string | null = null;
    let paymentId: string | null = null;
    let scopeType: typeof ScopeType.shipment | typeof ScopeType.payment | typeof ScopeType.deal = ScopeType.deal;
    if (input.shipment_id) {
      const shipment = await prisma.shipment.findFirst({ where: { id: input.shipment_id, deal_id: dealId } });
      if (!shipment) throw validationError([{ field: 'shipment_id', code: 'invalid', message: 'That shipment is not on this deal.' }]);
      shipmentId = shipment.id;
      scopeType = ScopeType.shipment;
    } else if (input.payment_id) {
      const payment = await prisma.payment.findFirst({ where: { id: input.payment_id, deal_id: dealId } });
      if (!payment) throw validationError([{ field: 'payment_id', code: 'invalid', message: 'That payment is not on this deal.' }]);
      paymentId = payment.id;
      scopeType = ScopeType.payment;
    }

    const result = await prisma.$transaction(async (tx) => {
      const { dispute, created } = await findOrCreateDispute({
        principal,
        exporterOrgId: deal.exporter_org_id,
        dealId,
        scopeType,
        shipmentId,
        paymentId,
        type: input.type as DisputeType,
        severity: input.severity as DisputeSeverity,
        summary: input.summary,
        ownerUserId: deal.owner_agent_id,
        correlationId,
        db: tx,
      });

      if (created) {
        const thresholds = await getConfig('sla.thresholds');
        const schedule = scheduleFromThreshold(thresholds.dispute_response ?? thresholds.default);
        await tx.task.create({
          data: {
            scope_type: 'deal',
            scope_id: dealId,
            deal_id: dealId,
            exporter_org_id: deal.exporter_org_id,
            title: `Respond to case: ${input.summary.slice(0, 80)}`,
            description: input.summary,
            owner_user_id: deal.owner_agent_id,
            owner_role: deal.owner_agent_id ? UserRole.agent : UserRole.ops_supervisor,
            state: TaskState.not_started,
            priority: input.severity === 'critical' || input.severity === 'high' ? TaskPriority.urgent : TaskPriority.high,
            due_at: schedule.due_at,
            warning_at: schedule.warning_at,
            visibility: Visibility.exporter_visible,
            task_type: 'dispute_owner_response',
          },
        });

        const notifyUserId = deal.owner_agent_id;
        if (notifyUserId) {
          await tx.notification.upsert({
            where: { user_id_dedupe_key: { user_id: notifyUserId, dedupe_key: `dispute-opened:${dispute.id}` } },
            update: { read_at: null, created_at: new Date() },
            create: {
              user_id: notifyUserId,
              type: 'dispute_opened',
              title: 'New case opened',
              body: input.summary.slice(0, 140),
              severity: input.severity === 'critical' ? 'critical' : 'action_required',
              object_type: 'dispute',
              object_id: dispute.id,
              deep_link: `/agent/deals/${dealId}`,
              dedupe_key: `dispute-opened:${dispute.id}`,
            },
          });
        }

        const effect = applyDisputeOpenedRiskEffect(deal, {
          id: dispute.id,
          severity: input.severity as DisputeSeverity,
          summary: input.summary,
        });
        if (effect.changed) {
          await tx.deal.update({
            where: { id: dealId },
            data: { risk_state: effect.risk_state, risk_reason: effect.risk_reason, version: { increment: 1 } },
          });
        }

        await writeAuditEvent({
          db: tx,
          actor: principal,
          action: AUDIT_ACTIONS.escalate,
          object_type: 'dispute',
          object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          after_summary: { deal_id: dealId, type: input.type, severity: input.severity, risk_effect: effect.changed },
          correlation_id: correlationId,
        });
      }

      return { dispute, created };
    });

    // AGT-08 / OPS-05: a freshly opened dispute is a new blocker under
    // `require_no_open_dispute`, so a not-yet-eligible payout's reason needs to reflect
    // it. (Opening a dispute never un-freezes an already-eligible payout — see the
    // freeze-once guarantee in `recomputePayoutForDeal` — this only keeps the
    // `not_eligible` reason text honest while it is still `not_eligible`.)
    await triggerPayoutRecompute(dealId, correlationId);

    return NextResponse.json(
      single({ dispute_id: result.dispute.id, dispute_created: result.created, status: result.dispute.status }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
