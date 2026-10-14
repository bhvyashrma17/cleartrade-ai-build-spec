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

  test('a v5 row must say which status it has, and only a ranked row may hold a rank', async () => {
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: orgId } });
    await expect(prisma.marketAssessment.create({ data: { ...assessment(run.id, 'US', 'market-opportunity-v5'), market_status: null } })).rejects.toThrow(/v5_has_status/);
    await expect(prisma.marketAssessment.create({ data: { ...assessment(run.id, 'US', 'market-opportunity-v5'), rank: 1 } })).rejects.toThrow(/rank_only_when_ranked/);
    await expect(prisma.marketAssessment.create({ data: { ...assessment(run.id, 'US', 'market-opportunity-v5'), market_status: 'ranked', rank: 0 } })).rejects.toThrow(/rank_only_when_ranked/);
    await expect(prisma.marketAssessment.create({ data: { ...assessment(run.id, 'US', 'market-opportunity-v5'), handed_off: true } })).rejects.toThrow(/handoff_is_ranked/);
    await prisma.marketAssessment.create({ data: { ...assessment(run.id, 'US', 'market-opportunity-v5'), market_status: 'ranked', rank: 1, handed_off: true } });
    await expect(prisma.marketAssessment.create({ data: { ...assessment(run.id, 'DE', 'market-opportunity-v5'), market_status: 'ranked', rank: 1 } })).rejects.toThrow(/run_rank_key|Unique constraint/);
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
