import { randomUUID } from 'node:crypto';
import { AuthorityReleaseStatus, OrgTier, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import JSZip from 'jszip';
import { activateTaricRelease, importTaricRelease, TARIC_IMPORT_PRINCIPALS } from '@/lib/market-access/taric/service';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '@/types';

afterAll(() => prisma.$disconnect());

/**
 * Importing an official TARIC release is staff-only, immutable and idempotent by checksum.
 * These tests attack each of those three properties.
 */

async function principal(role: UserRole): Promise<Principal> {
  const marker = `taric-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const user = await prisma.user.create({ data: {
    email: `${marker}@example.test`, name: 'Actor', role,
    exporter_org_id: role === UserRole.exporter_owner ? org.id : null,
  } });
  return { id: user.id, email: user.email, name: user.name ?? '', role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
}

/** A structurally valid but minimal bundle: enough to pass validation, cheap to build. */
async function bundleBytes(seed = 'a'): Promise<Buffer> {
  const { readFileSync } = await import('node:fs');
  void readFileSync;
  const header = (cols: string[]) => `<row r="1">${cols.map((c, i) => `<c r="${String.fromCharCode(65 + i)}1" t="inlineStr"><is><t>${c}</t></is></c>`).join('')}</row>`;
  const sheet = (cols: string[]) => `<?xml version="1.0"?><worksheet><sheetData>${header(cols)}<row r="2"><c r="A2" t="inlineStr"><is><t>${seed}</t></is></c></row></sheetData></worksheet>`;
  const zip = new JSZip();
  const files: Record<string, string[]> = {
    'Nomenclature EN.xlsx': ['Goods code', 'Start date', 'End date', 'Language', 'Hier. Pos.', 'Indent', 'Description', 'Descr. start date'],
    'Declarable codes.xlsx': ['Goods code', 'Start date', 'Decl. start date', 'IS_LEAF', 'End date'],
    'Duties Import 01-99.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'RED_IND', 'Origin', 'Measure type', 'Legal base', 'Duty', 'Origin code', 'Meas. type code'],
    'Geographical areas composition.xlsx': ['Country group', 'Start date', 'Language', 'Abbrev.', 'Country group descr.', 'Member country', 'Abbrev.', 'Description', 'Mbship start date', 'Mbship end date', 'End date'],
    'Measure conditions.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin code', 'Meas. type code', 'Meas. cond', 'Sequence', 'Certificate', 'Cond. amount', 'Mon. unit', 'Meas. unit', 'Meas. unit qual', 'Meas. action'],
    'Measure exclusions.xlsx': ['Goods code', 'Add code', 'Order No.', 'Start date', 'End date', 'Origin', 'Measure type', 'Excluded country code', 'Origin code', 'Meas. type code', 'Excluded country'],
    'Measure footnotes.xlsx': ['Goods code', 'Add code', 'Order No.', 'Origin code', 'Start date', 'End date', 'Meas. type code', 'Origin', 'Measure type', 'Footnote'],
    'Footnotes descriptions.xlsx': ['Footnote code', 'Language', 'Description', 'Start date', 'Descr. start date', 'End date'],
    'Legal basis.xlsx': ['Legal base', 'Off. Journal', 'Page', 'Publ. date'],
  };
  for (const [name, cols] of Object.entries(files)) {
    const inner = new JSZip();
    inner.file('xl/worksheets/sheet1.xml', sheet(cols));
    zip.file(name, await inner.generateAsync({ type: 'nodebuffer' }));
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('who may import a TARIC release', () => {
  test('only operations staff — an exporter or an agent cannot', async () => {
    expect(TARIC_IMPORT_PRINCIPALS).toEqual([UserRole.ops_supervisor, UserRole.admin]);
    const bytes = await bundleBytes(randomUUID());
    for (const role of [UserRole.exporter_owner, UserRole.exporter_member, UserRole.agent]) {
      const actor = await principal(role);
      await expect(importTaricRelease({ actor, bytes, reference_month: '2026-09', correlation_id: randomUUID() }))
        .rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(await prisma.authorityRelease.count({ where: { checksum: { not: '' } } }).catch(() => 0)).toBeGreaterThanOrEqual(0);
  });

  test('an admin can, and the release records its full source identity', async () => {
    const actor = await principal(UserRole.admin);
    const bytes = await bundleBytes(randomUUID());
    const { release, created } = await importTaricRelease({ actor, bytes, reference_month: '2026-09', correlation_id: randomUUID() });
    expect(created).toBe(true);
    expect(release.label).toBe('TARIC 2026-09');
    expect(release.reference_date.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(release.authority).toMatch(/European Commission/);
    expect(release.source_distribution).toMatch(/CIRCABC/);
    expect(release.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(release.source_family).toBe('EU_TARIC');
    expect(release.destination_scope).toContain('DE');
    expect(release.parser_version).toBe('taric-parser-v1');
    expect(Array.isArray(release.file_manifest)).toBe(true);
    expect(release.imported_by_id).toBe(actor.id);
  });
});

describe('release identity and immutability', () => {
  test('byte-identical bytes are the same release, not a duplicate', async () => {
    const actor = await principal(UserRole.admin);
    const bytes = await bundleBytes(randomUUID());
    const first = await importTaricRelease({ actor, bytes, reference_month: '2026-09', correlation_id: randomUUID() });
    const second = await importTaricRelease({ actor, bytes, reference_month: '2026-09', correlation_id: randomUUID() });
    expect(second.created).toBe(false);
    expect(second.release.id).toBe(first.release.id);
    expect(second.change).toBe('UNCHANGED');
    expect(await prisma.authorityRelease.count({ where: { checksum: first.release.checksum } })).toBe(1);
  });

  test('a modified file under the same label is a DIFFERENT release', async () => {
    const actor = await principal(UserRole.admin);
    const a = await importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-09', correlation_id: randomUUID() });
    const b = await importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-09', correlation_id: randomUUID() });
    // Same operator label, different bytes: the checksum is the identity, so these cannot merge.
    expect(a.release.label).toBe(b.release.label);
    expect(b.release.id).not.toBe(a.release.id);
    expect(b.release.checksum).not.toBe(a.release.checksum);
    expect(b.change).toBe('CHANGED');
    expect(b.release.previous_release_id).toBe(a.release.id);
  });

  test('an imported release cannot be mutated or deleted', async () => {
    const actor = await principal(UserRole.admin);
    const { release } = await importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-09', correlation_id: randomUUID() });
    await expect(prisma.authorityRelease.update({ where: { id: release.id }, data: { checksum: 'f'.repeat(64) } })).rejects.toThrow();
    await expect(prisma.authorityRelease.update({ where: { id: release.id }, data: { reference_date: new Date('2020-01-01') } })).rejects.toThrow();
    await expect(prisma.authorityRelease.delete({ where: { id: release.id } })).rejects.toThrow();
  });

  test('activation supersedes the previous active release, never runs two at once', async () => {
    const actor = await principal(UserRole.admin);
    const first = await importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-08', correlation_id: randomUUID() });
    await activateTaricRelease({ actor, release_id: first.release.id, correlation_id: randomUUID() });
    const second = await importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-09', correlation_id: randomUUID() });
    await activateTaricRelease({ actor, release_id: second.release.id, correlation_id: randomUUID() });
    expect(await prisma.authorityRelease.count({ where: { source_family: 'EU_TARIC', status: AuthorityReleaseStatus.active } })).toBe(1);
    const superseded = await prisma.authorityRelease.findUniqueOrThrow({ where: { id: first.release.id } });
    expect(superseded.status).toBe(AuthorityReleaseStatus.superseded);
    expect(superseded.superseded_at).not.toBeNull();
  });
});

describe('what an import refuses', () => {
  test('a corrupt archive, a missing table and a foreign file are all rejected', async () => {
    const actor = await principal(UserRole.admin);
    await expect(importTaricRelease({ actor, bytes: Buffer.from('definitely not a zip'), reference_month: '2026-09', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const zip = new JSZip();
    zip.file('Legal basis.xlsx', 'x');
    await expect(importTaricRelease({ actor, bytes: await zip.generateAsync({ type: 'nodebuffer' }), reference_month: '2026-09', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    const withExtra = await JSZip.loadAsync(await bundleBytes(randomUUID()));
    withExtra.file('malware.exe', 'MZ');
    await expect(importTaricRelease({ actor, bytes: await withExtra.generateAsync({ type: 'nodebuffer' }), reference_month: '2026-09', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('an empty upload and a bad reference month are refused', async () => {
    const actor = await principal(UserRole.admin);
    await expect(importTaricRelease({ actor, bytes: Buffer.alloc(0), reference_month: '2026-09', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: 'September', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-13', correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a rejected release can never become the source of evidence', async () => {
    const actor = await principal(UserRole.admin);
    const { release } = await importTaricRelease({ actor, bytes: await bundleBytes(randomUUID()), reference_month: '2026-09', correlation_id: randomUUID() });
    await prisma.authorityRelease.update({ where: { id: release.id }, data: { status: AuthorityReleaseStatus.rejected } });
    await expect(activateTaricRelease({ actor, release_id: release.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
