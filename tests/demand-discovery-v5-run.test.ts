import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceCompletenessStatus, EvidenceOrigin, JobStatus, JobType, MarketAccessEvidenceStatus, MarketAccessRuleType, OrgTier, Prisma, ProductClassificationMethod, ReferenceDatasetReleaseStatus, TradeDatasetReleaseStatus, UserRole } from '@prisma/client';
import type { DocumentStorage, StoredObject } from '../src/lib/document-storage';
import { isCostedJobType } from '../src/lib/billing/costed-work';
import { setV5ComtradeAccessForTesting } from '../src/lib/demand-discovery-v5/comtrade-step';
import { autoStartDemandDiscoveryV5, demandDiscoveryV5Availability } from '../src/lib/demand-discovery-v5/service';
import { setDemandDiscoveryV5StorageForTesting } from '../src/lib/job-handlers/demand-discovery-v5';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
import { confirmClassification, proposeClassification } from '../src/lib/product-classification';
import { manifestEntryFor, readReferenceManifest } from '../src/lib/reference-datasets/manifest';
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
const yearFile = (year: number) => 't,i,j,k,v,q\n' + FLOWS.map((flow) => `${year},${flow[0]},${flow[1]},100890,${valueAt(flow, year)},${(valueAt(flow, year) / flow[4]).toFixed(3)}`).join('\n') + '\n';
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
const comtradeRow = (reporter: number, partner: number, period: number, value: number) => ({ reporterCode: reporter, partnerCode: partner, partner2Code: 0, cmdCode: '100890', period, refYear: period, flowCode: 'M', freqCode: 'A', customsCode: 'C00', motCode: 0, primaryValue: value, netWgt: null, classificationCode: 'H6', isOriginalClassification: true });
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
  official_duty: { markets: Record<string, { status: string }> };
  reference: Record<string, { release_id: string } | null>;
  provider_coordinates: unknown;
  comtrade: { newest_year: { evidence_ids: string[] }; market_fallback: unknown };
  exporter: { usd_per_kg: unknown; yearly_kg: unknown };
}
interface Breakdown { newest_year: unknown; metrics: { key: string; score: number | null; inputs: Record<string, unknown> }[] }

async function importBaci(revision: 'HS17' | 'HS22', years: number[]) {
  const dir = mkdtempSync(join(tmpdir(), 'dd5-run-'));
  const bytes = buildZip([
    ...years.map((year) => ({ name: `BACI_${revision}_Y${year}_${VERSION}.csv`, data: yearFile(year) })),
    { name: `country_codes_${VERSION}.csv`, data: COUNTRIES },
    { name: `product_codes_${revision}_${VERSION}.csv`, data: 'code,description\n100890,"Cereals; n.e.c. in heading 1008"\n' },
  ]);
  const path = join(dir, `${revision}.zip`);
  writeFileSync(path, bytes);
  return importTradeDatasetRelease({
    actor: ops, file_path: path, expect_sha256: createHash('sha256').update(bytes).digest('hex'), provider: 'cepii_baci', dataset_version: VERSION, hs_revision: revision,
    source_url: `https://example.test/BACI_${revision}_${VERSION}.zip`, retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture, storage,
  });
}

/**
 * Customs Atlas evidence as `persistMarketAccessIngest` writes it: Germany's ordinary duty on
 * 100890 as a specific duty in EUR per tonne, Nepal's as 10% with a preference published for India,
 * and the ECB EUR/USD observation the specific duty converts with. Values are invented. This suite
 * scores 100890, which no other suite uses, because market-access evidence is immutable and stays
 * in the shared schema after the suite ends.
 */
