/**
 * POST /api/v1/deals/:dealId/messages — EXP-16 "Send message".
 *
 * `Message` is structurally exporter-visible: it is a different Prisma model from
 * `InternalNote`, with no shared row and no visibility flag to get wrong (see
 * prisma/schema.prisma header rule). This route only ever writes to `Message`, so
 * whatever is sent here is, by construction, something the exporter is allowed to read
 * back — there is no code path from this handler into the internal layer.
 *
 * EXP-16-AC01: a message never carries dispute state. This handler notifies the deal's
 * agent that a message arrived and does nothing else — no severity, no status, no
 * blocker. Raising an actual issue is a completely separate object and a completely
 * separate route (`disputes/route.ts`).
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { sendMessageSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'message.send');

    const body = await request.json().catch(() => null);
    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const created = await prisma.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          thread_key: `deal:${dealId}`,
          deal_id: dealId,
          exporter_org_id: deal.exporter_org_id,
          author_user_id: principal.id,
          body: parsed.data.body,
        },
      });

      // Notify the counterpart, not the sender: an exporter sending a message notifies
      // the deal's agent; an agent/ops sender notifies the exporter owner.
      const notifyUserId = principal.role.startsWith('exporter') ? deal.owner_agent_id : null;
      const notifyExporter = !principal.role.startsWith('exporter');
      if (notifyUserId) {
        await tx.notification.upsert({
          where: { user_id_dedupe_key: { user_id: notifyUserId, dedupe_key: `message:${message.id}` } },
          update: { read_at: null, created_at: new Date() },
          create: {
            user_id: notifyUserId,
            type: 'deal_message',
            title: 'New message on a deal',
            body: parsed.data.body.slice(0, 140),
            severity: 'info',
            object_type: 'deal',
            object_id: dealId,
            deep_link: `/agent/deals/${dealId}`,
            dedupe_key: `message:${message.id}`,
          },
        });
      } else if (notifyExporter) {
        const exporterOwner = await tx.user.findFirst({
          where: { exporter_org_id: deal.exporter_org_id, role: 'exporter_owner', is_active: true },
          select: { id: true },
        });
        if (exporterOwner) {
          await tx.notification.upsert({
            where: { user_id_dedupe_key: { user_id: exporterOwner.id, dedupe_key: `message:${message.id}` } },
            update: { read_at: null, created_at: new Date() },
            create: {
              user_id: exporterOwner.id,
              type: 'deal_message',
              title: 'New message on your deal',
              body: parsed.data.body.slice(0, 140),
              severity: 'info',
              object_type: 'deal',
              object_id: dealId,
              deep_link: `/app/deals/${dealId}/support`,
              dedupe_key: `message:${message.id}`,
            },
          });
        }
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'message',
        object_id: message.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId },
        correlation_id: correlationId,
      });

      return message;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
