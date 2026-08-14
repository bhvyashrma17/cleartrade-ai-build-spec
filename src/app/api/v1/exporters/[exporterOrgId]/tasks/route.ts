/**
 * POST /api/v1/exporters/:exporterOrgId/tasks — AGT-02 "Create task | Task scoped to
 * exporter/lead/deal". This is the account-level (not deal-level) scope — mirrors
 * `/api/v1/deals/:dealId/tasks`'s "Visibility explicit" rule exactly.
 */

import { TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadExporterAccountScoped } from '@/lib/agent-accounts';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getConfig } from '@/lib/config';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { createDealTaskSchema, zodFieldErrors } from '@/lib/validators';

const SLA_KEY_BY_OWNER: Record<string, string> = {
  exporter_owner: 'exporter_input_request',
  agent: 'default',
  ops_supervisor: 'default',
};

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { exporterOrgId } = await ctx.params;
    const { org } = await loadExporterAccountScoped(principal, exporterOrgId);
    assertCan(principal, 'task.transition');
    if (principal.role.startsWith('exporter')) {
      throw forbidden('Account-level tasks are created by your ClearTrade agent.');
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
          scope_type: 'exporter_org',
          scope_id: org.id,
          exporter_org_id: org.id,
          title: input.title,
          description: input.description ?? null,
          owner_user_id: input.owner_role === UserRole.agent ? org.assigned_agent_id : null,
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
        exporter_org_id: org.id,
        after_summary: { owner_role: task.owner_role, visibility: task.visibility },
        correlation_id: correlationId,
      });

      return task;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
