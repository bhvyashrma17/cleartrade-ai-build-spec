import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { AgentDecisionAction, AgentDecisionTarget, OrgTier, UserRole } from '@prisma/client';
import {
  ACTIONS_BY_TARGET,
  actionAppliesTo,
  agentDecisionsForOrg,
  assertCanRecordAgentDecision,
  buyerDecisionView,
  buyerOverrideOutcomes,
  disqualifyBuyer,
  effectiveState,
  marketDecisionView,
  promoteMarket,
  recordAgentDecision,
  rejectMarket,
  restoreMarket,
  shortlistBuyer,
} from '../src/lib/agent-decisions';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

const staff = (role: UserRole, id: string): Principal => ({
  id, email: `${id}@cleartrade.test`, name: role, role, exporter_org_id: null, tier: OrgTier.paid,
});

/**
 * One exporter with a market assessment and a buyer fit assessment, an agent assigned to it,
 * and an unassigned agent — the minimum needed to exercise every authorization branch.
 */
async function fixture() {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({
    data: { display_name: `Decisions Org ${s}`, tier: OrgTier.paid },
    select: { id: true },
  });
  const otherOrg = await prisma.exporterOrg.create({
    data: { display_name: `Other Org ${s}`, tier: OrgTier.paid },
    select: { id: true },
  });
  const [agent, otherAgent, ops, exporterUser] = await Promise.all([
    prisma.user.create({ data: { email: `agent-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `agent2-${s}@t.test`, name: 'Other Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
    prisma.user.create({
      data: { email: `own-${s}@t.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id },
      select: { id: true },
    }),
  ]);
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });

  const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id }, select: { id: true } });
  const product = await prisma.product.create({
    data: { exporter_org_id: org.id, name: `Product ${s}` }, select: { id: true },
  });
  // Two assessments in the run so rank is a real computation, not always 1.
  const [top, second] = await Promise.all([
    prisma.marketAssessment.create({
      data: {
        run_id: run.id, country_code: 'DE', overall_score: 88, confidence_score: 70,
        model_version: 'market-v3', weight_profile_key: 'default', weight_profile_version: 1,
        scoring_policy_hash: 'hash-abc',
      },
      select: { id: true, overall_score: true },
    }),
    prisma.marketAssessment.create({
      data: {
        run_id: run.id, country_code: 'FR', overall_score: 61, confidence_score: 55,
        model_version: 'market-v3', weight_profile_key: 'default', weight_profile_version: 1,
        scoring_policy_hash: 'hash-abc',
      },
      select: { id: true, overall_score: true },
    }),
  ]);
  const buyer = await prisma.buyer.create({
    data: { legal_name: `Buyer ${s}`, display_name: `Buyer ${s}`, country_code: 'DE', buyer_type: 'importer' },
    select: { id: true },
  });
  const fit = await prisma.buyerFitAssessment.create({
    data: {
      buyer_id: buyer.id, product_id: product.id, exporter_org_id: org.id,
      score: 74, confidence_score: 66, components: { demand: 40 }, input_snapshot: {},
      model_version: 'buyerfit-v2',
    },
    select: { id: true },
  });

  return {
    orgId: org.id, otherOrgId: otherOrg.id, buyerId: buyer.id, productId: product.id,
    marketTopId: top.id, marketSecondId: second.id, fitId: fit.id,
    agent: staff(UserRole.agent, agent.id),
    unassignedAgent: staff(UserRole.agent, otherAgent.id),
    ops: staff(UserRole.ops_supervisor, ops.id),
    exporter: { ...staff(UserRole.exporter_owner, exporterUser.id), exporter_org_id: org.id } as Principal,
  };
}

const base = () => ({ reason: 'Buyer confirmed strong demand on a call.', correlationId: randomUUID() });

