import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, OrgTier, TradeDatasetReleaseStatus, UserRole } from '@prisma/client';
import type { DocumentStorage, StoredObject } from '../src/lib/document-storage';
import { prisma } from '../src/lib/prisma';
import { importTradeDatasetRelease, latestReadyTradeDatasetRelease, readProductFlows } from '../src/lib/trade-datasets/service';
import type { Principal } from '../src/types';
import { buildZip, type ZipMember } from './zip-builder';

/**
 * A synthetic archive in BACI's documented shape (docs/36 §2): yearly t,i,j,k,v,q files, a country
 * file and a product file. The figures are invented and exist only to exercise the importer.
 */
const COUNTRIES = 'country_code,country_name,country_iso2,country_iso3\n699,India,IN,IND\n842,USA,US,USA\n276,Germany,DE,DEU\n156,China,CN,CHN\n50,Bangladesh,BD,BGD\n490,"Other Asia, nes",N/A,S19\n';
const PRODUCTS = 'code,description\n100630,"Rice, semi-milled or wholly milled"\n570110,Carpets of wool\n741810,Table and kitchen articles of copper\n';
const YEAR_2023 = 't,i,j,k,v,q\n2023,699,842,100630,1000.5,800\n2023,156,842,100630,500,NA\n2023,699,276,570110,250.25,10\n2023,156,50,741810,12,1\n';
const YEAR_2024 = 't,i,j,k,v,q\n2024,699,842,100630,1200,900\n2024,50,842,100630,40,30\n2024,490,276,570110,5,\n2024,699,50,100630,300,250\n';

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

const dir = mkdtempSync(join(tmpdir(), 'baci-import-'));
let actor: Principal;
const storage = new MemoryStorage();

function writeArchive(name: string, members: ZipMember[]) {
  const path = join(dir, name);
  const bytes = buildZip(members);
  writeFileSync(path, bytes);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}

const good = () => writeArchive(`good-${randomUUID()}.zip`, [
  { name: 'BACI_HS17_Y2023_V209901.csv', data: YEAR_2023 },
  { name: 'BACI_HS17_Y2024_V209901.csv', data: YEAR_2024 },
  { name: 'country_codes_V209901.csv', data: COUNTRIES },
  { name: 'product_codes_HS17_V209901.csv', data: PRODUCTS },
  { name: 'Readme.txt', data: 'synthetic test archive' },
]);

function args(path: string, sha256: string, version = 'V209901') {
  return {
    actor, file_path: path, expect_sha256: sha256, provider: 'cepii_baci' as const, dataset_version: version, hs_revision: 'HS17' as const,
    source_url: 'https://example.test/baci.zip', retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(),
    evidence_origin: EvidenceOrigin.fixture, storage,
  };
}

