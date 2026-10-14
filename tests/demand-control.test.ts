import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { AgentDecisionAction, OrgTier, UserRole } from '@prisma/client';
import {
  activeOnly,
  bucketFor,
  componentViews,
  DEFAULT_DIRECTION,
  isSortKey,
  marketControlRows,
  modelProvenance,
  operationalOrder,
  sortByOperationalOrder,
  sortRows,
} from '../src/lib/demand-control';
import {
  demoteMarket,
  markMarketNotSelected,
  markMarketSelected,
  pauseMarketAutomation,
  promoteMarket,
  rejectMarket,
  requestMarketReview,
  restoreMarket,
  resumeMarketAutomation,
} from '../src/lib/agent-decisions';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

const decision = (action: AgentDecisionAction, agent_priority: number | null = null) =>
  ({ action, agent_priority }) as never;

describe('state buckets', () => {
  test('no decision is active', () => {
    expect(bucketFor(null)).toBe('active');
  });

  test('reject and mark_not_selected are terminal', () => {
    expect(bucketFor(decision(AgentDecisionAction.reject))).toBe('terminal');
    expect(bucketFor(decision(AgentDecisionAction.mark_not_selected))).toBe('terminal');
  });

  test('the Phase 3 buyer equivalents use the same rule', () => {
    expect(bucketFor(decision(AgentDecisionAction.disqualify))).toBe('terminal');
    expect(bucketFor(decision(AgentDecisionAction.unqualify))).toBe('terminal');
  });

  test('pause and request_review stay visible, flagged', () => {
    expect(bucketFor(decision(AgentDecisionAction.pause_automation))).toBe('flagged');
    expect(bucketFor(decision(AgentDecisionAction.request_review))).toBe('flagged');
  });

  test('promote, restore and mark_selected are active', () => {
    expect(bucketFor(decision(AgentDecisionAction.promote, 1))).toBe('active');
    expect(bucketFor(decision(AgentDecisionAction.restore))).toBe('active');
    expect(bucketFor(decision(AgentDecisionAction.mark_selected, 2))).toBe('active');
  });
});

describe('operational order', () => {
  test('agent priority wins over model rank when supplied', () => {
    expect(operationalOrder({ modelRank: 7, current: decision(AgentDecisionAction.promote, 1) })).toBe(1);
  });

  test('falls back to model rank when the current decision carries no priority', () => {
    expect(operationalOrder({ modelRank: 4, current: decision(AgentDecisionAction.request_review) })).toBe(4);
  });

  test('a restored market uses its priority if given, otherwise model rank', () => {
    expect(operationalOrder({ modelRank: 6, current: decision(AgentDecisionAction.restore) })).toBe(6);
    expect(operationalOrder({ modelRank: 6, current: decision(AgentDecisionAction.promote, 2) })).toBe(2);
  });

  test('a terminal market has NO operational order and never falls back to model rank', () => {
    // The rule the whole bucket system exists for: a rejected market must not re-enter the
    // ranking on the strength of the AI's opinion the agent just overruled.
    expect(operationalOrder({ modelRank: 1, current: decision(AgentDecisionAction.reject) })).toBeNull();
    expect(operationalOrder({ modelRank: 1, current: decision(AgentDecisionAction.mark_not_selected) })).toBeNull();
  });

  test('an unscored market has no operational order rather than a manufactured one', () => {
    expect(operationalOrder({ modelRank: null, current: null })).toBeNull();
  });
});

