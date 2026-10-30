import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { OrgTier, type Prisma, UserRole } from '@prisma/client';
import {
  ARCHETYPE_EXPORTER_NAME, ARCHETYPE_MEMBERSHIP_DAYS, archetypeProductName, archetypeRunStatus, dutyBasisOf, startArchetypeRuns, summarizeCalibration, type ArchetypeStatusItem,
} from '@/lib/demand-discovery-v5/archetype-runs';
import { CALIBRATION_PRODUCTS } from '@/lib/demand-discovery-v5/calibration-set';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { PHASE_1_GATE_POLICY_V2 } from '@/lib/phase-1-gate/policy';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/** D-003 / docs/36 §10 step 7: the archetype runs are set up on staging through the portal's own services. */
async function staff(role: UserRole): Promise<Principal> {
  const s = randomUUID().slice(0, 8);
  const user = await prisma.user.create({ data: { email: `archetype-${role}-${s}@t.test`, name: `Archetype ${role}`, role }, select: { id: true, email: true, name: true } });
  return { id: user.id, email: user.email, name: user.name, role, exporter_org_id: null, tier: OrgTier.paid };
}

const now = new Date('2026-10-19T06:00:00Z');
const archetypes = PHASE_1_GATE_POLICY_V2.archetypes.value;

