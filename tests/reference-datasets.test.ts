import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { EvidenceOrigin, OrgTier, ReferenceDatasetReleaseStatus, UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseComtradeAvailability, parseIndiaTradeAgreements, parseWdiIndicator, wdiRowSchema } from '../src/lib/reference-datasets/parsers';
import { referenceDatasetDefinition } from '../src/lib/reference-datasets/registry';
import { activeReferenceRows, importReferenceDataset } from '../src/lib/reference-datasets/service';
import type { Principal } from '../src/types';

/**
 * Synthetic responses in the publishers' documented shapes: World Bank API v2 returns
 * [metadata, rows]; UN Comtrade getDa returns {elapsedTime, count, data, error}. Values are invented.
 */
function wdiResponse(indicator: string, rows: { iso3: string; name: string; date: string; value: number | null }[], meta: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify([
    { page: 1, pages: 1, per_page: 20000, total: rows.length, sourceid: '2', sourcename: 'World Development Indicators', lastupdated: '2026-07-01', ...meta },
    rows.map((row) => ({ indicator: { id: indicator, value: 'Logistics performance index: Overall (1=low to 5=high)' }, country: { id: row.iso3.slice(0, 2), value: row.name }, countryiso3code: row.iso3, date: row.date, value: row.value, unit: '', obs_status: '', decimal: 2 })),
  ]));
}

function getDaResponse(period: number, reporters: { code: number; iso: string; total: number }[]) {
  return Buffer.from(JSON.stringify({
    elapsedTime: '0.1 secs', count: reporters.length, error: '',
    data: reporters.map((reporter) => ({ datasetCode: 1, typeCode: 'C', freqCode: 'A', period, reporterCode: reporter.code, reporterISO: reporter.iso, reporterDesc: reporter.iso, classificationCode: 'H6', classificationSearchCode: 'HS', isOriginalClassification: true, totalRecords: reporter.total, datasetChecksum: 1, firstReleased: '2026-07-08T21:20:44.95', lastReleased: '2026-07-08T21:20:44.95' })),
  }));
}

describe('World Bank WDI parser', () => {
  test('keeps the latest non-null value per ISO country and drops aggregates by construction', () => {
    const parsed = parseWdiIndicator(wdiResponse('LP.LPI.OVRL.XQ', [
      { iso3: 'IND', name: 'India', date: '2022', value: 3.4 },
      { iso3: 'IND', name: 'India', date: '2018', value: 3.18 },
      { iso3: 'ARE', name: 'United Arab Emirates', date: '2022', value: 4 },
      { iso3: 'AFE', name: 'Africa Eastern and Southern', date: '2022', value: 2.5 },
      { iso3: 'WLD', name: 'World', date: '2022', value: 3 },
      { iso3: 'BGD', name: 'Bangladesh', date: '2022', value: null },
    ]), 'LP.LPI.OVRL.XQ');
    expect(parsed.rows).toEqual([{ iso2: 'AE', iso3: 'ARE', year: 2022, value: 4 }, { iso2: 'IN', iso3: 'IND', year: 2022, value: 3.4 }]);
    expect(parsed.last_updated).toBe('2026-07-01');
  });

  test('refuses another indicator, a paged response and an API error message', () => {
    expect(() => parseWdiIndicator(wdiResponse('TM.TAX.MANF.SM.AR.ZS', [{ iso3: 'IND', name: 'India', date: '2022', value: 1 }]), 'LP.LPI.OVRL.XQ')).toThrow(/not LP.LPI.OVRL.XQ/);
    expect(() => parseWdiIndicator(wdiResponse('LP.LPI.OVRL.XQ', [{ iso3: 'IND', name: 'India', date: '2022', value: 1 }], { pages: 3 }), 'LP.LPI.OVRL.XQ')).toThrow(/3 pages/);
    expect(() => parseWdiIndicator(Buffer.from(JSON.stringify([{ message: [{ id: '120', key: 'Invalid value', value: 'The provided parameter value is not valid' }] }])), 'LP.LPI.OVRL.XQ')).toThrow(/not \[metadata, rows\]/);
  });
});

describe('Comtrade data availability parser', () => {
  test('lists reporters for the expected period and refuses a mismatched one', () => {
    const rows = parseComtradeAvailability(getDaResponse(2025, [{ code: 842, iso: 'USA', total: 900 }, { code: 20, iso: 'AND', total: 48315 }]), 2025);
    expect(rows.map((row) => [row.reporter_code, row.reporter_iso3, row.total_records])).toEqual([['20', 'AND', 48315], ['842', 'USA', 900]]);
    expect(() => parseComtradeAvailability(getDaResponse(2024, [{ code: 842, iso: 'USA', total: 1 }]), 2025)).toThrow(/not 2025/);
  });
});

