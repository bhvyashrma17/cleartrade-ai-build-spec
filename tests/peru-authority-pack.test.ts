import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test, vi } from 'vitest';
import { getDocumentStorage } from '@/lib/document-storage';
import { importAuthorityRelease } from '@/lib/market-access/authority-releases';
import { acquirePeruAuthorityBundle, PERU_FRANJA_URL, PERU_TARIFF_URL } from '@/lib/market-access/providers/peru-acquisition';
import {
  buildPeruMarketAccess,
  PERU_BUNDLE_READER_VERSION,
  PERU_LEGACY_PARSER_VERSION,
  PERU_PARSER_VERSION,
  PERU_RAW_BUNDLE_READER_VERSION,
  PERU_SOURCE_AUTHORITY,
  PeruBundleError,
  readPeruAuthorityRelease,
  readPeruAuthorityZip,
  readPeruRawSunatZip,
  type PeruAuthorityBundle,
} from '@/lib/market-access/providers/peru-parser';
import { fetchPeruMarketAccess, importPeruRelease, reparsePeruAuthorityRelease } from '@/lib/market-access/providers/peru-service';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const AT = new Date('2026-09-10T00:00:00.000Z');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

function bundle(rows: PeruAuthorityBundle['rows'], options: { reader?: PeruAuthorityBundle['reader_version']; retained?: boolean } = {}): PeruAuthorityBundle {
  return {
    checksum: 'fixture-checksum', size_bytes: 1, release_identifier: '2026-09-10-current-state',
    source_url: PERU_TARIFF_URL, rows,
    files: [{ name: 'Cap01-98-Descripcion.xlsx', size_bytes: 1, sha256: 'a'.repeat(64), role: 'official_consolidated_tariff_workbook' }],
    reader_version: options.reader ?? PERU_BUNDLE_READER_VERSION,
    format: options.reader === PERU_RAW_BUNDLE_READER_VERSION ? 'raw_sunat_zip' : 'composite_pdf_v3',
    franja_decision_retained: options.retained ?? true,
  };
}

let tariffZipPromise: Promise<Buffer> | undefined;
function tariffZipFixture() {
  return tariffZipPromise ??= (async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('ARANCEL 2022');
    sheet.addRow(['Subpartida Nacional', 'Descripcion del Arancel 2022', 'AD VALOREM']);
    for (let index = 1; index <= 8_013; index += 1) sheet.addRow([String(3_000_000_000 + index), `Fixture tariff row ${index}`, 0]);
    sheet.addRow(['10.06.30.00.00', 'Arroz semiblanqueado o blanqueado', 0]);
    sheet.addRow(['02.08.90.00.10', 'Carne de cuy', 6]);
    sheet.addRow(['02.08.90.00.90', 'Los demás', 6]);
    sheet.addRow(['98.11.00.00.00', 'Material de guerra', 0]);
    const workbookBytes = Buffer.from(await workbook.xlsx.writeBuffer());
    const zip = new JSZip();
    zip.file('Cap01-98-Descripcion.xlsx', workbookBytes, { date: new Date('1980-01-01T00:00:00.000Z') });
    return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
  })();
}

const pdfFixture = (suffix = '') => Buffer.from(`%PDF-1.4\n016-2026-EF/15.01\n2545338-1\nderechos variables adicionales\n${suffix}\n%%EOF`);

function acquisitionFetch(tariff: Buffer, pdf: Buffer) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === PERU_TARIFF_URL) return new Response(new Uint8Array(tariff), { status: 200 });
    if (url === PERU_FRANJA_URL) return new Response(new Uint8Array(pdf), { status: 200, headers: { 'content-type': 'application/pdf' } });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('Peru SUNAT consolidated tariff semantics', () => {
  test('keeps the in-force agricultural price-band duty separate and specific', () => {
    const result = buildPeruMarketAccess({
      bundle: bundle([{ code: '1006300000', description: 'Arroz semiblanqueado o blanqueado', ad_valorem_rate_percent: 0 }]),
      release_id: 'pe-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '100630', at: AT, origin_country: 'IN',
    });
    expect(result.resolution.resolution).toBe('exact');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: '0%' });
    const franja = result.lines.find((line) => line.measure_kind === 'additional_duty');
    expect(franja?.duty).toMatchObject({ kind: 'specific', specific_amount: 142, specific_currency: 'USD', specific_unit: 'TNE', ad_valorem_rate_percent: null });
    expect(franja).toMatchObject({ effective_from: new Date('2026-08-20T00:00:00.000Z'), effective_to: new Date('2026-12-31T00:00:00.000Z') });
    expect(result.raw_evidence).toMatchObject({ workbook_validation: { automated_current_state_reconciliation: false }, franja_measure: { retained_in_authority_bundle: true } });
  });

  test.each([
    ['day before effective date', '2026-08-19T23:59:59.999Z', false],
    ['exact first effective date', '2026-08-20T00:00:00.000Z', true],
    ['date during validity', '2026-10-15T12:30:00.000Z', true],
    ['exact final effective date', '2026-12-31T23:59:59.999Z', true],
    ['day after expiry', '2027-01-01T00:00:00.000Z', false],
  ])('honours the RVM 016 date-only boundary: %s', (_label, at, expected) => {
    const result = buildPeruMarketAccess({
      bundle: bundle([{ code: '1006300000', description: 'Rice', ad_valorem_rate_percent: 0 }]),
      release_id: 'pe-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '100630', at: new Date(at),
    });
    expect(result.lines.some((line) => line.measure_kind === 'additional_duty')).toBe(expected);
    expect(result.resolution.candidates[0]!.control_codes.includes('PE_FRANJA:rice_milled')).toBe(expected);
  });

  test('preserves classification uncertainty when Peru national children differ', () => {
    const result = buildPeruMarketAccess({
      bundle: bundle([
        { code: '0208900010', description: 'Carne de cuy', ad_valorem_rate_percent: 6 },
        { code: '0208900090', description: 'Los demás', ad_valorem_rate_percent: 6 },
      ]),
      release_id: 'pe-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '020890', at: AT,
    });
    expect(result.resolution.resolution).toBe('all_children_equivalent');
    expect(result.resolution.candidate_count).toBe(2);
    expect(result.general_duty?.ad_valorem_rate_percent).toBe(6);
  });

  test('missing source rows do not become a zero duty', () => {
    const result = buildPeruMarketAccess({ bundle: bundle([]), release_id: 'pe-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '100630', at: AT });
    expect(result.resolution.resolution).toBe('unavailable');
    expect(result.general_duty).toBeNull();
    expect(result.lines).toEqual([]);
  });
});

