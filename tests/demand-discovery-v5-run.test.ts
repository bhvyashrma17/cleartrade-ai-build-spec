import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, JobStatus, JobType, OrgTier, ProductClassificationMethod, ReferenceDatasetReleaseStatus, TradeDatasetReleaseStatus, UserRole } from '@prisma/client';
import type { DocumentStorage, StoredObject } from '../src/lib/document-storage';
import { isCostedJobType } from '../src/lib/billing/costed-work';
import { setV5ComtradeAccessForTesting } from '../src/lib/demand-discovery-v5/comtrade-step';
import { autoStartDemandDiscoveryV5, demandDiscoveryV5Availability } from '../src/lib/demand-discovery-v5/service';
import { setDemandDiscoveryV5StorageForTesting } from '../src/lib/job-handlers/demand-discovery-v5';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
import { confirmClassification, proposeClassification } from '../src/lib/product-classification';
import { importReferenceDataset } from '../src/lib/reference-datasets/service';
import { importTradeDatasetRelease } from '../src/lib/trade-datasets/service';
import type { Principal } from '../src/types';
import { buildZip } from './zip-builder';

/**
 * Demand Discovery v5 end to end on synthetic data in the publishers' documented shapes: two BACI
 * archives (HS17 2019–2024, HS22 2022–2024), World Bank and Comtrade-availability responses, and a
 * fake Comtrade endpoint. Every figure is invented. What is under test is the wiring: confirming
 * a classification starts a run, the job reads what it should, and 218 assessments land.
 */
const VERSION = 'V209902';
const MARKER = `dd5-run-${randomUUID()}`;
const COUNTRIES = 'country_code,country_name,country_iso2,country_iso3\n699,India,IN,IND\n842,USA,US,USA\n276,Germany,DE,DEU\n784,United Arab Emirates,AE,ARE\n156,China,CN,CHN\n704,Viet Nam,VN,VNM\n524,Nepal,NP,NPL\n408,"Korea, Dem. People\'s Rep. of",KP,PRK\n490,"Other Asia, nes",N/A,S19\n';

/** [exporter, importer, value in thousand USD at 2019, yearly growth, USD per kg] */
const FLOWS: [number, number, number, number, number][] = [
  [156, 842, 100_000, 0.08, 2.0], [704, 842, 30_000, 0.1, 2.2], [699, 842, 10_000, 0.12, 1.8], [490, 842, 5_000, 0, 3.0],
  [156, 276, 20_000, 0, 2.5], [704, 276, 10_000, 0, 2.6], [699, 276, 2_000, 0, 2.0],
  [156, 784, 10_000, 0.05, 2.1], [699, 784, 5_000, 0.05, 1.9], [704, 784, 2_000, 0.05, 2.3], [784, 842, 9_000, 0.05, 2.4],
  [784, 524, 100, 0, 2.4], [699, 524, 200, 0, 1.7], [156, 524, 30, 0, 2.2], [156, 408, 1_000, 0, 2.0],
];
const valueAt = (flow: (typeof FLOWS)[number], year: number) => Number((flow[2] * (1 + flow[3]) ** (year - 2019)).toFixed(3));
const yearFile = (year: number) => 't,i,j,k,v,q\n' + FLOWS.map((flow) => `${year},${flow[0]},${flow[1]},100630,${valueAt(flow, year)},${(valueAt(flow, year) / flow[4]).toFixed(3)}`).join('\n') + '\n';
const importsUsd = (importer: number, year: number, exporter?: number) => FLOWS.filter((flow) => flow[1] === importer && (exporter == null || flow[0] === exporter)).reduce((sum, flow) => sum + valueAt(flow, year) * 1000, 0);

class MemoryStorage implements DocumentStorage {
  readonly provider = 'local' as const;
  readonly objects = new Map<string, Buffer>();
  async put(input: { bytes: Buffer; contentType: string; sha256: string; objectKey?: string }): Promise<StoredObject> {
    const key = input.objectKey ?? randomUUID();
    this.objects.set(key, Buffer.from(input.bytes));
    return { provider: 'local', objectKey: key, contentType: input.contentType, sizeBytes: input.bytes.length, sha256: input.sha256 };
  }
  async get(key: string) { const bytes = this.objects.get(key); if (!bytes) throw new Error(`missing ${key}`); return bytes; }
  async metadata(key: string) { const bytes = await this.get(key); return { provider: 'local' as const, objectKey: key, contentType: 'application/gzip', sizeBytes: bytes.length }; }
  async delete(key: string) { this.objects.delete(key); }
  async healthcheck() {}
}

