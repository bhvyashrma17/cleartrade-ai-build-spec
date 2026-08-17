/**
 * Buyer agent commands — canonical domain state and the audited decision layer, written
 * together or not at all.
 *
 * The rule this module enforces: **`AgentDecision` is the human-decision record, not the
 * operational source of truth.** `BuyerShortlist`, `BuyerLead.stage` and
 * `BuyerLead.disqualification_reason` remain canonical for what the system actually does.
 * Where an agent action corresponds to a real domain transition, both are written in ONE
 * transaction, so the system can never end up claiming "the agent shortlisted this buyer"
 * while the shortlist itself is empty — a contradiction that would make both records
 * untrustworthy and give the pipeline and the audit trail different answers.
 *
 * Actions fall into exactly three categories, and the category is a property of the action
 * rather than a judgement made at the call site:
 *
 *   A. DECISION / RANKING — no canonical state exists to move. Recorded in `AgentDecision`
 *      only. `promote`, `demote`, `request_review`, `qualify`, `unqualify`.
 *
 *   B. CANONICAL TRANSITION — a real domain change, written atomically with the decision.
 *      `shortlist`, `disqualify`, `restore`.
 *
 *   C. AUTOMATION — `pause_automation`, `resume_automation`. Instruction only, because
 *      nothing in the backend reads it (see `AUTOMATION_IS_ADVISORY`).
 *
 * `qualify` / `unqualify` are category A deliberately. `BuyerLeadStage` has no `qualified`
 * member; `interested` means the buyer expressed interest, which is a different fact from an
 * agent judging the buyer suitable. Inventing a canonical mapping would put a state into the
 * pipeline that no other part of the product understands, so these stay decision-only until a
 * genuine stage exists.
 */

import { AgentDecisionAction, AgentDecisionTarget, BuyerLeadStage, DisqualificationReason, Prisma } from '@prisma/client';
import { recordAgentDecision, type RecordAgentDecisionInput } from '@/lib/agent-decisions';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { createBuyerLeadCanonical } from '@/lib/buyer-leads';
import { assertLeadTransition } from '@/lib/state-machines/buyer-lead';

export type BuyerActionCategory = 'decision' | 'canonical' | 'automation';

/**
 * The category of every buyer action, and what canonical model it touches.
 *
 * Exported so the UI can label a control honestly — an agent should be able to tell, before
 * clicking, whether an action changes operational state or only records an opinion.
 */
export const BUYER_ACTION_CATEGORY: Record<string, { category: BuyerActionCategory; canonical: string | null }> = {
  [AgentDecisionAction.promote]: { category: 'decision', canonical: null },
  [AgentDecisionAction.demote]: { category: 'decision', canonical: null },
  [AgentDecisionAction.request_review]: { category: 'decision', canonical: null },
  [AgentDecisionAction.qualify]: { category: 'decision', canonical: null },
  [AgentDecisionAction.unqualify]: { category: 'decision', canonical: null },
  [AgentDecisionAction.shortlist]: { category: 'canonical', canonical: 'BuyerShortlist' },
  [AgentDecisionAction.disqualify]: { category: 'canonical', canonical: 'BuyerLead.stage' },
  [AgentDecisionAction.restore]: { category: 'canonical', canonical: 'BuyerLead.stage' },
  [AgentDecisionAction.pause_automation]: { category: 'automation', canonical: null },
  [AgentDecisionAction.resume_automation]: { category: 'automation', canonical: null },
};

/**
 * Whether an automation pause actually gates anything.
 *
 * Verified against the codebase, not assumed: nothing outside the decision layer reads
 * `AgentDecision`, so no worker, route or scheduler consults a pause. Until a real gate exists
 * this stays false and the UI describes the action as an instruction. Flipping it to true
 * without implementing the gate would tell an agent a market or buyer had stopped when it had
 * not — the most damaging thing this surface could get wrong.
 */
export const AUTOMATION_IS_ADVISORY = true;

export interface BuyerCommandInput extends Omit<RecordAgentDecisionInput, 'target' | 'action'> {
  /** Required when disqualifying — the canonical reason, not just the free-text explanation. */
  disqualificationReason?: DisqualificationReason | null;
}

