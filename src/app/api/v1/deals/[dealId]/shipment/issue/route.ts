/**
 * POST /api/v1/deals/:dealId/shipment/issue — EXP-14 "Raise issue" (AC04).
 *
 * Three things happen together, all deduplicated: the shipment's exception severity is
 * raised (guarded by `assertExceptionStateChange`), a case is opened via
 * `findOrCreateDispute` — which returns the EXISTING open dispute instead of a new one
 * if this shipment already has one — and the deal's risk floor is raised through the
 * same explicit domain rule the dispute route uses.
 *
 * That third step is required by docs/11 §3 ("Shipment exception | Deal risk banner
 * visible to all relevant roles"): the exception has to reach the persistent deal risk
 * banner, which reads `Deal.risk_state`, not `Shipment.exception_state`. It was missing
 * here — every existing test either hand-set `risk_state` in a fixture or opened the
 * dispute through `/disputes` (which does apply the rule), so nothing exercised the
 * shipment-exception path end to end until the cross-portal walk built a deal from
 * scratch. `applyDisputeOpenedRiskEffect` is deliberately reused rather than
 * reimplemented: it only ever RAISES risk and never overwrites a reason another rule
 * wrote, so a shipment exception cannot silently downgrade a worse existing risk.
 */

import { DisputeSeverity, DisputeType, ExceptionState, ScopeType, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { findOrCreateDispute } from '@/lib/disputes';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { applyDisputeOpenedRiskEffect } from '@/lib/state-machines/dispute';
import { assertExceptionStateChange } from '@/lib/state-machines/shipment';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { raiseShipmentIssueSchema, zodFieldErrors } from '@/lib/validators';

const SEVERITY_MAP: Record<'watch' | 'blocked', DisputeSeverity> = {
  watch: DisputeSeverity.medium,
  blocked: DisputeSeverity.high,
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'shipment.update');

    const shipment = await prisma.shipment.findFirst({ where: { deal_id: dealId } });
    if (!shipment) throw notFound('This deal has no shipment yet.');

    const body = await request.json().catch(() => null);
    const parsed = raiseShipmentIssueSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const targetState = input.severity === 'watch' ? ExceptionState.watch : ExceptionState.blocked;
    // Already at (or past) this severity — the exception is already visible; only the
    // case/task dedup matters now, not another state write.
    const alreadyRaised = shipment.exception_state !== ExceptionState.none;
    if (!alreadyRaised) {
      assertExceptionStateChange(shipment.exception_state, targetState, { reason: input.reason });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (!alreadyRaised) {
        await tx.shipment.update({
          where: { id: shipment.id },
          data: { exception_state: targetState, exception_reason: input.reason, exception_owner_id: deal.owner_agent_id },
        });
      }

      const { dispute, created: disputeCreated } = await findOrCreateDispute({
        principal,
        exporterOrgId: deal.exporter_org_id,
        dealId,
        scopeType: ScopeType.shipment,
        shipmentId: shipment.id,
        type: DisputeType.logistics,
        severity: SEVERITY_MAP[input.severity],
        summary: input.reason,
        ownerUserId: deal.owner_agent_id,
        correlationId,
        db: tx,
      });

      // docs/11 §3 row 8: the exception must reach the deal risk banner, which reads
      // `Deal.risk_state`. `loadDealScoped` does not select the risk columns, so they
      // are read here inside the same transaction as the write that depends on them.
      const riskRow = await tx.deal.findUniqueOrThrow({
        where: { id: dealId },
        select: { risk_state: true, risk_reason: true },
      });
      const riskEffect = applyDisputeOpenedRiskEffect(riskRow, {
        id: dispute.id,
        severity: SEVERITY_MAP[input.severity],
        summary: input.reason,
      });
      if (riskEffect.changed) {
        await tx.deal.update({
          where: { id: dealId },
          data: { risk_state: riskEffect.risk_state, risk_reason: riskEffect.risk_reason, version: { increment: 1 } },
        });
      }

      // AC04 also requires a managed TASK, not just a case — same dedup discipline:
      // one open remediation task per shipment exception, not one per click.
      const existingTask = await tx.task.findFirst({
        where: { deal_id: dealId, task_type: 'shipment_exception_remediation', state: { notIn: [TaskState.done, TaskState.cancelled] } },
      });
      if (!existingTask) {
        const thresholds = await getConfig('sla.thresholds');
        const schedule = scheduleFromThreshold(thresholds.shipment_exception);
        await tx.task.create({
          data: {
            scope_type: 'shipment',
            scope_id: shipment.id,
            deal_id: dealId,
            exporter_org_id: deal.exporter_org_id,
            title: 'Resolve shipment exception',
            description: input.reason,
            owner_user_id: deal.owner_agent_id,
            owner_role: UserRole.agent,
            state: TaskState.not_started,
            priority: TaskPriority.urgent,
            due_at: schedule.due_at,
            warning_at: schedule.warning_at,
            visibility: Visibility.exporter_visible,
            task_type: 'shipment_exception_remediation',
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.escalate,
        object_type: 'shipment',
        object_id: shipment.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, dispute_id: dispute.id, dispute_created: disputeCreated, reason: input.reason },
        correlation_id: correlationId,
      });

      return { dispute, disputeCreated };
    });

    return NextResponse.json(
      single({ shipment_id: shipment.id, dispute_id: result.dispute.id, dispute_created: result.disputeCreated }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
