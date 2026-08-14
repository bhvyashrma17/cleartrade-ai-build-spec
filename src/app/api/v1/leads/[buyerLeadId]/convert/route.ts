/**
 * POST /api/v1/leads/:buyerLeadId/convert — AGT-04 "Create negotiation/deal", the one
 * write path that creates a `Deal` from a `BuyerLead`.
 *
 * AC03: conversion must retain lead history and the lead-deal relation, not fork a new
 * record. `Deal.buyer_lead_id` and `BuyerLead.deal_id` are set to each other in the
 * SAME transaction — the lead's outreach activities, notes and stage history stay on
 * the lead row exactly as they were, and the deal is a new, separate object linked to
 * it, never a copy or a replacement.
 *
 * The Deal starts at `negotiating`, not the schema default `qualifying` — the lead only
 * reaches `negotiation` stage after real back-and-forth, and starting the deal a stage
 * earlier than the conversation actually is would be a regression the exporter/agent
 * would have to manually correct.
 *
 * `assertLeadTransition` enforces that only a `negotiation`-stage lead can convert
 * (docs/07 §7.1) and that a canonical deal id is present — it is filled in from the
 * deal just created inside this same transaction, never trusted from the client.
 */

import { BuyerLeadStage, DealStage } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadLeadScoped } from '@/lib/agent-leads';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan, isAgent } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertLeadTransition } from '@/lib/state-machines/buyer-lead';
import { convertLeadSchema, zodFieldErrors } from '@/lib/validators';
import { recordBuyerOutcomeTransition } from '@/lib/buyer-outcomes';

export async function POST(request: NextRequest, ctx: { params: Promise<{ buyerLeadId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { buyerLeadId } = await ctx.params;
    const lead = await loadLeadScoped(principal, buyerLeadId);
    assertCan(principal, 'deal.create');

    const body = await request.json().catch(() => null);
    const parsed = convertLeadSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const totalAmount =
      input.quantity && input.unit_price_amount ? Number(input.quantity) * Number(input.unit_price_amount) : null;

    const result = await prisma.$transaction(async (tx) => {
      const deal = await tx.deal.create({
        data: {
          exporter_org_id: lead.exporter_org_id,
          buyer_id: lead.buyer_id,
          buyer_lead_id: lead.id,
          product_id: lead.product_id,
          stage: DealStage.negotiating,
          owner_agent_id: isAgent(principal) ? principal.id : lead.assigned_agent_id,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          unit_price_amount: input.unit_price_amount ?? null,
          unit_price_currency: input.unit_price_currency ?? null,
          total_amount: totalAmount,
          total_currency: input.unit_price_currency ?? null,
          incoterm: input.incoterm ?? null,
          incoterm_place: input.incoterm_place ?? null,
        },
      });

      // Validates the lead is at `negotiation` and that a canonical deal is present —
      // throws InvalidTransitionError otherwise, which rolls this whole transaction back.
      assertLeadTransition(lead.stage, BuyerLeadStage.converted, { deal_id: deal.id });

      const updatedLead = await tx.buyerLead.update({
        where: { id: lead.id },
        data: { stage: BuyerLeadStage.converted, deal_id: deal.id },
      });
      await recordBuyerOutcomeTransition(tx, lead, BuyerLeadStage.converted);

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'deal',
        object_id: deal.id,
        exporter_org_id: lead.exporter_org_id,
        after_summary: { buyer_lead_id: lead.id, stage: deal.stage },
        correlation_id: correlationId,
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.convert,
        object_type: 'buyer_lead',
        object_id: lead.id,
        exporter_org_id: lead.exporter_org_id,
        before_summary: { stage: lead.stage, deal_id: null },
        after_summary: { stage: updatedLead.stage, deal_id: deal.id },
        correlation_id: correlationId,
      });

      return { deal, lead: updatedLead };
    });

    return NextResponse.json(single(result), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
