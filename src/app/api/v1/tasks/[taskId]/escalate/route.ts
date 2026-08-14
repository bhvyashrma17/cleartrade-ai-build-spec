/**
 * POST /api/v1/tasks/:taskId/escalate — AGT-07 "Escalate" quick action (AC04).
 *
 * SLA state stays a derived read (AC03): this route never writes `sla_state` directly.
 * It sets `escalated_at`, a timestamp exactly like `due_at`/`warning_at`, and
 * `deriveSlaState()` (src/lib/state-machines/task.ts) treats a non-null `escalated_at`
 * as an unconditional `escalated` read — the same "derive from a fact, not from a
 * status enum" shape as the auto-overdue path.
 *
 * Reuses `findOrCreateDispute()` for deal-scoped tasks — the same dedup helper AGT-06's
 * blocker escalation and EXP-14/EXP-15 go through — so escalating the same task twice
 * links the existing Ops case instead of opening a second one. A task with no deal_id
 * (e.g. a buyer-lead follow-up) has no dispute scope to attach to; it still escalates
 * and still surfaces in OPS-03 via `sla_state=escalated`, which `/ops/exceptions`
 * already queries for — that queue needed no changes to pick this up.
 */

import { DisputeSeverity, DisputeType, ScopeType } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { findOrCreateDispute } from '@/lib/disputes';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { canTransitionTask } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { deriveSlaState } from '@/lib/state-machines/task';
import { escalateTaskSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { taskId } = await ctx.params;

    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw notFound('That task is not available.');
    if (task.visibility === 'internal' && principal.role.startsWith('exporter')) throw notFound('That task is not available.');

    // Escalation routes a problem to Ops on ClearTrade's own side — an exporter raises
    // an issue through Support (EXP-16), not by escalating ClearTrade's internal queue.
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Raise this with your ClearTrade agent, who can escalate it to Ops.');
    }
    if (!(await canTransitionTask(principal, task))) {
      throw forbidden('You cannot escalate this task.');
    }

    const body = await request.json().catch(() => null);
    const parsed = escalateTaskSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { reason, severity } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const dispute = task.deal_id
        ? await findOrCreateDispute({
            principal,
            exporterOrgId: task.exporter_org_id ?? '',
            dealId: task.deal_id,
            scopeType: ScopeType.deal,
            type: DisputeType.other,
            severity: severity as DisputeSeverity,
            summary: `Escalated task: ${task.title} — ${reason}`,
            ownerUserId: null,
            correlationId,
            db: tx,
          })
        : null;

      const now = new Date();
      const thresholds = await getConfig('sla.thresholds');
      const row = await tx.task.update({
        where: { id: task.id },
        data: {
          escalated_at: now,
          // Preserve an existing waiting reason; only fill it if the task had none, so
          // escalating a task that's already recorded why it's stuck doesn't overwrite it.
          blocked_reason: task.blocked_reason ?? reason,
          sla_state: deriveSlaState(
            { due_at: task.due_at, warning_at: task.warning_at, state: task.state, escalated_at: now },
            thresholds.default,
          ),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.escalate,
        object_type: 'task',
        object_id: task.id,
        exporter_org_id: task.exporter_org_id ?? undefined,
        before_summary: { sla_state: task.state, escalated_at: task.escalated_at },
        after_summary: { sla_state: 'escalated', reason, dispute_id: dispute?.dispute.id ?? null },
        correlation_id: correlationId,
      });

      return { row, dispute };
    });

    return NextResponse.json(
      single({
        task: result.row,
        dispute_id: result.dispute?.dispute.id ?? null,
        dispute_created: result.dispute?.created ?? false,
        case_link: '/ops/exceptions',
      }),
      { status: 200, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
