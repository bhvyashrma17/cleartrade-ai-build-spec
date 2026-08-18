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
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.shortlisted });
    const result = await shortlistBuyerCommand({ ...base(f), agentPriority: 1 });

    expect(result.category).toBe('canonical');
    expect(result.canonicalChange).toMatchObject({ model: 'BuyerShortlist', from: 'not_shortlisted', to: 'shortlisted' });

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
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.shortlisted });
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

describe('shortlist moves membership and pipeline position without conflating them', () => {
  test('a `new` lead advances to shortlisted, and membership is created', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.new });
    const result = await shortlistBuyerCommand({ ...base(f), agentPriority: 1 });

    // Both canonical concepts moved, and the result reports both rather than one standing in
    // for the other.
    expect(result.canonicalChange?.model).toBe('BuyerShortlist + BuyerLead.stage');
    const lead = await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } });
    expect(lead.stage).toBe(BuyerLeadStage.shortlisted);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(1);
  });

  test('an already-shortlisted lead is left alone; membership stays idempotent', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.shortlisted });
    const result = await shortlistBuyerCommand({ ...base(f) });

    // No stage change to report, because none was needed.
    expect(result.canonicalChange?.model).toBe('BuyerShortlist');
    expect((await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } })).stage)
      .toBe(BuyerLeadStage.shortlisted);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(1);
  });

  test.each([
    BuyerLeadStage.contacted,
    BuyerLeadStage.replied,
    BuyerLeadStage.interested,
    BuyerLeadStage.negotiation,
    BuyerLeadStage.converted,
  ])('a downstream lead at %s does not regress', async (stage) => {
    const f = await fixture({ withLead: true, leadStage: stage });
    const result = await shortlistBuyerCommand({ ...base(f) });

    // Re-asserting a shortlist must never drag real pipeline progress backwards.
    expect((await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } })).stage).toBe(stage);
    // Membership is still asserted — that is a separate concept from pipeline position.
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(1);
    expect(result.canonicalChange?.model).toBe('BuyerShortlist');
  });

  test('a disqualified lead refuses shortlist and requires explicit restore', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.disqualified });
    await expect(shortlistBuyerCommand({ ...base(f) })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Full rollback: no decision, no membership, no silent un-disqualification. Shortlisting
    // must not become a back door around `restore`.
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(0);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(0);
    expect((await prisma.buyerLead.findUniqueOrThrow({ where: { id: f.leadId! } })).stage)
      .toBe(BuyerLeadStage.disqualified);
  });

  test('a discovered buyer with no lead gets one created, plus membership and decision', async () => {
    const f = await fixture({ withLead: false });
    const result = await shortlistBuyerCommand({ ...base(f), agentPriority: 1 });

    // Shortlisting from Buyer Discovery is how a buyer ENTERS the pipeline.
    expect(result.canonicalChange?.model).toBe('BuyerShortlist + BuyerLead (created)');
    const lead = await prisma.buyerLead.findFirstOrThrow({
      where: { exporter_org_id: f.orgId, buyer_id: f.buyerId, product_id: f.productId },
    });
    // Created at `new` by the canonical service, then advanced in the same transaction.
    expect(lead.stage).toBe(BuyerLeadStage.shortlisted);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(1);
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(1);
  });

  test('the created lead carries the full canonical apparatus, not just a row', async () => {
    const f = await fixture({ withLead: false });
    await shortlistBuyerCommand({ ...base(f) });
    const lead = await prisma.buyerLead.findFirstOrThrow({
      where: { exporter_org_id: f.orgId, buyer_id: f.buyerId, product_id: f.productId },
    });

    // The same service the create-lead route uses, so a shortlist-created lead is not thinner:
    // snapshot with frozen fit provenance, opening transition, and outcome row for the loop.
    const snapshot = await prisma.buyerLeadSnapshot.findFirstOrThrow({ where: { buyer_lead_id: lead.id } });
    expect(snapshot.buyer_fit_assessment_id).toBe(f.fitId);
    expect(snapshot.fit_score).toBe(74);
    expect(snapshot.fit_model_version).toBe('buyerfit-v2');
    const transitions = await prisma.buyerLeadTransition.findMany({ where: { buyer_lead_id: lead.id } });
    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.from_stage).toBeNull();
    expect(await prisma.buyerOutcome.count({ where: { buyer_lead_id: lead.id } })).toBe(1);
  });

  test('a duplicate shortlist command does not create a second lead', async () => {
    const f = await fixture({ withLead: false });
    await shortlistBuyerCommand({ ...base(f) });
    await shortlistBuyerCommand({ ...base(f), reason: 'Re-confirmed on a later call.' });

    expect(await prisma.buyerLead.count({
      where: { exporter_org_id: f.orgId, buyer_id: f.buyerId, product_id: f.productId },
    })).toBe(1);
    expect(await prisma.buyerShortlist.count({ where: { buyer_id: f.buyerId } })).toBe(1);
    // Two decisions, one of each canonical row — the decision layer is history, not state.
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: f.fitId } })).toBe(2);
  });


  test('a stage advance emits its own audit event alongside the membership one', async () => {
    const f = await fixture({ withLead: true, leadStage: BuyerLeadStage.new });
    const result = await shortlistBuyerCommand({ ...base(f) });

    const membership = await prisma.auditEvent.findMany({
      where: { object_type: 'BuyerShortlist', object_id: f.fitId },
    });
    const stage = await prisma.auditEvent.findMany({
      where: { object_type: 'BuyerLead.stage', object_id: f.fitId },
    });
    // A pipeline transition must be visible to a pipeline audit, not buried in a shortlist event.
    expect(membership).toHaveLength(1);
    expect(stage).toHaveLength(1);
    expect(stage[0]!.before_summary).toMatchObject({ state: 'new' });
    expect(stage[0]!.after_summary).toMatchObject({ state: 'shortlisted', agent_decision_id: result.decisionId });
  });
});

