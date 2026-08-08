/**
 * GET /api/v1/tasks — cross-deal task index (docs/13 A1). All exporter-owned tasks
 * across deals plus enablement (readiness) tasks, in one list. P0: mobile navigation's
 * `/app/tasks` depends on this, and readiness already creates real rows so it isn't an
 * empty screen on day one.
 *
 * Internal tasks are structurally excluded — `visibility: exporter_visible` is baked
 * into the where-clause, not left to the caller, exactly like Message (docs/00 rule:
 * internal content never reaches an exporter-facing response).
 */

import { SlaState, TaskState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

const OPEN_STATES: TaskState[] = [TaskState.not_started, TaskState.in_progress, TaskState.waiting];

/**
 * Deal-scoped screens don't exist yet (docs/13 A1), so a task whose action target lives
 * inside a deal workspace has nowhere real to send the user. Only enablement (readiness)
 * and buyer-lead tasks have a live destination today — everything else deep-links to
 * `null`, and the client renders that row as non-clickable rather than a dead link.
 */
function actionHref(task: { task_type: string | null; scope_type: string }): string | null {
  if (task.task_type?.startsWith('readiness_')) return '/app/readiness';
  if (task.scope_type === 'buyer_lead') return '/app/buyers';
  return null;
}

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'task.view');

    const params = request.nextUrl.searchParams;
    const state = params.get('state');
    if (state && !Object.values(TaskState).includes(state as TaskState)) {
      throw validationError([{ field: 'state', code: 'invalid', message: `Must be one of: ${Object.values(TaskState).join(', ')}.` }]);
    }

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const where = {
      exporter_org_id: principal.exporter_org_id,
      visibility: 'exporter_visible' as const,
      ...(state ? { state: state as TaskState } : { state: { in: OPEN_STATES } }),
    };

    const [rows, total] = await Promise.all([
      prisma.task.findMany({
        where,
        include: { owner: { select: { name: true } }, deal: { select: { id: true } } },
        // Escalated/overdue first, then soonest due — same priority rule as the agent
        // and dashboard queues so "what's most urgent" reads consistently everywhere.
        orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
        skip,
        take,
      }),
      prisma.task.count({ where }),
    ]);

    const data = rows.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      state: task.state,
      priority: task.priority,
      due_at: task.due_at,
      sla_state: task.sla_state,
      blocked_reason: task.blocked_reason,
      task_type: task.task_type,
      deal_id: task.deal_id,
      owner_name: task.owner?.name ?? null,
      action_href: actionHref(task),
    }));

    return NextResponse.json(list(data, { ...pageMeta({ page, per_page, total }) }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