describe('sorting into operational order', () => {
  const row = (modelRank: number | null, current: unknown = null, id: string = randomUUID()) =>
    ({ id, modelRank, current }) as never as { id: string; modelRank: number | null; current: never };

  test('terminal candidates sort after every active one', () => {
    const rejected = row(1, decision(AgentDecisionAction.reject), 'rejected');
    const active = row(9, null, 'active');
    const sorted = sortByOperationalOrder([rejected, active]);
    // Model rank 1 vs 9, but the rejected one still sorts last.
    expect(sorted.map((r) => r.id)).toEqual(['active', 'rejected']);
  });

  test('flagged candidates stay in the normal ordering', () => {
    const paused = row(2, decision(AgentDecisionAction.pause_automation), 'paused');
    const plain = row(5, null, 'plain');
    expect(sortByOperationalOrder([plain, paused]).map((r) => r.id)).toEqual(['paused', 'plain']);
  });

  test('agent priority reorders against model rank', () => {
    // Priority 1 against model rank 2 — unambiguous, so this tests the reordering itself
    // rather than tie-breaking.
    const promoted = row(8, decision(AgentDecisionAction.promote, 1), 'promoted');
    const topByModel = row(2, null, 'top-by-model');
    expect(sortByOperationalOrder([topByModel, promoted]).map((r) => r.id)).toEqual(['promoted', 'top-by-model']);
  });

  test('an explicit agent priority beats a model-rank fallback at the same number', () => {
    // agent_priority and model_rank share one number line, so promoting a market to 1 collides
    // with whatever the model ranked 1. The tie breaks on PROVENANCE of the number: a stated
    // agent priority is a deliberate instruction, a model-rank fallback is only the absence of
    // one — deferring to the fallback would let the AI outrank an override at the exact moment
    // the agent bothered to express it.
    const promoted = row(4, decision(AgentDecisionAction.promote, 1), 'promoted');
    const topByModel = row(1, null, 'top-by-model');
    expect(operationalOrder(promoted)).toBe(operationalOrder(topByModel));
    expect(sortByOperationalOrder([topByModel, promoted]).map((r) => r.id)).toEqual(['promoted', 'top-by-model']);
    // And the AI rank of neither market is touched by the reordering.
    expect(promoted.modelRank).toBe(4);
    expect(topByModel.modelRank).toBe(1);
  });

  test('two explicit equal priorities stay tied, resolved deterministically by AI rank', () => {
    // The agent is entitled to create this tie; it is preserved rather than silently rewritten.
    const worseByModel = row(7, decision(AgentDecisionAction.promote, 1), 'worse-by-model');
    const betterByModel = row(2, decision(AgentDecisionAction.promote, 1), 'better-by-model');
    expect(sortByOperationalOrder([worseByModel, betterByModel]).map((r) => r.id))
      .toEqual(['better-by-model', 'worse-by-model']);
    // Neither priority was rewritten to break the tie.
    expect(operationalOrder(worseByModel)).toBe(1);
    expect(operationalOrder(betterByModel)).toBe(1);
  });

  test('a fully identical tie falls back to a stable id ordering, not render order', () => {
    const a = { id: 'x', modelRank: 3, current: null, subjectId: 'aaa' } as never as { id: string; modelRank: number | null; current: never; subjectId: string };
    const b = { id: 'y', modelRank: 3, current: null, subjectId: 'bbb' } as never as { id: string; modelRank: number | null; current: never; subjectId: string };
    // Same order, same rank, same (absent) priority — the list must not reshuffle on reload.
    expect(sortByOperationalOrder([b, a]).map((r) => r.id)).toEqual(['x', 'y']);
    expect(sortByOperationalOrder([a, b]).map((r) => r.id)).toEqual(['x', 'y']);
  });

  test('unscored candidates sort last within their bucket, not first', () => {
    const unscored = row(null, null, 'unscored');
    const scored = row(3, null, 'scored');
    expect(sortByOperationalOrder([unscored, scored]).map((r) => r.id)).toEqual(['scored', 'unscored']);
  });

  test('the default list excludes terminal candidates; All keeps them', () => {
    const rows = [row(1, decision(AgentDecisionAction.reject), 'r'), row(2, null, 'a')];
    expect(activeOnly(rows).map((r) => r.id)).toEqual(['a']);
    expect(sortByOperationalOrder(rows)).toHaveLength(2);
  });
});

