/**
 * POST /api/v1/exporters/:exporterOrgId/messages — AGT-02 "Message exporter |
 * Exporter-visible thread | Visibility explicit". Not tied to any one deal or lead —
 * the account-level channel, same `Message` table as every other thread (never a
 * separate model), so it shows up on the exporter's cross-deal `/app/messages` index
 * like any other conversation.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadExporterAccountScoped } from '@/lib/agent-accounts';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { sendMessageSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { exporterOrgId } = await ctx.params;
    const { org } = await loadExporterAccountScoped(principal, exporterOrgId);
    assertCan(principal, 'message.send');

    const body = await request.json().catch(() => null);
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          thread_key: `exporter_org:${org.id}`,
          exporter_org_id: org.id,
          author_user_id: principal.id,
          body: parsed.data.body,
        },
      });

      const exporterOwner = await tx.user.findFirst({
        where: { exporter_org_id: org.id, role: 'exporter_owner', is_active: true },
        select: { id: true },
      });
      if (exporterOwner) {
        await tx.notification.upsert({
          where: { user_id_dedupe_key: { user_id: exporterOwner.id, dedupe_key: `message:${message.id}` } },
          update: { read_at: null, created_at: new Date() },
          create: {
            user_id: exporterOwner.id,
            type: 'account_message',
            title: 'New message from your agent',
            body: parsed.data.body.slice(0, 140),
            severity: 'info',
            object_type: 'exporter_org',
            object_id: org.id,
            deep_link: '/app/messages',
            dedupe_key: `message:${message.id}`,
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'message',
        object_id: message.id,
        exporter_org_id: org.id,
        after_summary: { exporter_org_id: org.id },
        correlation_id: correlationId,
      });

      return message;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
