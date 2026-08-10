/**
 * PATCH /api/v1/deals/:dealId/disputes/:disputeId — OPS-06 + EXP-16 case actions,
 * action-dispatched like the documents/payment routes: `assign`, `wait_external`,
 * `propose_resolution`, `accept` (exporter), `close` (Ops), `reopen`.
 *
 * Every transition goes through `assertDisputeTransition()` — the same guarded machine
 * whichever action reaches it, so "propose a resolution" and "accept it" cannot disagree
 * about what states exist or what data each one requires. Every DB write happens inside
 * exactly one `$transaction` per request — a multi-hop action (accept, and Ops closing
 * straight from `proposed_resolution`) asserts every hop it needs BEFORE writing anything,
 * so a guard failure on hop two never leaves hop one's write committed alone.
 *
 * `accept` is the round-trip's last hop and does two hops in one call, per EXP-16's own
 * action table ("Mark resolution accepted and close, as policy"): `proposed_resolution ->
 * resolved -> closed`, then calls `applyDisputeClosedRiskEffect()` explicitly — the "risk
 * cleared only via explicit domain rule" requirement from docs/07's cross-machine table,
 * not a side effect of the status write.
 */

import { DisputeStatus } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { DISPUTE_ACCEPTANCE_POLICY, OPEN_DISPUTE_STATUSES } from '@/lib/disputes';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, canAcceptDisputeResolution } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { applyDisputeClosedRiskEffect, assertDisputeTransition } from '@/lib/state-machines/dispute';
import {
  acceptResolutionSchema,
  assignDisputeSchema,
  closeDisputeSchema,
  proposeResolutionDisputeSchema,
  reopenDisputeSchema,
  waitExternalDisputeSchema,
  zodFieldErrors,
} from '@/lib/validators';

async function loadDisputeScoped(dealId: string, disputeId: string) {
  const dispute = await prisma.dispute.findFirst({ where: { id: disputeId, deal_id: dealId } });
  if (!dispute) throw notFound('That case is not available.');
  return dispute;
}