describe('reading model output without recomputing it', () => {
  /** An assessment carrying the provenance shape warehouse-engine.ts actually writes. */
  const assessment = (overrides: Record<string, unknown> = {}) => ({
    demand_score: 80, growth_score: 60, competition_score: null, market_access_score: 55,
    export_economics_score: 70, exporter_market_fit_score: 65,
    logistics_feasibility_score: 50, risk_resilience_score: 40,
    overall_score: 71, confidence_score: 62,
    model_version: 'market-v3', weight_profile_key: 'default', weight_profile_version: 1,
    scoring_policy_version: 3, scoring_policy_hash: 'hash-abc',
    as_of_date: new Date('2026-01-01'), reproducibility_status: 'reproducible',
    evidence_origins: ['authenticated_real'], eligibility_status: 'eligible',
    generated_at: new Date('2026-01-02'),
    field_provenance: {
      overall_score: {
        source: 'comtrade',
        input_evidence: {
          base_weights: { demand_strength: 25, growth_momentum: 10, competitive_opportunity: 10 },
          effective_weights: { demand_strength: 0.35, growth_momentum: 0.15, competitive_opportunity: 0 },
        },
      },
      demand_score: { source: 'comtrade', component_weight: 25, effective_renormalized_weight: 0.35 },
      competition_score: { status: 'unavailable', reason: 'Supplier coverage below the configured floor.' },
    },
    ...overrides,
  }) as never;

  test('per-component weights are read from provenance, both base and effective', () => {
    const views = componentViews(assessment());
    const demand = views.find((v) => v.field === 'demand_score')!;
    expect(demand.score).toBe(80);
    expect(demand.baseWeight).toBe(25);
    // 0.35 is the renormalised weight the ENGINE applied. Nothing here divides or re-derives it.
    expect(demand.effectiveWeight).toBe(0.35);
  });

  test('a component with no per-component decoration falls back to the overall weight block', () => {
    const views = componentViews(assessment());
    const growth = views.find((v) => v.field === 'growth_score')!;
    expect(growth.baseWeight).toBe(10);
    expect(growth.effectiveWeight).toBe(0.15);
  });

  test('an unavailable component surfaces its reason and keeps a null score', () => {
    const views = componentViews(assessment());
    const competition = views.find((v) => v.field === 'competition_score')!;
    expect(competition.score).toBeNull();
    // A gap is shown as a gap — never collapsed into a zero that reads as a genuine score.
    expect(competition.unavailableReason).toMatch(/supplier coverage/i);
    expect(competition.effectiveWeight).toBe(0);
  });

  test('missing weights stay null rather than being invented', () => {
    const views = componentViews(assessment({ field_provenance: {} }));
    for (const view of views) {
      expect(view.baseWeight).toBeNull();
      expect(view.effectiveWeight).toBeNull();
    }
  });

  test('all eight components are always represented', () => {
    expect(componentViews(assessment())).toHaveLength(8);
  });

  test('model provenance is passed through verbatim', () => {
    const p = modelProvenance(assessment());
    expect(p).toMatchObject({
      modelVersion: 'market-v3', weightProfileKey: 'default', weightProfileVersion: 1,
      scoringPolicyVersion: 3, scoringPolicyHash: 'hash-abc',
      reproducibilityStatus: 'reproducible', confidenceScore: 62, eligibilityStatus: 'eligible',
    });
  });
});

