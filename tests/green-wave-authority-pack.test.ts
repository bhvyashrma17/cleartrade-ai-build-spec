import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { GREEN_WAVE_CONFIGS } from '@/lib/market-access/providers/green-wave-config';
import { acquireGreenWaveAuthorityBundle } from '@/lib/market-access/providers/green-wave-acquisition';
import { buildGreenWaveMarketAccess } from '@/lib/market-access/providers/green-wave-parser';
import {
  buildPdfAuthorityBundle, parsePdfTablePages, parsePublishedDuty,
  readPdfAuthorityBundle, readPdfAuthorityRelease, type PdfAuthorityBundle, type PdfTablePage, type PdfTableProfile, type PdfTariffLine,
} from '@/lib/market-access/providers/pdf-table-family';

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const profile: PdfTableProfile = {
  country_code: 'NP', label: 'fixture', expected_pdf_pages: 2, table_first_page: 1, table_last_page: 2,
  expected_line_count: 2, code_pattern: /^\d{4}\.\d{2}\.\d{2}$/, code_header: /^Code$/,
  description_header: /^Description$/, unit_header: /^Unit$/,
  columns: [{ key: 'general', header: /^General$/, required: false }], code_tolerance_points: 12, effective_from: '2026-01-01',
};

function page(pageNumber: number, body: PdfTablePage['items']): PdfTablePage {
  return { page_number: pageNumber, width: 500, height: 700, items: [
    { str: 'Code', x: 50, y: 660 }, { str: 'Description', x: 120, y: 660 }, { str: 'Unit', x: 250, y: 660 }, { str: 'General', x: 330, y: 660 }, ...body,
  ] };
}

function fixtureLines(): ReadonlyMap<string, PdfTariffLine> {
  const general = parsePublishedDuty('10', 'NPR');
  const saarc = parsePublishedDuty('6', 'NPR');
  return new Map([['01012100', { code: '01012100', description: 'Pure-bred breeding animals', cells: { general, saarc }, raw_cells: { general: '10', saarc: '6' }, source_pages: [14] }]]);
}

describe('shared official PDF table family', () => {
  test('joins page continuations and keeps legal zero distinct from blank', () => {
    const parsed = parsePdfTablePages(profile, [
      page(1, [{ str: '0101.21.00', x: 50, y: 500 }, { str: 'Pure-bred', x: 120, y: 500 }]),
      page(2, [
        { str: 'animals', x: 120, y: 600 }, { str: '0', x: 340, y: 600 },
        { str: '0101.29.00', x: 50, y: 500 }, { str: 'Other', x: 120, y: 500 }, { str: '15', x: 340, y: 500 },
      ]),
    ], 'NPR');
    expect(parsed.get('01012100')?.description).toContain('animals');
    expect(parsed.get('01012100')?.cells.general).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parsePublishedDuty('', 'NPR')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parsePublishedDuty('Free', 'NPR')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
  });

  test('parses ad-valorem, specific and mixed expressions without inventing equivalents', () => {
    expect(parsePublishedDuty('7.25', 'NPR')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 7.25 });
    expect(parsePublishedDuty('Nu. 1200 per litre', 'BTN')).toMatchObject({ kind: 'specific', specific_amount: 1200, specific_currency: 'BTN', specific_unit: 'litre' });
    expect(parsePublishedDuty('Rs. 300 per litre or 80 Percent whichever is higher', 'MUR')).toMatchObject({ kind: 'mixed', specific_amount: 300, ad_valorem_rate_percent: 80 });
    expect(parsePublishedDuty('authority prose', 'ALL')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
  });

  test('fails closed when a table header or row total changes', () => {
    const changedPage = page(2, [{ str: '0101.29.00', x: 50, y: 500 }, { str: 'Other', x: 120, y: 500 }, { str: '15', x: 340, y: 500 }]);
    const changed: PdfTablePage = { ...changedPage, items: changedPage.items.filter((item) => item.str !== 'General') };
    expect(() => parsePdfTablePages(profile, [page(1, [{ str: '0101.21.00', x: 50, y: 500 }, { str: 'Pure-bred', x: 120, y: 500 }, { str: '10', x: 340, y: 500 }]), changed], 'NPR'))
      .toThrowError(expect.objectContaining({ code: 'row_count_changed' }));
    expect(() => parsePdfTablePages({ ...profile, expected_pdf_pages: 3 }, [page(1, [])], 'NPR'))
      .toThrowError(expect.objectContaining({ code: 'page_count_changed' }));
  });

  test('authenticates an immutable deterministic archive and rejects manifest/hash drift', async () => {
    const artifacts = [{ name: 'tariff.pdf', role: 'official_tariff', url: 'https://authority.example/tariff.pdf', bytes: Buffer.from('%PDF-fixture') }];
    const args = { family: 'OFFICIAL_PDF_TABLE' as const, profile: { ...profile, expected_line_count: 1 }, release_identifier: '2026-09-15', source_url: artifacts[0].url,
      artifacts, lines: fixtureLines(), rights_evidence: { artifact: 'tariff.pdf', rule: 'official text fixture' }, preference_evidence: { requires_origin_proof: true },
      scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false } };
    const first = await buildPdfAuthorityBundle(args); const second = await buildPdfAuthorityBundle(args);
    expect(first.equals(second)).toBe(true); expect(sha256(first)).toBe(sha256(second));
    const read = await readPdfAuthorityBundle({ bytes: first, release_identifier: '2026-09-15', country_code: 'NP', expected_roles: { 'tariff.pdf': 'official_tariff' } });
    expect(read.lines.size).toBe(1);
    expect(() => readPdfAuthorityRelease({ bytes: first, release_identifier: '2026-09-15', country_code: 'NP', expected_roles: { 'tariff.pdf': 'official_tariff' }, reader_version: 'future-reader' }))
      .toThrowError(expect.objectContaining({ code: 'unsupported_reader_version' }));
    const zip = await JSZip.loadAsync(first); zip.file('tariff.pdf', Buffer.from('%PDF-tampered'), { date: new Date('1980-01-01T00:00:00.000Z') });
    const tampered = Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
    await expect(readPdfAuthorityBundle({ bytes: tampered, release_identifier: '2026-09-15', country_code: 'NP', expected_roles: { 'tariff.pdf': 'official_tariff' } }))
      .rejects.toMatchObject({ code: 'artifact_hash_mismatch' });
  });

  test('fails closed on an authority source failure without manufacturing a release', async () => {
    const unavailable: typeof fetch = async () => new Response('unavailable', { status: 503 });
    await expect(acquireGreenWaveAuthorityBundle('NP', { fetch_impl: unavailable, attempts: 1 }))
      .rejects.toThrow('Authority acquisition failed');
  });
});

