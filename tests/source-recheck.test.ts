import { randomUUID } from 'node:crypto';
import { AuthorityReleaseChange, AuthorityReleaseStatus, OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { assessInputFreshness, loadInputFreshness, type FreshnessState } from '@/lib/demand-discovery-v5/input-freshness';
import { compareWithRelease, latestSourceRechecks, officialFiles, recordSourceRecheck } from '@/lib/market-access/source-recheck';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '@/types';

/**
 * E-069: a tariff source with no publishing rhythm is re-checked yearly. A re-check that finds the
 * official files unchanged is recorded, and the next one falls a year later; a changed file is named.
 */
const at = (value: string) => new Date(`${value}T00:00:00.000Z`);
const TARIFF = { name: 'IntegratedCustomsTariff.pdf', role: 'official_common_tariff', url: 'https://example.test/tariff.pdf', sha256: 'a'.repeat(64), size_bytes: 10 };
const CEPA = { name: 'Schedule-of-UAE.pdf', role: 'official_preference_schedule', url: 'https://example.test/cepa.pdf', sha256: 'b'.repeat(64), size_bytes: 10 };
const MANIFEST = [TARIFF, CEPA, { name: 'normalized-lines.json', role: 'lines_read_from_the_official_files', url: 'https://example.test/tariff.pdf', sha256: 'c'.repeat(64), size_bytes: 10 }];

describe('comparing today’s official files with the release’s own', () => {
  test('the official files exclude what ClearTrade derived from them', () => {
    expect(officialFiles(MANIFEST).map((file) => file.name)).toEqual(['IntegratedCustomsTariff.pdf', 'Schedule-of-UAE.pdf']);
    expect(officialFiles(null)).toEqual([]);
  });

  test('unchanged only when every file matches and every official file was supplied', () => {
    const official = officialFiles(MANIFEST);
    expect(compareWithRelease(official, [{ file: 'tariff.pdf', sha256: TARIFF.sha256 }, { file: 'cepa.pdf', sha256: CEPA.sha256 }]))
      .toEqual({ status: 'unchanged', files: [{ name: TARIFF.name, sha256: TARIFF.sha256 }, { name: CEPA.name, sha256: CEPA.sha256 }] });
    // A new edition of the tariff: named, nothing recorded.
    expect(compareWithRelease(official, [{ file: 'tariff.pdf', sha256: 'd'.repeat(64) }, { file: 'cepa.pdf', sha256: CEPA.sha256 }]))
      .toEqual({ status: 'changed', differing: [{ file: 'tariff.pdf', sha256: 'd'.repeat(64) }], not_supplied: [TARIFF.name] });
    // Only one of the two files supplied: not a re-check of the release.
    expect(compareWithRelease(official, [{ file: 'tariff.pdf', sha256: TARIFF.sha256 }])).toMatchObject({ status: 'changed', differing: [], not_supplied: [CEPA.name] });
    expect(compareWithRelease([], [{ file: 'x.pdf', sha256: TARIFF.sha256 }])).toMatchObject({ status: 'changed' });
  });
});

describe('a recorded re-check moves the next one a year on', () => {
  const state = (tariffs: FreshnessState['tariffs']): FreshnessState => ({
    baci: [], reference: new Map(), tariffs, rule_rates: {}, latest_usd_observation: null, singapore_refresh_enabled: false,
  });
  const release = (source_family: string, reference: string, rechecked?: string) => ({
    source_family, authority: `${source_family} authority`, label: source_family, release_identifier: `${source_family}-1`,
    reference_date: at(reference), retrieved_at: at('2026-10-19'), rechecked_on: rechecked ? at(rechecked) : null,
  });

  test('a source with no rhythm counts from its newest unchanged re-check; a monthly one does not', () => {
    // Production, 10 Nov 2026: the GCC tariff (Dubai Customs, 23 Jul 2025) showed Overdue for good.
    const row = (tariffs: FreshnessState['tariffs'], now: string, key: string) => assessInputFreshness(state(tariffs), at(now)).find((item) => item.key === key)!;
    expect(row([release('GCC_UNIFIED_TARIFF', '2025-07-23')], '2026-11-11', 'tariff:GCC_UNIFIED_TARIFF:GCC_UNIFIED_TARIFF authority')).toMatchObject({ status: 'overdue', due_at: '2026-07-23T00:00:00.000Z' });
    expect(row([release('GCC_UNIFIED_TARIFF', '2025-07-23', '2026-11-11')], '2026-11-11', 'tariff:GCC_UNIFIED_TARIFF:GCC_UNIFIED_TARIFF authority'))
      .toMatchObject({ status: 'fresh', due_at: '2027-11-11T00:00:00.000Z', current: { rechecked_on: '2026-11-11T00:00:00.000Z' } });
    // TARIC is published monthly: re-checking an old month does not make it current.
    expect(row([release('EU_TARIC', '2026-09-01', '2026-11-11')], '2026-11-11', 'tariff:EU_TARIC:EU_TARIC authority')).toMatchObject({ status: 'overdue', due_at: '2026-10-16T00:00:00.000Z' });
  });

  test('recorded by operations staff only; the loader reads the newest one', async () => {
    const marker = randomUUID();
    const admin = await prisma.user.create({ data: { email: `recheck-${marker}@example.test`, name: 'Ops', role: UserRole.admin } });
    const exporter = await prisma.user.create({ data: { email: `recheck-exporter-${marker}@example.test`, name: 'Exporter', role: UserRole.exporter_owner } });
    const principal = (user: typeof admin): Principal => ({ id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid });
    const authority = `Dubai Customs ${marker}`;
    const stored = await prisma.authorityRelease.create({ data: {
      label: `GCC tariff ${marker}`, source_family: 'GCC_UNIFIED_TARIFF', authority, destination_scope: ['AE'], source_url: TARIFF.url,
      release_identifier: `gcc-${marker}`, reference_date: at('2025-07-23'), source_distribution: 'test retained authority release', retrieved_at: at('2026-10-19'),
      source_format: 'zip', checksum: marker.replaceAll('-', '').padEnd(64, 'e').slice(0, 64), size_bytes: 10, artifact_object_key: `test/${marker}`,
      file_manifest: MANIFEST, reader_version: 'reader-v1', parser_version: 'parser-v1', validation: { fixture: true },
      change_classification: AuthorityReleaseChange.NEW_RELEASE, change_basis: { fixture: true }, imported_by_id: admin.id,
      status: AuthorityReleaseStatus.active, activated_at: at('2026-10-19'),
    } });
    const files = [{ name: TARIFF.name, sha256: TARIFF.sha256 }, { name: CEPA.name, sha256: CEPA.sha256 }];
    await expect(recordSourceRecheck({ actor: principal(exporter), release_id: stored.id, checked_on: at('2026-11-11'), files, correlation_id: marker })).rejects.toThrow(/operations staff/);
    await recordSourceRecheck({ actor: principal(admin), release_id: stored.id, checked_on: at('2026-11-01'), files, correlation_id: marker });
    await recordSourceRecheck({ actor: principal(admin), release_id: stored.id, checked_on: at('2026-11-11'), files, correlation_id: marker });
    expect((await latestSourceRechecks([stored.id])).get(stored.id)).toEqual(at('2026-11-11'));
    const row = (await loadInputFreshness(at('2026-11-12'))).find((item) => item.key === `tariff:GCC_UNIFIED_TARIFF:${authority}`)!;
    expect(row).toMatchObject({ status: 'fresh', due_at: '2027-11-11T00:00:00.000Z', current: { rechecked_on: '2026-11-11T00:00:00.000Z' }, refresh: expect.stringMatching(/recheck-authority-source/) });
  });
});