describe('table sorting', () => {
  const row = (id: string, modelRank: number | null, a: Record<string, unknown>, current: unknown = null) =>
    ({ id, modelRank, current, assessment: a }) as never as { id: string; modelRank: number | null; current: never; assessment: never };

  test('only allowlisted sort keys are accepted', () => {
    expect(isSortKey('ai_rank')).toBe(true);
    expect(isSortKey('demand_score')).toBe(true);
    expect(isSortKey('operational_order')).toBe(true);
    // A URL parameter must never reach an arbitrary column.
    expect(isSortKey('overall_score; DROP TABLE')).toBe(false);
    expect(isSortKey('password_hash')).toBe(false);
    expect(isSortKey(null)).toBe(false);
  });

  test('rank columns count up, score columns count down', () => {
    expect(DEFAULT_DIRECTION.ai_rank).toBe('asc');
    expect(DEFAULT_DIRECTION.operational_order).toBe('asc');
    expect(DEFAULT_DIRECTION.agent_priority).toBe('asc');
    expect(DEFAULT_DIRECTION.ai_score).toBe('desc');
    expect(DEFAULT_DIRECTION.confidence).toBe('desc');
    expect(DEFAULT_DIRECTION.demand_score).toBe('desc');
  });

  test('sorts by AI score, confidence and a component independently of agent decisions', () => {
    const rows = [
      row('a', 2, { overall_score: 50, confidence_score: 90, demand_score: 10 }),
      row('b', 1, { overall_score: 90, confidence_score: 40, demand_score: 80 }),
    ];
    expect(sortRows(rows, 'ai_score', 'desc').map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortRows(rows, 'confidence', 'desc').map((r) => r.id)).toEqual(['a', 'b']);
    expect(sortRows(rows, 'demand_score', 'desc').map((r) => r.id)).toEqual(['b', 'a']);
    expect(sortRows(rows, 'ai_rank', 'asc').map((r) => r.id)).toEqual(['b', 'a']);
  });

  test('nulls sort last in both directions — a missing component is not a zero', () => {
    const rows = [
      row('missing', 1, { demand_score: null }),
      row('present', 2, { demand_score: 5 }),
    ];
    expect(sortRows(rows, 'demand_score', 'asc').map((r) => r.id)).toEqual(['present', 'missing']);
    expect(sortRows(rows, 'demand_score', 'desc').map((r) => r.id)).toEqual(['present', 'missing']);
  });

  test('sorting by agent priority ignores rows without one', () => {
    const rows = [
      row('none', 1, {}, null),
      row('priority', 9, {}, decision(AgentDecisionAction.promote, 1)),
    ];
    expect(sortRows(rows, 'agent_priority', 'asc').map((r) => r.id)).toEqual(['priority', 'none']);
  });
});