describe('green-wave country semantics and routing', () => {
  function bundle(country: 'NP' | 'BT' | 'AL' | 'MU', lines = fixtureLines()): PdfAuthorityBundle {
    const config = GREEN_WAVE_CONFIGS[country];
    return { checksum: 'a'.repeat(64), size_bytes: 1, release_identifier: '2026-09-15', source_url: config.tariff_url, files: [], lines,
      line_count: lines.size, reader_version: 'customs-atlas-pdf-table-bundle-reader-v1', acquisition_version: 'customs-atlas-pdf-table-acquisition-v1',
      amendment_operations: [], rights_evidence: config.rights_evidence, preference_evidence: config.preference_evidence,
      scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false } };
  }

  test('never auto-applies an India preference from origin_country alone', () => {
    const result = buildGreenWaveMarketAccess({ country: 'NP', bundle: bundle('NP'), release_id: 'release', release_reference_date: new Date('2026-09-15'), retrieved_at: new Date('2026-09-15'), hs6: '010121', at: new Date('2026-09-15'), origin_country: 'IN' });
    expect(result.general_duty?.ad_valorem_rate_percent).toBe(10);
    expect(result.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', geographic_area_id: 'SAARC' });
    expect(result.regulatory_coverage_complete).toBe(false);
  });

  test('distinguishes bilateral zero from taxes and complete exclusion from unknown', () => {
    const btRecord: PdfTariffLine = {
      code: '01012100', description: 'Horse',
      cells: { customs_duty: parsePublishedDuty('10', 'BTN'), domestic_tax_1: parsePublishedDuty('5', 'BTN'), domestic_tax_2: parsePublishedDuty('0', 'BTN') },
      raw_cells: { customs_duty: '10', domestic_tax_1: '5', domestic_tax_2: '0' }, source_pages: [12],
    };
    const btLine = new Map([[btRecord.code, btRecord]]);
    const bt = buildGreenWaveMarketAccess({ country: 'BT', bundle: bundle('BT', btLine), release_id: 'release', release_reference_date: new Date('2026-09-15'), retrieved_at: new Date('2026-09-15'), hs6: '010121', at: new Date('2026-09-15'), origin_country: 'IN' });
    expect(bt.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', duty: { ad_valorem_rate_percent: 0 } });
    expect(bt.lines.some((line) => line.conditions.separate_component_not_a_replacement_tariff === true)).toBe(true);
    const al = buildGreenWaveMarketAccess({ country: 'AL', bundle: bundle('AL'), release_id: 'release', release_reference_date: new Date('2026-09-15'), retrieved_at: new Date('2026-09-15'), hs6: '010121', at: new Date('2026-09-15'), origin_country: 'IN' });
    expect(al.india_preference.applicability).toBe('not_applicable');
  });

  test('routes four qualified destinations and keeps the two acquisition failures isolated', () => {
    for (const country of ['NP', 'BT', 'AL', 'MU']) { expect(DESTINATION_ADAPTERS[country]?.provider_key).toBe(GREEN_WAVE_CONFIGS[country as keyof typeof GREEN_WAVE_CONFIGS].provider); expect(unconfiguredSourceForCountry(country)).toBeNull(); }
    expect(unconfiguredSourceForCountry('ME')?.reason).toBe('individual_investigation_required');
    expect(unconfiguredSourceForCountry('MK')?.reason).toBe('individual_investigation_required');
    expect(Object.keys(DESTINATION_ADAPTERS)).toHaveLength(46);
  });
});