export interface BuyerCommandResult {
  decisionId: string;
  category: BuyerActionCategory;
  /** What canonical state changed, for the caller to report honestly. Null for A and C. */
  canonicalChange: { model: string; from: string | null; to: string } | null;
}

/**
 * Run one buyer command.
 *
 * Single transaction, always: the decision insert, the canonical write and the audit rows
 * commit together. `recordAgentDecision` is handed the same transaction client, so its own
 * audit event and the canonical change cannot be separated either.
 */
export async function runBuyerCommand(
  action: AgentDecisionAction,
  input: BuyerCommandInput,
): Promise<BuyerCommandResult> {
  const spec = BUYER_ACTION_CATEGORY[action];
  if (!spec) {
    throw validationError([{ field: 'action', code: 'unknown', message: `Unknown buyer action "${action}".` }]);
  }

  return prisma.$transaction(async (tx) => {
    // Resolve the buyer/product/org the assessment belongs to BEFORE deciding, so a canonical
    // write can never target a different subject than the decision records.
    const assessment = await tx.buyerFitAssessment.findUnique({
      where: { id: input.subjectId },
      select: { buyer_id: true, product_id: true, exporter_org_id: true },
    });
    if (!assessment) throw notFound('Buyer fit assessment not found.');

    // Authorization, action validity, mandatory reason and the immutable snapshot all live in
    // the service — this module adds canonical state, it does not re-decide who may act.
    const decision = await recordAgentDecision(
      { ...input, target: AgentDecisionTarget.buyer, action },
      tx,
    );

    let canonicalChange: BuyerCommandResult['canonicalChange'] = null;
    if (spec.category === 'canonical') {
      canonicalChange = await applyCanonical(tx, action, assessment, input, decision.id);
    }

    return { decisionId: decision.id, category: spec.category, canonicalChange };
  });
}

type Tx = Prisma.TransactionClient;


/**
 * Assemble the inputs canonical lead creation needs, for a lead born out of a shortlist.
 *
 * The BuyerFit assessment is the decision's own subject, so it is already verified — but the
 * remaining context (product with certifications, buyer with evidence, latest market
 * assessment, latest sanctions case) has to be gathered the same way the create-lead route
 * gathers it, or the snapshot would be thinner for a shortlist-created lead than for one
 * created directly. No commercial overrides: shortlisting states no terms, so the snapshot
 * falls back to the product's own targets exactly as the route does when the caller omits them.
 */
async function createLeadForShortlist(
  tx: Tx,
  subject: { buyer_id: string; product_id: string; exporter_org_id: string },
  input: BuyerCommandInput,
) {
  const [fit, product, buyer] = await Promise.all([
    tx.buyerFitAssessment.findUniqueOrThrow({ where: { id: input.subjectId } }),
    tx.product.findUnique({ where: { id: subject.product_id }, include: { certifications: true } }),
    tx.buyer.findUnique({ where: { id: subject.buyer_id }, include: { source_evidence: true, feature_snapshot: true } }),
  ]);
  if (!product || product.exporter_org_id !== subject.exporter_org_id) {
    throw notFound('That product is not available.');
  }
  if (!buyer) throw notFound('That buyer is not available.');

  const [marketAssessment, sanctionsCase] = await Promise.all([
    tx.marketAssessment.findFirst({
      where: { product_id: subject.product_id, country_code: buyer.country_code },
      orderBy: { generated_at: 'desc' },
    }),
    tx.sanctionsScreeningCase.findFirst({ where: { buyer_id: subject.buyer_id }, orderBy: { created_at: 'desc' } }),
  ]);

  // An agent acting directly owns the lead; otherwise it follows the org's active assignment,
  // matching the route's rule rather than restating a different one.
  const assignment = await tx.agentAssignment.findFirst({
    where: { exporter_org_id: subject.exporter_org_id, status: 'active' },
    orderBy: { started_at: 'desc' },
  });

  return createBuyerLeadCanonical(tx, {
    actor: input.actor,
    exporterOrgId: subject.exporter_org_id,
    productId: subject.product_id,
    buyerId: subject.buyer_id,
    fit,
    product,
    buyer,
    marketAssessment,
    sanctionsCase,
    commercial: {},
    assignedAgentId: input.actor.role === 'agent' ? input.actor.id : (assignment?.agent_user_id ?? null),
    correlationId: input.correlationId,
  });
}

