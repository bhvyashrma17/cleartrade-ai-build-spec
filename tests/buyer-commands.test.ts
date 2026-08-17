import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { BuyerLeadStage, DisqualificationReason, OrgTier, UserRole } from '@prisma/client';
import {
  AUTOMATION_IS_ADVISORY,
  BUYER_ACTION_CATEGORY,
  disqualifyBuyerCommand,
  pauseBuyerAutomationCommand,
  promoteBuyerCommand,
  qualifyBuyerCommand,
  restoreBuyerCommand,
  shortlistBuyerCommand,
} from '../src/lib/buyer-commands';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

async function fixture(opts: { withLead?: boolean; leadStage?: BuyerLeadStage } = {}) {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({
    data: { display_name: `Cmd Org ${s}`, tier: OrgTier.paid }, select: { id: true },
  });
  const [agentUser, strangerUser] = await Promise.all([
    prisma.user.create({ data: { email: `c-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `c2-${s}@t.test`, name: 'Stranger', role: UserRole.agent }, select: { id: true } }),
  ]);
  await prisma.agentAssignment.create({
    data: { exporter_org_id: org.id, agent_user_id: agentUser.id, status: 'active' },
  });
  const product = await prisma.product.create({
    data: { exporter_org_id: org.id, name: `Product ${s}` }, select: { id: true },
  });
  const buyer = await prisma.buyer.create({
    data: { legal_name: `Buyer ${s}`, display_name: `Buyer ${s}`, country_code: 'DE', buyer_type: 'importer' },
    select: { id: true },
  });
  const fit = await prisma.buyerFitAssessment.create({
    data: {
      buyer_id: buyer.id, product_id: product.id, exporter_org_id: org.id,
      score: 74, confidence_score: 66,
      components: { volume_fit: 80, price_fit: 60, certification_fit: 55, outcome_prior: 70 },
      input_snapshot: { product_id: product.id, hs_code: '091030', rows: ['rec-1', 'rec-2'] },
      model_version: 'buyerfit-v2', evidence_origins: ['imported_real'],
    },
    select: { id: true },
  });
  const lead = opts.withLead
    ? await prisma.buyerLead.create({
        data: {
          exporter_org_id: org.id, buyer_id: buyer.id, product_id: product.id,
          stage: opts.leadStage ?? BuyerLeadStage.new,
        },
        select: { id: true, stage: true },
      })
    : null;

  const principal = (id: string): Principal => ({
    id, email: 'x@t.test', name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid,
  });
  return {
    orgId: org.id, buyerId: buyer.id, productId: product.id, fitId: fit.id, leadId: lead?.id ?? null,
    agent: principal(agentUser.id), stranger: principal(strangerUser.id),
  };
}

const base = (f: Awaited<ReturnType<typeof fixture>>) => ({
  actor: f.agent, subjectId: f.fitId,
  reason: 'Confirmed fit on a buyer call.', correlationId: randomUUID(),
});

describe('action classification is explicit', () => {
  test('every buyer action is classified into exactly one category', () => {
    const buyerActions = [
      'promote', 'demote', 'restore', 'pause_automation', 'resume_automation',
      'request_review', 'shortlist', 'disqualify', 'qualify', 'unqualify',
    ];
    for (const action of buyerActions) {
      expect(BUYER_ACTION_CATEGORY[action], action).toBeDefined();
      expect(['decision', 'canonical', 'automation']).toContain(BUYER_ACTION_CATEGORY[action]!.category);
    }
  });

  test('canonical actions name the model they move; decision-only actions name none', () => {
    expect(BUYER_ACTION_CATEGORY.shortlist).toEqual({ category: 'canonical', canonical: 'BuyerShortlist' });
    expect(BUYER_ACTION_CATEGORY.disqualify).toEqual({ category: 'canonical', canonical: 'BuyerLead.stage' });
    expect(BUYER_ACTION_CATEGORY.restore).toEqual({ category: 'canonical', canonical: 'BuyerLead.stage' });
    // qualify/unqualify have no canonical mapping: BuyerLeadStage has no `qualified` member,
    // and `interested` means the BUYER expressed interest, which is a different fact.
    expect(BUYER_ACTION_CATEGORY.qualify).toEqual({ category: 'decision', canonical: null });
    expect(BUYER_ACTION_CATEGORY.unqualify).toEqual({ category: 'decision', canonical: null });
    expect(BUYER_ACTION_CATEGORY.promote.canonical).toBeNull();
  });

  test('automation is advertised as advisory while nothing reads it', () => {
    // Guards the honesty claim in the UI: if a real gate is ever implemented this flips, and
    // this test is the reminder that the copy must change with it.
    expect(AUTOMATION_IS_ADVISORY).toBe(true);
    expect(BUYER_ACTION_CATEGORY.pause_automation.category).toBe('automation');
    expect(BUYER_ACTION_CATEGORY.pause_automation.canonical).toBeNull();
  });
});

describe('the explainable buyer snapshot is captured, not referenced', () => {
  test('a buyer decision freezes components, input snapshot, hash, computed_at and origins', async () => {
    const f = await fixture();
    const result = await promoteBuyerCommand({ ...base(f), agentPriority: 1 });
    const decision = await prisma.agentDecision.findUniqueOrThrow({ where: { id: result.decisionId } });

    expect(decision.original_score).toBe(74);
    expect(decision.original_confidence_score).toBe(66);
    expect(decision.original_model_version).toBe('buyerfit-v2');
    expect(decision.original_components).toEqual({
      volume_fit: 80, price_fit: 60, certification_fit: 55, outcome_prior: 70,
    });
    expect(decision.original_input_snapshot).toMatchObject({ hs_code: '091030', rows: ['rec-1', 'rec-2'] });
    expect(decision.original_input_snapshot_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(decision.original_computed_at).toBeInstanceOf(Date);
    expect(decision.original_evidence_origins).toEqual(['imported_real']);
  });

  test('a recompute overwrites the assessment but cannot touch the frozen snapshot', async () => {
    const f = await fixture();
    const result = await promoteBuyerCommand({ ...base(f), agentPriority: 1 });

    // Exactly what buyer-intelligence.ts does on the next run: upsert over the same row.
    await prisma.buyerFitAssessment.update({
      where: { id: f.fitId },
      data: {
        score: 12, confidence_score: 9,
        components: { volume_fit: 5 },
        input_snapshot: { product_id: f.productId, hs_code: '999999', rows: [] },
        model_version: 'buyerfit-v3',
      },
    });

    const decision = await prisma.agentDecision.findUniqueOrThrow({ where: { id: result.decisionId } });
    // The FK now points at numbers that did not exist at decision time; these columns are the
    // only surviving record of what the agent actually overruled.
    expect(decision.original_score).toBe(74);
    expect(decision.original_components).toEqual({
      volume_fit: 80, price_fit: 60, certification_fit: 55, outcome_prior: 70,
    });
    expect(decision.original_model_version).toBe('buyerfit-v2');
  });

  test('the decision chain survives a recompute and stays attached to the same subject', async () => {
    const f = await fixture();
    await promoteBuyerCommand({ ...base(f), agentPriority: 1 });
    await prisma.buyerFitAssessment.update({ where: { id: f.fitId }, data: { score: 30 } });
    const second = await qualifyBuyerCommand({ ...base(f) });

    const chain = await prisma.agentDecision.findMany({
      where: { buyer_fit_assessment_id: f.fitId }, orderBy: { created_at: 'asc' },
    });
    expect(chain).toHaveLength(2);
    // A buyer is a durable subject: recomputation does not fork or orphan the chain.
    expect(chain[1]!.id).toBe(second.decisionId);
    expect(chain[1]!.supersedes_id).toBe(chain[0]!.id);
    // And each decision carries the score as it was at ITS OWN decision time.
    expect(chain[0]!.original_score).toBe(74);
    expect(chain[1]!.original_score).toBe(30);
  });

  test('the database refuses a buyer decision with no explainable snapshot', async () => {
    const f = await fixture();
    // Bypassing the service entirely: the constraint is what makes the snapshot guaranteed,
    // because a buyer row missing it is permanently unexplainable.
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision"
         ("id","exporter_org_id","actor_user_id","buyer_fit_assessment_id","target","action","reason","created_at")
       VALUES ($1,$2,$3,$4,'buyer','qualify','no snapshot', NOW())`,
      randomUUID(), f.orgId, f.agent.id, f.fitId,
    )).rejects.toThrow(/AgentDecision_buyer_snapshot_required/);
  });
});

