/**
 * POST /api/v1/deals/:dealId/escalate — AGT-06 "Escalate blocker → Exception to Ops",
 * with the spec's own failure handling: "Dedup / open case link".
 *
 * Reuses `findOrCreateDispute()` — the same helper EXP-14's shipment issue and EXP-15's
 * payment dispute go through. That is deliberate: an escalation IS a managed case, and
 * having three routes invent three dedup rules is how you end up with three cases open
 * for one problem. The dedup key here is (deal, open status, deal-scoped), so escalating
 * the same blocker twice links the existing Ops case rather than opening a second.
 *
 * The Ops task created alongside is deduped separately on `task_type` — one open
 * remediation task per deal, matching the shipment-exception route's discipline.
 */

import { DisputeSeverity, DisputeType, ScopeType, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { findOrCreateDispute } from '@/lib/disputes';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { GATE_LABELS, type GateId } from '@/lib/execution-plan';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { escalateBlockerSchema, zodFieldErrors } from '@/lib/validators';

const OPS_ESCALATION_TASK_TYPE = 'ops_blocker_escalation';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'dispute.open');
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Raise this with your ClearTrade agent, who can escalate it to Ops.');
    }

    const body = await request.json().catch(() => null);
    const parsed = escalateBlockerSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const gateLabel = GATE_LABELS[input.gate as GateId] ?? input.gate;
    const summary = `${gateLabel} blocked: ${input.reason}`;

    const result = await prisma.$transaction(async (tx) => {
      const { dispute, created } = await findOrCreateDispute({
        principal,
        exporterOrgId: deal.exporter_org_id,
        dealId,
        scopeType: ScopeType.deal,
        type: DisputeType.other,
        severity: input.severity as DisputeSeverity,
        summary,
        ownerUserId: null,
        correlationId,
        db: tx,
      });

      const existingTask = await tx.task.findFirst({
        where: { deal_id: dealId, task_type: OPS_ESCALATION_TASK_TYPE, state: { notIn: [TaskState.done, TaskState.cancelled] } },
      });
      if (!existingTask) {
        const thresholds = await getConfig('sla.thresholds');
        const schedule = scheduleFromThreshold(thresholds.default);
        await tx.task.create({
          data: {
            scope_type: 'deal',
            scope_id: dealId,
            deal_id: dealId,
            exporter_org_id: deal.exporter_org_id,
            title: `Ops: unblock ${gateLabel.toLowerCase()}`,
            description: input.reason,
            owner_role: UserRole.ops_supervisor,
            state: TaskState.not_started,
            priority: TaskPriority.urgent,
            due_at: schedule.due_at,
            warning_at: schedule.warning_at,
            // An escalation is ClearTrade's internal remediation of its own blocker. The
            // exporter sees the RESULT (their blocked deal clears); they do not need the
            // internal escalation chatter, and docs/01 is explicit that ops-only
            // exception handling is not exporter-facing.
            visibility: Visibility.internal,
            task_type: OPS_ESCALATION_TASK_TYPE,
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.escalate,
        object_type: 'deal',
        object_id: dealId,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { gate: input.gate, dispute_id: dispute.id, dispute_created: created, reason: input.reason },
        correlation_id: correlationId,
      });

      return { dispute, created };
    });

    return NextResponse.json(
      single({
        deal_id: dealId,
        dispute_id: result.dispute.id,
        dispute_created: result.created,
        case_link: '/ops/exceptions',
      }),
      { status: 201, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
