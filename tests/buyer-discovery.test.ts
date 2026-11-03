import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, JobType, OrgTier, ProductClassificationStatus, ReferenceDatasetReleaseStatus, UserRole } from '@prisma/client';
import { buyerControlRows } from '../src/lib/buyer-control';
import { activeImporterLists, importImporterList } from '../src/lib/buyer-discovery/importer-list-service';
import { BUYER_DISCOVERY_MODEL, requestBuyerDiscovery, requestHandOffBuyerDiscovery, runBuyerDiscoveryJob, scoreCandidate } from '../src/lib/buyer-discovery/service';
import { runBuyerDiscovery } from '../src/lib/job-handlers/buyer-discovery';
import { prisma } from '../src/lib/prisma';
import { readImporterRegions } from '../src/lib/regional-demand/importer-regions';
import { sanctionsCoverage } from '../src/lib/sanctions/screening';
import type { Principal } from '../src/types';
import { hmrcLine } from './helpers/hmrc-lines';

/**
 * Real Buyer Discovery from official importer lists (D-033, docs/38 §2): importing HMRC's list, who
 * may ask for buyers, the job that turns list entries into canonical buyers and fit assessments, the
 * regional count, and what the agent's control surface shows. The shared schema may already hold
 * other suites' lists, so each test uses its own period and names.
 */
const MARKER = `buyers-${randomUUID().slice(0, 8)}`;
const period = `20${String(30 + Math.floor(Math.random() * 60)).padStart(2, '0')}0${1 + Math.floor(Math.random() * 8)}`;
let ops: Principal;
let agent: Principal;
let owner: Principal;
let orgId = '';
let productId = '';

const list = () => Buffer.from([
  hmrcLine(period, 1, `${MARKER} HANDMADE RUGS LIMITED`, ['THE STUDIO', '12 HIGH STREET', 'LONDON'], 'E1 6HF', ['57011010', '57011090', '57031000']),
  // HMRC publishes some towns in mixed case ("London" beside "LONDON"); the regional view counts them as one.
  hmrcLine(period, 1, `${MARKER} DEPARTMENT STORES PLC`, ['171 VICTORIA STREET', 'London'], 'SW1V 2QQ', [...Array.from({ length: 48 }, (_, i) => String(84000000 + i)), '57011090', '57019090']),
  hmrcLine(period, 1, `${MARKER} FREIGHT FORWARDING LTD`, ['DOCK ROAD', 'FELIXSTOWE'], 'IP11 3QW', ['57011090', '94036090']),
  hmrcLine(period, 1, `${MARKER} TILES LTD`, ['MILL LANE', 'LEEDS'], 'LS1 1AA', ['69089000']),
].join('\n'), 'latin1');