describe('canonical state and AgentDecision cannot diverge', () => {
  test('shortlist writes BOTH the decision and the canonical BuyerShortlist', async () => {
    const f = await fixture();
    const result = await shortlistBuyerCommand({ ...base(f), agentPriority: 1 });

    expect(result.category).toBe('canonical');
    expect(result.canonicalChange).toEqual({ model: 'BuyerShortlist', from: 'not_shortlisted', to: 'shortlisted' });

    const shortlist = await prisma.buyerShortlist.findUnique({
      where: {
        exporter_org_id_buyer_id_product_id: {
          exporter_org_id: f.orgId, buyer_id: f.buyerId, product_id: f.productId,
        },
      },
    });
    // The contradiction this whole module exists to prevent.
    expect(shortlist).not.toBeNull();
    expect(shortlist!.created_by_id).toBe(f.agent.id);
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId, action: 'shortlist' } })).toBe(1);
  });

  test('shortlisting twice is idempotent and does not duplicate canonical state', async () => {
    const f = await fixture();
    await shortlistBuyerCommand({ ...base(f), agentPriority: 1 });
    const second = await shortlistBuyerCommand({ ...base(f), agentPriority: 2 });
    expect(second.canonicalChange?.from).toBe('shortlisted');
    expect(await prisma.buyerShortlist.count({ where: { exporter_org_id: f.orgId, buyer_id: f.buyerId } })).toBe(1);
    // Two decisions, one canonical row — the decision layer is the history, not the state.
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(2);
  });

  test('disqualify moves the canonical lead stage and records the canonical reason', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.contacted });
    const result = await disqualifyBuyerCommand({
      ...base(f), disqualificationReason: DisqualificationReason.volume_too_small,
    });

    expect(result.canonicalChange).toEqual({ model: 'BuyerLead.stage', from: 'contacted', to: 'disqualified' });
    const lead = await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } });
    expect(lead.stage).toBe(BuyerLeadStage.disqualified);
    // Canonical enum reason AND the human explanation are both kept — they answer different
    // questions and one is not a substitute for the other.
    expect(lead.disqualification_reason).toBe(DisqualificationReason.volume_too_small);
    expect(lead.disqualification_reason_text).toBe(base(f).reason);
  });

  test('disqualify without a canonical reason writes NOTHING — not even the decision', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.contacted });
    await expect(disqualifyBuyerCommand({ ...base(f) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // The transaction rolled back, so there is no decision claiming a transition that never
    // happened. This is the divergence case that matters most.
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(0);
    const lead = await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } });
    expect(lead.stage).toBe(BuyerLeadStage.contacted);
  });

  test('restore returns the canonical stage and clears the disqualification reason', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.contacted });
    await disqualifyBuyerCommand({ ...base(f), disqualificationReason: DisqualificationReason.no_response });
    const result = await restoreBuyerCommand({ ...base(f), reason: 'Buyer replied after all.' });

    expect(result.canonicalChange).toEqual({ model: 'BuyerLead.stage', from: 'disqualified', to: 'shortlisted' });
    const lead = await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } });
    expect(lead.stage).toBe(BuyerLeadStage.shortlisted);
    expect(lead.disqualification_reason).toBeNull();
    expect(lead.disqualification_reason_text).toBeNull();
  });

  test('an illegal canonical transition rolls back the decision too', async () => {
    // `converted` has no edge to `shortlisted`, so restore must be refused by the existing
    // state machine rather than forced through by this module.
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.converted });
    await expect(restoreBuyerCommand({ ...base(f) })).rejects.toThrow();
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(0);
    expect((await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } })).stage).toBe(BuyerLeadStage.converted);
  });

  test('a canonical action with no lead is refused rather than inventing pipeline state', async () => {
    const f = await fixture({ withLead: false });
    await expect(disqualifyBuyerCommand({
      ...base(f), disqualificationReason: DisqualificationReason.no_response,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(0);
  });

  test('an unassigned agent changes neither the decision layer nor canonical state', async () => {
    const f = await fixture({ withLead: true });
    await expect(shortlistBuyerCommand({ ...base(f), actor: f.stranger })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(0);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(0);
  });

  test('decision-only actions leave every canonical model untouched', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.contacted });
    const before = await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } });

    await promoteBuyerCommand({ ...base(f), agentPriority: 1 });
    await qualifyBuyerCommand({ ...base(f) });
    await pauseBuyerAutomationCommand({ ...base(f) });

    expect(await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } })).toEqual(before);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(0);
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(3);
  });
});