describe('marketControlRows against real data', () => {
  async function fixture() {
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({
      data: { display_name: `Control Org ${s}`, tier: OrgTier.paid }, select: { id: true },
    });
    const agentUser = await prisma.user.create({
      data: { email: `ctl-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true },
    });
    await prisma.agentAssignment.create({
      data: { exporter_org_id: org.id, agent_user_id: agentUser.id, status: 'active' },
    });
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id }, select: { id: true } });

    const mk = (country: string, score: number) => prisma.marketAssessment.create({
      data: {
        run_id: run.id, country_code: country, overall_score: score, confidence_score: 60,
        model_version: 'market-v3', weight_profile_key: 'default', weight_profile_version: 1,
        scoring_policy_hash: 'hash-abc', reproducibility_status: 'reproducible',
        field_provenance: {
          demand_score: { source: 'comtrade', component_weight: 25, effective_renormalized_weight: 0.4 },
          competition_score: { status: 'unavailable', reason: 'Coverage below floor.' },
        },
      },
      select: { id: true },
    });
    const de = await mk('DE', 90);
    const fr = await mk('FR', 70);
    const es = await mk('ES', 50);

    const agent: Principal = {
      id: agentUser.id, email: 'a@t.test', name: 'Agent', role: UserRole.agent,
      exporter_org_id: null, tier: OrgTier.paid,
    };
    return { runId: run.id, de: de.id, fr: fr.id, es: es.id, agent };
  }

  const base = () => ({ reason: 'Agent judgement recorded during review.', correlationId: randomUUID() });

  test('model rank is derived from score, and survives an agent override', async () => {
    const f = await fixture();
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 1 });
    const rows = await marketControlRows(f.runId);

    const es = rows.find((r) => r.assessment.id === f.es)!;
    // The AI half is untouched: still third by score, still 50.
    expect(es.modelRank).toBe(3);
    expect(es.assessment.overall_score).toBe(50);
    // The agent half sits alongside it.
    expect(es.current?.agent_priority).toBe(1);
    expect(es.operationalOrder).toBe(1);
  });

  test('a rejected market is bucketed terminal with no operational order', async () => {
    const f = await fixture();
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de });
    const rows = await marketControlRows(f.runId);
    const de = rows.find((r) => r.assessment.id === f.de)!;

    expect(de.bucket).toBe('terminal');
    expect(de.operationalOrder).toBeNull();
    // The model's own rank is still readable — it is not erased, just not used for ordering.
    expect(de.modelRank).toBe(1);
    expect(activeOnly(rows).map((r) => r.assessment.id)).not.toContain(f.de);
  });

  test('a not-selected market is terminal; a paused one stays in the order', async () => {
    const f = await fixture();
    await markMarketNotSelected({ ...base(), actor: f.agent, subjectId: f.de });
    await pauseMarketAutomation({ ...base(), actor: f.agent, subjectId: f.fr });
    const rows = await marketControlRows(f.runId);

    expect(rows.find((r) => r.assessment.id === f.de)!.bucket).toBe('terminal');
    const fr = rows.find((r) => r.assessment.id === f.fr)!;
    expect(fr.bucket).toBe('flagged');
    expect(fr.operationalOrder).toBe(2);
  });

  test('restoring a rejected market returns it to the active list', async () => {
    const f = await fixture();
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de });
    await restoreMarket({ ...base(), actor: f.agent, subjectId: f.de });
    const rows = await marketControlRows(f.runId);
    const de = rows.find((r) => r.assessment.id === f.de)!;

    expect(de.bucket).toBe('active');
    // No priority on the restore, so it falls back to the model's rank.
    expect(de.operationalOrder).toBe(1);
    expect(activeOnly(rows).map((r) => r.assessment.id)).toContain(f.de);
  });

  test('a request_review market stays visible and flagged', async () => {
    const f = await fixture();
    await requestMarketReview({ ...base(), actor: f.agent, subjectId: f.fr });
    const rows = await marketControlRows(f.runId);
    const fr = rows.find((r) => r.assessment.id === f.fr)!;
    expect(fr.bucket).toBe('flagged');
    expect(activeOnly(rows).map((r) => r.assessment.id)).toContain(f.fr);
  });

  test('components and provenance come through on every row', async () => {
    const f = await fixture();
    const rows = await marketControlRows(f.runId);
    const de = rows.find((r) => r.assessment.id === f.de)!;

    expect(de.components).toHaveLength(8);
    expect(de.components.find((c) => c.field === 'demand_score')?.effectiveWeight).toBe(0.4);
    expect(de.components.find((c) => c.field === 'competition_score')?.unavailableReason).toMatch(/coverage/i);
    expect(de.provenance.reproducibilityStatus).toBe('reproducible');
    expect(de.provenance.scoringPolicyHash).toBe('hash-abc');
  });

  test('the full ordering respects buckets and priorities together', async () => {
    const f = await fixture();
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de });      // model rank 1 -> terminal
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 1 }); // rank 3 -> order 1
    const rows = sortByOperationalOrder(await marketControlRows(f.runId));

    expect(rows.map((r) => r.assessment.country_code)).toEqual(['ES', 'FR', 'DE']);
    expect(rows.at(-1)!.operationalOrder).toBeNull();
  });
});

describe('marketControlRows on a Demand Discovery v5 run', () => {
  async function v5Fixture() {
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({ data: { display_name: `V5 Control ${s}`, tier: OrgTier.paid }, select: { id: true } });
    const agentUser = await prisma.user.create({ data: { email: `v5ctl-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } });
    await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agentUser.id, status: 'active' } });
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, model_version: 'market-opportunity-v5' }, select: { id: true } });
    const metric = { key: 'market_size', score: 80, quality: 1, reason: null, inputs: { average_imports_usd: 1_000_000 } };
    const mk = (country: string, data: { overall_score: number | null; market_status: string; rank: number | null; live_points: number | null; handed_off?: boolean; flag_reasons?: string[] }) => prisma.marketAssessment.create({
      data: {
        run_id: run.id, country_code: country, confidence_score: 70, model_version: 'market-opportunity-v5', weight_profile_key: 'demand-discovery-v5-policy-v2',
        weight_profile_version: 1, scoring_policy_hash: 'hash-v5', reproducibility_status: 'reproducible', data_year: 2024,
        score_breakdown: { parts: [{ part: 'demand', points: 35, live_points: 35, score: 80 }], metrics: [metric] },
        labels: [{ key: 'big_and_growing', text: 'Big and growing', tone: 'positive' }], reasons: [{ metric: 'market_size', effect: 'adds', text: 'Imports average $1.0 million a year.' }],
        ...data, flag_reasons: data.flag_reasons ?? [],
      },
      select: { id: true },
    });
    const us = await mk('US', { overall_score: 80, market_status: 'ranked', rank: 1, live_points: 90, handed_off: true });
    const de = await mk('DE', { overall_score: 70, market_status: 'ranked', rank: 2, live_points: 85, handed_off: true, flag_reasons: ['ECGC cover is restricted (Group II)'] });
    // A partial score above both ranked ones: shown, never ranked.
    const tv = await mk('TV', { overall_score: 85, market_status: 'not_enough_data', rank: null, live_points: 30 });
    const kp = await mk('KP', { overall_score: null, market_status: 'excluded', rank: null, live_points: null });
    const agent: Principal = { id: agentUser.id, email: 'a@t.test', name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
    return { runId: run.id, us: us.id, de: de.id, tv: tv.id, kp: kp.id, agent };
  }

  test('the stored rank is the model rank; a partial score is never ranked; the v5 measures replace the eight components', async () => {
    const f = await v5Fixture();
    const rows = await marketControlRows(f.runId);
    expect(rows.map((r) => [r.assessment.country_code, r.modelRank])).toEqual([['US', 1], ['DE', 2], ['TV', null], ['KP', null]]);
    const tv = rows.find((r) => r.assessment.id === f.tv)!;
    expect(tv.operationalOrder).toBeNull();
    expect(tv.components).toEqual([]);
    expect(tv.v5).toMatchObject({ market_status: 'not_enough_data', overall_score: 85, live_points: 30, total_ranked: 2, rank: null });
    expect(rows.find((r) => r.assessment.id === f.de)!.v5).toMatchObject({ rank: 2, handed_off: true, flag_reasons: ['ECGC cover is restricted (Group II)'], metrics: [{ key: 'market_size', score: 80 }] });
    const ordered = sortByOperationalOrder(rows).map((r) => r.assessment.country_code);
    expect(ordered.slice(0, 2)).toEqual(['US', 'DE']);
    expect(ordered.slice(2).sort()).toEqual(['KP', 'TV']);
  });

  test('an agent may still promote an unranked market; the decision freezes the stored rank, not a count of scores', async () => {
    const f = await v5Fixture();
    await promoteMarket({ actor: f.agent, subjectId: f.tv, agentPriority: 1, reason: 'Agent judgement recorded during review.', correlationId: randomUUID() });
    await promoteMarket({ actor: f.agent, subjectId: f.de, agentPriority: 2, reason: 'Agent judgement recorded during review.', correlationId: randomUUID() });
    const rows = await marketControlRows(f.runId);
    const tv = rows.find((r) => r.assessment.id === f.tv)!;
    expect(tv.operationalOrder).toBe(1);
    expect(tv.modelRank).toBeNull();
    expect(tv.current).toMatchObject({ original_rank: null, original_score: 85, original_model_version: 'market-opportunity-v5' });
    expect(rows.find((r) => r.assessment.id === f.de)!.current).toMatchObject({ original_rank: 2, original_score: 70 });
  });
});