describe('BuyerFit scoring-policy provenance', () => {
  test('the persisted policy is the one the code applies, not the unused config key', async () => {
    const { BUYER_FIT_POLICY, BUYER_FIT_POLICY_HASH } = await import('../src/lib/buyer-intelligence');

    // The live scorer combines these four. `buyers.fit_score_weights` lists
    // country_match/category_match/verification/import_recency and is read by nothing, so it
    // must never appear in a provenance record.
    expect(BUYER_FIT_POLICY.components).toEqual(['volume_fit', 'price_fit', 'cert_fit', 'outcome_prior']);
    expect(BUYER_FIT_POLICY.combine.method).toBe('unweighted_mean_of_available');
    expect(JSON.stringify(BUYER_FIT_POLICY)).not.toMatch(/country_match|category_match|import_recency/);
    expect(BUYER_FIT_POLICY_HASH).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the hash is stable and changes only when the policy changes', async () => {
    const { BUYER_FIT_POLICY, BUYER_FIT_POLICY_HASH } = await import('../src/lib/buyer-intelligence');
    const { scoringPolicyHash } = await import('../src/lib/discovery/policy');
    // Same canonicalization as Demand Discovery, so identical content always hashes identically.
    expect(scoringPolicyHash(BUYER_FIT_POLICY)).toBe(BUYER_FIT_POLICY_HASH);
    expect(scoringPolicyHash({ ...BUYER_FIT_POLICY, version: 999 })).not.toBe(BUYER_FIT_POLICY_HASH);
  });

  test('assessments written before provenance existed stay explicitly legacy', async () => {
    const f = await fixture();
    // The fixture writes directly, as a pre-provenance run would have.
    const assessment = await prisma.buyerFitAssessment.findUniqueOrThrow({ where: { id: f.fitId } });
    expect(assessment.scoring_policy_hash).toBeNull();
    expect(assessment.scoring_policy_version).toBeNull();
    // Named as unverifiable rather than silently attributed to today's policy.
    expect(assessment.reproducibility_status).toBe('legacy_non_recomputable');
  });

  test('a decision copies policy provenance when present, and null when not', async () => {
    const f = await fixture();
    // Legacy assessment: no policy to copy, so the decision says so rather than guessing.
    const legacy = await promoteBuyerCommand({ ...base(f), agentPriority: 1 });
    const legacyDecision = await prisma.agentDecision.findUniqueOrThrow({ where: { id: legacy.decisionId } });
    expect(legacyDecision.original_policy_hash).toBeNull();
    expect(legacyDecision.original_policy_version).toBeNull();

    // Now give the assessment real provenance, as the writer now does.
    const { BUYER_FIT_POLICY, BUYER_FIT_POLICY_HASH } = await import('../src/lib/buyer-intelligence');
    await prisma.buyerFitAssessment.update({
      where: { id: f.fitId },
      data: {
        scoring_policy_hash: BUYER_FIT_POLICY_HASH,
        scoring_policy_version: BUYER_FIT_POLICY.version,
        reproducibility_status: 'reproducible',
      },
    });
    const current = await qualifyBuyerCommand({ ...base(f) });
    const currentDecision = await prisma.agentDecision.findUniqueOrThrow({ where: { id: current.decisionId } });
    expect(currentDecision.original_policy_hash).toBe(BUYER_FIT_POLICY_HASH);
    expect(currentDecision.original_policy_version).toBe(BUYER_FIT_POLICY.version);
  });
});

