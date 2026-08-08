/**
 * Commercial proposal versions for one deal (AGT-05 / EXP-10).
 *
 *   GET  — the full version history, newest first (AGT-05-AC04: history is preserved).
 *   POST — agent actions: `save_draft`, `propose`, `revise`.
 *   PATCH — exporter actions: `approve`, `request_changes`.
 *
 * The split is deliberate: AGT-05-AC02 says the exporter approves their own terms and the
 * agent cannot do it for them. Keeping the approving verbs on a different method with a
 * different permission check makes that boundary hard to blur later.
 */

import { DealStage, ProposalStatus, TaskPriority, TaskState, UserRole, Visibility } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { COMMERCIAL_APPROVAL_POLICY, NEGOTIABLE_STAGES } from '@/lib/commercial';
import { getConfig } from '@/lib/config';
import {
  errorResponse,
  forbidden,
  list,
  newCorrelationId,
  notFound,
  single,
  validationError,
  versionConflict,
} from '@/lib/errors';
import {
  assertPermitted,
  canApproveCommercialTerms,
  canReadDeal,
  isAgent,
  isExporter,
  isOps,
} from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { scheduleFromThreshold } from '@/lib/state-machines/task';
import { approveProposalSchema, proposalTermsSchema, requestChangesSchema, zodFieldErrors } from '@/lib/validators';

/** Load the deal and enforce tenant scope, or 404 without confirming existence. */
async function loadDeal(dealId: string, principalPromise: ReturnType<typeof requirePrincipal>) {
  const principal = await principalPromise;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    select: { id: true, exporter_org_id: true, stage: true, version: true, owner_agent_id: true, locked_at: true },
  });
  if (!deal) throw notFound('That deal is not available.');
  await assertPermitted(canReadDeal(principal, deal), 'That deal is not available.');
  return { principal, deal };
}