describe('audit covers both halves', () => {
  test('a canonical action writes the override event AND a state_change event', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.contacted });
    const result = await disqualifyBuyerCommand({
      ...base(f), disqualificationReason: DisqualificationReason.risk_flag,
    });

    const override = await prisma.auditEvent.findMany({
      where: { object_type: 'agent_decision', object_id: result.decisionId },
    });
    const stateChange = await prisma.auditEvent.findMany({
      where: { object_type: 'BuyerLead.stage', object_id: f.fitId },
    });
    // Two events answering two different questions: who decided, and what state moved.
    // Collapsing them would make a pipeline transition invisible to a pipeline audit.
    expect(override).toHaveLength(1);
    expect(override[0]!.action).toBe('override');
    expect(stateChange).toHaveLength(1);
    expect(stateChange[0]!.action).toBe('state_change');
    expect(stateChange[0]!.after_summary).toMatchObject({
      state: 'disqualified', agent_decision_id: result.decisionId,
    });
    expect(stateChange[0]!.before_summary).toMatchObject({ state: 'contacted' });
  });

  test('a rolled-back command writes no audit event of either kind', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.contacted });
    const before = await prisma.auditEvent.count({ where: { exporter_org_id: f.orgId } });
    await expect(disqualifyBuyerCommand({ ...base(f) })).rejects.toThrow();
    expect(await prisma.auditEvent.count({ where: { exporter_org_id: f.orgId } })).toBe(before);
  });
});