async function seedOfficialTariffs() {
  const retrieved = new Date(Date.now() - 3_600_000);
  const tariff = async (country: string, provider: string, rows: Omit<Prisma.MarketAccessEvidenceCreateManyInput, 'snapshot_id' | 'jurisdiction' | 'country_code' | 'hs_code_scope' | 'source_reference' | 'retrieved_at' | 'raw_evidence' | 'evidence_origin'>[]) => {
    const snapshot = await prisma.marketAccessEvidenceSnapshot.create({
      data: {
        jurisdiction: country, country_code: country, hs_code_scope: '100890', hs6_code: '100890', source_authority: rows[0].source_authority, source_reference: `https://example.test/${country}/100890`,
        retrieved_at: retrieved, completeness_status: EvidenceCompletenessStatus.COMPLETE, tariff_coverage: true, parser_version: 'fixture-v1', evidence_origin: EvidenceOrigin.fixture,
        provider, raw_evidence: { marker: MARKER }, classification_resolution: 'exact',
      },
    });
    await prisma.marketAccessEvidence.createMany({
      data: rows.map((row) => ({ ...row, snapshot_id: snapshot.id, jurisdiction: country, country_code: country, hs_code_scope: '100890', source_reference: `https://example.test/${country}/100890`, retrieved_at: retrieved, raw_evidence: { marker: MARKER }, evidence_origin: EvidenceOrigin.fixture })),
    });
  };
  const common = { status: MarketAccessEvidenceStatus.verified, confidence: new Prisma.Decimal(1), effective_at: new Date('2026-01-01T00:00:00Z') };
  await tariff('DE', 'eu_taric', [{ ...common, rule_type: MarketAccessRuleType.destination_tariff, source_authority: 'EU TARIC', duty_expression: '175.00 EUR / 1000 kg', duty_kind: 'specific', national_tariff_code: '1008909000' }]);
  await tariff('NP', 'nepal_customs', [
    { ...common, rule_type: MarketAccessRuleType.destination_tariff, source_authority: 'Nepal Customs', duty_expression: '10%', duty_kind: 'ad_valorem', tariff_rate_percent: new Prisma.Decimal(10), national_tariff_code: '10089000' },
    { ...common, rule_type: MarketAccessRuleType.preferential_tariff_india, source_authority: 'Nepal Customs', duty_expression: '0%', duty_kind: 'ad_valorem', status: MarketAccessEvidenceStatus.needs_review, confidence: new Prisma.Decimal(0.5), preference_applicability: 'potentially_applicable_requires_origin_proof', national_tariff_code: '10089000' },
  ]);
  const fxSnapshot = await prisma.authoritativeFxSnapshot.create({
    data: { provider: 'ecb_sdmx', source_authority: 'European Central Bank', source_dataset: 'EXR', series_key: 'D.USD.EUR.SP00.A', request_reference: MARKER, requested_at: retrieved, retrieved_at: retrieved, http_status: 200, raw_response_checksum: randomUUID(), raw_response_text: 'fixture', parser_version: 'ecb-sdmx-exr-v1', normalization_version: 'ecb-fx-normalization-v1', environment: 'test', evidence_origin: EvidenceOrigin.fixture, completeness: 'COMPLETE' },
  });
  const day = new Date(`${new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)}T00:00:00Z`);
  await prisma.authoritativeFxObservation.createMany({
    data: [{ snapshot_id: fxSnapshot.id, provider: 'ecb_sdmx', series_key: `D.USD.EUR.SP00.A.${MARKER}`, base_currency: 'EUR', quote_currency: 'USD', rate: new Prisma.Decimal('1.1'), observation_date: day, observation_status: 'A', normalization_version: 'ecb-fx-normalization-v1', parser_version: 'ecb-sdmx-exr-v1', environment: 'test', evidence_origin: EvidenceOrigin.fixture, retrieved_at: retrieved }],
  });
}