function termsToRow(input: ReturnType<typeof proposalTermsSchema.parse>) {
  return {
    quantity: input.quantity ?? null,
    unit: input.unit ?? null,
    unit_price_amount: input.unit_price_amount ?? null,
    unit_price_currency: input.unit_price_currency ?? null,
    total_amount: input.total_amount ?? null,
    total_currency: input.total_currency ?? null,
    incoterm: input.incoterm ?? null,
    incoterm_place: input.incoterm_place ?? null,
    payment_terms: input.payment_terms ?? undefined,
    ship_window_start: input.ship_window_start ? new Date(input.ship_window_start) : null,
    ship_window_end: input.ship_window_end ? new Date(input.ship_window_end) : null,
    special_conditions: input.special_conditions ?? null,
    agent_note: input.agent_note ?? null,
    buyer_status: input.buyer_status ?? null,
    buyer_status_note: input.buyer_status_note ?? null,
  };
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const { dealId } = await ctx.params;
    await loadDeal(dealId, requirePrincipal());

    const proposals = await prisma.dealProposal.findMany({
      where: { deal_id: dealId },
      orderBy: { version: 'desc' },
      include: {
        proposed_by: { select: { name: true } },
        approved_by: { select: { name: true } },
        changes_requested_by: { select: { name: true } },
      },
    });

    return NextResponse.json(
      list(proposals, { page: 1, per_page: proposals.length, total: proposals.length, total_pages: 1 }),
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
    const { principal, deal } = await loadDeal(dealId, requirePrincipal());

    // Agents (and Ops) author proposals. An exporter approving their own terms goes
    // through PATCH — an exporter must never be able to author the offer they approve.
    if (!isAgent(principal) && !isOps(principal)) {
      throw forbidden('Only your ClearTrade agent can prepare commercial proposals.');
    }

    const body = await request.json().catch(() => null);
    const action = (body as { action?: string } | null)?.action ?? 'save_draft';

    if (deal.locked_at || !NEGOTIABLE_STAGES.includes(deal.stage)) {
      throw forbidden('This deal is past negotiation. Locked terms change only through an amendment.');
    }

    const parsed = proposalTermsSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const terms = termsToRow(parsed.data);

    const latest = await prisma.dealProposal.findFirst({
      where: { deal_id: dealId },
      orderBy: { version: 'desc' },
    });

    let saved;

    if (action === 'save_draft' && latest?.status === ProposalStatus.draft) {
      // A draft is the ONLY mutable proposal state — editing anything else in place would
      // rewrite history the exporter may already have acted on (AGT-05-AC04).
      saved = await prisma.dealProposal.update({ where: { id: latest.id }, data: terms });
    } else {
      const nextVersion = (latest?.version ?? 0) + 1;
      const isPropose = action === 'propose' || action === 'revise';
      saved = await prisma.$transaction(async (tx) => {
        // Revising supersedes whatever was awaiting the exporter; it never edits it.
        if (isPropose && latest && latest.status === ProposalStatus.awaiting_exporter) {
          await tx.dealProposal.update({
            where: { id: latest.id },
            data: { status: ProposalStatus.superseded },
          });
        }
        const created = await tx.dealProposal.create({
          data: {
            deal_id: dealId,
            version: nextVersion,
            status: isPropose ? ProposalStatus.awaiting_exporter : ProposalStatus.draft,
            ...terms,
            proposed_by_id: isPropose ? principal.id : null,
            proposed_at: isPropose ? new Date() : null,
          },
        });

        if (isPropose) {
          // Sending for approval creates the exporter's task and notification — the
          // "who owns the next action?" rule (docs/00 §8) applied to negotiation.
          const thresholds = await getConfig('sla.thresholds');
          const schedule = scheduleFromThreshold(
            thresholds.exporter_document_approval ?? thresholds.default,
          );
          const exporterOwner = await tx.user.findFirst({
            where: { exporter_org_id: deal.exporter_org_id, role: UserRole.exporter_owner, is_active: true },
            select: { id: true },
          });
          await tx.task.create({
            data: {
              scope_type: 'deal',
              scope_id: dealId,
              deal_id: dealId,
              exporter_org_id: deal.exporter_org_id,
              title: `Review commercial terms v${nextVersion}`,
              description: 'Your agent sent revised commercial terms for your approval.',
              owner_user_id: exporterOwner?.id ?? null,
              owner_role: UserRole.exporter_owner,
              state: TaskState.not_started,
              priority: TaskPriority.high,
              due_at: schedule.due_at,
              warning_at: schedule.warning_at,
              visibility: Visibility.exporter_visible,
              task_type: 'exporter_approve_commercial_terms',
            },
          });
          if (exporterOwner) {
            // `upsert`, not `create`: Notification carries @@unique([user_id, dedupe_key])
            // precisely so a repeated event collapses onto the same row instead of
            // spamming the user. With `create` that constraint turns a duplicate
            // notification into a 500 that fails the whole surrounding transaction —
            // i.e. the dedupe mechanism would break the very action it is meant to make
            // safe to repeat.
            const proposedKey = `proposal:${dealId}:v${nextVersion}`;
            await tx.notification.upsert({
              where: { user_id_dedupe_key: { user_id: exporterOwner.id, dedupe_key: proposedKey } },
              update: { read_at: null, created_at: new Date() },
              create: {
                user_id: exporterOwner.id,
                type: 'commercial_terms_proposed',
                title: 'New commercial terms to review',
                body: `Your agent sent version ${nextVersion} of the commercial terms for approval.`,
                severity: 'action_required',
                object_type: 'deal',
                object_id: dealId,
                deep_link: `/app/deals/${dealId}/commercial`,
                dedupe_key: proposedKey,
              },
            });
          }
        }

        await writeAuditEvent({
          db: tx,
          actor: principal,
          action: isPropose ? AUDIT_ACTIONS.create : AUDIT_ACTIONS.update,
          object_type: 'deal_proposal',
          object_id: created.id,
          exporter_org_id: deal.exporter_org_id,
          after_summary: { deal_id: dealId, version: nextVersion, status: created.status },
          correlation_id: correlationId,
        });

        return created;
      });
    }

    return NextResponse.json(single(saved), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const { dealId } = await ctx.params;
    const { principal, deal } = await loadDeal(dealId, requirePrincipal());

    const body = await request.json().catch(() => null);
    const action = (body as { action?: string } | null)?.action;

    if (action === 'request_changes') {
      const parsed = requestChangesSchema.safeParse(body);
      if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
      return await handleRequestChanges({ correlationId, dealId, deal, principal, input: parsed.data });
    }

    const parsed = approveProposalSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    // AGT-05-AC02 / EXP-10-AC03. `canApproveCommercialTerms` denies the agent role
    // outright, so this is the check that makes "the agent can never self-approve" true
    // regardless of what the client sends.
    const mayApprove = await canApproveCommercialTerms(principal, deal, COMMERCIAL_APPROVAL_POLICY);
    if (!mayApprove) {
      throw forbidden(
        isAgent(principal)
          ? 'Only the exporter can approve their own commercial terms.'
          : 'Your role does not allow approving commercial terms.',
      );
    }

    // Optimistic concurrency (docs/09 §2). The client echoes back the deal version it
    // rendered; a mismatch means the terms moved under them, so 409 with the current
    // version rather than approving something they never saw.
    if (deal.version !== parsed.data.deal_version) {
      throw versionConflict(deal.version, new Date());
    }

    const proposal = await prisma.dealProposal.findUnique({
      where: { deal_id_version: { deal_id: dealId, version: parsed.data.version } },
    });
    if (!proposal) throw notFound('That proposal version is not available.');
    if (proposal.status !== ProposalStatus.awaiting_exporter) {
      throw validationError(
        [{ field: 'version', code: 'invalid', message: `Version ${proposal.version} is "${proposal.status}", not awaiting approval.` }],
        'That version is no longer the one awaiting your approval.',
      );
    }

    const approved = await prisma.$transaction(async (tx) => {
      const row = await tx.dealProposal.update({
        where: { id: proposal.id },
        data: { status: ProposalStatus.approved, approved_by_id: principal.id, approved_at: new Date() },
      });

      // Copy the approved terms onto the Deal so the pipeline/list views agree with what
      // was accepted, and advance the stage. `version` increments to invalidate any other
      // client still holding the old token.
      await tx.deal.update({
        where: { id: dealId },
        data: {
          quantity: row.quantity,
          unit: row.unit,
          unit_price_amount: row.unit_price_amount,
          unit_price_currency: row.unit_price_currency,
          total_amount: row.total_amount,
          total_currency: row.total_currency,
          value_amount: row.total_amount,
          value_currency: row.total_currency,
          incoterm: row.incoterm,
          incoterm_place: row.incoterm_place,
          payment_terms: row.payment_terms ?? undefined,
          delivery_terms: {
            ship_window_start: row.ship_window_start?.toISOString().slice(0, 10) ?? null,
            ship_window_end: row.ship_window_end?.toISOString().slice(0, 10) ?? null,
            notes: row.special_conditions,
          },
          stage: DealStage.terms_agreed,
          version: { increment: 1 },
        },
      });

      // Close the approval task this proposal created.
      await tx.task.updateMany({
        where: { deal_id: dealId, task_type: 'exporter_approve_commercial_terms', state: { notIn: [TaskState.done, TaskState.cancelled] } },
        data: { state: TaskState.done, completed_at: new Date() },
      });

      if (deal.owner_agent_id) {
        const approvedKey = `proposal-approved:${dealId}:v${row.version}`;
        await tx.notification.upsert({
          where: { user_id_dedupe_key: { user_id: deal.owner_agent_id, dedupe_key: approvedKey } },
          update: { read_at: null, created_at: new Date() },
          create: {
            user_id: deal.owner_agent_id,
            type: 'commercial_terms_approved',
            title: 'Exporter approved the commercial terms',
            body: `Version ${row.version} was approved. The deal can now be locked once its prerequisites are met.`,
            severity: 'info',
            object_type: 'deal',
            object_id: dealId,
            deep_link: `/agent/deals/${dealId}/commercial`,
            dedupe_key: approvedKey,
          },
        });
      }

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.approve,
        object_type: 'deal_proposal',
        object_id: row.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, version: row.version, approved_by: principal.id },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(approved), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

async function handleRequestChanges(args: {
  correlationId: string;
  dealId: string;
  deal: { exporter_org_id: string; version: number; owner_agent_id: string | null };
  principal: Awaited<ReturnType<typeof requirePrincipal>>;
  input: { version: number; deal_version: number; note: string };
}) {
  const { correlationId, dealId, deal, principal, input } = args;

  if (!isExporter(principal)) {
    throw forbidden('Only the exporter can request changes to their commercial terms.');
  }
  if (deal.version !== input.deal_version) throw versionConflict(deal.version, new Date());

  const proposal = await prisma.dealProposal.findUnique({
    where: { deal_id_version: { deal_id: dealId, version: input.version } },
  });
  if (!proposal) throw notFound('That proposal version is not available.');
  if (proposal.status !== ProposalStatus.awaiting_exporter) {
    throw validationError(
      [{ field: 'version', code: 'invalid', message: `Version ${proposal.version} is "${proposal.status}".` }],
      'That version is no longer awaiting your response.',
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.dealProposal.update({
      where: { id: proposal.id },
      data: {
        status: ProposalStatus.changes_requested,
        changes_requested_by_id: principal.id,
        changes_requested_at: new Date(),
        changes_requested_note: input.note,
      },
    });

    // EXP-10-AC04: requesting a revision generates an agent-visible task + notification.
    const thresholds = await getConfig('sla.thresholds');
    const schedule = scheduleFromThreshold(thresholds.default);
    await tx.task.create({
      data: {
        scope_type: 'deal',
        scope_id: dealId,
        deal_id: dealId,
        exporter_org_id: deal.exporter_org_id,
        title: `Revise commercial terms (v${row.version} changes requested)`,
        description: input.note,
        owner_user_id: deal.owner_agent_id,
        owner_role: UserRole.agent,
        state: TaskState.not_started,
        priority: TaskPriority.high,
        due_at: schedule.due_at,
        warning_at: schedule.warning_at,
        visibility: Visibility.exporter_visible,
        task_type: 'agent_revise_commercial_terms',
      },
    });
    if (deal.owner_agent_id) {
      const changesKey = `proposal-changes:${dealId}:v${row.version}`;
      await tx.notification.upsert({
        where: { user_id_dedupe_key: { user_id: deal.owner_agent_id, dedupe_key: changesKey } },
        update: { read_at: null, created_at: new Date(), body: input.note.slice(0, 240) },
        create: {
          user_id: deal.owner_agent_id,
          type: 'commercial_changes_requested',
          title: 'Exporter requested changes to the terms',
          body: input.note.slice(0, 240),
          severity: 'action_required',
          object_type: 'deal',
          object_id: dealId,
          deep_link: `/agent/deals/${dealId}/commercial`,
          dedupe_key: changesKey,
        },
      });
    }

    // The exporter's own approval task is done — the ball is with the agent now.
    await tx.task.updateMany({
      where: { deal_id: dealId, task_type: 'exporter_approve_commercial_terms', state: { notIn: [TaskState.done, TaskState.cancelled] } },
      data: { state: TaskState.done, completed_at: new Date() },
    });

    await writeAuditEvent({
      db: tx,
      actor: principal,
      action: AUDIT_ACTIONS.request_changes,
      object_type: 'deal_proposal',
      object_id: row.id,
      exporter_org_id: deal.exporter_org_id,
      after_summary: { deal_id: dealId, version: row.version, note: input.note },
      correlation_id: correlationId,
    });

    return row;
  });

  return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
}