const wdi = (indicator: string, rows: [string, number][]) => Buffer.from(JSON.stringify([
  { page: 1, pages: 1, per_page: 20000, total: rows.length, lastupdated: '2026-07-01' },
  rows.map(([iso3, value]) => ({ indicator: { id: indicator, value: indicator }, country: { id: iso3.slice(0, 2), value: iso3 }, countryiso3code: iso3, date: '2022', value, unit: '', obs_status: '', decimal: 2 })),
]));
const getDa = (period: number, reporters: [number, string][]) => Buffer.from(JSON.stringify({
  elapsedTime: '0.1 secs', count: reporters.length, error: '',
  data: reporters.map(([code, iso]) => ({ datasetCode: 1, typeCode: 'C', freqCode: 'A', period, reporterCode: code, reporterISO: iso, reporterDesc: iso, classificationCode: 'H6', classificationSearchCode: 'HS', isOriginalClassification: true, totalRecords: 1000, datasetChecksum: 1, firstReleased: '2026-07-01T00:00:00', lastReleased: '2026-07-01T00:00:00' })),
}));

/** The fake Comtrade endpoint: World and India rows for L and L+1; nothing for the fallback markets. */
const comtradeCalls: URL[] = [];
const comtradeRow = (reporter: number, partner: number, period: number, value: number) => ({ reporterCode: reporter, partnerCode: partner, partner2Code: 0, cmdCode: '100630', period, refYear: period, flowCode: 'M', freqCode: 'A', customsCode: 'C00', motCode: 0, primaryValue: value, netWgt: null, classificationCode: 'H6', isOriginalClassification: true });
const fakeComtrade = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  comtradeCalls.push(url);
  const rows = url.searchParams.get('period') === '2024,2025' && !url.searchParams.get('reporterCode')
    ? [
        comtradeRow(842, 0, 2024, importsUsd(842, 2024) * 1.05), comtradeRow(842, 0, 2025, importsUsd(842, 2024) * 1.05 * 1.07),
        comtradeRow(842, 699, 2024, importsUsd(842, 2024, 699) * 1.05), comtradeRow(842, 699, 2025, importsUsd(842, 2024, 699) * 1.05 * 1.15),
        comtradeRow(276, 0, 2024, importsUsd(276, 2024) * 1.04),
        comtradeRow(784, 0, 2024, importsUsd(784, 2024)), comtradeRow(784, 0, 2025, importsUsd(784, 2024) * 20),
      ]
    : [];
  return new Response(JSON.stringify({ elapsedTime: '0.1 secs', count: rows.length, data: rows, error: '' }), { status: 200 });
}) as typeof fetch;

const storage = new MemoryStorage();
let ops: Principal;

/** The parts of the stored JSON this suite reads. */
interface FrozenInputs {
  baci: { revision_test: unknown; base_years: number[] };
  comtrade: { newest_year: { evidence_ids: string[] }; market_fallback: unknown };
  exporter: { usd_per_kg: unknown; yearly_kg: unknown };
}
interface Breakdown { newest_year: unknown; metrics: { key: string }[] }

async function importBaci(revision: 'HS17' | 'HS22', years: number[]) {
  const dir = mkdtempSync(join(tmpdir(), 'dd5-run-'));
  const bytes = buildZip([
    ...years.map((year) => ({ name: `BACI_${revision}_Y${year}_${VERSION}.csv`, data: yearFile(year) })),
    { name: `country_codes_${VERSION}.csv`, data: COUNTRIES },
    { name: `product_codes_${revision}_${VERSION}.csv`, data: 'code,description\n100630,"Rice, semi-milled or wholly milled"\n' },
  ]);
  const path = join(dir, `${revision}.zip`);
  writeFileSync(path, bytes);
  return importTradeDatasetRelease({
    actor: ops, file_path: path, expect_sha256: createHash('sha256').update(bytes).digest('hex'), provider: 'cepii_baci', dataset_version: VERSION, hs_revision: revision,
    source_url: `https://example.test/BACI_${revision}_${VERSION}.zip`, retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture, storage,
  });
}

