import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { GREEN_WAVE_CONFIGS } from '@/lib/market-access/providers/green-wave-config';
import { acquireGreenWaveAuthorityBundle } from '@/lib/market-access/providers/green-wave-acquisition';
import { buildGreenWaveMarketAccess } from '@/lib/market-access/providers/green-wave-parser';
import { __test__ as greenWaveService } from '@/lib/market-access/providers/green-wave-service';
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
    expect(parsePublishedDuty('18%', 'LKR')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 18 });
    expect(parsePublishedDuty('Ex', 'LKR')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parsePublishedDuty('10% or Rs.12/= per kg', 'LKR')).toMatchObject({ kind: 'mixed', specific_amount: 12, specific_currency: 'LKR', specific_unit: 'kg', ad_valorem_rate_percent: 10 });
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
  function bundle(country: 'NP' | 'BT' | 'AL' | 'MU' | 'LK', lines = fixtureLines(), amendmentOperations: PdfAuthorityBundle['amendment_operations'] = []): PdfAuthorityBundle {
    const config = GREEN_WAVE_CONFIGS[country];
    return { checksum: 'a'.repeat(64), size_bytes: 1, release_identifier: '2026-09-15', source_url: config.tariff_url, files: [], lines,
      line_count: lines.size, reader_version: 'customs-atlas-pdf-table-bundle-reader-v1', acquisition_version: 'customs-atlas-pdf-table-acquisition-v1',
      amendment_operations: amendmentOperations, rights_evidence: config.rights_evidence, preference_evidence: config.preference_evidence,
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

  test('models Sri Lanka SCL replacement and the 2488/69 applicability change without double-stacking the surcharge', () => {
    const vehicle: PdfTariffLine = {
      code: '87021053', description: 'Vehicle', source_pages: [601],
      cells: { general: parsePublishedDuty('30%', 'LKR'), india: parsePublishedDuty('20%', 'LKR'), surcharge: parsePublishedDuty('50%', 'LKR'), scl_indicator: parsePublishedDuty('', 'LKR') },
      raw_cells: { general: '30%', india: '20%', surcharge: '50%', scl_indicator: '' },
    };
    const operations: PdfAuthorityBundle['amendment_operations'] = [
      { operation: 'ADD', code: '87', publication_date: '2026-05-15', effective_from: '2026-05-16', effective_to: '2026-08-14', precedence: 1, source_artifact: 'gazette-2488-56.pdf', classification: 'TARIFF_AFFECTING', cells: { surcharge: '50%' } },
      { operation: 'AMEND_APPLICABILITY', code: '87', publication_date: '2026-05-17', effective_from: '2026-05-18', effective_to: '2026-08-14', precedence: 2, source_artifact: 'gazette-2488-69.pdf', classification: 'TARIFF_AFFECTING', cells: {}, conditions: { numeric_rate_unchanged: true } },
      { operation: 'REPLACE', code: '87', publication_date: '2026-08-14', effective_from: '2026-08-15', effective_to: '2026-12-31', precedence: 3, source_artifact: 'gazette-2501-88.pdf', classification: 'TARIFF_AFFECTING', cells: { surcharge: '50%' } },
    ];
    const vehicleBundle = bundle('LK', new Map([[vehicle.code, vehicle]]), operations);
    const at = (date: string) => buildGreenWaveMarketAccess({ country: 'LK', bundle: vehicleBundle, release_id: 'release', release_reference_date: new Date('2026-09-20'), retrieved_at: new Date('2026-09-20'), hs6: '870210', at: new Date(`${date}T12:00:00.000Z`), origin_country: 'IN' });
    for (const [date, artifact, amended] of [['2026-05-17', '2488-56', false], ['2026-05-18', '2488-69', true], ['2026-08-15', '2501-88', false]] as const) {
      const result = at(date); const surcharges = result.lines.filter((line) => line.conditions.customs_import_duty_surcharge === true);
      expect(surcharges).toHaveLength(1);
      expect(surcharges[0]).toMatchObject({ duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 50 }, conditions: { numeric_rate_created_once: true, applicability_amended_by_2488_69: amended } });
      expect(surcharges[0]!.source_reference).toContain(artifact);
    }
    expect(operations[1]).toMatchObject({ operation: 'AMEND_APPLICABILITY', classification: 'TARIFF_AFFECTING', cells: {} });

    const scl: PdfTariffLine = {
      code: '100590', description: 'Maize', source_pages: [58],
      cells: { general: parsePublishedDuty('20%', 'LKR'), india: parsePublishedDuty('Free', 'LKR'), vat: parsePublishedDuty('18%', 'LKR'), scl_indicator: parsePublishedDuty('*', 'LKR') },
      raw_cells: { general: '20%', india: 'Free', vat: '18%', scl_indicator: '*' },
    };
    const result = buildGreenWaveMarketAccess({ country: 'LK', bundle: bundle('LK', new Map([[scl.code, scl]]), operations), release_id: 'release', release_reference_date: new Date('2026-09-20'), retrieved_at: new Date('2026-09-20'), hs6: '100590', at: new Date('2026-09-20'), origin_country: 'IN' });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ duty: { kind: 'specific', specific_amount: 50, specific_currency: 'LKR', specific_unit: 'kg' }, conditions: { replaces_all_other_import_levies: true } });
    expect(result.india_preference.applicability).toBe('unknown');
  });

  test('routes five qualified destinations and keeps the two acquisition failures isolated', () => {
    for (const country of ['NP', 'BT', 'AL', 'MU', 'LK']) { expect(DESTINATION_ADAPTERS[country]?.provider_key).toBe(GREEN_WAVE_CONFIGS[country as keyof typeof GREEN_WAVE_CONFIGS].provider); expect(unconfiguredSourceForCountry(country)).toBeNull(); }
    expect(unconfiguredSourceForCountry('ME')?.reason).toBe('individual_investigation_required');
    expect(unconfiguredSourceForCountry('MK')?.reason).toBe('individual_investigation_required');
    // 45 accepted + Sri Lanka, Indonesia, Saudi Arabia, Qatar, Kuwait, Uzbekistan, Vietnam, Morocco and Tunisia pending + six customs-territory aliases pending
    // + Martinique, San Marino and Andorra (chapters 25–97) on the EU tariff.
    expect(Object.keys(DESTINATION_ADAPTERS)).toHaveLength(63);
  });
});

