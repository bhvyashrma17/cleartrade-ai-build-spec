/**
 * POST /api/v1/leads/:buyerLeadId/disqualify — AGT-04 "No fit → Disqualify with reason".
 * Thin wrapper over `assertLeadTransition(..., 'disqualified', ...)`, which already
 * requires a reason and already closes open outreach tasks as a side effect.
 */

import { BuyerLeadStage, TaskState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadLeadScoped } from '@/lib/agent-leads';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertLeadTransition } from '@/lib/state-machines/buyer-lead';
import { disqualifyLeadSchema, zodFieldErrors } from '@/lib/validators';
import { recordBuyerOutcomeTransition } from '@/lib/buyer-outcomes';

export async function POST(request: NextRequest, ctx: { params: Promise<{ buyerLeadId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { buyerLeadId } = await ctx.params;
    const lead = await loadLeadScoped(principal, buyerLeadId);

    if (!permits(principal, 'outreach.send')) throw forbidden('You cannot disqualify this lead.');

    const body = await request.json().catch(() => null);
    const parsed = disqualifyLeadSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const effects = assertLeadTransition(lead.stage, BuyerLeadStage.disqualified, {
      disqualification_reason: input.disqualification_reason,
      disqualification_reason_text: input.disqualification_reason_text,
    });

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.buyerLead.update({
        where: { id: lead.id },
        data: {
          stage: BuyerLeadStage.disqualified,
          disqualification_reason: input.disqualification_reason,
          disqualification_reason_text: input.disqualification_reason_text ?? null,
        },
      });
      await recordBuyerOutcomeTransition(tx, lead, BuyerLeadStage.disqualified, new Date(), input.disqualification_reason, undefined, principal.id);
      if (effects.close_open_outreach_tasks) {
        await tx.task.updateMany({
          where: { scope_type: 'buyer_lead', scope_id: lead.id, state: { notIn: [TaskState.done, TaskState.cancelled] } },
          data: { state: TaskState.cancelled, cancel_reason: 'Lead disqualified.' },
        });
      }
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.disqualify,
        object_type: 'buyer_lead',
        object_id: lead.id,
        exporter_org_id: lead.exporter_org_id,
        before_summary: { stage: lead.stage },
        after_summary: { stage: row.stage, reason: input.disqualification_reason },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
