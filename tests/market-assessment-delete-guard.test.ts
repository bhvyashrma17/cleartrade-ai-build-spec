import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma';

/**
 * The lineage guard protects v4 assessments only. Before 20261013181000 it also cancelled every
 * other delete without an error (a BEFORE DELETE trigger returning NEW, which is NULL there), so a
 * retry appended a second result set and a deleted run left its assessments orphaned.
 */
const marker = `delete-guard-${randomUUID()}`;
let orgId = '';

afterAll(async () => { await prisma.$disconnect(); });

const assessment = (runId: string, country: string, modelVersion: string) => ({
  run_id: runId, country_code: country, confidence_score: 1, model_version: modelVersion, weight_profile_key: 'test', weight_profile_version: 1,
  ...(modelVersion === 'market-opportunity-v5' ? { market_status: 'not_enough_data' } : {}),
});

describe('MarketAssessment delete guard', () => {
  test('non-v4 assessments delete, directly and by cascade; nothing is orphaned', async () => {
    const org = await prisma.exporterOrg.create({ data: { display_name: marker } });
    orgId = org.id;
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id } });
    await prisma.marketAssessment.createMany({ data: [assessment(run.id, 'US', 'market-opportunity-v5'), assessment(run.id, 'DE', 'market-opportunity-v5'), assessment(run.id, 'FR', 'test')] });
    expect((await prisma.marketAssessment.deleteMany({ where: { run_id: run.id, country_code: 'US' } })).count).toBe(1);
    await prisma.discoveryRun.delete({ where: { id: run.id } });
    expect(await prisma.marketAssessment.count({ where: { run_id: run.id } })).toBe(0);
  });

  test('a v5 row must say which status it has; a ranked row holds a rank, and only a fully scored one is handed on', async () => {
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: orgId } });
    const v5 = (country: string) => assessment(run.id, country, 'market-opportunity-v5');
    await expect(prisma.marketAssessment.create({ data: { ...v5('US'), market_status: null } })).rejects.toThrow(/v5_has_status/);
    await expect(prisma.marketAssessment.create({ data: { ...v5('US'), market_status: 'ranked' } })).rejects.toThrow(/rank_by_status/);
    await expect(prisma.marketAssessment.create({ data: { ...v5('US'), market_status: 'ranked', rank: 0 } })).rejects.toThrow(/rank_by_status/);
    await expect(prisma.marketAssessment.create({ data: { ...v5('KP'), market_status: 'excluded', rank: 3 } })).rejects.toThrow(/rank_by_status/);
    await expect(prisma.marketAssessment.create({ data: { ...v5('US'), handed_off: true } })).rejects.toThrow(/handoff_is_ranked/);
    await prisma.marketAssessment.create({ data: { ...v5('US'), market_status: 'ranked', rank: 1, handed_off: true } });
    await expect(prisma.marketAssessment.create({ data: { ...v5('DE'), market_status: 'ranked', rank: 1 } })).rejects.toThrow(/run_rank_key|Unique constraint/);
    // D-044 (policy v9): a market short of data, or with no recorded imports, ranks after the fully
    // scored ones; runs from before v9 left it unranked, which stays valid. Neither is handed on.
    await prisma.marketAssessment.create({ data: { ...v5('VA'), rank: 2 } });
    await prisma.marketAssessment.create({ data: { ...v5('TV'), market_status: 'no_recorded_demand', rank: 3 } });
    await prisma.marketAssessment.create({ data: { ...v5('FO') } });
    await expect(prisma.marketAssessment.create({ data: { ...v5('MQ'), rank: 4, handed_off: true } })).rejects.toThrow(/handoff_is_ranked/);
    await expect(prisma.marketAssessment.create({ data: { ...v5('MQ'), rank: -1 } })).rejects.toThrow(/rank_by_status/);
    await prisma.discoveryRun.delete({ where: { id: run.id } });
  });

  test('v4 assessments still refuse deletion', async () => {
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: orgId } });
    const v4 = await prisma.marketAssessment.create({ data: assessment(run.id, 'US', 'market-attractiveness-v4') });
    await expect(prisma.marketAssessment.delete({ where: { id: v4.id } })).rejects.toThrow(/never deleted/);
    await expect(prisma.discoveryRun.delete({ where: { id: run.id } })).rejects.toThrow(/never deleted/);
    expect(await prisma.marketAssessment.count({ where: { id: v4.id } })).toBe(1);
  });
});