describe('the dead buyers.fit_score_weights control cannot be presented as live', () => {
  test('it is not an editable config key, so the update route cannot accept it', async () => {
    const { updateConfigSchema } = await import('../src/lib/validators');
    // The enum on this schema IS the editable surface — the Ops config route validates against
    // it. A key absent here cannot be written, whatever a client sends.
    expect(updateConfigSchema.safeParse({ key: 'buyers.fit_score_weights', value: {} }).success).toBe(false);
    // A genuinely live key still passes, so this proves exclusion rather than a broken schema.
    expect(updateConfigSchema.safeParse({ key: 'sla.thresholds', value: {} }).success).toBe(true);
  });

  test('it is marked deprecated in one shared place', async () => {
    const { DEPRECATED_CONFIG_KEYS, isDeprecatedConfigKey } = await import('../src/lib/config');
    expect(DEPRECATED_CONFIG_KEYS).toContain('buyers.fit_score_weights');
    expect(isDeprecatedConfigKey('buyers.fit_score_weights')).toBe(true);
    expect(isDeprecatedConfigKey('sla.thresholds')).toBe(false);
  });

  test('the Ops console does not offer it as a tunable setting', async () => {
    const { OPS_TUNABLE_CONFIG_KEYS, isDeprecatedConfigKey } = await import('../src/lib/config');
    // The console renders exactly this list, so asserting it IS asserting what Ops sees —
    // grepping the page source would match the comment explaining the key's absence.
    expect(OPS_TUNABLE_CONFIG_KEYS).not.toContain('buyers.fit_score_weights');
    expect(OPS_TUNABLE_CONFIG_KEYS.length).toBeGreaterThan(0);
    // Derived from the deprecation list, so retiring another key cannot be forgotten here.
    expect(OPS_TUNABLE_CONFIG_KEYS.every((k) => !isDeprecatedConfigKey(k))).toBe(true);
  });

  test('the config shape is retained so stored rows still parse', async () => {
    const { CONFIG_DEFAULTS } = await import('../src/lib/config');
    // Deprecated is not deleted: removing the shape would orphan any persisted ConfigSetting
    // row and make existing history unreadable.
    expect(CONFIG_DEFAULTS['buyers.fit_score_weights']).toBeDefined();
  });

  test('BuyerFit scoring remains code-owned and is not driven by the dead key', async () => {
    const { BUYER_FIT_POLICY } = await import('../src/lib/buyer-intelligence');
    const { CONFIG_DEFAULTS } = await import('../src/lib/config');
    const dead = CONFIG_DEFAULTS['buyers.fit_score_weights'] as unknown as Record<string, unknown>;
    // The two describe different models; no key of the dead config appears in the real policy.
    for (const key of Object.keys(dead)) {
      expect(JSON.stringify(BUYER_FIT_POLICY)).not.toContain(key);
    }
  });
});
