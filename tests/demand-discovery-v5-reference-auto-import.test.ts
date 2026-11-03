import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { ReferenceDatasetReleaseStatus, UserRole } from '@prisma/client';
import { OrgTier } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { autoImportReferenceData, autoImportSource, writeAutoImportSwitch } from '@/lib/demand-discovery-v5/reference-auto-import';
import { prisma } from '@/lib/prisma';

/** Stage 1, item 4 (E-040): the keyless World Bank and Comtrade inputs import themselves when due. */
const LATER = new Date('2030-01-01T00:00:00Z');
const MARKER = randomUUID();

const wdi = (indicator: string) => JSON.stringify([
  { page: 1, pages: 1, per_page: 20000, total: 2, lastupdated: '2029-12-01' },
  [['USA', 3.9], ['DEU', 4.2]].map(([iso3, value]) => ({ indicator: { id: indicator, value: `${indicator} ${MARKER}` }, country: { id: String(iso3).slice(0, 2), value: iso3 }, countryiso3code: iso3, date: '2028', value, unit: '', obs_status: '', decimal: 2 })),
]);
const getDa = (period: number) => JSON.stringify({
  elapsedTime: MARKER, count: 1, error: '',
  data: [{ datasetCode: 1, typeCode: 'C', freqCode: 'A', period, reporterCode: 842, reporterISO: 'USA', reporterDesc: 'USA', classificationCode: 'H6', classificationSearchCode: 'HS', isOriginalClassification: true, totalRecords: 1000, datasetChecksum: 1, firstReleased: '2029-07-01T00:00:00', lastReleased: '2029-07-01T00:00:00' }],
});