describe("India's trade agreements (curated file)", () => {
  const file = readFileSync(join(__dirname, '..', 'data', 'reference', 'india-trade-agreements-v1.json'));

  test('the checked-in list parses: every row has a source, a date and a known scope', () => {
    const parsed = parseIndiaTradeAgreements(file);
    expect(parsed.rows.length).toBeGreaterThan(30);
    expect(parsed.rows.every((row) => row.source_url.startsWith('https://'))).toBe(true);
    const find = (iso2: string, agreement: string) => parsed.rows.find((row) => row.partner_iso2 === iso2 && row.agreement.includes(agreement));
    expect(find('AE', 'UAE CEPA')).toMatchObject({ scope: 'comprehensive', in_force_from: '2022-05-01' });
    expect(find('GB', 'UK CETA')).toMatchObject({ scope: 'comprehensive', in_force_from: '2026-07-15' });
    expect(find('VN', 'ASEAN')).toMatchObject({ in_force_from: '2010-06-01' });
    expect(parsed.rows.some((row) => row.partner_iso2 === 'PK')).toBe(false);
    expect(parsed.excluded.map((item) => item.agreement)).toEqual(expect.arrayContaining(['India–EU FTA', 'Global System of Trade Preferences (GSTP)']));
    expect(referenceDatasetDefinition('india:trade-agreements').parse(file).rows).toHaveLength(parsed.rows.length);
  });

  test('refuses a row without a source, a duplicate pair and an end before its start', () => {
    const doc = (rows: unknown[]) => Buffer.from(JSON.stringify({ schema_version: 'india-trade-agreements-v1', compiled_on: '2026-10-13', excluded: [], rows }));
    const row = { agreement: 'Agreement A', partner_iso2: 'AE', scope: 'comprehensive', in_force_from: '2022-05-01', in_force_until: null, source_url: 'https://example.test', note: null };
    expect(() => parseIndiaTradeAgreements(doc([{ ...row, source_url: 'example' }]))).toThrow(/source_url/);
    expect(() => parseIndiaTradeAgreements(doc([row, row]))).toThrow(/repeats Agreement A for AE/);
    expect(() => parseIndiaTradeAgreements(doc([{ ...row, in_force_until: '2021-01-01' }]))).toThrow(/ends before it starts/);
    expect(() => parseIndiaTradeAgreements(doc([{ ...row, scope: 'broad' }]))).toThrow(/scope/);
  });
});

describe('reference dataset releases', () => {
  let actor: Principal;
  beforeAll(async () => {
    const id = `refdata-${randomUUID()}`;
    await prisma.user.create({ data: { id, email: `${id}@test.local`, name: 'Reference Operator', role: UserRole.admin } });
    actor = { id, email: `${id}@test.local`, name: 'Reference Operator', role: UserRole.admin, exporter_org_id: null, tier: OrgTier.paid };
  });
  afterAll(async () => { await prisma.$disconnect(); });

  const importArgs = (bytes: Buffer) => ({
    actor, dataset_key: 'wdi:LP.LPI.OVRL.XQ', bytes, source_url: 'https://api.worldbank.org/v2/country/all/indicator/LP.LPI.OVRL.XQ?format=json',
    retrieved_at: new Date('2026-10-13T00:00:00Z'), correlation_id: randomUUID(), evidence_origin: EvidenceOrigin.fixture,
  });

  test('imports once, is UNCHANGED on the same bytes, and a newer file supersedes the active release', async () => {
    const first = await importReferenceDataset(importArgs(wdiResponse('LP.LPI.OVRL.XQ', [{ iso3: 'IND', name: 'India', date: '2022', value: 3.4 }])));
    expect(first).toMatchObject({ change: 'NEW', row_count: 1 });
    expect(await importReferenceDataset(importArgs(wdiResponse('LP.LPI.OVRL.XQ', [{ iso3: 'IND', name: 'India', date: '2022', value: 3.4 }])))).toMatchObject({ change: 'UNCHANGED', release_id: first.release_id });

    const second = await importReferenceDataset(importArgs(wdiResponse('LP.LPI.OVRL.XQ', [{ iso3: 'IND', name: 'India', date: '2022', value: 3.4 }, { iso3: 'USA', name: 'United States', date: '2022', value: 3.8 }])));
    expect(second.change).toBe('NEW');
    // Only this suite's releases: other suites sharing the schema may have imported the same key.
    const releases = await prisma.referenceDatasetRelease.findMany({ where: { dataset_key: 'wdi:LP.LPI.OVRL.XQ', imported_by_id: actor.id }, orderBy: { imported_at: 'asc' } });
    expect(releases.map((release) => release.status)).toEqual([ReferenceDatasetReleaseStatus.superseded, ReferenceDatasetReleaseStatus.active]);

    const active = await activeReferenceRows('wdi:LP.LPI.OVRL.XQ', wdiRowSchema);
    expect(active).toMatchObject({ release_id: second.release_id, rows: [{ iso2: 'IN', value: 3.4 }, { iso2: 'US', value: 3.8 }] });
    await expect(importReferenceDataset(importArgs(wdiResponse('LP.LPI.OVRL.XQ', [{ iso3: 'IND', name: 'India', date: '2022', value: 3.4 }])))).rejects.toThrow(/since superseded/);
  });

  test('rows are immutable and releases are never deleted', async () => {
    const release = await prisma.referenceDatasetRelease.findFirstOrThrow({ where: { dataset_key: 'wdi:LP.LPI.OVRL.XQ', status: ReferenceDatasetReleaseStatus.active, imported_by_id: actor.id } });
    await expect(prisma.referenceDatasetRelease.update({ where: { id: release.id }, data: { rows: [] , row_count: 0 } })).rejects.toThrow(/immutable/);
    await expect(prisma.referenceDatasetRelease.delete({ where: { id: release.id } })).rejects.toThrow(/never deleted/);
  });

  test('unknown datasets and non-staff importers are refused', async () => {
    expect(() => referenceDatasetDefinition('wdi:NY.GDP.MKTP.CD')).toThrow(/Unknown reference dataset/);
    await expect(importReferenceDataset({ ...importArgs(Buffer.from('[]')), actor: { ...actor, role: UserRole.agent } })).rejects.toThrow(/operations staff/);
  });
});