describe('Demand Discovery v5 archetype runs', () => {
  test('dutyBasisOf reads how the duty metric found each market\'s duty', () => {
    const metrics = (inputs: Record<string, unknown> | null, score: number | null = 50) => ({ metrics: [{ key: 'market_size', score: 80, inputs: {} }, ...(inputs ? [{ key: 'duty', score, inputs }] : [])] });
    expect(dutyBasisOf(metrics({ basis: 'official', duty_percent: 5 }))).toEqual({ basis: 'official', union: null });
    expect(dutyBasisOf(metrics({ basis: 'official', duty_percent: 10, common_tariff: 'ECOWAS common external tariff' }))).toEqual({ basis: 'common_tariff', union: 'ECOWAS common external tariff' });
    expect(dutyBasisOf(metrics({ basis: 'official', duty_percent: 10, recorded_by_agent: 'yes' }))).toEqual({ basis: 'agent_recorded', union: null });
    expect(dutyBasisOf(metrics({ basis: 'official', duty_percent: 6, schedule_read: 'China’s 2026 customs tariff' }))).toEqual({ basis: 'schedule_read', union: null, schedule: 'China’s 2026 customs tariff' });
    expect(dutyBasisOf(metrics({ basis: 'rule', duty_percent: 0 }))).toEqual({ basis: 'rule', union: null });
    expect(dutyBasisOf(metrics({ basis: 'estimate', duty_percent: 7.5 }))).toEqual({ basis: 'estimate', union: null });
    expect(dutyBasisOf(metrics({ basis: 'official', duty_percent: 5 }, null))).toEqual({ basis: 'none', union: null });
    expect(dutyBasisOf(metrics(null))).toEqual({ basis: 'none', union: null });
    expect(dutyBasisOf(null)).toEqual({ basis: 'none', union: null });
  });

  test('only staff may set the runs up', async () => {
    const owner = { ...(await staff(UserRole.agent)), role: UserRole.exporter_owner };
    await expect(startArchetypeRuns({ actor: owner, correlation_id: randomUUID(), now })).rejects.toThrow('agent, ops supervisor or admin');
    expect(await prisma.exporterOrg.count({ where: { display_name: ARCHETYPE_EXPORTER_NAME } })).toBe(0);
  });

  test('start creates a dated paid test exporter and confirms each archetype code as the staff account; repeating it confirms nothing again', async () => {
    const admin = await staff(UserRole.admin);
    const correlation = randomUUID();
    const first = await startArchetypeRuns({ actor: admin, correlation_id: correlation, now });
    expect(first).toMatchObject({ exporter_created: true, membership: 'granted' });

    const org = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: first.exporter_org_id } });
    expect(org).toMatchObject({ display_name: ARCHETYPE_EXPORTER_NAME, tier: OrgTier.paid });
    expect(org.paid_until?.toISOString()).toBe(new Date(now.getTime() + ARCHETYPE_MEMBERSHIP_DAYS * 86_400_000).toISOString());
    expect(await prisma.subscription.count({ where: { exporter_org_id: org.id, provider: 'manual', status: 'active' } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { object_type: 'subscription', exporter_org_id: org.id, actor_user_id: admin.id } })).toBe(1);

    expect(first.items.map((item) => [item.key, item.hs6, item.action, item.product_created])).toEqual(archetypes.map((archetype) => [archetype.key, archetype.hs6, 'confirmed', true]));
    for (const [index, item] of first.items.entries()) {
      const product = await prisma.product.findUniqueOrThrow({ where: { id: item.product_id } });
      expect(product).toMatchObject({ exporter_org_id: org.id, name: archetypeProductName(archetypes[index]!.label), hs_code: archetypes[index]!.hs6, hs_classification_status: 'confirmed', hs_confirmed_by_id: admin.id });
      const classification = await prisma.productClassification.findUniqueOrThrow({ where: { id: item.classification_id } });
      expect(classification).toMatchObject({ status: 'confirmed', hs6_code: archetypes[index]!.hs6, nomenclature: 'HS', nomenclature_version: '2022', method: 'agent_supplied', confirmed_by_id: admin.id });
      // The confirmation's own audit trail: who confirmed it, and what its v5 auto-start did.
      expect(await prisma.auditEvent.count({ where: { object_type: 'product_classification', object_id: item.classification_id, action: 'demand_discovery_auto_start', correlation_id: correlation } })).toBe(1);
      if (item.run_started) expect(item.run).toMatchObject({ classification_id: item.classification_id });
      else expect(item.not_started_reason).toEqual(expect.any(String));
    }

    const again = await startArchetypeRuns({ actor: admin, correlation_id: randomUUID(), now: new Date(now.getTime() + 3_600_000) });
    expect(again).toMatchObject({ exporter_org_id: first.exporter_org_id, exporter_created: false, membership: 'active' });
    for (const [index, item] of again.items.entries()) {
      expect(item).toMatchObject({ product_id: first.items[index]!.product_id, product_created: false, classification_id: first.items[index]!.classification_id });
      // A run already exists → left alone; none could start → a run is tried again for the same code, never a new code revision.
      expect(item.action).toBe(first.items[index]!.run ? 'left_alone' : 'started');
      expect(await prisma.productClassification.count({ where: { product_id: item.product_id } })).toBe(1);
    }
    expect(await prisma.subscription.count({ where: { exporter_org_id: first.exporter_org_id } })).toBe(1);
  });

  test('status reports each archetype\'s newest run: markets by status, how duties were found, the top and why a comparison could not be made', async () => {
    const org = await prisma.exporterOrg.findFirstOrThrow({ where: { display_name: ARCHETYPE_EXPORTER_NAME } });
    const rice = await prisma.product.findFirstOrThrow({ where: { exporter_org_id: org.id, name: archetypeProductName(archetypes[0]!.label) } });
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, product_id: rice.id, model_version: DEMAND_DISCOVERY_V5_MODEL, status: 'completed', completed_at: now, input_snapshot: { hs_code: '100630' } }, select: { id: true } });
    const duty = (inputs: Record<string, unknown> | null) => ({ metrics: inputs ? [{ key: 'duty', score: 60, inputs }] : [] }) as unknown as Prisma.InputJsonValue;
    const rows: [string, string, number | null, number | null, Record<string, unknown> | null][] = [
      ['SA', 'ranked', 1, 81, { basis: 'official', duty_percent: 5 }],
      ['SN', 'ranked', 2, 74, { basis: 'official', duty_percent: 10, common_tariff: 'ECOWAS common external tariff' }],
      ['KE', 'ranked', 3, 70, null],
      ['HK', 'ranked', 4, 66, { basis: 'rule', duty_percent: 0 }],
      ['IR', 'not_enough_data', null, null, { basis: 'estimate', duty_percent: 20 }],
      ['KP', 'excluded', null, null, { basis: 'estimate', duty_percent: 10 }],
    ];
    await prisma.marketAssessment.createMany({
      data: rows.map(([market, status, rank, overall, inputs]) => ({
        run_id: run.id, product_id: rice.id, country_code: market, confidence_score: 60, model_version: DEMAND_DISCOVERY_V5_MODEL, weight_profile_key: 'demand-discovery-v5-policy-v6',
        weight_profile_version: 1, scoring_policy_hash: 'hash-v6', reproducibility_status: 'reproducible', market_status: status, rank, overall_score: overall, score_breakdown: duty(inputs),
      })),
    });

    const status = await archetypeRunStatus({ top: 3 });
    const item = status.items.find((entry) => entry.key === archetypes[0]!.key)!;
    expect(item.run).toMatchObject({ id: run.id, status: 'completed' });
    expect(item.markets).toEqual({
      by_status: { ranked: 4, not_enough_data: 1, excluded: 1 },
      duty_basis: { official: 1, common_tariff: 1, schedule_read: 0, agent_recorded: 0, rule: 1, estimate: 1, none: 1 },
      common_tariff_markets: { 'ECOWAS common external tariff': 1 },
      schedule_read_markets: {},
      top: [{ rank: 1, market: 'SA', overall: 81 }, { rank: 2, market: 'SN', overall: 74 }, { rank: 3, market: 'KE', overall: 70 }],
    });
    // A run without its frozen BACI inputs cannot be compared; status says why instead of failing.
    expect(item.comparison).toBeNull();
    expect(item.comparison_error).toContain('has not finished');
    expect((await archetypeRunStatus({ compare: false })).items.find((entry) => entry.key === archetypes[0]!.key)).toMatchObject({ comparison: null, comparison_error: null });
  });

  test('the calibration set (stage 1, item 6): eighteen distinct codes across ten sectors, the archetypes among them under their gate labels', () => {
    expect(CALIBRATION_PRODUCTS).toHaveLength(18);
    expect(new Set(CALIBRATION_PRODUCTS.map((product) => product.key)).size).toBe(18);
    expect(new Set(CALIBRATION_PRODUCTS.map((product) => product.hs6)).size).toBe(18);
    for (const product of CALIBRATION_PRODUCTS) expect(product, product.key).toMatchObject({ hs6: expect.stringMatching(/^\d{6}$/), hs_revision: 'HS2022' });
    for (const archetype of archetypes) expect(CALIBRATION_PRODUCTS).toContainEqual(expect.objectContaining({ key: archetype.key, label: archetype.label, hs6: archetype.hs6 }));
    expect(new Set(CALIBRATION_PRODUCTS.map((product) => product.sector))).toEqual(new Set(['food', 'handicrafts', 'textiles', 'marine', 'apparel', 'gems and jewellery', 'pharmaceuticals', 'engineering', 'leather', 'building materials']));
  });

  test('start --set=calibration reuses the archetype products and confirms the fifteen others as calibration products', async () => {
    const supervisor = await staff(UserRole.ops_supervisor);
    const org = await prisma.exporterOrg.findFirstOrThrow({ where: { display_name: ARCHETYPE_EXPORTER_NAME } });
    const before = await prisma.product.count({ where: { exporter_org_id: org.id } });
    const result = await startArchetypeRuns({ actor: supervisor, correlation_id: randomUUID(), now: new Date(now.getTime() + 7_200_000), set: 'calibration' });
    expect(result).toMatchObject({ exporter_org_id: org.id, exporter_created: false, membership: 'active' });
    expect(result.items.map((item) => item.key)).toEqual(CALIBRATION_PRODUCTS.map((product) => product.key));
    const archetypeKeys = new Set(archetypes.map((archetype) => archetype.key));
    for (const item of result.items) {
      if (archetypeKeys.has(item.key)) {
        // Already confirmed by the archetype start: never proposed again.
        expect(item, item.key).toMatchObject({ product_created: false });
        expect(item.action).not.toBe('confirmed');
        expect(await prisma.productClassification.count({ where: { product_id: item.product_id } })).toBe(1);
        continue;
      }
      expect(item, item.key).toMatchObject({ product_created: true, action: 'confirmed' });
      const classification = await prisma.productClassification.findUniqueOrThrow({ where: { id: item.classification_id } });
      expect(classification).toMatchObject({ status: 'confirmed', hs6_code: item.hs6, nomenclature: 'HS', nomenclature_version: '2022', confirmed_by_id: supervisor.id });
      expect(classification.rationale).toMatch(/^Calibration product \(stage 1, item 6\) "[a-z_]+": .+, HS 2022 subheading \d{6} \(docs\/36 §8\)\.$/);
      expect(classification.evidence).toMatchObject({ calibration_product: item.key, hs_revision: 'HS2022', source: 'CALIBRATION_PRODUCTS' });
    }
    expect(await prisma.product.count({ where: { exporter_org_id: org.id } })).toBe(before + 15);
  });

  test('status --set=calibration lists every calibration product and sums up the comparisons', async () => {
    const status = await archetypeRunStatus({ set: 'calibration', top: 3 });
    expect(status.set).toBe('calibration');
    expect(status.items.map((item) => item.key)).toEqual(CALIBRATION_PRODUCTS.map((product) => product.key));
    // No run here has frozen BACI inputs, so none can be compared; status says so per product.
    expect(status.calibration).toMatchObject({ products: 18, compared: 0, pass: 0, calibration_failure: 0, no_india_exports: 0, median_overlap: null, failures: [] });
    expect(status.calibration!.finished).toBe(status.items.filter((item) => item.run && ['completed', 'partial'].includes(item.run.status)).length);
    expect(await archetypeRunStatus({ set: 'calibration', compare: false })).not.toHaveProperty('calibration');
  });

  test('the calibration summary counts verdicts, takes the median overlap where India exports, and lists failures worst first', () => {
    const item = (key: string, verdict: string | null, overlap = 0, runStatus = 'completed'): ArchetypeStatusItem => ({
      key, hs6: '000000', product_id: 'product', run: { id: key, status: runStatus, created_at: '2026-10-30T00:00:00Z', completed_at: null, classification_id: null }, markets: null,
      comparison: verdict ? { verdict, overlap, top: 10, india_top: [], run_top: [], missed: [] } : null, comparison_error: null,
    });
    expect(summarizeCalibration([item('a', 'pass', 7), item('b', 'calibration_failure', 3), item('c', 'calibration_failure', 2), item('d', 'no_india_exports'), item('e', null, 0, 'processing'), item('f', 'pass', 5)])).toEqual({
      products: 6, finished: 5, compared: 5, pass: 2, calibration_failure: 2, no_india_exports: 1, median_overlap: 4,
      failures: [{ key: 'c', hs6: '000000', overlap: 2, top: 10 }, { key: 'b', hs6: '000000', overlap: 3, top: 10 }],
    });
    expect(summarizeCalibration([item('a', 'pass', 6), item('b', 'pass', 9), item('c', 'pass', 8)]).median_overlap).toBe(8);
    expect(summarizeCalibration([])).toMatchObject({ products: 0, finished: 0, compared: 0, median_overlap: null, failures: [] });
  });
});
