/**
 * POST /api/v1/leads/:buyerLeadId/activities — AGT-04 "Log outreach/reply".
 *
 * An activity plus an OPTIONAL stage move it justifies, in one call — logging that a
 * buyer replied and marking the lead `replied` are the same real-world event, and
 * splitting them into two requests would let one succeed while the other fails,
 * leaving the log and the stage disagreeing about what happened.
 *
 * `OutreachActivity.visibility` defaults to `internal` at the schema level (outreach
 * logs are not exporter-visible unless marked) — this route honours whatever the
 * caller sends, but the Zod schema's own default keeps that the safe fallback if the
 * field is omitted.
 */

import { BuyerLeadStage, OutreachActivityType, OutreachChannel, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadLeadScoped } from '@/lib/agent-leads';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, forbidden, newCorrelationId, single, validationError } from '@/lib/errors';
import { permits } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertLeadTransition } from '@/lib/state-machines/buyer-lead';
import { logOutreachActivitySchema, zodFieldErrors } from '@/lib/validators';
import { recordBuyerOutcomeTransition } from '@/lib/buyer-outcomes';

export async function POST(request: NextRequest, ctx: { params: Promise<{ buyerLeadId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { buyerLeadId } = await ctx.params;
    const lead = await loadLeadScoped(principal, buyerLeadId);

    if (!permits(principal, 'outreach.send')) throw forbidden('You cannot log outreach for this lead.');

    const body = await request.json().catch(() => null);
    const parsed = logOutreachActivitySchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    if (input.to_stage && !Object.values(BuyerLeadStage).includes(input.to_stage as BuyerLeadStage)) {
      throw validationError([{ field: 'to_stage', code: 'invalid', message: `Must be one of: ${Object.values(BuyerLeadStage).join(', ')}.` }]);
    }

    const nextActionAt = input.next_action_at ? new Date(input.next_action_at) : null;
    if (input.next_action_at && Number.isNaN(nextActionAt?.getTime())) {
      throw validationError([{ field: 'next_action_at', code: 'invalid', message: 'Must be a valid date.' }]);
    }

    const effects = input.to_stage
      ? assertLeadTransition(lead.stage, input.to_stage as BuyerLeadStage, {
          next_action: input.next_action,
          next_action_at: nextActionAt,
          interest_level: input.interest_level,
        })
      : null;

    const result = await prisma.$transaction(async (tx) => {
      const activity = await tx.outreachActivity.create({
        data: {
          buyer_lead_id: lead.id,
          actor_user_id: principal.id,
          type: input.type as OutreachActivityType,
          visibility: input.visibility as Visibility,
          outcome: input.outcome ?? null,
          summary: input.summary,
        },
      });
      const isAttempt = input.type !== 'note';
      const attemptCount = isAttempt ? await tx.outreachAttempt.count({ where: { buyer_lead_id: lead.id } }) : 0;
      const attempt = isAttempt ? await tx.outreachAttempt.create({ data: {
        buyer_lead_id: lead.id,
        actor_user_id: principal.id,
        channel: input.type as OutreachChannel,
        template_id: input.template_id ?? null,
        template_version: input.template_version ?? null,
        automation: input.automation,
        sequence_number: attemptCount + 1,
        delivery_status: input.delivery_status,
        reply_classification: input.reply_classification ?? null,
        reply_notes: input.reply_notes ?? null,
        replied_at: input.reply_classification && input.reply_classification !== 'no_response' ? new Date() : null,
      } }) : null;

      let updatedLead = null;
      if (input.to_stage && effects) {
        updatedLead = await tx.buyerLead.update({
          where: { id: lead.id },
          data: {
            stage: input.to_stage as BuyerLeadStage,
            ...(effects.set_last_contact_at ? { last_contact_at: new Date() } : {}),
            ...(input.next_action !== undefined ? { next_action: input.next_action } : {}),
            ...(nextActionAt ? { next_action_at: nextActionAt } : {}),
            ...(input.interest_level ? { interest_level: input.interest_level } : {}),
          },
        });
        await writeAuditEvent({
          db: tx,
          actor: principal,
          action: AUDIT_ACTIONS.stage_change,
          object_type: 'buyer_lead',
          object_id: lead.id,
          exporter_org_id: lead.exporter_org_id,
          before_summary: { stage: lead.stage },
          after_summary: { stage: updatedLead.stage },
          correlation_id: correlationId,
        });
        await recordBuyerOutcomeTransition(tx, lead, input.to_stage as BuyerLeadStage, new Date(), input.reply_classification ?? null, undefined, principal.id);
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'outreach_activity',
        object_id: activity.id,
        exporter_org_id: lead.exporter_org_id,
        after_summary: { buyer_lead_id: lead.id, type: activity.type, visibility: activity.visibility },
        correlation_id: correlationId,
      });

      return { activity, attempt, lead: updatedLead };
    });

    return NextResponse.json(single(result), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