async function paidProduct(tier: OrgTier) {
  const org = await prisma.exporterOrg.create({ data: { display_name: `${MARKER}-${tier}`, tier } });
  const user = await prisma.user.create({ data: { email: `${MARKER}-${tier}-${randomUUID()}@example.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const product = await prisma.product.create({
    data: {
      exporter_org_id: org.id, name: 'Basmati rice', description: 'Milled basmati rice', evidence_origin: EvidenceOrigin.fixture,
      price_target_amount: 2, price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB', capacity_value: 4000, capacity_unit: 'kg', capacity_period: 'month',
    },
  });
  const principal: Principal = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: org.id, tier };
  return { org, product, principal };
}

async function confirmRice(productId: string, actor: Principal) {
  const candidate = await proposeClassification({ product_id: productId, hs6_code: '100630', nomenclature: 'HS', nomenclature_version: '2022', method: ProductClassificationMethod.exporter_supplied, evidence: {}, rationale: 'Milled rice.', confidence: 0.95 }, actor, MARKER);
  return confirmClassification({ classification_id: candidate.id, product_id: productId }, actor, MARKER);
}

beforeAll(async () => {
  const id = `${MARKER}-ops`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: 'Dataset Operator', role: UserRole.admin } });
  ops = { id, email: `${id}@test.local`, name: 'Dataset Operator', role: UserRole.admin, exporter_org_id: null, tier: OrgTier.paid };
  registerAllJobHandlers();
  setDemandDiscoveryV5StorageForTesting(storage);
  setV5ComtradeAccessForTesting({ mode: 'authenticated', api_key: 'test-key', credential_fingerprint: `${MARKER}-key`, source_origin: EvidenceOrigin.fixture, reason: null, fetch: fakeComtrade, sleep: async () => {} });
});

afterAll(async () => {
  setDemandDiscoveryV5StorageForTesting(null);
  setV5ComtradeAccessForTesting(null);
  // Leave nothing "ready" or "active" behind for suites sharing this schema.
  await prisma.tradeDatasetRelease.updateMany({ where: { dataset_version: VERSION, status: TradeDatasetReleaseStatus.ready }, data: { status: TradeDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  await prisma.referenceDatasetRelease.updateMany({ where: { imported_by_id: ops.id, status: ReferenceDatasetReleaseStatus.active }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  await prisma.$disconnect();
});

describe('Demand Discovery v5 runs', () => {
  test('without a BACI release, v5 is unavailable and confirming a code starts nothing', async () => {
    expect(isCostedJobType(JobType.demand_discovery_v5)).toBe(true);
    expect(await demandDiscoveryV5Availability()).toEqual({ available: false, reason: 'No CEPII BACI release is ready in this environment.' });
    const { product, principal } = await paidProduct(OrgTier.paid);
    await confirmRice(product.id, principal);
    expect(await prisma.discoveryRun.count({ where: { product_id: product.id } })).toBe(0);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: 'demand_discovery_auto_start', exporter_org_id: product.exporter_org_id } });
    expect(audit.after_summary).toMatchObject({ started: false, reason: 'No CEPII BACI release is ready in this environment.' });
  });

  test('with BACI and reference data imported, confirming a code starts one v5 run for a paid tenant only', async () => {
    expect(await importBaci('HS17', [2019, 2020, 2021, 2022, 2023, 2024])).toMatchObject({ change: 'NEW' });
    expect(await importBaci('HS22', [2022, 2023, 2024])).toMatchObject({ change: 'NEW' });
    const reference = (dataset_key: string, bytes: Buffer) => importReferenceDataset({ actor: ops, dataset_key, bytes, source_url: `https://example.test/${dataset_key}`, retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture });
    await reference('wdi:LP.LPI.OVRL.XQ', wdi('LP.LPI.OVRL.XQ', [['USA', 3.8], ['DEU', 4.1], ['ARE', 4.0], ['NPL', 2.5]]));
    await reference('wdi:TM.TAX.TCOM.SM.AR.ZS', wdi('TM.TAX.TCOM.SM.AR.ZS', [['USA', 4], ['DEU', 9], ['ARE', 5], ['NPL', 12]]));
    await reference('comtrade:availability:2024', getDa(2024, [[842, 'USA'], [276, 'DEU'], [784, 'ARE']]));
    await reference('comtrade:availability:2025', getDa(2025, [[842, 'USA']]));
    await reference('india:trade-agreements', readFileSync(join(__dirname, '..', 'data', 'reference', 'india-trade-agreements-v1.json')));
    expect(await demandDiscoveryV5Availability()).toEqual({ available: true });

    const free = await paidProduct(OrgTier.free);
    await confirmRice(free.product.id, free.principal);
    expect(await prisma.discoveryRun.count({ where: { product_id: free.product.id } })).toBe(0);
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: 'demand_discovery_auto_start', exporter_org_id: free.org.id } })).after_summary).toMatchObject({ started: false, reason: expect.stringMatching(/commitment fee/) });

    const paid = await paidProduct(OrgTier.paid);
    await confirmRice(paid.product.id, paid.principal);
    const run = await prisma.discoveryRun.findFirstOrThrow({ where: { product_id: paid.product.id } });
    expect(run).toMatchObject({ model_version: 'market-opportunity-v5', trigger: 'classification_confirmed', status: JobStatus.queued, job_id: expect.any(String) });
    expect(await prisma.job.findUniqueOrThrow({ where: { id: run.job_id! } })).toMatchObject({ type: JobType.demand_discovery_v5, target_id: run.id, status: JobStatus.queued });
    expect(await autoStartDemandDiscoveryV5({ product_id: paid.product.id, actor: paid.principal, correlation_id: MARKER })).toMatchObject({ started: false, reason: expect.stringMatching(/already running|in flight|running/i) });

    // The worker picks it up.
    const job = await claimNextJob([JobType.demand_discovery_v5]);
    expect(job?.id).toBe(run.job_id);
    await runClaimedJob(job!);
    const finished = await prisma.job.findUniqueOrThrow({ where: { id: run.job_id! } });
    expect(finished.error_message).toBeNull();
    expect(finished.status).toBe(JobStatus.completed);

    const closed = await prisma.discoveryRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(closed).toMatchObject({ status: JobStatus.completed, reproducibility_status: 'reproducible', scoring_policy_hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const frozen = closed.frozen_inputs as unknown as FrozenInputs;
    expect(frozen.baci.revision_test).toMatchObject({ verdict: 'consistent', use_older_revision: true });
    expect(frozen.baci.base_years).toEqual([2019, 2020, 2021, 2022, 2023, 2024]);
    expect(frozen.comtrade.newest_year).toMatchObject({ status: 'used', complete: true, evidence_ids: [expect.any(String)] });
    expect(frozen.comtrade.market_fallback).toMatchObject({ status: 'used' });
    expect(frozen.exporter.usd_per_kg).toMatchObject({ value: 2 });
    expect(frozen.exporter.yearly_kg).toMatchObject({ value: 48_000 });
    expect(comtradeCalls.map((url) => url.searchParams.get('period'))).toEqual(['2024,2025', '2019,2020,2021,2022,2023,2024,2025']);
    expect(await prisma.sourceEvidence.count({ where: { id: { in: frozen.comtrade.newest_year.evidence_ids } } })).toBe(1);

    const assessments = await prisma.marketAssessment.findMany({ where: { run_id: run.id } });
    expect(assessments).toHaveLength(218);
    const by = new Map(assessments.map((row) => [row.country_code, row]));
    expect(by.get('US')).toMatchObject({ market_status: 'ranked', rank: 1, data_year: 2025, handed_off: true, model_version: 'market-opportunity-v5', classification_hs6_code: '100630', evidence_origins: [EvidenceOrigin.fixture] });
    expect(by.get('DE')).toMatchObject({ market_status: 'ranked', data_year: 2024 });
    expect((by.get('AE')!.score_breakdown as unknown as Breakdown).newest_year).toEqual({ linked: null, refusal: 'implausible_change' });
    expect(by.get('KP')).toMatchObject({ market_status: 'excluded', eligibility_status: 'ineligible', overall_score: null, rank: null });
    expect(by.get('NP')).toMatchObject({ market_status: 'ranked' });
    expect((by.get('NP')!.labels as { key: string }[]).map((label) => label.key)).toContain('estimated_from_partners');
    expect(by.get('TV')).toMatchObject({ market_status: 'not_enough_data', live_points: 0, overall_score: null });
    expect((by.get('US')!.reasons as unknown[]).length).toBe(3);
    const duty = (by.get('DE')!.score_breakdown as unknown as Breakdown).metrics.find((metric) => metric.key === 'duty');
    expect(duty).toMatchObject({ estimated: true, inputs: { duty_percent: 9, basis: 'estimate', agreement_scope: 'none' } });
    const uaeDuty = (by.get('AE')!.score_breakdown as unknown as Breakdown).metrics.find((metric) => metric.key === 'duty');
    expect(uaeDuty).toMatchObject({ inputs: { duty_percent: 2.5, agreement_scope: 'comprehensive', agreement: 'India–UAE CEPA' } });
    const ranks = assessments.filter((row) => row.rank != null).map((row) => row.rank!).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, index) => index + 1));
    expect(closed.summary).toMatchObject({ markets: 218, excluded: 1, ranked: ranks.length, handed_off: expect.arrayContaining([expect.objectContaining({ market: 'US', rank: 1 })]) });
    expect((closed.summary as { notes: string[] }).notes).toEqual(expect.arrayContaining([expect.stringMatching(/ECGC list and capital coordinates/)]));

    // A retry replaces the result set rather than appending to it.
    await prisma.job.update({ where: { id: run.job_id! }, data: { status: JobStatus.queued, dedupe_key: null } });
    const retry = await claimNextJob([JobType.demand_discovery_v5]);
    await runClaimedJob(retry!);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: run.job_id! } })).toMatchObject({ status: JobStatus.completed, error_message: null });
    expect(await prisma.marketAssessment.count({ where: { run_id: run.id } })).toBe(218);
  });
});
