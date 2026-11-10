import { randomUUID } from 'node:crypto';
import { JobStatus, OrgTier, ProductClassificationMethod, ProductClassificationStatus, UserRole } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { agentCountryTruthWork, marketResults, v5Market } from '@/lib/country-discovery/service';
import { rankMarkets, V5_MODEL_VERSION, type AssessmentRecord } from '@/lib/country-discovery/market-view';
import { v5AgentActions, v5DutyIsOfficial, v5MarketStatus } from '@/lib/country-discovery/v5-work';
import { buildWorkQueue } from '@/lib/country-discovery/work-queue';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '@/types';

/**
 * E-061: the agent's Demand Discovery views read v5 runs as v5. On production (10 Nov 2026) the
 * assigned agent of Lappu Exports saw Vatican City (a partial 93 over 20 of 100 points, not ranked)
 * as the top market, Country Truth statuses on every row and 872 v4 tasks; the exporter's own
 * Markets page had the United States first. The agent now sees the engine's order, its statuses,
 * and work only where it changes a result: a handed-on market's tariff line, when the stored score
 * used no official duty.
 */

/** The real UK shape for HS 100630 (`country-discovery-service.test.ts`): it asks about the goods. */
const UK_CANDIDATES = [
  { code: '1006302110', description: 'In immediate packings of a net content not exceeding 5 kg', description_path: ['Semi-milled rice', 'Parboiled', 'Round grain'], duty: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { code: '1006302190', description: 'Other', description_path: ['Semi-milled rice', 'Parboiled', 'Round grain'], duty: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { code: '1006302712', description: 'Basmati rice', description_path: ['Semi-milled rice', 'Parboiled', 'Long grain', 'Aromatic rice'], duty: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { code: '1006309692', description: 'Other', description_path: ['Wholly milled rice', 'Long grain'], duty: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
];

const breakdown = (basis: 'official' | 'estimate') => ({
  parts: [{ part: 'demand', points: 40, live_points: 40, score: 80 }],
  metrics: [
    { key: 'market_size', score: 90, quality: 1, reason: null, inputs: {} },
    { key: 'duty', score: 70, quality: basis === 'official' ? 1 : 0.5, reason: null, inputs: { duty_percent: 7.5, basis }, ...(basis === 'estimate' ? { estimated: true } : {}) },
  ],
});

let agent: Principal;
let stranger: Principal;
let orgId = '';
let productId = '';

beforeAll(async () => {
  const marker = `agent-v5-${randomUUID().slice(0, 8)}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: `${marker} exporter`, tier: OrgTier.paid } });
  const agentUser = await prisma.user.create({ data: { email: `${marker}-agent@example.test`, name: 'Agent', role: UserRole.agent } });
  const strangerUser = await prisma.user.create({ data: { email: `${marker}-stranger@example.test`, name: 'Other agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { agent_user_id: agentUser.id, exporter_org_id: org.id, status: 'active' } });
  agent = { id: agentUser.id, email: agentUser.email, name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
  stranger = { id: strangerUser.id, email: strangerUser.email, name: 'Other agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
  orgId = org.id;

  const now = new Date();
  const product = await prisma.product.create({ data: {
    exporter_org_id: org.id, name: `${marker} basmati`, description: 'Basmati rice', hs_code: '100630', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022',
    hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_confirmed_by_id: agentUser.id, hs_confirmed_at: now, hs_classification_revision: 1,
  } });
  productId = product.id;
  await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: '100630', nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {}, rationale: 'test', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: agentUser.id, confirmed_by_id: agentUser.id, confirmed_at: now } });

  // The HS code splits into national lines in Great Britain and in the United States. The run
  // scored the United States with an official duty all the same, and Great Britain with an estimate.
  for (const country of ['GB', 'US']) {
    await prisma.marketAccessEvidenceSnapshot.create({ data: {
      jurisdiction: country, country_code: country, hs_code_scope: '100630', hs6_code: '100630', national_code_system: country === 'GB' ? 'UK_COMMODITY' : 'HTS',
      classification_resolution: 'classification_refinement_required', candidate_line_count: UK_CANDIDATES.length,
      resolution_detail: { declarable_candidates: UK_CANDIDATES.map((candidate) => ({ ...candidate, effective_from: null, effective_to: null })) },
      source_authority: 'Test tariff', source_reference: `https://example.test/${country}/100630`,
      retrieved_at: now, completeness_status: 'PARTIAL', tariff_coverage: false, regulatory_coverage: false,
      parser_version: 'test', evidence_origin: 'fixture', provider: 'test', raw_evidence: {},
    } });
  }

  const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, product_id: product.id, model_version: V5_MODEL_VERSION, status: JobStatus.partial, completed_at: now } });
  const market = (country: string, fields: { status: string; rank: number | null; score: number | null; confidence: number; handed_off?: boolean; duty?: 'official' | 'estimate' }) => ({
    run_id: run.id, product_id: product.id, country_code: country, model_version: V5_MODEL_VERSION, weight_profile_key: 'test', weight_profile_version: 1,
    market_status: fields.status, rank: fields.rank, overall_score: fields.score, confidence_score: fields.confidence, handed_off: fields.handed_off ?? false,
    live_points: fields.status === 'ranked' ? 100 : fields.status === 'not_enough_data' ? 20 : null, classification_hs6_code: '100630',
    score_breakdown: fields.duty ? breakdown(fields.duty) : undefined,
  });
  await prisma.marketAssessment.createMany({ data: [
    // Vatican City and Martinique: high partial scores over 20 of 100 points. Before E-061 they led.
    market('VA', { status: 'not_enough_data', rank: null, score: 93, confidence: 0 }),
    market('MQ', { status: 'not_enough_data', rank: null, score: 92, confidence: 0 }),
    market('KP', { status: 'excluded', rank: null, score: null, confidence: 0 }),
    market('DE', { status: 'ranked', rank: 4, score: 70, confidence: 75 }),
    market('GB', { status: 'ranked', rank: 3, score: 80, confidence: 70, handed_off: true, duty: 'estimate' }),
    market('SA', { status: 'ranked', rank: 2, score: 83, confidence: 81, handed_off: true, duty: 'official' }),
    market('US', { status: 'ranked', rank: 1, score: 85, confidence: 82, handed_off: true, duty: 'official' }),
  ] });
});

