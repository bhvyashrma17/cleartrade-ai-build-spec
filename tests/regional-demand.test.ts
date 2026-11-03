import { randomUUID } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, JobType, OrgTier, RegionalDemandStatus, UserRole } from '@prisma/client';
import { RegionalDemand } from '../src/app/app/markets/[marketAssessmentId]/RegionalDemand';
import { runRegionalDemand, setRegionalDemandFetchForTesting } from '../src/lib/job-handlers/regional-demand';
import { prisma } from '../src/lib/prisma';
import type { CensusFetch } from '../src/lib/regional-demand/census';
import { regionalDemandView, requestHandOffRegionalDemand, requestRegionalDemand } from '../src/lib/regional-demand/service';
import type { Principal } from '../src/types';

/**
 * Regional demand for a v5 market (D-033, docs/38): who may ask, what is accepted, the job that reads
 * the Census Bureau, the hand-off of a run's top markets (D-019), and the market-page panel. Other
 * suites share this schema, so every assertion is about this suite's own rows.
 */
const MARKER = `regional-${randomUUID()}`;
const V5 = 'market-opportunity-v5';
let paidOwner: Principal;
let freeOwner: Principal;
let stranger: Principal;
let paidRunId = '';
let freeRunId = '';
const ids: Record<string, string> = {};
const savedKey = process.env.CENSUS_API_KEY;

const HEADER = ['STATE', 'GEN_VAL_MO', 'CNT_VAL_MO', 'CNT_WGT_MO', 'VES_VAL_MO', 'VES_WGT_MO', 'AIR_VAL_MO', 'AIR_WGT_MO', 'YEAR', 'MONTH'];
const PORTS = ['PORT', 'PORT_NAME', 'GEN_VAL_MO', 'CNT_VAL_MO', 'CNT_WGT_MO', 'VES_VAL_MO', 'VES_WGT_MO', 'AIR_VAL_MO', 'AIR_WGT_MO', 'YEAR', 'MONTH'];
const census: CensusFetch = async (url) => {
  const parsed = new URL(url);
  const dataset = parsed.pathname.split('/').at(-1);
  const india = parsed.searchParams.get('CTY_CODE') === '5330';
  const body = dataset === 'statehs'
    ? [HEADER, ['NY', india ? '500' : '900', '450', '30', '450', '30', '10', '1', '2026', '08'], ['GA', india ? '200' : '200', '200', '15', '200', '15', '0', '0', '2026', '08']]
    : [PORTS, ['1001', 'NEW YORK, NY', india ? '600' : '1000', '540', '35', '540', '35', '0', '0', '2026', '08']];
  return { status: 200, text: async () => JSON.stringify(body) };
};

async function owner(tier: OrgTier) {
  const org = await prisma.exporterOrg.create({ data: { display_name: `${MARKER} ${tier}`, tier } });
  const user = await prisma.user.create({ data: { email: `${MARKER}-${tier}@test.local`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: `${MARKER} carpets`, description: 'Hand-knotted wool carpets', evidence_origin: EvidenceOrigin.fixture } });
  const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, product_id: product.id, model_version: V5, status: JobStatus.completed, completed_at: new Date() } });
  const principal: Principal = { id: user.id, email: user.email, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id, tier };
  return { org, product, run, principal };
}

const assessment = (runId: string, productId: string, country: string, extra: Record<string, unknown> = {}) => prisma.marketAssessment.create({
  data: {
    run_id: runId, product_id: productId, country_code: country, confidence_score: 80, model_version: V5, weight_profile_key: 'test', weight_profile_version: 1,
    market_status: 'not_enough_data', classification_hs6_code: '570110', evidence_origins: [EvidenceOrigin.fixture], ...extra,
  },
});

const context = (jobId: string, targetId: string) => ({ job_id: jobId, attempt_no: 1, payload: {}, exporter_org_id: null, target_id: targetId, correlation_id: randomUUID(), reportProgress: async () => undefined });

beforeAll(async () => {
  const paid = await owner(OrgTier.paid);
  const free = await owner(OrgTier.free);
  paidOwner = paid.principal;
  freeOwner = free.principal;
  paidRunId = paid.run.id;
  freeRunId = free.run.id;
  const other = await prisma.exporterOrg.create({ data: { display_name: `${MARKER} other`, tier: OrgTier.paid } });
  const strangerUser = await prisma.user.create({ data: { email: `${MARKER}-stranger@test.local`, name: 'Stranger', role: UserRole.exporter_owner, exporter_org_id: other.id } });
  stranger = { id: strangerUser.id, email: strangerUser.email, name: 'Stranger', role: UserRole.exporter_owner, exporter_org_id: other.id, tier: OrgTier.paid };

  ids.us = (await assessment(paid.run.id, paid.product.id, 'US', { market_status: 'ranked', rank: 1, handed_off: true })).id;
  ids.de = (await assessment(paid.run.id, paid.product.id, 'DE', { market_status: 'ranked', rank: 2, handed_off: true })).id;
  ids.freeUs = (await assessment(free.run.id, free.product.id, 'US')).id;
  const oldRun = await prisma.discoveryRun.create({ data: { exporter_org_id: paid.org.id, product_id: paid.product.id } });
  ids.v4 = (await prisma.marketAssessment.create({ data: { run_id: oldRun.id, product_id: paid.product.id, country_code: 'US', confidence_score: 1, model_version: 'market-attractiveness-v4', weight_profile_key: 'test', weight_profile_version: 1, classification_hs6_code: '570110' } })).id;
});