/**
 * Shortlist: two canonical concepts, moved together but not conflated.
 *
 *   `BuyerShortlist`   — selected for pursuit. Membership, always asserted.
 *   `BuyerLead.stage`  — current pipeline position. Advanced only from `new`.
 *
 * The lead stage is NOT blindly set. A lead already past `shortlisted` represents real
 * progress — a contacted or negotiating buyer must not be dragged backwards because someone
 * re-asserted the shortlist, so downstream stages are left exactly where they are. A
 * `disqualified` lead is refused outright: silently un-disqualifying by way of a shortlist
 * would bypass `restore`, which exists precisely so reopening a lead is explicit and reasoned.
 */
async function applyShortlist(
  tx: Tx,
  subject: { buyer_id: string; product_id: string; exporter_org_id: string },
  input: BuyerCommandInput,
  decisionId: string,
): Promise<BuyerCommandResult['canonicalChange']> {
  const lead = await tx.buyerLead.findFirst({
    where: {
      exporter_org_id: subject.exporter_org_id,
      buyer_id: subject.buyer_id,
      product_id: subject.product_id,
    },
    select: { id: true, stage: true },
  });
  // A buyer discovered in Buyer Discovery has never entered the pipeline, and shortlisting is
  // exactly how it enters. So a missing lead is created rather than refused — through the
  // SAME canonical creation service the POST /api/v1/buyer-leads route uses, because a lead
  // without its snapshot, opening transition and outcome row is a lead the rest of the product
  // cannot reason about.
  let created: Awaited<ReturnType<typeof createBuyerLeadCanonical>> | null = null;
  if (!lead) {
    created = await createLeadForShortlist(tx, subject, input);
  } else if (lead.stage === BuyerLeadStage.disqualified) {
    throw validationError([{
      field: 'action',
      code: 'lead_disqualified',
      message: 'This lead is disqualified. Restore it explicitly before shortlisting.',
    }]);
  }

  // Canonical creation starts a lead at `new`; the advance below moves it to `shortlisted` in
  // this same transaction, so a shortlisted buyer is never left sitting at `new`.
  const effectiveLead = lead ?? { id: created!.id, stage: created!.stage };

  // Membership is idempotent — the unique key is (org, buyer, product), so a repeat is the
  // same row and re-asserting a shortlist is not an error.
  const existing = await tx.buyerShortlist.findUnique({
    where: {
      exporter_org_id_buyer_id_product_id: {
        exporter_org_id: subject.exporter_org_id,
        buyer_id: subject.buyer_id,
        product_id: subject.product_id,
      },
    },
    select: { id: true },
  });
  if (!existing) {
    await tx.buyerShortlist.create({
      data: {
        exporter_org_id: subject.exporter_org_id,
        buyer_id: subject.buyer_id,
        product_id: subject.product_id,
        created_by_id: input.actor.id,
      },
    });
  }

  // Only `new` advances, and it advances through the shared state machine rather than by
  // assignment, so this path cannot diverge from the transition table everything else uses.
  let stageChange: { from: string; to: string } | null = null;
  if (effectiveLead.stage === BuyerLeadStage.new) {
    assertLeadTransition(effectiveLead.stage, BuyerLeadStage.shortlisted, {
      disqualification_reason: null,
      disqualification_reason_text: null,
    });
    await tx.buyerLead.update({ where: { id: effectiveLead.id }, data: { stage: BuyerLeadStage.shortlisted } });
    stageChange = { from: effectiveLead.stage, to: BuyerLeadStage.shortlisted };
  }

  const membershipFrom = existing ? 'shortlisted' : 'not_shortlisted';
  await auditCanonical(tx, input, decisionId, subject.exporter_org_id, {
    model: 'BuyerShortlist', from: membershipFrom, to: 'shortlisted',
  });
  // A stage advance is its own canonical change and gets its own audit row — a pipeline
  // transition must be visible to a pipeline audit, not buried inside a shortlist event.
  if (stageChange) {
    await auditCanonical(tx, input, decisionId, subject.exporter_org_id, {
      model: 'BuyerLead.stage', from: stageChange.from, to: stageChange.to,
    });
  }

  return {
    model: created
      ? 'BuyerShortlist + BuyerLead (created)'
      : stageChange ? 'BuyerShortlist + BuyerLead.stage' : 'BuyerShortlist',
    from: membershipFrom,
    to: stageChange ? `shortlisted (lead ${stageChange.from} -> ${stageChange.to})` : 'shortlisted',
  };
}