describe('Peru deterministic acquisition and versioned readers', () => {
  test('uses stable legal artifacts: unchanged inputs are byte-identical and a legal-content change changes identity', async () => {
    const tariff = await tariffZipFixture();
    const first = await acquirePeruAuthorityBundle({ fetch_impl: acquisitionFetch(tariff, pdfFixture()) });
    const repeated = await acquirePeruAuthorityBundle({ fetch_impl: acquisitionFetch(tariff, pdfFixture()) });
    const changed = await acquirePeruAuthorityBundle({ fetch_impl: acquisitionFetch(tariff, pdfFixture('genuine amended legal content')) });
    expect(repeated.equals(first)).toBe(true);
    expect(sha256(repeated)).toBe(sha256(first));
    expect(sha256(changed)).not.toBe(sha256(first));
  });

  test('parses the composite fixture and verifies a SHA-256 for every retained file', async () => {
    const tariff = await tariffZipFixture();
    const bytes = await acquirePeruAuthorityBundle({ fetch_impl: acquisitionFetch(tariff, pdfFixture()) });
    const parsed = await readPeruAuthorityZip({ bytes, release_identifier: 'fixture-v3', source_url: PERU_TARIFF_URL });
    expect(parsed.reader_version).toBe(PERU_BUNDLE_READER_VERSION);
    expect(parsed.format).toBe('composite_pdf_v3');
    expect(parsed.rows).toHaveLength(8_017);
    expect(parsed.files.map((file) => file.name)).toEqual(['Cap01-98-Descripcion.xlsx', 'sunat-tariff.zip', 'franja-resolution.pdf', 'acquisition.json']);
    expect(parsed.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256) && file.size_bytes > 0)).toBe(true);

    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('acquisition.json')!.async('text'));
    manifest.artifacts[0].sha256 = '0'.repeat(64);
    zip.file('acquisition.json', JSON.stringify(manifest, null, 2), { date: new Date('1980-01-01T00:00:00.000Z') });
    const tampered = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
    await expect(readPeruAuthorityZip({ bytes: tampered, release_identifier: 'tampered', source_url: PERU_TARIFF_URL }))
      .rejects.toEqual(expect.objectContaining<Partial<PeruBundleError>>({ code: 'artifact_hash_mismatch' }));
  });

  test('dispatches historical raw and current composite releases by immutable reader version', async () => {
    const raw = await tariffZipFixture();
    const oldBundle = await readPeruAuthorityRelease({ bytes: raw, release_identifier: 'old', source_url: PERU_TARIFF_URL, reader_version: PERU_RAW_BUNDLE_READER_VERSION });
    expect(oldBundle).toMatchObject({ format: 'raw_sunat_zip', franja_decision_retained: false, reader_version: PERU_RAW_BUNDLE_READER_VERSION });
    const composite = await acquirePeruAuthorityBundle({ fetch_impl: acquisitionFetch(raw, pdfFixture()) });
    const newBundle = await readPeruAuthorityRelease({ bytes: composite, release_identifier: 'new', source_url: PERU_TARIFF_URL, reader_version: PERU_BUNDLE_READER_VERSION });
    expect(newBundle).toMatchObject({ format: 'composite_pdf_v3', franja_decision_retained: true, reader_version: PERU_BUNDLE_READER_VERSION });
    await expect(readPeruRawSunatZip({ bytes: composite, release_identifier: 'wrong', source_url: PERU_TARIFF_URL })).rejects.toThrow(/exactly Cap01-98-Descripcion.xlsx/);
    expect(() => readPeruAuthorityRelease({ bytes: raw, release_identifier: 'x', source_url: PERU_TARIFF_URL, reader_version: 'unknown' })).toThrow(expect.objectContaining({ code: 'unsupported_reader_version' }));
  });

  test('keeps an authority outage as an acquisition failure', async () => {
    const fetchImpl = (async (input: string | URL | Request) => {
      expect([PERU_TARIFF_URL, PERU_FRANJA_URL]).toContain(String(input));
      return new Response('unavailable', { status: 503 });
    }) as typeof fetch;
    await expect(acquirePeruAuthorityBundle({ fetch_impl: fetchImpl, attempts: 1 })).rejects.toThrow('retryable HTTP 503');
  });
});