beforeAll(async () => {
  const id = `baci-ops-${randomUUID()}`;
  await prisma.user.create({ data: { id, email: `${id}@test.local`, name: 'Dataset Operator', role: UserRole.ops_supervisor } });
  actor = { id, email: `${id}@test.local`, name: 'Dataset Operator', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
});

afterAll(async () => {
  // Leave no ready release behind: a ready BACI release makes Demand Discovery v5 available, which
  // would change what later suites sharing this schema see (auto-start on classification).
  await prisma.tradeDatasetRelease.updateMany({ where: { dataset_version: { startsWith: 'V2099' }, status: TradeDatasetReleaseStatus.ready }, data: { status: TradeDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  await prisma.$disconnect();
});

describe('trade dataset import (BACI)', () => {
  test('imports, partitions by year and chapter, and reads one product back with verified checksums', async () => {
    const archive = good();
    const result = await importTradeDatasetRelease(args(archive.path, archive.sha256));
    expect(result).toMatchObject({ change: 'NEW', row_count: 8 });
    const release = await prisma.tradeDatasetRelease.findUniqueOrThrow({ where: { id: result.release_id }, include: { partitions: true, countries: true } });
    expect(release).toMatchObject({ status: TradeDatasetReleaseStatus.ready, first_year: 2023, last_year: 2024, licence: 'etalab-2.0', partition_count: 5 });
    expect(release.partitions.map((partition) => `${partition.year}/${partition.hs_chapter}:${partition.row_count}`).sort()).toEqual(['2023/10:2', '2023/57:1', '2023/74:1', '2024/10:3', '2024/57:1']);
    expect(release.partitions.find((partition) => partition.year === 2024 && partition.hs_chapter === '10')!.value_sum.toString()).toBe('1540');
    expect(release.countries.find((country) => country.provider_code === '490')).toMatchObject({ iso2: null, iso3: null, name: 'Other Asia, nes' });
    expect(release.validation).toMatchObject({ years: [2023, 2024], country_count: 6, product_count: 3, unrecognised_members: ['Readme.txt'] });

    const read = await readProductFlows({ release_id: release.id, hs6: '100630', storage });
    expect(read.flows.map((flow) => `${flow.year}:${flow.exporter}->${flow.importer}:${flow.value_kusd}:${flow.quantity_t}`)).toEqual([
      '2023:699->842:1000.5:800', '2023:156->842:500:null', '2024:699->842:1200:900', '2024:50->842:40:30', '2024:699->50:300:250',
    ]);
    expect(read.partitions.map((partition) => partition.year)).toEqual([2023, 2024]);
    expect(read.years_without_partition).toEqual([]);

    const carpets = await readProductFlows({ release_id: release.id, hs6: '570110', years: [2022, 2024], storage });
    expect(carpets.flows).toEqual([{ year: 2024, exporter: '490', importer: '276', product: '570110', value_kusd: 5, quantity_t: null }]);
    expect(carpets.years_without_partition).toEqual([2022]);
    expect(await latestReadyTradeDatasetRelease('cepii_baci', 'HS17')).toMatchObject({ id: release.id });
  });

  test('a second import of the same bytes is UNCHANGED, and the stated sha256 must match', async () => {
    const archive = good();
    // The builder is deterministic, so these bytes may already be imported by the first test.
    const first = await importTradeDatasetRelease(args(archive.path, archive.sha256));
    const again = await importTradeDatasetRelease(args(archive.path, archive.sha256));
    expect(again).toMatchObject({ change: 'UNCHANGED', release_id: first.release_id, row_count: 8 });
    const audits = await prisma.auditEvent.count({ where: { object_type: 'trade_dataset_release', object_id: first.release_id, action: 'acquisition_unchanged' } });
    expect(audits).toBeGreaterThanOrEqual(1);
    await expect(importTradeDatasetRelease(args(archive.path, 'a'.repeat(64)))).rejects.toThrow(/not the expected/);
  });

  test('a malformed row fails the import, records why, and leaves no ready release', async () => {
    const archive = writeArchive('bad-row.zip', [
      { name: 'BACI_HS17_Y2024_V209903.csv', data: 't,i,j,k,v,q\n2024,699,842,100630,1200,900\n2024,699,842,10063,5,1\n' },
      { name: 'country_codes_V209903.csv', data: COUNTRIES },
    ]);
    await expect(importTradeDatasetRelease(args(archive.path, archive.sha256, 'V209903'))).rejects.toThrow(/line 3: product "10063"/);
    const release = await prisma.tradeDatasetRelease.findFirstOrThrow({ where: { dataset_version: 'V209903' } });
    expect(release.status).toBe(TradeDatasetReleaseStatus.failed);
    expect(JSON.stringify(release.validation)).toContain('10063');
  });

  test('a flow naming a country the archive does not define is refused', async () => {
    const archive = writeArchive('unknown-country.zip', [
      { name: 'BACI_HS17_Y2024_V209904.csv', data: 't,i,j,k,v,q\n2024,699,999,100630,1,1\n' },
      { name: 'country_codes_V209904.csv', data: COUNTRIES },
    ]);
    await expect(importTradeDatasetRelease(args(archive.path, archive.sha256, 'V209904'))).rejects.toThrow(/country code 999 is not in the archive's country file/);
  });

  test('archives that are not the stated revision and version are refused before any release is written', async () => {
    const archive = writeArchive('wrong-version.zip', [
      { name: 'BACI_HS22_Y2024_V209905.csv', data: YEAR_2024 },
      { name: 'country_codes_V209905.csv', data: COUNTRIES },
    ]);
    await expect(importTradeDatasetRelease(args(archive.path, archive.sha256, 'V209905'))).rejects.toThrow(/are not HS17 V209905/);
    expect(await prisma.tradeDatasetRelease.count({ where: { dataset_version: 'V209905' } })).toBe(0);
  });

  test('a tampered partition is never read', async () => {
    const archive = writeArchive('tamper.zip', [
      { name: 'BACI_HS17_Y2024_V209906.csv', data: YEAR_2024 },
      { name: 'country_codes_V209906.csv', data: COUNTRIES },
    ]);
    const result = await importTradeDatasetRelease(args(archive.path, archive.sha256, 'V209906'));
    const partition = await prisma.tradeDatasetPartition.findFirstOrThrow({ where: { release_id: result.release_id, hs_chapter: '10' } });
    const original = await storage.get(partition.object_key);
    storage.objects.set(partition.object_key, gzipSync(gunzipSync(original).toString().replace('1200', '9999')));
    await expect(readProductFlows({ release_id: result.release_id, hs6: '100630', storage })).rejects.toThrow(/does not match the manifest/);
    storage.objects.set(partition.object_key, original);
  });

  test('the database refuses to rewrite a ready release or delete a partition', async () => {
    const archive = writeArchive('immutable.zip', [
      { name: 'BACI_HS17_Y2024_V209907.csv', data: YEAR_2024 },
      { name: 'country_codes_V209907.csv', data: COUNTRIES },
    ]);
    const result = await importTradeDatasetRelease(args(archive.path, archive.sha256, 'V209907'));
    await expect(prisma.tradeDatasetRelease.update({ where: { id: result.release_id }, data: { source_url: 'https://example.test/other' } })).rejects.toThrow(/immutable/);
    await expect(prisma.tradeDatasetRelease.update({ where: { id: result.release_id }, data: { status: TradeDatasetReleaseStatus.failed } })).rejects.toThrow(/immutable/);
    await expect(prisma.tradeDatasetPartition.deleteMany({ where: { release_id: result.release_id } })).rejects.toThrow(/append-only/);
    await prisma.tradeDatasetRelease.update({ where: { id: result.release_id }, data: { status: TradeDatasetReleaseStatus.superseded, superseded_at: new Date() } });
  });

  test('only operations staff may import', async () => {
    const archive = good();
    await expect(importTradeDatasetRelease({ ...args(archive.path, archive.sha256), actor: { ...actor, role: UserRole.agent } })).rejects.toThrow(/operations staff/);
  });
});