/** Recompute and, if changed, write the risk effect of this dispute reaching `closed`. */
async function applyClosureRiskEffect(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  dealId: string,
  disputeId: string,
): Promise<boolean> {
  const dealFull = await tx.deal.findUniqueOrThrow({ where: { id: dealId }, select: { risk_state: true, risk_reason: true } });
  const remaining = await tx.dispute.findMany({
    where: { deal_id: dealId, status: { in: OPEN_DISPUTE_STATUSES }, id: { not: disputeId } },
    select: { id: true, severity: true, summary: true },
  });
  const effect = applyDisputeClosedRiskEffect(dealFull, { id: disputeId }, remaining);
  if (effect.changed) {
    await tx.deal.update({
      where: { id: dealId },
      data: { risk_state: effect.risk_state, risk_reason: effect.risk_reason, version: { increment: 1 } },
    });
  }
  return effect.changed;
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ dealId: string; disputeId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, disputeId } = await ctx.params;
    await loadDealScoped(principal, dealId);
    const dispute = await loadDisputeScoped(dealId, disputeId);
    return NextResponse.json(single(dispute), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string; disputeId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, disputeId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    const dispute = await loadDisputeScoped(dealId, disputeId);

    const body = await request.json().catch(() => null);
    const action = (body as { action?: string } | null)?.action;
    const isExporter = principal.role.startsWith('exporter');

    // ---- Exporter: accept a proposed resolution (closes the case in the same call) ----
    if (action === 'accept') {
      const parsed = acceptResolutionSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

      if (!(await canAcceptDisputeResolution(principal, { exporter_org_id: deal.exporter_org_id }, DISPUTE_ACCEPTANCE_POLICY))) {
        throw forbidden('Only an authorized exporter user can accept this resolution.');
      }

      // Both hops asserted before anything is written — a dispute that isn't at
      // `proposed_resolution` (a stale page, a double-click) is refused up front.
      assertDisputeTransition(dispute.status, DisputeStatus.resolved, { accepted: true, closure_basis: 'exporter_accepted' });
      assertDisputeTransition(DisputeStatus.resolved, DisputeStatus.closed, {
        closure_summary: 'Exporter accepted the proposed resolution.',
      });

      const updated = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const row = await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: DisputeStatus.closed, accepted_at: now, closed_at: now, closure_basis: 'exporter_accepted' },
        });
        const riskChanged = await applyClosureRiskEffect(tx, dealId, dispute.id);
        await writeAuditEvent({
          db: tx,
          actor: principal,
          action: AUDIT_ACTIONS.state_change,
          object_type: 'dispute',
          object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { status: dispute.status },
          after_summary: { status: row.status, accepted_at: row.accepted_at, risk_effect: riskChanged },
          correlation_id: correlationId,
        });
        return row;
      });

      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    // Every other action is Ops/agent case management — an exporter has no capability
    // for it at all (EXP-16 gives the exporter exactly two dispute actions: open, accept).
    if (isExporter) {
      throw forbidden('Case management is handled by your ClearTrade agent and Ops.');
    }
    assertCan(principal, 'dispute.resolve');

    if (action === 'assign') {
      const parsed = assignDisputeSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
      const owner = await prisma.user.findFirst({
        where: { id: parsed.data.owner_user_id, is_active: true, role: { in: ['agent', 'ops_supervisor', 'ops_finance'] } },
      });
      if (!owner) {
        throw validationError([{ field: 'owner_user_id', code: 'invalid', message: 'That user is not an active agent or Ops account.' }]);
      }
      assertDisputeTransition(dispute.status, DisputeStatus.investigating, { owner_user_id: owner.id });

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: DisputeStatus.investigating, owner_user_id: owner.id },
        });
        await writeAuditEvent({
          db: tx, actor: principal, action: AUDIT_ACTIONS.state_change, object_type: 'dispute', object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { status: dispute.status, owner_user_id: dispute.owner_user_id },
          after_summary: { status: row.status, owner_user_id: row.owner_user_id },
          correlation_id: correlationId,
        });
        return row;
      });
      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    if (action === 'wait_external') {
      const parsed = waitExternalDisputeSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
      const followUp = new Date(parsed.data.follow_up_at);
      assertDisputeTransition(dispute.status, DisputeStatus.waiting_external, { waiting_on: parsed.data.waiting_on, follow_up_at: followUp });

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: DisputeStatus.waiting_external, waiting_on: parsed.data.waiting_on, sla_due_at: followUp },
        });
        await writeAuditEvent({
          db: tx, actor: principal, action: AUDIT_ACTIONS.state_change, object_type: 'dispute', object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { status: dispute.status },
          after_summary: { status: row.status, waiting_on: row.waiting_on },
          correlation_id: correlationId,
        });
        return row;
      });
      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    if (action === 'propose_resolution') {
      const parsed = proposeResolutionDisputeSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
      assertDisputeTransition(dispute.status, DisputeStatus.proposed_resolution, { resolution: parsed.data.resolution });

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: DisputeStatus.proposed_resolution, resolution: parsed.data.resolution },
        });
        // Exporter-visible: they need to see a proposal exists to act on it.
        const exporterOwner = await tx.user.findFirst({
          where: { exporter_org_id: deal.exporter_org_id, role: 'exporter_owner', is_active: true },
          select: { id: true },
        });
        if (exporterOwner) {
          await tx.notification.upsert({
            where: { user_id_dedupe_key: { user_id: exporterOwner.id, dedupe_key: `dispute-proposed:${dispute.id}` } },
            update: { read_at: null, created_at: new Date() },
            create: {
              user_id: exporterOwner.id,
              type: 'dispute_resolution_proposed',
              title: 'A resolution has been proposed',
              body: parsed.data.resolution.slice(0, 140),
              severity: 'action_required',
              object_type: 'dispute',
              object_id: dispute.id,
              deep_link: `/app/deals/${dealId}/support`,
              dedupe_key: `dispute-proposed:${dispute.id}`,
            },
          });
        }
        await writeAuditEvent({
          db: tx, actor: principal, action: AUDIT_ACTIONS.state_change, object_type: 'dispute', object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { status: dispute.status },
          after_summary: { status: row.status },
          correlation_id: correlationId,
        });
        return row;
      });
      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    if (action === 'close') {
      const parsed = closeDisputeSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

      // Ops may close directly from `proposed_resolution` (skipping exporter
      // acceptance, on a recorded authority basis) or from an already-`resolved` case.
      // Both hops are asserted up front so a guard failure never leaves a half-applied
      // resolve-then-fail-to-close state.
      if (dispute.status === DisputeStatus.resolved) {
        assertDisputeTransition(DisputeStatus.resolved, DisputeStatus.closed, { closure_summary: parsed.data.closure_summary });
      } else {
        assertDisputeTransition(dispute.status, DisputeStatus.resolved, { closure_basis: parsed.data.closure_basis });
        assertDisputeTransition(DisputeStatus.resolved, DisputeStatus.closed, { closure_summary: parsed.data.closure_summary });
      }

      const updated = await prisma.$transaction(async (tx) => {
        const now = new Date();
        const row = await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: DisputeStatus.closed, closed_at: now, closure_basis: parsed.data.closure_basis, resolution: dispute.resolution ?? parsed.data.closure_summary },
        });
        const riskChanged = await applyClosureRiskEffect(tx, dealId, dispute.id);
        await writeAuditEvent({
          db: tx, actor: principal, action: AUDIT_ACTIONS.state_change, object_type: 'dispute', object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { status: dispute.status },
          after_summary: { status: row.status, closure_basis: row.closure_basis, risk_effect: riskChanged },
          correlation_id: correlationId,
        });
        return row;
      });
      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    if (action === 'reopen') {
      const parsed = reopenDisputeSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
      assertDisputeTransition(dispute.status, DisputeStatus.investigating, { reopen_reason: parsed.data.reopen_reason });

      const updated = await prisma.$transaction(async (tx) => {
        const row = await tx.dispute.update({
          where: { id: dispute.id },
          data: { status: DisputeStatus.investigating, closed_at: null },
        });
        await writeAuditEvent({
          db: tx, actor: principal, action: AUDIT_ACTIONS.state_change, object_type: 'dispute', object_id: dispute.id,
          exporter_org_id: deal.exporter_org_id,
          before_summary: { status: dispute.status },
          after_summary: { status: row.status, reopen_reason: parsed.data.reopen_reason },
          correlation_id: correlationId,
        });
        return row;
      });
      return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
    }

    throw validationError([{ field: 'action', code: 'invalid', message: 'Unknown action.' }]);
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