afterEach(() => {
  setRegionalDemandFetchForTesting(null);
  if (savedKey === undefined) delete process.env.CENSUS_API_KEY;
  else process.env.CENSUS_API_KEY = savedKey;
});

afterAll(async () => {
  await prisma.job.deleteMany({ where: { type: JobType.regional_demand_discovery, exporter_org_id: { in: [paidOwner.exporter_org_id!, freeOwner.exporter_org_id!] } } });
  await prisma.$disconnect();
});

describe('Requesting regional demand', () => {
  test('creates one run and one job for a paid v5 market, audits it, and reuses an unfinished run', async () => {
    const correlation = randomUUID();
    const { run, created } = await requestRegionalDemand({ market_assessment_id: ids.us!, actor: paidOwner, trigger: 'requested', correlation_id: correlation });
    expect(created).toBe(true);
    expect(run).toMatchObject({ status: RegionalDemandStatus.queued, country_code: 'US', hs6_code: '570110', source_key: 'us_census_intltrade', trigger: 'requested', requested_by_id: paidOwner.id });
    const job = await prisma.job.findUniqueOrThrow({ where: { id: run.job_id! } });
    expect(job).toMatchObject({ type: JobType.regional_demand_discovery, target_id: run.id, target_type: 'regional_demand_run', dedupe_key: `regional_demand:${ids.us}`, exporter_org_id: paidOwner.exporter_org_id });
    expect(await prisma.auditEvent.count({ where: { object_type: 'regional_demand_run', object_id: run.id, correlation_id: correlation } })).toBe(1);

    const again = await requestRegionalDemand({ market_assessment_id: ids.us!, actor: paidOwner, trigger: 'requested', correlation_id: randomUUID() });
    expect(again.created).toBe(false);
    expect(again.run.id).toBe(run.id);
    await prisma.job.update({ where: { id: run.job_id! }, data: { status: JobStatus.cancelled, dedupe_key: null } });
    await prisma.regionalDemandRun.update({ where: { id: run.id }, data: { status: RegionalDemandStatus.failed, reason: 'test', completed_at: new Date() } });
  });

  test('refuses markets without a regional source, older assessments, other tenants and free tenants', async () => {
    await expect(requestRegionalDemand({ market_assessment_id: ids.de!, actor: paidOwner, trigger: 'requested', correlation_id: randomUUID() })).rejects.toThrow(/Regional figures for DE are not connected yet. They are available for US, GB, CA/);
    await expect(requestRegionalDemand({ market_assessment_id: ids.v4!, actor: paidOwner, trigger: 'requested', correlation_id: randomUUID() })).rejects.toThrow(/Demand Discovery v5 market/);
    await expect(requestRegionalDemand({ market_assessment_id: ids.us!, actor: stranger, trigger: 'requested', correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(requestRegionalDemand({ market_assessment_id: 'missing', actor: paidOwner, trigger: 'requested', correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(requestRegionalDemand({ market_assessment_id: ids.freeUs!, actor: freeOwner, trigger: 'requested', correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'UPGRADE_REQUIRED' });
    expect(await prisma.regionalDemandRun.count({ where: { market_assessment_id: ids.freeUs! } })).toBe(0);
    // A system request for a tenant that has not paid gets past the role check but is refused at the
    // queue, and the run it created says why instead of waiting forever.
    await expect(requestRegionalDemand({ market_assessment_id: ids.freeUs!, actor: null, trigger: 'operator', correlation_id: randomUUID() })).rejects.toMatchObject({ code: 'UPGRADE_REQUIRED' });
    const refused = await prisma.regionalDemandRun.findFirstOrThrow({ where: { market_assessment_id: ids.freeUs! }, orderBy: { created_at: 'desc' } });
    expect(refused.status).toBe(RegionalDemandStatus.failed);
    expect(refused.reason).toMatch(/Premium/);
  });
});

describe('Reading the Census Bureau', () => {
  async function freshRun() {
    const { run } = await requestRegionalDemand({ market_assessment_id: ids.us!, actor: paidOwner, trigger: 'requested', correlation_id: randomUUID() });
    return run;
  }
  async function close(run: { id: string; job_id: string | null }) {
    await prisma.job.update({ where: { id: run.job_id! }, data: { status: JobStatus.completed, dedupe_key: null } });
  }

  test('writes the states, ports and totals once and reports them', async () => {
    process.env.CENSUS_API_KEY = 'test-key';
    setRegionalDemandFetchForTesting(census);
    const run = await freshRun();
    const outcome = await runRegionalDemand(context(run.job_id!, run.id));
    await close(run);
    expect(outcome).toMatchObject({ status: 'completed', result: { outcome: 'completed', country_code: 'US', hs6_code: '570110', top_area: 'NY', second_view_top: 'New York, NY', india_value_usd: 700 } });
    const stored = await prisma.regionalDemandRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(stored.status).toBe(RegionalDemandStatus.completed);
    expect(stored.retrieved_at).not.toBeNull();
    const result = stored.result as { totals: { india_value_usd: number; world_value_usd: number }; views: { areas: { code: string }[] }[]; source: { requests: string[] } };
    expect(result.totals).toMatchObject({ india_value_usd: 700, world_value_usd: 1100 });
    expect(result.views[0]!.areas.map((area) => area.code)).toEqual(['NY', 'GA']);
    expect(JSON.stringify(stored.result)).not.toContain('test-key');

    const view = await regionalDemandView(ids.us!, 'US');
    expect(view.supported).toBe(true);
    expect(view.shown?.id).toBe(run.id);
    expect(view.latest?.status).toBe(RegionalDemandStatus.completed);
    expect(await regionalDemandView(ids.de!, 'DE')).toEqual({ supported: false, publisher: null, latest: null, shown: null });
  });

  test('without a key, or with a refused one, the run is unavailable with the reason and the job completes', async () => {
    delete process.env.CENSUS_API_KEY;
    const noKey = await freshRun();
    expect(await runRegionalDemand(context(noKey.job_id!, noKey.id))).toMatchObject({ status: 'completed', result: { outcome: 'unavailable' } });
    await close(noKey);
    expect(await prisma.regionalDemandRun.findUniqueOrThrow({ where: { id: noKey.id } })).toMatchObject({ status: RegionalDemandStatus.unavailable, reason: expect.stringMatching(/CENSUS_API_KEY/) });

    process.env.CENSUS_API_KEY = 'expired';
    setRegionalDemandFetchForTesting(async () => ({ status: 200, text: async () => '<html>Invalid Key</html>' }));
    const refused = await freshRun();
    await runRegionalDemand(context(refused.job_id!, refused.id));
    await close(refused);
    expect(await prisma.regionalDemandRun.findUniqueOrThrow({ where: { id: refused.id } })).toMatchObject({ status: RegionalDemandStatus.unavailable, reason: expect.stringMatching(/refused the API key/) });

    // The market page still shows the last completed figures while the newest run says why it stopped.
    const view = await regionalDemandView(ids.us!, 'US');
    expect(view.latest?.status).toBe(RegionalDemandStatus.unavailable);
    expect(view.shown?.status).toBe(RegionalDemandStatus.completed);
  });

  test('an unreachable source fails the run and rethrows so the queue retries', async () => {
    process.env.CENSUS_API_KEY = 'test-key';
    setRegionalDemandFetchForTesting(async () => { throw new Error('ETIMEDOUT'); });
    const run = await freshRun();
    await expect(runRegionalDemand(context(run.job_id!, run.id))).rejects.toThrow(/could not be reached/);
    await close(run);
    expect(await prisma.regionalDemandRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: RegionalDemandStatus.failed, reason: expect.stringMatching(/ETIMEDOUT/) });
  });
});

describe('Hand-off and the market page', () => {
  test('a finished run hands its top markets on only where a regional source exists', async () => {
    const before = await prisma.regionalDemandRun.count({ where: { market_assessment_id: ids.de! } });
    const handOff = await requestHandOffRegionalDemand(paidRunId, randomUUID());
    expect(handOff).toEqual({ requested: ['US'], refused: [] });
    expect(await prisma.regionalDemandRun.count({ where: { market_assessment_id: ids.de! } })).toBe(before);
    const created = await prisma.regionalDemandRun.findFirstOrThrow({ where: { market_assessment_id: ids.us!, trigger: 'hand_off' } });
    expect(created.requested_by_id).toBeNull();
    await prisma.job.update({ where: { id: created.job_id! }, data: { status: JobStatus.cancelled, dedupe_key: null } });
    expect(await requestHandOffRegionalDemand(freeRunId, randomUUID())).toEqual({ requested: [], refused: [] });
  });

  test('the panel shows the figures with their source, period and the Census notice', async () => {
    const view = await regionalDemandView(ids.us!, 'US');
    const html = renderToStaticMarkup(createElement(RegionalDemand, { assessmentId: ids.us!, countryName: 'United States', initial: { ...view, latest: view.shown }, canRequest: true }));
    expect(html).toContain('Destination states');
    expect(html).toContain('Ports of entry');
    expect(html).toContain('New York');
    expect(html).toContain('This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.');
    expect(html).toContain('$700 of this product came from India in Sep 2025 – Aug 2026.');
    const empty = renderToStaticMarkup(createElement(RegionalDemand, { assessmentId: ids.de!, countryName: 'Germany', initial: { supported: false, publisher: null, latest: null, shown: null }, canRequest: true }));
    expect(empty).toContain('Regional figures for Germany are not connected yet.');
  });
});