describe('Mauritius edition change (13 August -> 1 October 2026)', () => {
  async function muBundle(roles: Readonly<Record<string, string>>, effectiveFrom: string) {
    const artifacts = Object.entries(roles).map(([name, role]) => ({ name, role, url: 'https://www.mra.mu/download/fixture.pdf', bytes: Buffer.from(`%PDF-${name}`) }));
    return buildPdfAuthorityBundle({ family: 'BASELINE_PLUS_AMENDMENTS', profile: { ...profile, country_code: 'MU', expected_line_count: 1, effective_from: effectiveFrom },
      release_identifier: '2026-09-15', source_url: artifacts[0]!.url, artifacts, lines: fixtureLines(),
      rights_evidence: { artifact: 'government-copyright-policy.json' }, preference_evidence: { requires_origin_proof: true },
      scope: { tariff_treatment_complete: true, regulatory_coverage_complete: false } });
  }

  test('a retained 13 August release stays readable and keeps its own effective date', async () => {
    const retired = GREEN_WAVE_CONFIGS.MU.retired_artifact_sets![0]!;
    expect(Object.keys(retired)).toContain('integrated-tariff-2026-08-13.pdf');
    const bytes = await muBundle(retired, '2026-08-13');
    const read = await greenWaveService.readRetainedGreenWaveRelease('MU', { bytes, release_identifier: '2026-09-15', reader_version: 'customs-atlas-pdf-table-bundle-reader-v1' });
    expect(read.effective_from).toBe('2026-08-13');
    const at = new Date('2026-09-20T00:00:00.000Z');
    const result = buildGreenWaveMarketAccess({ country: 'MU', bundle: read, release_id: 'august', release_reference_date: at, retrieved_at: at, hs6: '010121', at, origin_country: 'IN' });
    expect(result.lines.length).toBeGreaterThan(0);
    // Without its recorded date the same lines would be dated to the current (1 October) edition and hidden on 20 September.
    const undated = buildGreenWaveMarketAccess({ country: 'MU', bundle: { ...read, effective_from: undefined }, release_id: 'august', release_reference_date: at, retrieved_at: at, hs6: '010121', at, origin_country: 'IN' });
    expect(undated.lines).toHaveLength(0);
  });

  test('the current edition reads, and an unknown artifact set still fails closed', async () => {
    const current = Object.fromEntries(GREEN_WAVE_CONFIGS.MU.artifacts.map((artifact) => [artifact.name, artifact.role]));
    expect(GREEN_WAVE_CONFIGS.MU.profile.effective_from).toBe('2026-10-01');
    const bytes = await muBundle(current, '2026-10-01');
    await expect(greenWaveService.readRetainedGreenWaveRelease('MU', { bytes, release_identifier: '2026-09-15', reader_version: 'customs-atlas-pdf-table-bundle-reader-v1' }))
      .resolves.toMatchObject({ effective_from: '2026-10-01' });
    const unknown = await muBundle({ 'integrated-tariff-2026-07-01.pdf': 'official_integrated_tariff_baseline', 'government-copyright-policy.json': 'reviewed_government_reuse_policy_citation' }, '2026-07-01');
    await expect(greenWaveService.readRetainedGreenWaveRelease('MU', { bytes: unknown, release_identifier: '2026-09-15', reader_version: 'customs-atlas-pdf-table-bundle-reader-v1' }))
      .rejects.toMatchObject({ code: 'unexpected_manifest' });
  });
});
