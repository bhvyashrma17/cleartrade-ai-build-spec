import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OrgTier, UserRole } from '@prisma/client';
import { beforeAll, describe, expect, test } from 'vitest';
import { buyerControlRows } from '../src/lib/buyer-control';
import { marketControlRows } from '../src/lib/demand-control';
import { prisma } from '../src/lib/prisma';
import { PILOT_DISCOVERY_FIXTURE_KEY, seedAlphaDiscoveryFixture } from '../src/lib/staging-pilot-discovery';
import type { Principal } from '../src/types';

let alphaId: string; let charlieId: string; let agent: Principal;

beforeAll(async () => {
  const suffix = randomUUID();
  const alpha = await prisma.exporterOrg.create({ data: { display_name: '[PILOT] Alpha', tier: OrgTier.paid } });
  const charlie = await prisma.exporterOrg.create({ data: { display_name: `[PILOT] Charlie test ${suffix}`, tier: OrgTier.paid } });
  const product = await prisma.product.create({ data: { exporter_org_id: alpha.id, name: '[PILOT] Basmati rice 1121', hs_code: '100630', itc_hs_code: '10063020', evidence_origin: 'fixture' } });
  expect(product.id).toBeTruthy();
  await prisma.user.create({ data: { email: 'exporter-a@pilot.invalid', name: '[PILOT] Alpha Owner', role: UserRole.exporter_owner, exporter_org_id: alpha.id } });
  const user = await prisma.user.create({ data: { email: `pilot-discovery-${suffix}@test.local`, name: 'Assigned Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { agent_user_id: user.id, exporter_org_id: alpha.id, assigned_by_id: user.id, status: 'active' } });
  alphaId = alpha.id; charlieId = charlie.id;
  agent = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: null, tier: OrgTier.paid };
});

describe('staging pilot discovery fixture', () => {
  test('creates a completed Alpha run with exactly three ranked markets and no decisions', async () => {
    const result = await seedAlphaDiscoveryFixture(prisma);
    expect(result).toMatchObject({ created: true, exporterOrgId: alphaId, marketCount: 3, buyerCount: 3 });
    const run = await prisma.discoveryRun.findUniqueOrThrow({ where: { id: result.runId } });
    expect(run).toMatchObject({ status: 'completed', reproducibility_status: 'deterministic_fixture' });
    const markets = await prisma.marketAssessment.findMany({ where: { run_id: run.id }, orderBy: { overall_score: 'desc' } });
    expect(markets.map((m) => [m.country_code, m.overall_score])).toEqual([['DE', 88], ['AE', 76], ['US', 58]]);
    expect(markets.every((m) => m.field_provenance && m.scoring_policy_hash && m.evidence_origins.includes('fixture'))).toBe(true);
    expect(await prisma.agentDecision.count({ where: { market_assessment_id: { in: markets.map((m) => m.id) } } })).toBe(0);
    const rows = await marketControlRows(run.id);
    expect(rows.map((r) => r.modelRank)).toEqual([1, 2, 3]);
    expect(rows.every((r) => r.components.every((c) => c.baseWeight !== null && c.effectiveWeight !== null))).toBe(true);
  });

  test('Buyer Discovery returns strong, medium and weak synthetic recommendations with no decisions', async () => {
    const rows = await buyerControlRows(agent, alphaId);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.fit.score)).toEqual([91, 72, 43]);
    expect(rows.every((r) => r.buyerName.startsWith('[PILOT] Synthetic'))).toBe(true);
    expect(rows.every((r) => r.provenance.inputSnapshot && r.provenance.scoringPolicyHash)).toBe(true);
    expect(rows.every((r) => r.history.length === 0 && r.current === null)).toBe(true);
    expect(await prisma.agentDecision.count({ where: { buyer_fit_assessment_id: { in: rows.map((r) => r.fitId) } } })).toBe(0);
  });

  test('rerun is idempotent and Charlie isolation remains untouched', async () => {
    const beforeCharlie = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: charlieId }, include: { discovery_runs: true, buyer_fit_assessments: true, assignments: true } });
    const before = { runs: await prisma.discoveryRun.count({ where: { exporter_org_id: alphaId } }), markets: await prisma.marketAssessment.count({ where: { run: { exporter_org_id: alphaId } } }), fits: await prisma.buyerFitAssessment.count({ where: { exporter_org_id: alphaId } }) };
    const result = await seedAlphaDiscoveryFixture(prisma);
    expect(result.created).toBe(false);
    expect({ runs: await prisma.discoveryRun.count({ where: { exporter_org_id: alphaId } }), markets: await prisma.marketAssessment.count({ where: { run: { exporter_org_id: alphaId } } }), fits: await prisma.buyerFitAssessment.count({ where: { exporter_org_id: alphaId } }) }).toEqual(before);
    const afterCharlie = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: charlieId }, include: { discovery_runs: true, buyer_fit_assessments: true, assignments: true } });
    expect(afterCharlie).toEqual(beforeCharlie);
  });

  test('command retains the production guard and explicit worker-verification disclaimer', async () => {
    const script = await readFile(path.resolve('scripts/staging-pilot.ts'), 'utf8');
    expect(script).toContain("case 'seed-discovery': return seedDiscovery()");
    expect(script).toContain("env === 'production'");
    expect(script).toContain('does not verify enqueue, worker, external data, or the scoring engine');
    expect(PILOT_DISCOVERY_FIXTURE_KEY).toBe('phase9-alpha-discovery-v1');
  });
});