async function paidProduct(tier: OrgTier) {
  const org = await prisma.exporterOrg.create({ data: { display_name: `${MARKER}-${tier}`, tier } });
  const user = await prisma.user.create({ data: { email: `${MARKER}-${tier}-${randomUUID()}@example.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id } });
  const product = await prisma.product.create({
    data: {
      exporter_org_id: org.id, name: 'Cereal grain', description: 'Cereal grain, not elsewhere classified', evidence_origin: EvidenceOrigin.fixture,
      price_target_amount: 2, price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB', capacity_value: 4000, capacity_unit: 'kg', capacity_period: 'month',
    },
  });
  const principal: Principal = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: org.id, tier };
  return { org, product, principal };
}

async function confirmCereal(productId: string, actor: Principal) {
  const candidate = await proposeClassification({ product_id: productId, hs6_code: '100890', nomenclature: 'HS', nomenclature_version: '2022', method: ProductClassificationMethod.exporter_supplied, evidence: {}, rationale: 'Other cereal grain.', confidence: 0.95 }, actor, MARKER);
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
    await confirmCereal(product.id, principal);
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
    // The real ECGC list and GeoDist capitals, with the originals the manifest records. A suffix the
    // parsers ignore makes this suite's bytes its own: another suite importing — and superseding —
    // the same file in the shared schema would otherwise make these bytes un-importable here.
    for (const [file, suffix] of [['ecgc-country-risk-st-2026-07-01.txt', `\n${MARKER}\n`], ['geo_cepii.csv', '\n']] as const) {
      const real = readFileSync(join(__dirname, '..', 'data', 'reference', file));
      const entry = manifestEntryFor(readReferenceManifest(), real)!;
      const bytes = Buffer.concat([real, Buffer.from(suffix)]);
      expect(await importReferenceDataset({ actor: ops, dataset_key: entry.dataset_key, bytes, source_url: entry.derived_from!.url, retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture, derived_from: entry.derived_from })).toMatchObject({ change: 'NEW' });
    }
    expect(await demandDiscoveryV5Availability()).toEqual({ available: true });
    await seedOfficialTariffs();

    const free = await paidProduct(OrgTier.free);
    await confirmCereal(free.product.id, free.principal);
    expect(await prisma.discoveryRun.count({ where: { product_id: free.product.id } })).toBe(0);
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: 'demand_discovery_auto_start', exporter_org_id: free.org.id } })).after_summary).toMatchObject({ started: false, reason: expect.stringMatching(/commitment fee/) });

    const paid = await paidProduct(OrgTier.paid);
    await confirmCereal(paid.product.id, paid.principal);
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
    expect(by.get('US')).toMatchObject({ market_status: 'ranked', rank: 1, data_year: 2025, handed_off: true, model_version: 'market-opportunity-v5', classification_hs6_code: '100890', evidence_origins: [EvidenceOrigin.fixture] });
    expect(by.get('DE')).toMatchObject({ market_status: 'ranked', data_year: 2024 });
    expect((by.get('AE')!.score_breakdown as unknown as Breakdown).newest_year).toEqual({ linked: null, refusal: 'implausible_change' });
    expect(by.get('KP')).toMatchObject({ market_status: 'excluded', eligibility_status: 'ineligible', overall_score: null, rank: null });
    expect(by.get('NP')).toMatchObject({ market_status: 'ranked' });
    expect((by.get('NP')!.labels as { key: string }[]).map((label) => label.key)).toContain('estimated_from_partners');
    // No trade dataset covers Tuvalu here; only its ECGC grade (C1, 40) is live: a partial score, never ranked.
    expect(by.get('TV')).toMatchObject({ market_status: 'not_enough_data', live_points: 10, overall_score: 40, rank: null });
    expect((by.get('US')!.reasons as unknown[]).length).toBe(3);
    const duty = (by.get('US')!.score_breakdown as unknown as Breakdown).metrics.find((metric) => metric.key === 'duty');
    expect(duty).toMatchObject({ estimated: true, inputs: { duty_percent: 4, basis: 'estimate', agreement_scope: 'none' } });
    const uaeDuty = (by.get('AE')!.score_breakdown as unknown as Breakdown).metrics.find((metric) => metric.key === 'duty');
    expect(uaeDuty).toMatchObject({ inputs: { duty_percent: 2.5, agreement_scope: 'comprehensive', agreement: 'India–UAE CEPA' } });
    const ranks = assessments.filter((row) => row.rank != null).map((row) => row.rank!).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, index) => index + 1));
    expect(closed.summary).toMatchObject({ markets: 218, excluded: 1, ranked: ranks.length, handed_off: expect.arrayContaining([expect.objectContaining({ market: 'US', rank: 1 })]) });
    expect((closed.summary as { notes: string[] }).notes.filter((note) => /ECGC|coordinates/.test(note))).toEqual([]);
    const metric = (market: string, key: string) => (by.get(market)!.score_breakdown as unknown as Breakdown).metrics.find((item) => item.key === key);
    expect(metric('US', 'country_risk')).toMatchObject({ score: 100, inputs: { grade: 'A1', cover: 'open' } });
    expect(metric('NP', 'country_risk')).toMatchObject({ score: 55, inputs: { grade: 'B2', cover: 'open' } });
    // US suppliers: China, Viet Nam, India, the UAE and BACI 490 placed at Taipei — all on the map.
    expect(metric('US', 'distance_fit')).toMatchObject({ score: expect.any(Number), inputs: { covered_share: 1 } });
    expect(frozen.reference['ecgc:country-risk:short-term']).toMatchObject({ release_id: expect.any(String) });
    expect(frozen.reference['cepii:geo_cepii']).toMatchObject({ release_id: expect.any(String) });
    expect(frozen.provider_coordinates).toEqual({ placed: [{ identity: 'cepii_baci:490', iso2: 'TW', city: 'Taipei' }], unplaced: [] });
    // Official duty: Germany's EUR 175 per tonne at EUR/USD 1.1 over Germany's median supplier unit
    // value of USD 2.50/kg is 7.7%; Nepal's 10% is scored, the 0% preference only noted.
    const deDuty = metric('DE', 'duty')!;
    expect(deDuty).toMatchObject({ inputs: { basis: 'official', source: 'EU TARIC 1008909000', duty_expression: '175.00 EUR / 1000 kg', market_usd_per_kg: 2.5 } });
    expect(deDuty.inputs.duty_percent).toBeCloseTo(7.7, 4);
    expect(metric('NP', 'duty')).toMatchObject({ score: 60, inputs: { basis: 'official', duty_percent: 10, preference_percent: 0, preference_applicability: 'potentially_applicable_requires_origin_proof' } });
    expect((by.get('NP')!.reasons as { text: string }[]).map((reason) => reason.text).join(' ')).not.toMatch(/estimated\)/);
    expect(frozen.official_duty.markets).toMatchObject({ DE: { status: 'specific' }, NP: { status: 'percent' } });
    expect(Object.keys(frozen.official_duty.markets).sort()).toEqual(['DE', 'NP']);
    expect((closed.summary as { notes: string[] }).notes.filter((note) => /official tariff/.test(note))).toEqual([]);

    // A retry replaces the result set rather than appending to it.
    await prisma.job.update({ where: { id: run.job_id! }, data: { status: JobStatus.queued, dedupe_key: null } });
    const retry = await claimNextJob([JobType.demand_discovery_v5]);
    await runClaimedJob(retry!);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: run.job_id! } })).toMatchObject({ status: JobStatus.completed, error_message: null });
    expect(await prisma.marketAssessment.count({ where: { run_id: run.id } })).toBe(218);
  });
});