beforeAll(async () => {
  const opsUser = await prisma.user.create({ data: { email: `${MARKER}-ops@test.local`, name: 'Ops', role: UserRole.ops_supervisor } });
  const agentUser = await prisma.user.create({ data: { email: `${MARKER}-agent@test.local`, name: 'Agent', role: UserRole.agent } });
  const org = await prisma.exporterOrg.create({ data: { display_name: `${MARKER} exporter`, tier: OrgTier.paid } });
  const ownerUser = await prisma.user.create({ data: { email: `${MARKER}-owner@test.local`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: `${MARKER} carpets`, description: 'Hand-knotted wool carpets', hs_code: '570110', hs_classification_status: ProductClassificationStatus.confirmed, evidence_origin: EvidenceOrigin.fixture } });
  ops = { id: opsUser.id, email: opsUser.email, name: 'Ops', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
  agent = { id: agentUser.id, email: agentUser.email, name: 'Agent', role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
  owner = { id: ownerUser.id, email: ownerUser.email, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id, tier: OrgTier.paid };
  orgId = org.id;
  productId = product.id;
});

afterAll(async () => {
  await prisma.importerListRelease.updateMany({ where: { imported_by_id: ops.id, status: ReferenceDatasetReleaseStatus.active }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  await prisma.job.deleteMany({ where: { type: JobType.buyer_discovery, exporter_org_id: orgId } });
  await prisma.$disconnect();
});

describe('Importing an HMRC importer list', () => {
  test('is for operations staff, records the release once, and supersedes the same month on a new file', async () => {
    const args = { source_key: 'uk_hmrc_importers' as const, source_url: 'https://www.uktradeinfo.com/media/test/importers.zip', retrieved_at: new Date('2026-10-22T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture };
    await expect(importImporterList({ ...args, actor: agent, files: [{ name: 'importers.txt', bytes: list() }] })).rejects.toThrow(/operations staff/);
    const first = await importImporterList({ ...args, actor: ops, files: [{ name: 'importers.txt', bytes: list() }] });
    expect(first).toMatchObject({ change: 'NEW', period: `${period.slice(0, 4)}-${period.slice(4)}`, row_count: 4, superseded_release_id: null });
    expect(await importImporterList({ ...args, actor: ops, files: [{ name: 'importers.txt', bytes: list() }] })).toMatchObject({ change: 'UNCHANGED', release_id: first.release_id });
    const revised = Buffer.concat([list(), Buffer.from(`\n${hmrcLine(period, 1, `${MARKER} LATE ADDITION LTD`, ['1 ROAD', 'BATH'], 'BA1 1AA', ['57011090'])}`)]);
    const second = await importImporterList({ ...args, actor: ops, files: [{ name: 'importers.txt', bytes: revised }] });
    expect(second).toMatchObject({ change: 'NEW', row_count: 5, superseded_release_id: first.release_id });
    expect((await prisma.importerListRelease.findUniqueOrThrow({ where: { id: first.release_id } })).status).toBe(ReferenceDatasetReleaseStatus.superseded);
    expect((await activeImporterLists('uk_hmrc_importers')).some((release) => release.id === second.release_id)).toBe(true);
    await expect(importImporterList({ ...args, actor: ops, source_key: 'ca_cid_major_importers', files: [{ name: 'x.xlsx', bytes: Buffer.from('x') }] })).rejects.toThrow(/not built yet/);
  });
});

describe('Requesting buyers', () => {
  test('agents assigned to the exporter and ops may ask; exporters and other markets may not', async () => {
    const base = { exporter_org_id: orgId, product_id: productId, trigger: 'requested' as const, correlation_id: randomUUID() };
    await expect(requestBuyerDiscovery({ ...base, country_code: 'GB', actor: owner })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(requestBuyerDiscovery({ ...base, country_code: 'GB', actor: agent })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(requestBuyerDiscovery({ ...base, country_code: 'DE', actor: ops })).rejects.toThrow(/Buyer lists for DE are not connected yet/);
    const job = await requestBuyerDiscovery({ ...base, country_code: 'gb', actor: ops });
    expect(job).toMatchObject({ type: JobType.buyer_discovery, target_id: productId, dedupe_key: `buyer_discovery:${orgId}:${productId}:GB`, payload: { country_code: 'GB', hs6: '570110', source_key: 'uk_hmrc_importers' } });
    await prisma.job.update({ where: { id: job.id }, data: { status: JobStatus.cancelled, dedupe_key: null } });
  });
});

describe('Finding buyers in the list', () => {
  test('creates one buyer per importer with its evidence and a scored assessment, and a rerun changes nothing', async () => {
    const ctx = { job_id: randomUUID(), attempt_no: 1, payload: { exporter_org_id: orgId, product_id: productId, country_code: 'GB', hs6: '570110', source_key: 'uk_hmrc_importers' }, exporter_org_id: orgId, target_id: productId, correlation_id: randomUUID(), reportProgress: async () => undefined };
    const outcome = await runBuyerDiscovery(ctx);
    expect(outcome.status).toBe('completed');
    expect(outcome.result).toMatchObject({ outcome: 'completed', country_code: 'GB', hs6: '570110' });
    const ours = await prisma.buyer.findMany({ where: { legal_name: { startsWith: MARKER } }, include: { source_evidence: true } });
    expect(ours.map((buyer) => buyer.legal_name).sort()).toEqual([`${MARKER} DEPARTMENT STORES PLC`, `${MARKER} FREIGHT FORWARDING LTD`, `${MARKER} HANDMADE RUGS LIMITED`, `${MARKER} LATE ADDITION LTD`]);
    expect(ours.every((buyer) => buyer.country_code === 'GB' && buyer.source_entity_key?.startsWith('uk_hmrc_importers:') && buyer.source_evidence.length === 1)).toBe(true);
    const forwarder = ours.find((buyer) => buyer.legal_name.includes('FREIGHT'))!;
    expect(forwarder).toMatchObject({ buyer_type: 'intermediary', deprioritized: true });
    const rugs = ours.find((buyer) => buyer.legal_name.includes('RUGS'))!;
    expect(rugs.import_activity_summary).toMatchObject({ scope: 'official_importer_list', town: 'LONDON', postcode: 'E1 6HF', region_name: 'London' });
    const coverage = await sanctionsCoverage();
    expect(rugs.risk_flags).toEqual(coverage.complete ? [] : [expect.objectContaining({ code: 'SCREENING_INCOMPLETE', severity: 'warning' })]);

    const fits = await prisma.buyerFitAssessment.findMany({ where: { exporter_org_id: orgId, product_id: productId, model_version: BUYER_DISCOVERY_MODEL } });
    expect(fits).toHaveLength(4);
    const fitOf = (name: string) => fits.find((fit) => fit.buyer_id === ours.find((buyer) => buyer.legal_name.includes(name))!.id)!;
    expect(fitOf('RUGS').score).toBeGreaterThan(fitOf('DEPARTMENT').score!);
    expect(fitOf('RUGS')).toMatchObject({ confidence_score: 50, evidence_origins: [EvidenceOrigin.fixture], reproducibility_status: 'reproducible', scoring_policy_version: 1 });
    expect((fitOf('RUGS').components as { summary_lines: string[] }).summary_lines[0]).toMatch(/^Imported 5701\.10\.10 and 5701\.10\.90 in \w{3} \d{4} \(HMRC importer list\)\.$/);

    await runBuyerDiscovery({ ...ctx, job_id: randomUUID() });
    expect(await prisma.buyer.count({ where: { legal_name: { startsWith: MARKER } } })).toBe(4);
    expect(await prisma.buyerSourceEvidence.count({ where: { buyer_id: { in: ours.map((buyer) => buyer.id) } } })).toBe(4);
    expect(await prisma.buyerFitAssessment.count({ where: { exporter_org_id: orgId, product_id: productId, model_version: BUYER_DISCOVERY_MODEL } })).toBe(4);
  });

  test('the agent control surface reads them with their own components, place and reason', async () => {
    const rows = await buyerControlRows(ops, orgId, { productId });
    const rugs = rows.find((row) => row.buyerName.includes('RUGS'))!;
    expect(rugs.components.map((component) => component.label)).toEqual(['Product match', 'Product focus', 'Buys it from India', 'Months listed']);
    expect(rugs.components.find((component) => component.key === 'india_origin')).toMatchObject({ score: null, unavailableReason: 'This list does not say where the importer buys from.' });
    expect(rugs.evidence.officialList).toMatchObject({ place: 'LONDON · E1 6HF · London', source: 'HMRC importer details (UK Trade Info)' });
    expect(rugs.evidence.officialList!.why[0]).toMatch(/^Imported 5701\.10\.10/);
  });

  test('regions count the importers of the product in the newest list', async () => {
    const { result } = await readImporterRegions({ source_key: 'uk_hmrc_importers', hs6: '570110', now: new Date() });
    expect(result).not.toBeNull();
    const view = result!.views[0]!;
    expect(view.measure).toBe('importers');
    if (view.measure !== 'importers') throw new Error('expected importer view');
    const london = view.areas.find((area) => area.code === 'TLI');
    expect(london?.importer_count).toBeGreaterThanOrEqual(2);
    // A town is listed once whatever its letter case.
    for (const area of view.areas) expect(new Set(area.towns.map((town) => town.toUpperCase())).size).toBe(area.towns.length);
    expect(result!.source.attribution).toMatch(/Open Government Licence v3\.0/);
    expect(result!.totals.importer_count).toBeGreaterThanOrEqual(4);
  });

  test('a market with no imported list completes with the reason', async () => {
    const result = await runBuyerDiscoveryJob({ exporter_org_id: orgId, product_id: productId, country_code: 'CA', hs6: '570110', source_key: 'ca_cid_major_importers' }, randomUUID());
    expect(result).toMatchObject({ outcome: 'no_list', importers_found: 0 });
  });

  test('a finished v5 run hands its UK and Canada top markets on to buyer discovery', async () => {
    const run = await prisma.discoveryRun.create({ data: { exporter_org_id: orgId, product_id: productId, model_version: 'market-opportunity-v5', status: JobStatus.completed } });
    const market = (country: string, rank: number) => ({ run_id: run.id, product_id: productId, country_code: country, confidence_score: 80, model_version: 'market-opportunity-v5', weight_profile_key: 'test', weight_profile_version: 1, market_status: 'ranked', rank, handed_off: true, classification_hs6_code: '570110' });
    await prisma.marketAssessment.createMany({ data: [market('GB', 1), market('DE', 2), market('CA', 3)] });
    const handOff = await requestHandOffBuyerDiscovery(run.id, randomUUID());
    expect(handOff.requested.sort()).toEqual(['CA', 'GB']);
    expect(handOff.refused).toEqual([]);
    await prisma.job.updateMany({ where: { type: JobType.buyer_discovery, exporter_org_id: orgId, status: JobStatus.queued }, data: { status: JobStatus.cancelled, dedupe_key: null } });
  });
});

describe('Scoring', () => {
  test('a source that does not publish a measure leaves it out instead of counting it as zero', () => {
    const candidate = { entity_key: 'X|E16HF', name: 'X', address_lines: [], town: null, postcode: null, region_code: null, region_name: null, product_codes: ['57011090'], all_codes: ['57011090', '57031000', '94036090', '84000000'], india: null, periods: ['2026-08'], releases: ['r'], notes: [] };
    const uk = scoreCandidate(candidate, '570110', 1, 'not_published');
    expect(uk.components.focus.score).toBe(50);
    expect(uk.components.india_origin.score).toBeNull();
    expect(uk.components.activity.score).toBeNull();
    expect(uk.score).toBe(Math.round((40 * 100 + 30 * 50) / 70));
    expect(uk.confidence).toBe(50);
    const ca = scoreCandidate({ ...candidate, india: true }, '570110', 1, 'published');
    expect(ca.components.india_origin.score).toBe(100);
    expect(ca.score).toBe(Math.round((40 * 100 + 30 * 50 + 20 * 100) / 90));
    const months = scoreCandidate({ ...candidate, periods: ['2026-08', '2026-06'] }, '570110', 4, 'not_published');
    expect(months.components.activity.score).toBe(50);
  });
});