afterAll(() => prisma.$disconnect());

describe('the agent’s view of a v5 run', () => {
  test('one model identity for every surface', () => {
    expect(V5_MODEL_VERSION).toBe(DEMAND_DISCOVERY_V5_MODEL);
  });

  test('the Demand Discovery tab leads with the engine’s rank #1, in the engine’s order and words', async () => {
    const [view] = await agentCountryTruthWork(agent, orgId);
    expect(view!.model_version).toBe(DEMAND_DISCOVERY_V5_MODEL);
    expect(view!.summary.top_market).toMatchObject({ country_code: 'US', attractiveness: 85, confidence: 82 });
    expect(view!.top_markets.map((market) => market.country_code)).toEqual(['US', 'SA', 'GB', 'DE', 'VA']);
    const status = Object.fromEntries(view!.top_markets.map((market) => [market.country_code, market.status]));
    // The United States' line splits too, but its score used the official duty: no question is due.
    expect(status).toEqual({ US: 'Handed on to buyer search', SA: 'Handed on to buyer search', GB: expect.stringMatching(/^Tariff line needs \d+ answers?$/), DE: 'Ranked', VA: 'Not enough data' });
    // A market the engine did not rank shows no score: its partial 93 is not an attractiveness.
    expect(view!.top_markets.find((market) => market.country_code === 'VA')!.attractiveness).toBeNull();
  });

  test('the work queue holds the handed-on markets’ tariff-line questions, and nothing from Country Truth', async () => {
    const [view] = await agentCountryTruthWork(agent, orgId);
    expect(view!.queue.map((task) => task.code)).toEqual(['GB:answer_tariff_line_questions']);
    expect(view!.queue[0]).toMatchObject({ category: 'classification', priority: 'top_ranked', unlocks: ['Official duty'] });
    expect(view!.queue[0]!.detail).toContain('estimated duty');
    expect(view!.tasks.map((task) => task.code)).toEqual(['GB:answer_tariff_line_questions']);
    expect(view!.queue_summary).toMatchObject({ total: 1, needs_attention: 1 });
  });

  test('a market page reads the v5 breakdown, under the same assignment rule', async () => {
    const gb = await v5Market(agent, orgId, productId, 'gb');
    expect(gb).toMatchObject({ country_code: 'GB', detail: { market_status: 'ranked', rank: 3, total_ranked: 4, handed_off: true } });
    const va = await v5Market(agent, orgId, productId, 'VA');
    expect(va!.detail).toMatchObject({ market_status: 'not_enough_data', rank: null });
    await expect(v5Market(agent, orgId, productId, 'FR')).rejects.toThrow(/not in this product/);
    await expect(v5Market(stranger, orgId, productId, 'GB')).rejects.toThrow();
    // The list page redirects v5 runs to the market control table; it learns the engine from here.
    expect((await marketResults(agent, orgId, productId)).run?.model_version).toBe(DEMAND_DISCOVERY_V5_MODEL);
  });
});