describe('Peru historical replay and idempotence', () => {
  test('replays old raw and new composite releases with their recorded versions', async () => {
    const user = await prisma.user.create({ data: { email: `peru-pack-${Date.now()}@cleartrade.test`, name: 'Peru Pack Test', role: UserRole.admin } });
    const actor: Principal = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: null, tier: OrgTier.paid };
    const raw = await tariffZipFixture();
    const legacySource = {
      source_family: 'PE_SUNAT', authority: PERU_SOURCE_AUTHORITY, destination_scope: ['PE'],
      source_distribution: 'SUNAT consolidated national tariff workbook', source_format: 'zip+xlsx', content_type: 'application/zip',
      max_bundle_bytes: 8 * 1024 * 1024, reader_version: PERU_RAW_BUNDLE_READER_VERSION, parser_version: PERU_LEGACY_PARSER_VERSION,
    };
    const old = await importAuthorityRelease({
      actor, source: legacySource, bytes: raw, label: 'Peru legacy raw fixture', release_identifier: `legacy-${Date.now()}`,
      reference_date: AT, retrieved_at: AT, source_url: PERU_TARIFF_URL, correlation_id: `pe-old-${Date.now()}`,
      validate: async (bytes) => ({ file_manifest: (await readPeruRawSunatZip({ bytes, release_identifier: 'legacy', source_url: PERU_TARIFF_URL })).files, validation: { legacy_raw_release: true } }),
    });
    const oldResult = await fetchPeruMarketAccess('100630', { release_id: old.release.id, now: AT });
    expect(oldResult.parser_version).toBe(PERU_LEGACY_PARSER_VERSION);
    expect(oldResult.lines.some((line) => line.measure_kind === 'additional_duty')).toBe(true);

    const composite = await acquirePeruAuthorityBundle({ fetch_impl: acquisitionFetch(raw, pdfFixture()) });
    const currentArgs = { actor, bytes: composite, release_identifier: `composite-${Date.now()}`, reference_date: AT, retrieved_at: AT, source_url: PERU_TARIFF_URL, correlation_id: `pe-new-${Date.now()}` };
    const current = await importPeruRelease(currentArgs);
    const repeatedImport = await importPeruRelease({ ...currentArgs, correlation_id: `${currentArgs.correlation_id}-repeat` });
    expect(repeatedImport.created).toBe(false);
    expect(repeatedImport.release.id).toBe(current.release.id);
    expect(current.release).toMatchObject({ reader_version: PERU_BUNDLE_READER_VERSION, parser_version: PERU_PARSER_VERSION });
    expect(current.release.validation).toMatchObject({
      per_file_sha256_validated: true,
      mef_currentness_page_retained: false,
      amendment_texts_retained: false,
      automated_current_state_reconciliation: false,
      franja_official_pdf_retained: true,
    });
    expect(current.release.validation).not.toHaveProperty('mef_current_line_count_reconciled');
    expect(current.release.file_manifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'sunat-tariff.zip', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ name: 'franja-resolution.pdf', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
      expect.objectContaining({ name: 'acquisition.json', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }),
    ]));

    const first = await reparsePeruAuthorityRelease({ actor, release_id: current.release.id, hs6: '100630', parser_version: PERU_PARSER_VERSION, now: AT, correlation_id: `pe-reparse-${Date.now()}` });
    const repeated = await reparsePeruAuthorityRelease({ actor, release_id: current.release.id, hs6: '100630', parser_version: PERU_PARSER_VERSION, now: AT, correlation_id: `pe-reparse-repeat-${Date.now()}` });
    expect(repeated.id).toBe(first.id);
    expect(first.authority_release_id).toBe(current.release.id);
    await getDocumentStorage().delete(old.release.artifact_object_key);
    await getDocumentStorage().delete(current.release.artifact_object_key);
  });
});

test.runIf(Boolean(process.env.CLEARTRADE_PERU_RELEASE))('real release canary: validates the current composite and all retained hashes', async () => {
  const parsed = await readPeruAuthorityZip({ bytes: readFileSync(process.env.CLEARTRADE_PERU_RELEASE!), release_identifier: 'real-local-canary', source_url: PERU_TARIFF_URL });
  expect(parsed.rows).toHaveLength(8_017);
  expect(parsed.rows.some((row) => row.code === '9811000000')).toBe(true);
  expect(parsed.rows.some((row) => row.code === '0208900010')).toBe(true);
  expect(parsed.rows.some((row) => row.code === '0208900090')).toBe(true);
  expect(parsed.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
});
