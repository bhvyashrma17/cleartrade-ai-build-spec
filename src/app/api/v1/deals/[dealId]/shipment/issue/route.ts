/**
 * POST /api/v1/deals/:dealId/shipment/issue — EXP-14 "Raise issue" (AC04).
 *
 * Two things happen together, both deduplicated: the shipment's exception severity is
 * raised (guarded by `assertExceptionStateChange`), and a case is opened via
 * `findOrCreateDispute` — which returns the EXISTING open dispute instead of a new one
 * if this shipment already has one. Calling this twice in a row must never produce two
 * disputes.
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