describe('authorization', () => {
  test('an assigned agent may record a decision', async () => {
    const f = await fixture();
    const decision = await promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 1 });
    expect(decision.actor_user_id).toBe(f.agent.id);
    expect(decision.exporter_org_id).toBe(f.orgId);
  });

  test('an authorized Ops role may record a decision without an assignment', async () => {
    const f = await fixture();
    await expect(promoteMarket({ ...base(), actor: f.ops, subjectId: f.marketTopId, agentPriority: 1 }))
      .resolves.toMatchObject({ actor_user_id: f.ops.id });
  });

  test('an unassigned agent is refused, and told nothing about the org', async () => {
    const f = await fixture();
    // NOT_FOUND, never FORBIDDEN: a 403 would confirm another tenant's assessment exists.
    await expect(rejectMarket({ ...base(), actor: f.unassignedAgent, subjectId: f.marketTopId }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('an exporter cannot record an agent decision about their own org', async () => {
    const f = await fixture();
    // FORBIDDEN, not NOT_FOUND: they already know their org exists. Allowing this would make
    // the AI-vs-human comparison meaningless — the override would not be independent.
    await expect(rejectMarket({ ...base(), actor: f.exporter, subjectId: f.marketTopId }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('authorization is derived from the subject, not from a caller-supplied org', async () => {
    const f = await fixture();
    // The assessment belongs to f.orgId; an agent assigned only to a different org must not
    // reach it, however the call is shaped.
    await expect(assertCanRecordAgentDecision(f.unassignedAgent, f.orgId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(assertCanRecordAgentDecision(f.agent, f.orgId)).resolves.toBeUndefined();
    await expect(assertCanRecordAgentDecision(f.ops, f.otherOrgId)).resolves.toBeUndefined();
  });
});

describe('append-only', () => {
  test('the database refuses an UPDATE to a recorded decision', async () => {
    const f = await fixture();
    const decision = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });

    // Not merely "the service exposes no update" — the trigger makes it impossible even for
    // a direct write, so the guarantee survives a future caller or a psql prompt.
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "AgentDecision" SET "reason" = 'rewritten' WHERE "id" = $1`, decision.id),
    ).rejects.toThrow(/append-only/i);

    const after = await prisma.agentDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(after.reason).toBe(decision.reason);
  });

  test('a change of mind is a new row that points back at the old one', async () => {
    const f = await fixture();
    const first = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, reason: 'Tariff risk too high.' });
    const second = await restoreMarket({
      ...base(), actor: f.agent, subjectId: f.marketTopId, reason: 'Tariff exemption confirmed.',
    });

    // Supersession points BACKWARD, so the historical row is byte-identical to when written.
    expect(second.supersedes_id).toBe(first.id);
    const reread = await prisma.agentDecision.findUniqueOrThrow({ where: { id: first.id } });
    expect(reread).toEqual(first);
  });

  test('the service derives supersession, chaining each decision onto the previous tip', async () => {
    const f = await fixture();
    const first = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    const second = await restoreMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    const third = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    // A strict linear chain, computed by the service — callers cannot select a target.
    expect(first.supersedes_id).toBeNull();
    expect(second.supersedes_id).toBe(first.id);
    expect(third.supersedes_id).toBe(second.id);
  });

  test('decisions on different subjects form independent chains', async () => {
    const f = await fixture();
    const onTop = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    const onSecond = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketSecondId });
    // Each subject starts its own root; neither reaches into the other's chain.
    expect(onTop.supersedes_id).toBeNull();
    expect(onSecond.supersedes_id).toBeNull();
  });
});

describe('the model output is never touched', () => {
  test('recording decisions leaves the assessment byte-identical', async () => {
    const f = await fixture();
    const before = await prisma.marketAssessment.findUniqueOrThrow({ where: { id: f.marketTopId } });
    const beforeFit = await prisma.buyerFitAssessment.findUniqueOrThrow({ where: { id: f.fitId } });

    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 1 });
    await disqualifyBuyer({ ...base(), actor: f.agent, subjectId: f.fitId });

    expect(await prisma.marketAssessment.findUniqueOrThrow({ where: { id: f.marketTopId } })).toEqual(before);
    expect(await prisma.buyerFitAssessment.findUniqueOrThrow({ where: { id: f.fitId } })).toEqual(beforeFit);
  });

  test('decision-time model values are frozen onto the row, and survive a recompute', async () => {
    const f = await fixture();
    // The FR market is second by score, so its model rank must be 2, not 1.
    const decision = await promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketSecondId, agentPriority: 1 });
    expect(decision.original_score).toBe(61);
    expect(decision.original_rank).toBe(2);
    expect(decision.original_confidence_score).toBe(55);
    expect(decision.original_model_version).toBe('market-v3');
    expect(decision.original_policy_hash).toBe('hash-abc');
    // Agent priority is the operational rank and is independent of the model's.
    expect(decision.agent_priority).toBe(1);

    // A later recompute must not retro-change what the agent is recorded as having overruled.
    await prisma.marketAssessment.update({ where: { id: f.marketSecondId }, data: { overall_score: 95 } });
    const reread = await prisma.agentDecision.findUniqueOrThrow({ where: { id: decision.id } });
    expect(reread.original_score).toBe(61);
  });

  test('buyer decisions freeze the buyer fit score and rank', async () => {
    const f = await fixture();
    const decision = await shortlistBuyer({ ...base(), actor: f.agent, subjectId: f.fitId, agentPriority: 2 });
    expect(decision.original_score).toBe(74);
    expect(decision.original_rank).toBe(1);
    expect(decision.original_model_version).toBe('buyerfit-v2');
    // BuyerFitAssessment has no scoring-policy hash; inventing one would be a lie.
    expect(decision.original_policy_hash).toBeNull();
  });
});

describe('invalid targets and actions', () => {
  test('the action/target map has no meaningless overlap', () => {
    expect(actionAppliesTo(AgentDecisionTarget.market, AgentDecisionAction.shortlist)).toBe(false);
    expect(actionAppliesTo(AgentDecisionTarget.buyer, AgentDecisionAction.mark_selected)).toBe(false);
    expect(actionAppliesTo(AgentDecisionTarget.market, AgentDecisionAction.reject)).toBe(true);
    expect(actionAppliesTo(AgentDecisionTarget.buyer, AgentDecisionAction.disqualify)).toBe(true);
    // Shared actions apply to both.
    for (const target of [AgentDecisionTarget.market, AgentDecisionTarget.buyer]) {
      expect(actionAppliesTo(target, AgentDecisionAction.request_review)).toBe(true);
      expect(actionAppliesTo(target, AgentDecisionAction.pause_automation)).toBe(true);
    }
    expect(ACTIONS_BY_TARGET.market).not.toContain(AgentDecisionAction.qualify);
    expect(ACTIONS_BY_TARGET.buyer).not.toContain(AgentDecisionAction.mark_not_selected);
  });

  test('the service rejects a market action on a buyer subject', async () => {
    const f = await fixture();
    await expect(recordAgentDecision({
      ...base(), actor: f.agent, target: AgentDecisionTarget.buyer,
      subjectId: f.fitId, action: AgentDecisionAction.mark_selected,
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('the DATABASE also rejects a mismatched action, independently of the service', async () => {
    const f = await fixture();
    // Bypasses every service guard: the CHECK constraint is what makes the rule a guarantee.
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision" ("id","exporter_org_id","actor_user_id","buyer_fit_assessment_id","target","action","reason")
       VALUES ($1,$2,$3,$4,'buyer','mark_selected','bypass')`,
      randomUUID(), f.orgId, f.agent.id, f.fitId,
    )).rejects.toThrow(/AgentDecision_action_matches_target/);
  });

  test('the DATABASE rejects a row with no target', async () => {
    const f = await fixture();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision" ("id","exporter_org_id","actor_user_id","target","action","reason")
       VALUES ($1,$2,$3,'market','reject','no target')`,
      randomUUID(), f.orgId, f.agent.id,
    )).rejects.toThrow(/AgentDecision_target_shape/);
  });

  test('the DATABASE rejects a row with BOTH targets', async () => {
    const f = await fixture();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision" ("id","exporter_org_id","actor_user_id","market_assessment_id","buyer_fit_assessment_id","target","action","reason")
       VALUES ($1,$2,$3,$4,$5,'market','reject','two targets')`,
      randomUUID(), f.orgId, f.agent.id, f.marketTopId, f.fitId,
    )).rejects.toThrow(/AgentDecision_target_shape/);
  });

  test('the DATABASE rejects a target that disagrees with its foreign key', async () => {
    const f = await fixture();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision" ("id","exporter_org_id","actor_user_id","buyer_fit_assessment_id","target","action","reason")
       VALUES ($1,$2,$3,$4,'market','reject','mislabelled')`,
      randomUUID(), f.orgId, f.agent.id, f.fitId,
    )).rejects.toThrow(/AgentDecision_target_shape/);
  });

  test('referential integrity: a decision cannot point at an assessment that does not exist', async () => {
    const f = await fixture();
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision" ("id","exporter_org_id","actor_user_id","market_assessment_id","target","action","reason")
       VALUES ($1,$2,$3,$4,'market','reject','dangling')`,
      randomUUID(), f.orgId, f.agent.id, randomUUID(),
    )).rejects.toThrow(/foreign key|violates/i);
  });

  test('a blank reason is refused by the service and by the database', async () => {
    const f = await fixture();
    await expect(rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, reason: '   ' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "AgentDecision" ("id","exporter_org_id","actor_user_id","market_assessment_id","target","action","reason")
       VALUES ($1,$2,$3,$4,'market','reject','  ')`,
      randomUUID(), f.orgId, f.agent.id, f.marketTopId,
    )).rejects.toThrow(/AgentDecision_reason_not_blank/);
  });

  test('an operational priority is refused on an action that cannot carry one', async () => {
    const f = await fixture();
    await expect(rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 3 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 0 }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('audit', () => {
  test('every decision writes an override audit event carrying what was overruled', async () => {
    const f = await fixture();
    const decision = await promoteMarket({
      ...base(), actor: f.agent, subjectId: f.marketSecondId, agentPriority: 1,
      reason: 'Exporter has an existing distributor in France.',
    });

    const events = await prisma.auditEvent.findMany({
      where: { object_type: 'agent_decision', object_id: decision.id },
    });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    // `override`, not `create` — an override must be findable as its own audit category.
    expect(event.action).toBe('override');
    expect(event.actor_user_id).toBe(f.agent.id);
    expect(event.role).toBe(UserRole.agent);
    expect(event.exporter_org_id).toBe(f.orgId);
    const after = event.after_summary as Record<string, unknown>;
    expect(after).toMatchObject({
      target: 'market', action: 'promote', subject_id: f.marketSecondId,
      original_score: 61, original_rank: 2, agent_priority: 1,
    });
  });

  test('a rejected decision writes no row and no audit event', async () => {
    const f = await fixture();
    const before = await prisma.auditEvent.count({ where: { exporter_org_id: f.orgId } });
    await expect(rejectMarket({ ...base(), actor: f.unassignedAgent, subjectId: f.marketTopId })).rejects.toThrow();
    expect(await prisma.agentDecision.count({ where: { exporter_org_id: f.orgId } })).toBe(0);
    expect(await prisma.auditEvent.count({ where: { exporter_org_id: f.orgId } })).toBe(before);
  });
});

describe('read model keeps AI and agent separate', () => {
  test('the market view returns both halves and never a blended score', async () => {
    const f = await fixture();
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 1 });
    const view = await marketDecisionView(f.marketTopId);

    expect(view.recommendation.overall_score).toBe(88);
    expect(view.decision.current?.action).toBe('promote');
    expect(view.decision.current?.agent_priority).toBe(1);
    // The shape must offer no single merged number for a UI to reach for.
    expect(view).not.toHaveProperty('effective_score');
    expect(view.decision.current).not.toHaveProperty('overall_score');
  });

  test('the buyer view returns both halves', async () => {
    const f = await fixture();
    await shortlistBuyer({ ...base(), actor: f.agent, subjectId: f.fitId, agentPriority: 1 });
    const view = await buyerDecisionView(f.fitId);
    expect(view.recommendation.score).toBe(74);
    expect(view.decision.current?.action).toBe('shortlist');
  });

  test('a subject with no decision has a recommendation and a null decision', async () => {
    const f = await fixture();
    const view = await marketDecisionView(f.marketTopId);
    expect(view.recommendation.overall_score).toBe(88);
    expect(view.decision.current).toBeNull();
    expect(view.decision.history).toHaveLength(0);
  });

  test('current is the newest in-force decision; history keeps everything', async () => {
    const f = await fixture();
    const first = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, reason: 'Too risky.' });
    const second = await restoreMarket({
      ...base(), actor: f.agent, subjectId: f.marketTopId, reason: 'Risk cleared.',
    });
    const view = await marketDecisionView(f.marketTopId);
    expect(view.decision.current?.id).toBe(second.id);
    expect(view.decision.history.map((d) => d.id)).toEqual([second.id, first.id]);
    expect(view.decision.history.find((d) => d.id === first.id)?.state).toBe('superseded');
  });

  test('an expired decision is not current, and does not fall back to an older one', async () => {
    const f = await fixture();
    const past = new Date(Date.now() - 60_000);
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 1 });
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, expiresAt: past });

    const view = await marketDecisionView(f.marketTopId);
    // The newest row expired. An expired instruction is not evidence that the previous one
    // resumed, so there is no current decision — and critically, `current` must NOT scan
    // past the lapsed rejection to the older promote, which would resurrect an instruction
    // the agent had already replaced.
    expect(view.decision.current).toBeNull();
    expect(view.decision.latest?.state).toBe('expired');
    expect(view.decision.latest?.action).toBe('reject');
    // The promote is in history but superseded by the rejection that replaced it — it must
    // NOT read as active, or a caller could conclude the promotion resumed on expiry.
    expect(view.decision.history).toHaveLength(2);
    expect(view.decision.history.find((d) => d.action === 'promote')?.state).toBe('superseded');
  });

  test('effectiveState prefers superseded over expired', () => {
    const expired = new Date(Date.now() - 1000);
    expect(effectiveState({ expires_at: expired, superseded_by: { id: 'x' } })).toBe('superseded');
    expect(effectiveState({ expires_at: expired, superseded_by: null })).toBe('expired');
    expect(effectiveState({ expires_at: null, superseded_by: null })).toBe('active');
  });

  test('org history spans both targets and can be filtered', async () => {
    const f = await fixture();
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 1 });
    await shortlistBuyer({ ...base(), actor: f.agent, subjectId: f.fitId, agentPriority: 1 });
    expect(await agentDecisionsForOrg(f.orgId)).toHaveLength(2);
    expect(await agentDecisionsForOrg(f.orgId, { target: AgentDecisionTarget.buyer })).toHaveLength(1);
  });
});

describe('learning loop: AI ranking -> override -> outcome', () => {
  test('a buyer override joins to its realised outcome via the frozen model score', async () => {
    const f = await fixture();
    await shortlistBuyer({ ...base(), actor: f.agent, subjectId: f.fitId, agentPriority: 1 });

    const lead = await prisma.buyerLead.create({
      data: { exporter_org_id: f.orgId, buyer_id: f.buyerId, product_id: f.productId, stage: 'contacted' },
      select: { id: true },
    });
    await prisma.buyerOutcome.create({
      data: { buyer_id: f.buyerId, exporter_org_id: f.orgId, buyer_lead_id: lead.id, converted: true },
    });

    const rows = await buyerOverrideOutcomes(f.orgId);
    expect(rows).toHaveLength(1);
    // The comparison the whole layer exists to make possible.
    expect(rows[0]!.model_score_at_decision).toBe(74);
    expect(rows[0]!.model_rank_at_decision).toBe(1);
    expect(rows[0]!.outcome?.converted).toBe(true);
  });

  test('an override with no outcome yet reports a null outcome rather than being dropped', async () => {
    const f = await fixture();
    await shortlistBuyer({ ...base(), actor: f.agent, subjectId: f.fitId, agentPriority: 1 });
    const rows = await buyerOverrideOutcomes(f.orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.outcome).toBeNull();
  });
});

describe('chain integrity is enforced by the database, not just the service', () => {
  /** Insert a decision directly, bypassing every service guard. */
  const rawInsert = (args: {
    orgId: string; actorId: string; target: 'market' | 'buyer';
    marketId?: string | null; buyerFitId?: string | null; supersedesId?: string | null;
  }) => prisma.$executeRawUnsafe(
    `INSERT INTO "AgentDecision"
       ("id","exporter_org_id","actor_user_id","market_assessment_id","buyer_fit_assessment_id","target","action","reason","supersedes_id")
     VALUES ($1,$2,$3,$4,$5,$6::"AgentDecisionTarget",$7::"AgentDecisionAction",'raw',$8)`,
    randomUUID(), args.orgId, args.actorId, args.marketId ?? null, args.buyerFitId ?? null,
    args.target, args.target === 'market' ? 'reject' : 'disqualify', args.supersedesId ?? null,
  );

  test('a second root for the same subject is refused', async () => {
    const f = await fixture();
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    // Two independent chains over one subject would leave "what is in force?" unanswerable.
    await expect(rawInsert({
      orgId: f.orgId, actorId: f.agent.id, target: 'market', marketId: f.marketTopId, supersedesId: null,
    })).rejects.toThrow(/competing chain/i);
  });

  test('superseding another exporter\'s decision is refused', async () => {
    const f = await fixture();
    const mine = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    // Same decision id, but claiming a different exporter_org_id on the new row.
    await expect(rawInsert({
      orgId: f.otherOrgId, actorId: f.agent.id, target: 'market', marketId: f.marketTopId, supersedesId: mine.id,
    })).rejects.toThrow(/another exporter/i);
  });

  test('superseding across targets is refused', async () => {
    const f = await fixture();
    const marketDecision = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    await expect(rawInsert({
      orgId: f.orgId, actorId: f.agent.id, target: 'buyer', buyerFitId: f.fitId, supersedesId: marketDecision.id,
    })).rejects.toThrow(/different target/i);
  });

  test('superseding a decision about a different subject is refused', async () => {
    const f = await fixture();
    const onTop = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    await expect(rawInsert({
      orgId: f.orgId, actorId: f.agent.id, target: 'market', marketId: f.marketSecondId, supersedesId: onTop.id,
    })).rejects.toThrow(/different subject/i);
  });

  test('superseding a historical row rather than the chain tip is refused', async () => {
    const f = await fixture();
    const first = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    await restoreMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId });
    // `first` is no longer the tip. Allowing this would fork the chain into two tips, which
    // AgentDecision_no_self_supersede alone would happily permit.
    await expect(rawInsert({
      orgId: f.orgId, actorId: f.agent.id, target: 'market', marketId: f.marketTopId, supersedesId: first.id,
    })).rejects.toThrow(/not the latest/i);
  });

  test('superseding a decision that does not exist is refused', async () => {
    const f = await fixture();
    await expect(rawInsert({
      orgId: f.orgId, actorId: f.agent.id, target: 'market', marketId: f.marketTopId, supersedesId: randomUUID(),
    })).rejects.toThrow(/does not exist|foreign key/i);
  });
});

describe('concurrent decisions stay deterministic', () => {
  test('simultaneous decisions on one subject form a single linear chain, not competing roots', async () => {
    const f = await fixture();
    // Fired together: without serialization both would read the same tip and race.
    const results = await Promise.allSettled([
      promoteMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, agentPriority: 1, reason: 'A' }),
      rejectMarket({ ...base(), actor: f.ops, subjectId: f.marketTopId, reason: 'B' }),
      restoreMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId, reason: 'C' }),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const rows = await prisma.agentDecision.findMany({
      where: { market_assessment_id: f.marketTopId },
      select: { id: true, supersedes_id: true },
    });
    expect(rows).toHaveLength(3);

    // Exactly one root and exactly one tip — the definition of a single linear chain.
    expect(rows.filter((r) => r.supersedes_id === null)).toHaveLength(1);
    const superseded = new Set(rows.map((r) => r.supersedes_id).filter(Boolean));
    expect(rows.filter((r) => !superseded.has(r.id))).toHaveLength(1);

    // And the chain reaches every row, so nothing was orphaned.
    const byPredecessor = new Map(rows.map((r) => [r.supersedes_id, r]));
    let cursor = rows.find((r) => r.supersedes_id === null)!;
    const visited = [cursor.id];
    while (byPredecessor.has(cursor.id)) {
      cursor = byPredecessor.get(cursor.id)!;
      visited.push(cursor.id);
    }
    expect(visited).toHaveLength(3);

    // The read model still resolves one unambiguous current decision.
    const view = await marketDecisionView(f.marketTopId);
    expect(view.decision.current?.id).toBe(visited[visited.length - 1]);
  });

  test('concurrent decisions on DIFFERENT subjects do not serialize against each other', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([
      rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketTopId }),
      rejectMarket({ ...base(), actor: f.agent, subjectId: f.marketSecondId }),
    ]);
    // Independent subjects, so both are roots of their own chain.
    expect(a.supersedes_id).toBeNull();
    expect(b.supersedes_id).toBeNull();
  });
});

describe('frozen model values keep the source precision', () => {
  test('score and confidence are stored at the same integer precision as the model fields', async () => {
    const f = await fixture();
    const decision = await shortlistBuyer({ ...base(), actor: f.agent, subjectId: f.fitId, agentPriority: 1 });
    const fit = await prisma.buyerFitAssessment.findUniqueOrThrow({ where: { id: f.fitId } });

    // Identical values AND identical runtime type — no rounding, no Decimal->number coercion,
    // because both sides are `Int` in Prisma and `integer` in Postgres.
    expect(decision.original_score).toBe(fit.score);
    expect(decision.original_confidence_score).toBe(fit.confidence_score);
    expect(Number.isInteger(decision.original_score)).toBe(true);
    expect(Number.isInteger(decision.original_confidence_score)).toBe(true);
  });
});