async function applyCanonical(
  tx: Tx,
  action: AgentDecisionAction,
  subject: { buyer_id: string; product_id: string; exporter_org_id: string },
  input: BuyerCommandInput,
  decisionId: string,
): Promise<BuyerCommandResult['canonicalChange']> {
  if (action === AgentDecisionAction.shortlist) {
    return applyShortlist(tx, subject, input, decisionId);
  }

  // disqualify / restore both move the canonical pipeline stage, which lives on BuyerLead.
  const lead = await tx.buyerLead.findFirst({
    where: {
      exporter_org_id: subject.exporter_org_id,
      buyer_id: subject.buyer_id,
      product_id: subject.product_id,
    },
    select: { id: true, stage: true },
  });
  if (!lead) {
    // No lead means there is no canonical pipeline state to move. Rather than invent one — or
    // silently record a decision that claims a transition that never happened — this fails and
    // says what is missing.
    throw validationError([{
      field: 'action',
      code: 'no_canonical_state',
      message: `This buyer has no lead for that product, so there is no pipeline state to ${action}. Create the lead first.`,
    }]);
  }

  const to = action === AgentDecisionAction.disqualify
    ? BuyerLeadStage.disqualified
    // `disqualified -> shortlisted` is the only legal way out of disqualified in the existing
    // state machine, so restore uses it rather than defining a new edge.
    : BuyerLeadStage.shortlisted;

  if (action === AgentDecisionAction.disqualify && !input.disqualificationReason) {
    throw validationError([{
      field: 'disqualification_reason',
      code: 'required',
      message: 'A canonical disqualification reason is required, alongside the decision reason.',
    }]);
  }

  // The existing state machine decides legality and side effects — this module must not
  // duplicate the transition table or it will drift from the exporter/agent routes that use it.
  assertLeadTransition(lead.stage, to, {
    disqualification_reason: input.disqualificationReason ?? null,
    disqualification_reason_text: input.reason,
  });

  await tx.buyerLead.update({
    where: { id: lead.id },
    data: {
      stage: to,
      ...(action === AgentDecisionAction.disqualify
        ? {
            disqualification_reason: input.disqualificationReason!,
            disqualification_reason_text: input.reason,
          }
        : { disqualification_reason: null, disqualification_reason_text: null }),
    },
  });

  await auditCanonical(tx, input, decisionId, subject.exporter_org_id, {
    model: 'BuyerLead.stage', from: lead.stage, to,
  });
  return { model: 'BuyerLead.stage', from: lead.stage, to };
}

/**
 * A second audit event for the canonical change.
 *
 * Separate from the decision's own `override` event on purpose: they answer different
 * questions — "who decided this" and "what state moved" — and collapsing them would make a
 * pipeline transition invisible to anyone auditing pipeline transitions. Both carry the
 * decision id so the pair is joinable.
 */
async function auditCanonical(
  tx: Tx,
  input: BuyerCommandInput,
  decisionId: string,
  orgId: string,
  change: { model: string; from: string | null; to: string },
) {
  await writeAuditEvent({
    db: tx,
    actor: input.actor,
    action: AUDIT_ACTIONS.state_change,
    object_type: change.model,
    object_id: input.subjectId,
    exporter_org_id: orgId,
    before_summary: { state: change.from },
    after_summary: { state: change.to, agent_decision_id: decisionId, reason: input.reason },
    correlation_id: input.correlationId,
  });
}

// Named commands, mirroring the market helpers in agent-decisions.ts.
export const shortlistBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.shortlist, i);
export const disqualifyBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.disqualify, i);
export const restoreBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.restore, i);
export const promoteBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.promote, i);
export const demoteBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.demote, i);
export const qualifyBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.qualify, i);
export const unqualifyBuyerCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.unqualify, i);
export const pauseBuyerAutomationCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.pause_automation, i);
export const resumeBuyerAutomationCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.resume_automation, i);
export const requestBuyerReviewCommand = (i: BuyerCommandInput) => runBuyerCommand(AgentDecisionAction.request_review, i);
