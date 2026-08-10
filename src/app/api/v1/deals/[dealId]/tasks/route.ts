/**
 * POST /api/v1/deals/:dealId/tasks — AGT-06 "Create exporter task | Visibility explicit".
 *
 * `visibility` is a required field with no default (see `createDealTaskSchema`). The
 * Prisma column defaults to `exporter_visible`, which is the right default for a column
 * but the wrong default for this endpoint: an agent jotting an internal reminder must not
 * publish it to the exporter because they omitted a field. Requiring the caller to say
 * which one they mean is the whole point of AGT-06's "Visibility explicit" rule.
 */

import { TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { createDealTaskSchema, zodFieldErrors } from '@/lib/validators';

/** Whose SLA clock applies, by who owns the work. */
const SLA_KEY_BY_OWNER: Record<string, string> = {
  exporter_owner: 'exporter_input_request',
  agent: 'default',
  ops_supervisor: 'default',
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'task.transition');
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Tasks on a deal are created by your ClearTrade agent.');
    }

    const body = await request.json().catch(() => null);
    const parsed = createDealTaskSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const thresholds = await getConfig('sla.thresholds');
    const key = SLA_KEY_BY_OWNER[input.owner_role] ?? 'default';
    const schedule = scheduleFromThreshold(thresholds[key] ?? thresholds.default);

    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          scope_type: 'deal',
          scope_id: dealId,
          deal_id: dealId,
          exporter_org_id: deal.exporter_org_id,
          title: input.title,
          description: input.description ?? null,
          // An exporter-owned task goes to the org, not to a named agent; an agent-owned
          // one goes to the deal's own agent so it lands in a real person's queue.
          owner_user_id: input.owner_role === UserRole.agent ? deal.owner_agent_id : null,
          owner_role: input.owner_role as UserRole,
          state: TaskState.not_started,
          priority: input.priority as TaskPriority,
          due_at: schedule.due_at,
          warning_at: schedule.warning_at,
          visibility: input.visibility as Visibility,
          task_type: 'agent_created',
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'task',
        object_id: task.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, owner_role: task.owner_role, visibility: task.visibility },
        correlation_id: correlationId,
      });

      return task;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
