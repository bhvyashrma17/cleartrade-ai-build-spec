import { randomUUID } from 'node:crypto';
import { JobStatus, OrgTier, ProductClassificationMethod, ProductClassificationStatus, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agentCountryTruthWork,
  answerClassificationQuestions,
  classificationQuestions,
  compareMarkets,
  countryDetail,
  marketResults,
  productDiscoveryState,
  startMarketDiscovery,
} from '@/lib/country-discovery/service';
import { prisma } from '../src/lib/prisma';
import type { CandidateLine } from '@/lib/market-access/classification-refinement';
import type { Principal } from '@/types';

afterAll(() => prisma.$disconnect());

/** The real UK shape for HS 100630: one Basmati line among grain-length and pack-size siblings. */
const UK_CANDIDATES: CandidateLine[] = [
  { national_tariff_code: '1006302110', description: 'In immediate packings of a net content not exceeding 5 kg', description_path: ['Semi-milled rice', 'Parboiled', 'Round grain'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { national_tariff_code: '1006302190', description: 'Other', description_path: ['Semi-milled rice', 'Parboiled', 'Round grain'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { national_tariff_code: '1006302712', description: 'Basmati rice', description_path: ['Semi-milled rice', 'Parboiled', 'Long grain', 'Aromatic rice'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
  { national_tariff_code: '1006309692', description: 'Other', description_path: ['Wholly milled rice', 'Long grain'], duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' },
];

async function fixture(options: { withAnalysis?: boolean } = {}) {
  const marker = `disc-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const owner = await prisma.user.create({ data: { email: `${marker}-owner@example.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const agent = await prisma.user.create({ data: { email: `${marker}-agent@example.test`, name: 'Agent', role: UserRole.agent } });
  // An agent reaches an exporter only through an active assignment — the same gate the
  // "unassigned agent" test below relies on being real.
  await prisma.agentAssignment.create({ data: { agent_user_id: agent.id, exporter_org_id: org.id, status: 'active' } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Basmati rice 1121' } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: '100630', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_confirmed_by_id: agent.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  const classification = await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: '100630', nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: {}, evidence: {}, rationale: 'test', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: agent.id, confirmed_by_id: agent.id, confirmed_at: now } });

  const snapshot = await prisma.marketAccessEvidenceSnapshot.create({ data: {
    jurisdiction: 'GB', country_code: 'GB', hs_code_scope: '100630', hs6_code: '100630', national_code_system: 'UK_COMMODITY',
    classification_resolution: 'classification_refinement_required', candidate_line_count: UK_CANDIDATES.length,
    resolution_detail: { declarable_candidates: UK_CANDIDATES.map((candidate) => ({ code: candidate.national_tariff_code, description: candidate.description, description_path: candidate.description_path ?? [], duty: candidate.duty_expression, duty_kind: candidate.duty_kind, effective_from: null, effective_to: null })) },
    source_authority: 'HMRC UK Integrated Online Tariff', source_reference: 'https://www.trade-tariff.service.gov.uk/uk/api/search?q=100630',
    retrieved_at: now, completeness_status: 'PARTIAL', tariff_coverage: false, regulatory_coverage: false,
    parser_version: 'test', evidence_origin: 'fixture', provider: 'test', raw_evidence: {},
  } });

  let run = null;
  if (options.withAnalysis) {
    run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, product_id: product.id, status: JobStatus.completed } });
    const markets = [
      { country_code: 'DE', overall_score: 76, confidence_score: 48, state: 'rankable' },
      { country_code: 'GB', overall_score: 71, confidence_score: 48, state: 'rankable' },
      { country_code: 'US', overall_score: 65, confidence_score: 48, state: 'rankable' },
    ];
    for (const market of markets) {
      await prisma.marketAssessment.create({ data: {
        run_id: run.id, product_id: product.id, country_code: market.country_code,
        overall_score: market.overall_score, confidence_score: market.confidence_score,
        country_truth_assessment_state: market.state,
        country_truth_period_set: [2021, 2022, 2023, 2024, 2025],
        country_truth_as_of_date: new Date('2026-08-27T00:00:00Z'),
        model_version: 'market-attractiveness-v4', weight_profile_key: 'default', weight_profile_version: 1,
        rationale: 'Deterministic rationale.',
        field_provenance: {
          demand_score: { score: 74, available: true, confidence: 100, effective_weight: 0.5, exclusion_reason: null },
          growth_score: { score: 82, available: true, confidence: 100, effective_weight: 0.2, exclusion_reason: null },
          competition_score: { score: 68, available: true, confidence: 100, effective_weight: 0.2, exclusion_reason: null },
          risk_resilience: { score: 87, available: true, confidence: 60, effective_weight: 0.1, exclusion_reason: null },
          market_access: { score: null, available: false, confidence: 0, effective_weight: 0, exclusion_reason: 'tariff unavailable' },
          export_economics: { score: null, available: false, confidence: 0, effective_weight: 0, exclusion_reason: 'No sufficient sourced export-economics input.' },
          exporter_market_fit: { score: null, available: false, confidence: 0, effective_weight: 0, exclusion_reason: 'insufficient_exporter_data' },
          logistics_feasibility: { score: null, available: false, confidence: 0, effective_weight: 0, exclusion_reason: 'No current explicit route-availability evidence exists.' },
        },
      } });
    }
  }

  const principal = (user: { id: string; email: string; name: string | null; role: UserRole }, orgId: string | null): Principal =>
    ({ id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: orgId, tier: OrgTier.paid });

  return {
    org, owner, agent, product, classification, snapshot, run,
    ownerPrincipal: principal(owner, org.id),
    agentPrincipal: principal(agent, null),
  };
}

describe('tenant isolation', () => {
  test('a product in another org is not found, never forbidden', async () => {
    const [mine, theirs] = await Promise.all([fixture(), fixture()]);
    // NOT_FOUND rather than FORBIDDEN: a 403 on a guessed id confirms the id exists, which
    // turns the error code itself into an existence oracle across tenants.
    await expect(productDiscoveryState(mine.ownerPrincipal, mine.org.id, theirs.product.id))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Naming the other org outright is refused the same way.
    await expect(productDiscoveryState(mine.ownerPrincipal, theirs.org.id, theirs.product.id))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('another tenant’s market analysis cannot be read through any surface', async () => {
    const [mine, theirs] = await Promise.all([fixture(), fixture({ withAnalysis: true })]);
    for (const call of [
      () => marketResults(mine.ownerPrincipal, theirs.org.id, theirs.product.id),
      () => countryDetail(mine.ownerPrincipal, theirs.org.id, theirs.product.id, 'DE'),
      () => compareMarkets(mine.ownerPrincipal, theirs.org.id, theirs.product.id, ['DE', 'GB']),
      () => classificationQuestions(mine.ownerPrincipal, theirs.org.id, theirs.product.id, 'GB'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'NOT_FOUND' });
    }
  });

  test('an unassigned agent cannot read Country Truth work for an org they do not hold', async () => {
    const [target, other] = await Promise.all([fixture(), fixture()]);
    await expect(agentCountryTruthWork(other.agentPrincipal, target.org.id)).rejects.toBeTruthy();
  });

  test('an exporter cannot open the agent work queue', async () => {
    const f = await fixture();
    await expect(agentCountryTruthWork(f.ownerPrincipal, f.org.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('screening request', () => {
  test('an unclassified product is refused rather than screened', async () => {
    const marker = `disc-${randomUUID()}`;
    const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
    const owner = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
    const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Unclassified' } });
    const principal = { id: owner.id, email: owner.email, name: owner.name, role: UserRole.exporter_owner, exporter_org_id: org.id, tier: OrgTier.paid };
    await expect(startMarketDiscovery(principal, org.id, product.id, randomUUID()))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('the request accepts no country input at any layer', async () => {
    // The signature itself is the guard: there is no parameter through which a caller could
    // name markets, so Stage A's candidate set cannot be biased by the requester.
    expect(startMarketDiscovery).toHaveLength(4);
    const route = await import('node:fs').then((fs) =>
      fs.readFileSync('src/app/api/v1/exporters/[exporterOrgId]/products/[productId]/market-discovery/route.ts', 'utf8'));
    // No request-body field names a market. (`country` appears only in the route's own prose
    // explaining that it accepts none, so this matches on the shapes a body would take.)
    expect(route).not.toMatch(/candidate_countries|country_code|countries:|request\.json/);
    expect(route).toContain('Deliberately takes NO body');
  });
});

describe('market results and detail', () => {
  test('markets are ranked and the detail page agrees with the list', async () => {
    const f = await fixture({ withAnalysis: true });
    const results = await marketResults(f.ownerPrincipal, f.org.id, f.product.id);
    expect(results.markets.map((market) => market.country_code)).toEqual(['DE', 'GB', 'US']);
    expect(results.markets.map((market) => market.rank)).toEqual([1, 2, 3]);
    // Names come from the registry, not from ISO codes echoed back.
    expect(results.markets[0]!.country).toBe('Germany');

    const detail = await countryDetail(f.ownerPrincipal, f.org.id, f.product.id, 'GB');
    expect(detail.market.rank).toBe(2);
    expect(detail.market.attractiveness).toBe(71);
  });

  test('an unavailable pillar reaches the detail view as null with a reason', async () => {
    const f = await fixture({ withAnalysis: true });
    const detail = await countryDetail(f.ownerPrincipal, f.org.id, f.product.id, 'DE');
    const marketAccess = detail.market.pillars.find((pillar) => pillar.key === 'market_access')!;
    expect(marketAccess.score).toBeNull();
    expect(marketAccess.state).toBe('not_established');
    expect(detail.market.pillars_not_established).toBe(4);
  });

  test('a market outside the analysis is not found rather than invented', async () => {
    const f = await fixture({ withAnalysis: true });
    await expect(countryDetail(f.ownerPrincipal, f.org.id, f.product.id, 'ZA'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('comparison keeps missing evidence missing and names what it could not include', async () => {
    const f = await fixture({ withAnalysis: true });
    const comparison = await compareMarkets(f.ownerPrincipal, f.org.id, f.product.id, ['DE', 'US', 'ZA']);
    expect(comparison.markets.map((market) => market.country_code)).toEqual(['DE', 'US']);
    expect(comparison.unavailable).toEqual(['ZA']);
    for (const market of comparison.markets) {
      const economics = market.pillars.find((pillar) => pillar.key === 'export_economics')!;
      expect(economics.score).toBeNull();
      expect(economics.score).not.toBe(0);
    }
  });

  test('comparison is capped at three markets', async () => {
    const f = await fixture({ withAnalysis: true });
    const comparison = await compareMarkets(f.ownerPrincipal, f.org.id, f.product.id, ['DE', 'GB', 'US', 'ZA']);
    expect(comparison.markets.length + comparison.unavailable.length).toBeLessThanOrEqual(3);
  });
});

describe('classification refinement, exporter-facing', () => {
  test('questions are about the goods and never expose a tariff code', async () => {
    const f = await fixture();
    const view = await classificationQuestions(f.ownerPrincipal, f.org.id, f.product.id, 'GB');
    expect(view.state).toBe('questions');
    expect(view.candidate_total).toBe(4);
    const serialized = JSON.stringify(view.questions);
    // Not one of the four candidate codes may appear in what the browser is handed.
    for (const candidate of UK_CANDIDATES) expect(serialized).not.toContain(candidate.national_tariff_code);
    expect(view.questions.some((question) => /parboiled|basmati|grain/i.test(question.question))).toBe(true);
  });

  test('answering narrows server-side and the exporter never sends a code', async () => {
    const f = await fixture();
    const after = await answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'GB', answers: { basmati: 'yes' }, correlation_id: randomUUID(),
    }).then(() => classificationQuestions(f.ownerPrincipal, f.org.id, f.product.id, 'GB'));
    expect(after.remaining).toBe(1);
    expect(after.state).toBe('resolved');
    // Resolved by the exporter's own answers is explicitly NOT a verified classification.
    expect(after.resolved_line!.verification).toMatch(/not yet verified/i);
    expect(after.resolved_line!.description).toContain('Basmati');
  });

  test('an exporter’s answers are recorded as refinement_required, never as a verified selection', async () => {
    const f = await fixture();
    const record = await answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'GB', answers: { basmati: 'yes' }, correlation_id: randomUUID(),
    });
    expect(record.state).toBe('refinement_required');
    expect(record.selected_national_code).toBeNull();
    expect(record.assertion_class).toBe('exporter_declared');
  });

  test('earlier answers are preserved rather than overwritten by a later submission', async () => {
    const f = await fixture();
    await answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'GB', answers: { parboiled: 'yes' }, correlation_id: randomUUID(),
    });
    const second = await answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'GB', answers: { grain_length: 'no' }, correlation_id: randomUUID(),
    });
    expect(second.deciding_attributes).toMatchObject({ parboiled: 'yes', grain_length: 'no' });
  });

  test('an answer contradicting every remaining candidate is refused', async () => {
    const f = await fixture();
    await answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'GB', answers: { basmati: 'yes' }, correlation_id: randomUUID(),
    });
    // Basmati is long-grain aromatic; "not long grain" contradicts the only line still in scope.
    await expect(answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'GB', answers: { grain_length: 'no' }, correlation_id: randomUUID(),
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a destination with no authoritative tariff evidence says so rather than guessing', async () => {
    const f = await fixture();
    const view = await classificationQuestions(f.ownerPrincipal, f.org.id, f.product.id, 'ZA');
    expect(view.state).toBe('no_evidence_yet');
    expect(view.questions).toHaveLength(0);
    await expect(answerClassificationQuestions({
      actor: f.ownerPrincipal, exporter_org_id: f.org.id, product_id: f.product.id,
      country_code: 'ZA', answers: { basmati: 'yes' }, correlation_id: randomUUID(),
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('agent action surface', () => {
  test('only ClearTrade-owned tasks are queued to the agent', async () => {
    const f = await fixture({ withAnalysis: true });
    const work = await agentCountryTruthWork(f.agentPrincipal, f.org.id);
    const view = work.find((entry) => entry.product.id === f.product.id)!;
    expect(view.tasks.length).toBeGreaterThan(0);
    const labels = view.tasks.map((task) => task.label).join(' ');
    // The exporter's own missing facts belong on the exporter's surface, not the agent's queue.
    expect(labels).not.toMatch(/Add your target export price|Add production capacity/);
    expect(labels).toMatch(/Confirm the destination tariff line|Collect freight/);
  });
});