describe('v5 ordering and work, pure', () => {
  const row = (country: string, status: string, rank: number | null, score: number | null) => ({
    id: country, country_code: country, overall_score: score, confidence_score: 0, model_version: V5_MODEL_VERSION, market_status: status, rank,
    country_truth_assessment_state: null, country_truth_period_set: null, country_truth_as_of_date: null, generated_at: new Date(), rationale: null,
    field_provenance: null, is_selected: false, saved_at: null, country_trade_metrics: null,
  }) as unknown as AssessmentRecord;

  test('ranked markets in stored rank, then not enough data by score, then no recorded imports, then excluded', () => {
    const order = rankMarkets([row('KP', 'excluded', null, null), row('VA', 'not_enough_data', null, 93), row('FO', 'not_enough_data', null, 52), row('ZZ', 'no_recorded_demand', null, null), row('GB', 'ranked', 2, 80), row('US', 'ranked', 1, 79)]);
    expect(order.map((entry) => entry.country_code)).toEqual(['US', 'GB', 'VA', 'FO', 'ZZ', 'KP']);
  });

  test('a handed-on market’s work is due with the top-ranked, wherever it ranks', () => {
    const actions = v5AgentActions({ state: 'questions', remaining: 4, questions: [{}] });
    const queue = buildWorkQueue([
      { country_code: 'AE', country: 'United Arab Emirates', rank: 8, is_selected: false, is_marked: false, is_excluded: false, is_handed_off: true, actions },
      { country_code: 'FR', country: 'France', rank: 12, is_selected: false, is_marked: false, is_excluded: false, actions },
    ]);
    expect(queue.map((task) => [task.country_code, task.priority])).toEqual([['AE', 'top_ranked'], ['FR', 'backlog']]);
    expect(actions[0]!.label).toBe('Answer 1 tariff-line question');
    expect(v5AgentActions({ state: 'resolved', remaining: 1, questions: [] })).toEqual([]);
    expect(v5AgentActions({ state: 'agent_classification_required', remaining: 3, questions: [] })).toEqual([]);
  });

  test('statuses and the official-duty test read the stored row', () => {
    expect(v5MarketStatus({ market_status: 'excluded' })).toEqual({ status: 'Excluded', status_tone: 'incomplete' });
    expect(v5MarketStatus({ market_status: 'ranked', handed_off: false }, { state: 'agent_classification_required', remaining: 3, questions: [] }).status).toBe('Needs ClearTrade classification');
    expect(v5DutyIsOfficial(breakdown('official'))).toBe(true);
    expect(v5DutyIsOfficial(breakdown('estimate'))).toBe(false);
    expect(v5DutyIsOfficial({ metrics: [{ key: 'duty', score: 100, inputs: { basis: 'rule' } }] })).toBe(true);
    expect(v5DutyIsOfficial({ metrics: [{ key: 'duty', score: null, inputs: { basis: 'official' } }] })).toBe(false);
    expect(v5DutyIsOfficial(null)).toBe(false);
  });
});