function publisher(failing: string | null = null) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    if (failing && url.includes(failing)) return new Response('Service unavailable', { status: 503 });
    const indicator = /indicator\/([A-Z0-9.]+)\?/.exec(url)?.[1];
    if (indicator) return new Response(wdi(indicator), { status: 200 });
    const period = /period=(\d{4})/.exec(url)?.[1];
    if (period) return new Response(getDa(Number(period)), { status: 200 });
    return new Response('Not found', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('automatic imports of the keyless inputs', () => {
  test('only the World Bank indicators and Comtrade lists have a publisher URL, the runbook one', () => {
    expect(autoImportSource('wdi:LP.LPI.OVRL.XQ')).toBe('https://api.worldbank.org/v2/country/all/indicator/LP.LPI.OVRL.XQ?format=json&per_page=20000&mrnev=1');
    expect(autoImportSource('comtrade:availability:2025')).toBe('https://comtradeapi.un.org/public/v1/getDa/C/A/HS?period=2025');
    for (const key of ['ecgc:country-risk:short-term', 'india:trade-agreements', 'curated:sanctions-programmes', 'cepii:geo_cepii']) expect(autoImportSource(key)).toBeNull();
  });

  test('without an account to import as, nothing is downloaded and each due input says why', async () => {
    const { calls, fetchImpl } = publisher();
    const result = await autoImportReferenceData({ now: LATER, fetchImpl, actor_email: null });
    expect(result!.actor).toBeNull();
    expect(result!.due).toEqual(expect.arrayContaining(['wdi:LP.LPI.OVRL.XQ', 'wdi:IS.SHP.GCNW.XQ', 'wdi:TM.TAX.TCOM.SM.AR.ZS', 'wdi:TM.TAX.MANF.SM.AR.ZS']));
    expect(calls).toEqual([]);
    expect(result!.failed[0]!.reason).toMatch(/No active ops supervisor or admin account is configured/);
    // An agent cannot import reference data, so an agent's address is refused the same way.
    const agent = await prisma.user.create({ data: { email: `auto-import-agent-${MARKER.slice(0, 8)}@t.test`, name: 'Agent', role: UserRole.agent }, select: { email: true } });
    expect((await autoImportReferenceData({ now: LATER, fetchImpl, actor_email: agent.email }))!.failed[0]!.reason).toMatch(/matches auto-import-agent/);
    expect(calls).toEqual([]);
  });

  test('due inputs are downloaded and imported as the staff account; a publisher failure is reported and the rest still import', async () => {
    const ops = await prisma.user.create({ data: { email: `auto-import-ops-${MARKER.slice(0, 8)}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true, email: true } });
    const { calls, fetchImpl } = publisher('IS.SHP.GCNW.XQ');
    const result = await autoImportReferenceData({ now: LATER, fetchImpl, actor_email: ops.email });
    expect(result!.actor).toBe(ops.email);
    expect(calls).toEqual(result!.due.map((key) => autoImportSource(key)));
    expect(result!.failed).toEqual([{ key: 'wdi:IS.SHP.GCNW.XQ', reason: 'The publisher answered HTTP 503.' }]);
    const lpi = result!.imported.find((item) => item.key === 'wdi:LP.LPI.OVRL.XQ')!;
    expect(lpi).toMatchObject({ change: 'NEW', version: 'WDI LP.LPI.OVRL.XQ updated 2029-12-01' });
    const release = await prisma.referenceDatasetRelease.findUniqueOrThrow({ where: { id: lpi.release_id } });
    expect(release).toMatchObject({ dataset_key: 'wdi:LP.LPI.OVRL.XQ', status: ReferenceDatasetReleaseStatus.active, source_url: autoImportSource('wdi:LP.LPI.OVRL.XQ') });
    expect(await prisma.auditEvent.count({ where: { object_type: 'reference_dataset_release', object_id: lpi.release_id, actor_user_id: ops.id } })).toBeGreaterThanOrEqual(1);

    // Imported, it is no longer due; the one that failed still is, and imports once the publisher answers.
    const again = await autoImportReferenceData({ now: LATER, fetchImpl: publisher().fetchImpl, actor_email: ops.email });
    expect(again!.due).not.toContain('wdi:LP.LPI.OVRL.XQ');
    expect(again!.imported.find((item) => item.key === 'wdi:IS.SHP.GCNW.XQ')).toMatchObject({ change: 'NEW' });
    // A year on it is due again, and the same bytes change nothing.
    const yearOn = await autoImportReferenceData({ now: new Date('2031-02-01T00:00:00Z'), fetchImpl: publisher().fetchImpl, actor_email: ops.email });
    expect(yearOn!.imported.find((item) => item.key === 'wdi:LP.LPI.OVRL.XQ')).toMatchObject({ change: 'UNCHANGED', release_id: lpi.release_id });
  });

  test('the switch writes only its two fields, by an admin, audited; the policy keeps following the code', async () => {
    const make = async (role: UserRole) => {
      const user = await prisma.user.create({ data: { email: `switch-${role}-${MARKER.slice(0, 8)}@t.test`, name: role, role }, select: { id: true, email: true, name: true } });
      return { id: user.id, email: user.email, name: user.name ?? '', role, exporter_org_id: null, tier: OrgTier.paid };
    };
    const admin = await make(UserRole.admin);
    const supervisor = await make(UserRole.ops_supervisor);
    const before = await prisma.configSetting.findFirst({ where: { key: 'demand_discovery.v5', is_active: true }, orderBy: { version: 'desc' } });
    try {
      await expect(writeAutoImportSwitch({ enabled: true, actor_email: supervisor.email, changed_by: supervisor, reason: 'Try' })).rejects.toThrow(/config.edit is admin-only/);
      await expect(writeAutoImportSwitch({ enabled: true, actor_email: 'nobody@t.test', changed_by: admin, reason: 'Try' })).rejects.toThrow(/No active ops supervisor or admin account matches/);
      const on = await writeAutoImportSwitch({ enabled: true, actor_email: supervisor.email.toUpperCase(), changed_by: admin, reason: 'Import the keyless inputs on staging (E-044)' });
      expect(on.value).toEqual({ ...((before?.value ?? {}) as object), reference_auto_import: true, reference_auto_import_actor_email: supervisor.email });
      expect(on.value).not.toHaveProperty('policy');
      const config = await getConfig('demand_discovery.v5');
      expect(config).toMatchObject({ reference_auto_import: true, reference_auto_import_actor_email: supervisor.email });
      expect(await prisma.auditEvent.count({ where: { action: 'config_change', actor_user_id: admin.id } })).toBe(1);
      const off = await writeAutoImportSwitch({ enabled: false, changed_by: admin, reason: 'Pause during a gate check' });
      expect(off.value).toMatchObject({ reference_auto_import: false, reference_auto_import_actor_email: supervisor.email });
      expect(await prisma.configSetting.count({ where: { key: 'demand_discovery.v5', is_active: true } })).toBe(1);
    } finally {
      // Leave the shared test schema as it was for later files.
      await prisma.configSetting.updateMany({ where: { key: 'demand_discovery.v5', is_active: true }, data: { is_active: false } });
      if (before) await prisma.configSetting.update({ where: { id: before.id }, data: { is_active: true } });
    }
  });
});
