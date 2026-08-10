/**
 * POST /api/v1/tasks/:taskId/ask-agent — EXP-03 "Ask agent".
 *
 * Writes a `Message` (thread_key `task:<id>`), the same model EXP-16's deal-scoped
 * conversation uses — a readiness task has no `deal_id`, so this thread is scoped to
 * the task instead, but it is still a `Message`, still exporter-visible-only, and still
 * shows up in the exporter's own `/app/messages` index (which already reads every
 * message for the org, not just deal-scoped ones).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { askAgentSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ taskId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'message.send');
    const orgId = principal.exporter_org_id as string;

    const { taskId } = await ctx.params;
    const task = await prisma.task.findFirst({ where: { id: taskId, exporter_org_id: orgId } });
    if (!task) throw notFound('That task is not available.');

    const body = await request.json().catch(() => null);
    const parsed = askAgentSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const org = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: orgId }, select: { assigned_agent_id: true } });

    const message = await prisma.$transaction(async (tx) => {
      const row = await tx.message.create({
        data: {
          thread_key: `task:${task.id}`,
          exporter_org_id: orgId,
          author_user_id: principal.id,
          body: `Re: ${task.title}\n\n${parsed.data.body}`,
        },
      });

      if (org.assigned_agent_id) {
        await tx.notification.upsert({
          where: { user_id_dedupe_key: { user_id: org.assigned_agent_id, dedupe_key: `message:${row.id}` } },
          update: { read_at: null, created_at: new Date() },
          create: {
            user_id: org.assigned_agent_id,
            type: 'deal_message',
            title: 'Question about a readiness task',
            body: parsed.data.body.slice(0, 140),
            severity: 'info',
            object_type: 'task',
            object_id: task.id,
            deep_link: `/agent`,
            dedupe_key: `message:${row.id}`,
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'message',
        object_id: row.id,
        exporter_org_id: orgId,
        after_summary: { task_id: task.id },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(message), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
