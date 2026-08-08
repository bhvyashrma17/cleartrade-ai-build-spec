/**
 * POST /api/v1/deals/:dealId/lock — the deal lock gate (AGT-05-AC03, docs/07 §7.2).
 *
 * This route deliberately contains no lock rules of its own. It loads the facts, hands
 * them to `assertDealTransition(→ deal_locked)`, and writes the returned `DealLockPlan`
 * verbatim inside one transaction. Every prerequisite — exporter-authorized approval, a
 * complete set of terms, PI approved at the right version+checksum, a verified IEC, an
 * active fee policy — lives in `src/lib/state-machines/deal.ts` and is re-checked there,
 * so there is no way to reach `deal_locked` by asserting it was already checked.
 *
 * GET returns the same prerequisite check without writing anything, so the agent UI can
 * show exactly what is blocking the lock before anyone clicks it.
 */

import { DealStage } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { buildDealLockContext, documentRegistry } from '@/lib/commercial';
import { getConfig } from '@/lib/config';
import { errorResponse, forbidden, newCorrelationId, notFound, single, versionConflict } from '@/lib/errors';
import { assertPermitted, canReadDeal, isAgent, isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertDealTransition, collectDealLockBlockers } from '@/lib/state-machines/deal';
import { scheduleFromThreshold } from '@/lib/state-machines/task';

async function loadDeal(dealId: string) {
  const principal = await requirePrincipal();
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, exporter_org_id: true, stage: true, version: true, owner_agent_id: true, locked_at: true },
  });
  if (!deal) throw notFound('That deal is not available.');
  await assertPermitted(canReadDeal(principal, deal), 'That deal is not available.');
  return { principal, deal };
}

/** Preview the prerequisites without locking — powers the agent's "why can't I lock?" panel. */
export async function GET(_request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const { dealId } = await ctx.params;
    await loadDeal(dealId);
    const lockContext = await buildDealLockContext(dealId);
    const blockers = collectDealLockBlockers(lockContext);
    return NextResponse.json(
      single({ deal_id: dealId, can_lock: blockers.length === 0, blockers }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const { dealId } = await ctx.params;
    const { principal, deal } = await loadDeal(dealId);

    // "Lock deal | Agent/Ops per policy" (AGT-05 actions table).
    if (!isAgent(principal) && !isOps(principal)) {
      throw forbidden('Only your ClearTrade agent can lock a deal.');
    }

    const body = (await request.json().catch(() => null)) as { deal_version?: number } | null;
    if (typeof body?.deal_version === 'number' && body.deal_version !== deal.version) {
      throw versionConflict(deal.version, new Date());
    }

    const [lockContext, registry, thresholds] = await Promise.all([
      buildDealLockContext(dealId),
      documentRegistry(),
      getConfig('sla.thresholds'),
    ]);

    // The single call that validates the whole lock and returns everything it must write.
    // Throws DEAL_LOCK_PREREQUISITES_NOT_MET with a full blockers[] list — the route never
    // re-implements or short-circuits any of those checks.
    const effects = assertDealTransition(deal.stage, DealStage.deal_locked, {
      lock: { ...lockContext, locked_by_id: principal.id },
      document_registry: registry,
    });
    const plan = effects.lock_plan;
    if (!plan) throw new Error('assertDealTransition returned no lock plan for a deal_locked transition.');

    const result = await prisma.$transaction(async (tx) => {
      // Step 2 — freeze the snapshot every document will generate from.
      const snapshot = await tx.dealSnapshot.create({
        data: {
          deal_id: plan.snapshot.deal_id,
          version: plan.snapshot.version,
          buyer_id: plan.snapshot.buyer_id,
          buyer_legal_name: plan.snapshot.buyer_legal_name,
          product_id: plan.snapshot.product_id,
          product_name: plan.snapshot.product_name,
          sku: plan.snapshot.sku,
          quantity: plan.snapshot.quantity,
          unit: plan.snapshot.unit,
          unit_price_amount: plan.snapshot.unit_price_amount,
          unit_price_currency: plan.snapshot.unit_price_currency,
          total_amount: plan.snapshot.total_amount,
          total_currency: plan.snapshot.total_currency,
          incoterm: plan.snapshot.incoterm,
          incoterm_place: plan.snapshot.incoterm_place,
          payment_terms: plan.snapshot.payment_terms ?? undefined,
          ship_window_start: plan.snapshot.ship_window_start,
          ship_window_end: plan.snapshot.ship_window_end,
          special_conditions: plan.snapshot.special_conditions,
          fee_policy: plan.snapshot.fee_policy as never,
          created_by_id: principal.id,
        },
      });

      // Steps 3 & 5 & set_locked_at — fee policy frozen onto the deal, terms now read-only.
      await tx.deal.update({
        where: { id: dealId },
        data: {
          stage: DealStage.deal_locked,
          locked_at: new Date(),
          quoted_fee_policy: plan.quoted_fee_policy as never,
          version: { increment: 1 },
        },
      });

      // Step 4a — the document checklist, each row pointing at the snapshot version it
      // must generate from (docs/13 E1: never from live deal fields).
      for (const item of plan.documents) {
        await tx.document.create({
          data: {
            deal_id: item.deal_id,
            doc_type: item.doc_type,
            version: 1,
            is_current_version: true,
            source: 'generated',
            generation_status: 'queued',
            approval_status: item.approval_required ? 'pending' : 'not_required',
            filing_status: item.filing_applicable ? 'draft' : 'not_applicable',
            generated_from_snapshot_id: snapshot.id,
          },
        });
      }

      // Step 4b — execution tasks, with due dates resolved from the SLA config by key.
      for (const task of plan.tasks) {
        const threshold = thresholds[task.sla_key] ?? thresholds.default;
        const schedule = scheduleFromThreshold(threshold);
        await tx.task.create({
          data: {
            scope_type: 'deal',
            scope_id: dealId,
            deal_id: dealId,
            exporter_org_id: deal.exporter_org_id,
            title: task.title,
            description: task.description,
            owner_user_id: task.owner_role === 'agent' ? deal.owner_agent_id : null,
            owner_role: task.owner_role,
            priority: task.priority,
            due_at: schedule.due_at,
            warning_at: schedule.warning_at,
            visibility: task.visibility,
            task_type: task.task_type,
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.lock,
        object_type: 'deal',
        object_id: dealId,
        exporter_org_id: deal.exporter_org_id,
        before_summary: { stage: deal.stage },
        after_summary: {
          stage: DealStage.deal_locked,
          snapshot_version: snapshot.version,
          documents_created: plan.documents.length,
          tasks_created: plan.tasks.length,
          fee_policy_version: plan.quoted_fee_policy.version,
        },
        correlation_id: correlationId,
      });

      return { snapshot_id: snapshot.id, snapshot_version: snapshot.version };
    });

    return NextResponse.json(
      single({
        deal_id: dealId,
        stage: DealStage.deal_locked,
        snapshot_id: result.snapshot_id,
        snapshot_version: result.snapshot_version,
        documents_created: plan.documents.length,
        tasks_created: plan.tasks.length,
        enables_shipment: plan.enables_shipment,
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
