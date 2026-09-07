import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { PHILIPPINES_ACQUISITION_VERSION, readPhilippinesAuthorityBundle } from '@/lib/market-access/providers/philippines-bundle';
import { importPhilippinesRelease } from '@/lib/market-access/providers/philippines-service';

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
async function workbookStub() {
  const zip = new JSZip(); zip.file('[Content_Types].xml', '<Types/>'); zip.file('xl/workbook.xml', '<workbook/>');
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}
async function packageFixture(overlapStatus: string = 'confirmed') {
  // Structural packaging fixture only. These bytes are deliberately NOT tariff rows and this test
  // never describes them as authority evidence or a canary.
  const baseline = Buffer.from('%PDF-1.7\nfixture');
  const mfn = await workbookStub();
  const aifta = await workbookStub();
  const components = [
    { role: 'ahtn_2022_baseline', filename: 'ahtn-2022.pdf', source_url: 'https://tariffcommission.gov.ph/tariff-book-2022', sha256: sha(baseline), effective_from: '2022-01-01' },
    { role: 'mfn_executive_order_overlay', filename: 'eo-62.xlsx', source_url: 'https://www.officialgazette.gov.ph/2024/06/20/executive-order-no-62-s-2024/', sha256: sha(mfn), effective_from: '2024-07-22', legal_instrument: 'Executive Order No. 62, s. 2024' },
    { role: 'aifta_annual_schedule', filename: 'aifta-2026.xlsx', source_url: 'https://finder.tariffcommission.gov.ph/aifta', sha256: sha(aifta), effective_from: '2026-01-01', schedule_year: 2026, form_ai_required: true },
  ];
  const manifest = { acquisition_version: PHILIPPINES_ACQUISITION_VERSION, release_identifier: 'ahtn2022-mfn2024-aifta2026', retrieved_at: '2026-09-07T00:00:00.000Z', eo_62_overlap_review: { status: overlapStatus, reviewed_at: '2026-09-07', basis: 'Operator compared EO 62 scopes and effective dates with the retained baseline.' }, components };
  const zip = new JSZip(); zip.file('acquisition.json', JSON.stringify(manifest)); zip.file('ahtn-2022.pdf', baseline); zip.file('eo-62.xlsx', mfn); zip.file('aifta-2026.xlsx', aifta);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

describe('Philippine Tariff Commission controlled manual release', () => {
  test('executes the composite preflight and records all official-file provenance without emitting tariff rows', async () => {
    const bundle = await readPhilippinesAuthorityBundle(await packageFixture());
    expect(bundle.components.map((c) => c.role)).toEqual(['ahtn_2022_baseline', 'mfn_executive_order_overlay', 'aifta_annual_schedule']);
    expect(bundle.files).toHaveLength(4);
    expect(bundle.tariff_rows_parsed).toBe(false);
  });

  test('refuses a composite before the EO 62 overlap is confirmed', async () => {
    await expect(readPhilippinesAuthorityBundle(await packageFixture('pending'))).rejects.toThrow(/manifest is incomplete/);
  });

  test('refuses any checksum mismatch rather than treating a corrupt artifact as evidence', async () => {
    const bytes = await packageFixture();
    const zip = await JSZip.loadAsync(bytes);
    zip.file('eo-62.xlsx', Buffer.from('changed'));
    const changed = Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
    await expect(readPhilippinesAuthorityBundle(changed)).rejects.toThrow(/not a readable XLSX|checksum/);
  });

  test('the service refuses activation until a real artifact schema has been implemented', async () => {
    await expect(importPhilippinesRelease({
      actor: { id: 'fixture-admin', email: 'fixture@example.test', name: 'Fixture', role: UserRole.admin, exporter_org_id: null, tier: OrgTier.paid },
      bytes: await packageFixture(), release_identifier: 'ahtn2022-mfn2024-aifta2026',
      reference_date: new Date('2026-09-07T00:00:00.000Z'), source_url: 'https://finder.tariffcommission.gov.ph/about',
      activate: true, correlation_id: 'fixture-correlation',
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [expect.objectContaining({ code: 'parser_blocked' })] });
  });
});