describe('Phase 2b: the full write path, assessment -> decision -> audit -> refreshed order', () => {
  async function scenario() {
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({
      data: { display_name: `WritePath ${s}`, tier: OrgTier.paid }, select: { id: true },
    });
    const [agentUser, otherAgentUser] = await Promise.all([
      prisma.user.create({ data: { email: `wp-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
      prisma.user.create({ data: { email: `wp2-${s}@t.test`, name: 'Other', role: UserRole.agent }, select: { id: true } }),
    ]);
    await prisma.agentAssignment.create({
      data: { exporter_org_id: org.id, agent_user_id: agentUser.id, status: 'active' },
    });
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id }, select: { id: true } });
    const mk = (country: string, score: number) => prisma.marketAssessment.create({
      data: {
        run_id: run.id, country_code: country, overall_score: score, confidence_score: 60,
        model_version: 'market-v3', weight_profile_key: 'default', weight_profile_version: 1,
      },
      select: { id: true },
    });
    const de = await mk('DE', 90);   // model rank 1
    const fr = await mk('FR', 70);   // model rank 2
    const es = await mk('ES', 50);   // model rank 3

    const principal = (id: string): Principal => ({
      id, email: 'x@t.test', name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid,
    });
    return {
      runId: run.id, de: de.id, fr: fr.id, es: es.id,
      agent: principal(agentUser.id), stranger: principal(otherAgentUser.id),
    };
  }
  const base = () => ({ reason: 'Recorded during weekly account review.', correlationId: randomUUID() });

  /** Every field of the assessment, so "unchanged" means genuinely byte-identical. */
  const snapshotAll = (runId: string) =>
    prisma.marketAssessment.findMany({ where: { run_id: runId }, orderBy: { id: 'asc' } });

  test('an explicit priority beats a model-rank fallback after a real promote', async () => {
    const f = await scenario();
    // ES is model rank 3; promoting it to priority 1 must place it above DE (model rank 1).
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 1 });
    const rows = sortByOperationalOrder(await marketControlRows(f.runId));

    expect(rows.map((r) => r.assessment.country_code)).toEqual(['ES', 'DE', 'FR']);
    const es = rows.find((r) => r.assessment.id === f.es)!;
    const de = rows.find((r) => r.assessment.id === f.de)!;
    expect(es.operationalOrder).toBe(1);
    expect(de.operationalOrder).toBe(1); // same number, lower precedence
    // Neither AI rank moved.
    expect(es.modelRank).toBe(3);
    expect(de.modelRank).toBe(1);
  });

  test('two explicit equal priorities stay tied and order deterministically by AI rank', async () => {
    const f = await scenario();
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 1 });
    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.fr, agentPriority: 1 });
    const rows = sortByOperationalOrder(await marketControlRows(f.runId));

    // FR (model rank 2) precedes ES (model rank 3); neither priority was rewritten.
    expect(rows.map((r) => r.assessment.country_code)).toEqual(['FR', 'ES', 'DE']);
    expect(rows[0]!.current?.agent_priority).toBe(1);
    expect(rows[1]!.current?.agent_priority).toBe(1);
  });

  test('reject removes a market from the active bucket; restore returns it', async () => {
    const f = await scenario();
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de });
    let rows = await marketControlRows(f.runId);
    let de = rows.find((r) => r.assessment.id === f.de)!;
    expect(de.bucket).toBe('terminal');
    expect(de.operationalOrder).toBeNull();
    expect(activeOnly(rows).map((r) => r.assessment.id)).not.toContain(f.de);

    await restoreMarket({ ...base(), actor: f.agent, subjectId: f.de });
    rows = await marketControlRows(f.runId);
    de = rows.find((r) => r.assessment.id === f.de)!;
    expect(de.bucket).toBe('active');
    expect(de.operationalOrder).toBe(1);
    expect(activeOnly(rows).map((r) => r.assessment.id)).toContain(f.de);
  });

  test('pause keeps the market in the order and shows a paused state', async () => {
    const f = await scenario();
    await pauseMarketAutomation({ ...base(), actor: f.agent, subjectId: f.fr });
    const rows = await marketControlRows(f.runId);
    const fr = rows.find((r) => r.assessment.id === f.fr)!;

    expect(fr.bucket).toBe('flagged');
    expect(fr.current?.action).toBe('pause_automation');
    expect(fr.operationalOrder).toBe(2);
    expect(activeOnly(rows).map((r) => r.assessment.id)).toContain(f.fr);
  });

  test('a reason is mandatory', async () => {
    const f = await scenario();
    await expect(rejectMarket({ ...base(), actor: f.agent, subjectId: f.de, reason: '   ' }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.agentDecision.count({ where: { market_assessment_id: f.de } })).toBe(0);
  });

  test('an unassigned agent is refused and writes nothing', async () => {
    const f = await scenario();
    await expect(rejectMarket({ ...base(), actor: f.stranger, subjectId: f.de }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await prisma.agentDecision.count({ where: { market_assessment_id: f.de } })).toBe(0);
  });

  test('every action writes an audit event carrying the frozen AI snapshot', async () => {
    const f = await scenario();
    const decision = await promoteMarket({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 2 });
    const events = await prisma.auditEvent.findMany({
      where: { object_type: 'agent_decision', object_id: decision.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('override');
    expect(events[0]!.after_summary).toMatchObject({
      action: 'promote', subject_id: f.es, original_score: 50, original_rank: 3, agent_priority: 2,
    });
  });

  test('history keeps superseded decisions, each with its own AI snapshot', async () => {
    const f = await scenario();
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de, reason: 'Tariff risk.' });
    await restoreMarket({ ...base(), actor: f.agent, subjectId: f.de, reason: 'Risk cleared.' });
    const rows = await marketControlRows(f.runId);
    const de = rows.find((r) => r.assessment.id === f.de)!;

    expect(de.history).toHaveLength(2);
    expect(de.history[0]!.action).toBe('restore');
    expect(de.history[0]!.state).toBe('active');
    // The earlier decision is retained, marked superseded — never silently dropped.
    expect(de.history[1]!.action).toBe('reject');
    expect(de.history[1]!.state).toBe('superseded');
    expect(de.history[1]!.original_score).toBe(90);
  });

  test('the underlying MarketAssessment rows are byte-identical after every action', async () => {
    const f = await scenario();
    const before = await snapshotAll(f.runId);

    await promoteMarket({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 1 });
    await demoteMarket({ ...base(), actor: f.agent, subjectId: f.fr, agentPriority: 9 });
    await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de });
    await restoreMarket({ ...base(), actor: f.agent, subjectId: f.de });
    await markMarketSelected({ ...base(), actor: f.agent, subjectId: f.es, agentPriority: 1 });
    await markMarketNotSelected({ ...base(), actor: f.agent, subjectId: f.fr });
    await pauseMarketAutomation({ ...base(), actor: f.agent, subjectId: f.es });
    await resumeMarketAutomation({ ...base(), actor: f.agent, subjectId: f.es });
    await requestMarketReview({ ...base(), actor: f.agent, subjectId: f.es });

    // Nine decisions across every market action, and the model's output is untouched.
    expect(await snapshotAll(f.runId)).toEqual(before);
    expect(await prisma.agentDecision.count({ where: { market_assessment_id: { in: [f.de, f.fr, f.es] } } })).toBe(9);
  });

  test('there is no update path: a change of mind appends and supersedes', async () => {
    const f = await scenario();
    const first = await rejectMarket({ ...base(), actor: f.agent, subjectId: f.de });
    const second = await restoreMarket({ ...base(), actor: f.agent, subjectId: f.de });
    expect(second.supersedes_id).toBe(first.id);
    // The original row is unchanged by the supersession.
    expect(await prisma.agentDecision.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
  });
});
