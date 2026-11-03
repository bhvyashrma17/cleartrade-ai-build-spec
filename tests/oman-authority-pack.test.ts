import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import {
  OMAN_BUNDLE_READER_VERSION, OMAN_EXPECTED_PHYSICAL_ROWS, OMAN_EXPECTED_UNIQUE_CODES,
  OMAN_PDF_TABLE_VERSION, OmanBundleError, parseOmanDutyCell, parseOmanPdfPages,
  readOmanAuthorityBundle, readOmanAuthorityRelease, type OmanTariffLine,
} from '@/lib/market-access/providers/oman-bundle';
import { acquireOmanAuthorityBundle } from '@/lib/market-access/providers/oman-acquisition';
import { buildOmanMarketAccess } from '@/lib/market-access/providers/oman-parser';
import { importOmanRelease, reparseOmanAuthorityRelease } from '@/lib/market-access/providers/oman-service';
import { prisma } from '@/lib/prisma';
import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { Principal } from '@/types';

const RELEASE = '2026-09-14';
const AT = new Date('2026-09-14T00:00:00.000Z');
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const rate = (value: number): ParsedDuty => ({ kind: 'ad_valorem', ad_valorem_rate_percent: value, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${value}%`, note: null });
const none = (expression = ''): ParsedDuty => ({ kind: 'none', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note: null });
const mixed: ParsedDuty = { kind: 'mixed', ad_valorem_rate_percent: 100, specific_amount: 3, specific_currency: 'OMR', specific_unit: 'kg gross', specific_unit_quantity: 1, expression: '100% with a minimum charge of RO. 3 per kg', note: 'No AVE.' };

function line(code: string, general: ParsedDuty, india: OmanTariffLine['india_category'], options: { additional?: ParsedDuty; prohibited?: boolean } = {}): OmanTariffLine {
  return { code, description: `Fixture ${code}`, general_duty: general, additional_duty: options.additional ?? null, india_category: india, efta_category: 'A', singapore_category: 'A', usa_category: 'A', prohibited: options.prohibited ?? false, source_pages: [24] };
}

function fixtureLines() {
  const rows: OmanTariffLine[] = [
    line('010121100001', rate(0), 'A'),
    line('030569000000', rate(5), 'B'),
    line('040110000000', rate(5), 'C'),
    line('240110100000', mixed, 'X'),
    line('690721000906', rate(5), 'B', { additional: rate(23.5) }),
    line('690721000907', rate(5), 'B', { additional: rate(70.2) }),
    line('690721000908', rate(5), 'B', { additional: rate(37) }),
    line('690721000909', rate(5), 'B', { additional: rate(17.6) }),
    line('690721000911', rate(5), 'B', { additional: rate(41.2) }),
    line('010310000000', none('PROHIBITED'), 'E', { prohibited: true }),
  ];
  for (let index = 0; rows.length < OMAN_EXPECTED_UNIQUE_CODES; index += 1) {
    rows.push(line((BigInt('980000000000') + BigInt(index)).toString(), rate(5), 'A'));
  }
  return rows.sort((left, right) => left.code.localeCompare(right.code));
}

async function fixtureBundle() {
  const normalized = Buffer.from(JSON.stringify({ table_parser_version: OMAN_PDF_TABLE_VERSION, physical_row_count: OMAN_EXPECTED_PHYSICAL_ROWS, lines: fixtureLines() }));
  const raw = [
    ['customs-tariff-2026.pdf', 'official_consolidated_national_tariff', 'https://www.customs.gov.om/media/gmglqkjb/2026-4.pdf', Buffer.from('%PDF-fixture tariff')],
    ['anti-dumping-current.pdf', 'official_current_national_trade_remedy_schedule', 'https://www.customs.gov.om/current.pdf', Buffer.from('%PDF-fixture current remedy')],
    ['gcc-anti-dumping-extension-55.pdf', 'official_gcc_trade_remedy_extension_instrument', 'https://www.gcc-sg.org/55.pdf', Buffer.from('%PDF-fixture extension')],
    ['anti-dumping-tiles.xlsx', 'official_national_trade_remedy_legacy_cross_check', 'https://www.customs.gov.om/anti.xlsx', Buffer.from('PK fixture')],
    ['user-guides.html', 'official_current_tariff_and_customs_fee_index', 'https://www.customs.gov.om/en/user-guides/', Buffer.from('tariff and fee index')],
    ['india-cepa.html', 'official_effective_date_concession_and_origin_guidance', 'https://www.customs.gov.om/ar/agreements/cepa/', Buffer.from('CEPA 1 June 2026 WO PSR')],
    ['india-cepa-rules-of-origin.pdf', 'official_agreement_rules_of_origin_chapter', 'https://www.commerce.gov.in/roo.pdf', Buffer.from('%PDF-fixture RoO')],
    ['india-cepa-product-specific-rules.pdf', 'official_agreement_product_specific_rules', 'https://www.commerce.gov.in/psr.pdf', Buffer.from('%PDF-fixture PSR')],
    ['copyright-law-article-4.txt', 'wipo_lex_reproduction_of_oman_law_article_4', 'https://www.wipo.int/wipolex/en/text/589897', Buffer.from('article 4 official documents')],
    ['normalized-lines.json', 'deterministic_coordinate_parser_output', 'https://www.customs.gov.om/media/gmglqkjb/2026-4.pdf', normalized],
  ] as const;
  const manifest = {
    acquisition_version: 'rop-customs-tariff-acquisition-v2', release_identifier: RELEASE,
    artifacts: raw.map(([name, role, url, bytes]) => ({ name, role, url, size_bytes: bytes.length, sha256: sha256(bytes) })),
    rights_evidence: { law_article: 'Oman Copyright Law article 4' },
    trade_remedy_evidence: { producer_or_exporter_identity_required: true },
    india_preference_evidence: { requires_origin_proof: true, origin_criterion_must_be_established_from_product_specific_rules: true },
  };
  const zip = new JSZip();
  const options = { date: new Date('1980-01-01T00:00:00.000Z') };
  raw.forEach(([name, , , bytes]) => zip.file(name, bytes, options));
  zip.file('acquisition.json', JSON.stringify(manifest), options);
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' }));
}

describe('Oman coordinate tariff semantics', () => {
  test('keeps zero, ad-valorem and mixed-minimum duty forms distinct without an invented AVE', () => {
    expect(parseOmanDutyCell('0%', 'general')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseOmanDutyCell('5%', 'general')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(parseOmanDutyCell('100 % with a minimum charge of RO. 3 per kg', 'general')).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 100, specific_amount: 3, specific_currency: 'OMR', specific_unit: 'kg gross' });
    expect(parseOmanDutyCell('', 'additional')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
  });

  test('uses reviewed column coordinates and handles the authority PDF merged 009 token', () => {
    const items = [
      { str: '69', x: 686, y: 500 }, { str: '07', x: 695, y: 500 }, { str: '23', x: 703, y: 500 },
      { str: '009', x: 713, y: 500 }, { str: '08', x: 725, y: 500 },
      { str: '5%', x: 261, y: 500 }, { str: '37%', x: 307, y: 500 }, { str: 'B', x: 157, y: 501 },
      { str: 'A', x: 187, y: 501 }, { str: 'A', x: 211, y: 501 }, { str: 'A', x: 230, y: 501 },
      { str: 'India producer', x: 355, y: 500 },
    ];
    const parsed = parseOmanPdfPages([{ page_number: 196, items }], { minimum_rows: 1, require_reviewed_semantics: false });
    expect(parsed.lines.get('690723000908')).toMatchObject({ india_category: 'B', additional_duty: { ad_valorem_rate_percent: 37 } });
  });

  test('fails closed when the PDF table is absent or malformed', () => {
    expect(() => parseOmanPdfPages([], { minimum_rows: 1, require_reviewed_semantics: false }))
      .toThrow(expect.objectContaining({ code: 'incomplete_pdf_table' }));
  });

  test('merges intentionally repeated codes only when treatment matches', () => {
    const row = (page_number: number, description: string, rateText = '5%') => ({ page_number, items: [
      { str: '01 01 21 10 00 01', x: 686, y: 500 },
      { str: rateText, x: 261, y: 500 }, { str: 'A', x: 157, y: 500 },
      { str: 'A', x: 187, y: 500 }, { str: 'A', x: 211, y: 500 }, { str: 'A', x: 230, y: 500 },
      { str: description, x: 355, y: 500 },
    ] });
    const merged = parseOmanPdfPages([row(1, 'First use'), row(2, 'Second use')], { minimum_rows: 2, require_reviewed_semantics: false });
    expect(merged.lines.get('010121100001')).toMatchObject({ description: 'First use; Second use', source_pages: [1, 2] });
    expect(() => parseOmanPdfPages([row(1, 'First use'), row(2, 'Second use', '10%')], { minimum_rows: 2, require_reviewed_semantics: false }))
      .toThrow(expect.objectContaining({ code: 'conflicting_duplicate_line' }));
  });

  test('does not convert an authority-source failure into a zero duty', async () => {
    const failedFetch = async () => new Response('unavailable', { status: 503 });
    await expect(acquireOmanAuthorityBundle({ fetch_impl: failedFetch as typeof fetch, attempts: 1 }))
      .rejects.toThrow(/retryable HTTP 503/);
  });
});

describe('Oman retained authority bundle and market-access result', () => {
  test('authenticates the exact manifest, full-release controls and historical reader version', async () => {
    const bytes = await fixtureBundle();
    expect(await fixtureBundle()).toEqual(bytes);
    const bundle = await readOmanAuthorityBundle({ bytes, release_identifier: RELEASE });
    expect(bundle.lines.size).toBe(OMAN_EXPECTED_UNIQUE_CODES);
    expect(bundle.physical_row_count).toBe(OMAN_EXPECTED_PHYSICAL_ROWS);
    expect(bundle.files).toHaveLength(11);
    expect(bundle.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(() => readOmanAuthorityRelease({ bytes, release_identifier: RELEASE, reader_version: 'future-reader' })).toThrow(expect.objectContaining({ code: 'unsupported_reader_version' }));

    const zip = await JSZip.loadAsync(bytes);
    const manifest = JSON.parse(await zip.file('acquisition.json')!.async('text'));
    manifest.artifacts[0].sha256 = '0'.repeat(64);
    zip.file('acquisition.json', JSON.stringify(manifest), { date: new Date('1980-01-01T00:00:00.000Z') });
    await expect(readOmanAuthorityBundle({ bytes: Buffer.from(await zip.generateAsync({ type: 'nodebuffer' })), release_identifier: RELEASE }))
      .rejects.toEqual(expect.objectContaining<Partial<OmanBundleError>>({ code: 'artifact_hash_mismatch' }));
  });

  test('stages CEPA categories, keeps origin proof unresolved and preserves regulatory incompleteness', async () => {
    const bytes = await fixtureBundle();
    const bundle = await readOmanAuthorityBundle({ bytes, release_identifier: RELEASE });
    const common = { bundle, release_id: 'om-release', release_reference_date: AT, retrieved_at: AT };
    const categoryA = buildOmanMarketAccess({ ...common, hs6: '010121', at: AT, origin_country: 'IN' });
    expect(categoryA.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(categoryA.india_preference).toMatchObject({ applicability: 'potentially_applicable_requires_origin_proof', duty: { ad_valorem_rate_percent: 0 } });
    expect(categoryA.regulatory_coverage_complete).toBe(false);
    expect(categoryA.lines.find((item) => item.measure_kind === 'tariff_preference')?.conditions).toMatchObject({
      qualification_status: 'not_established',
      origin_criterion_must_be_established_from_annex_3b_for_this_product: true,
    });

    const categoryB = buildOmanMarketAccess({ ...common, hs6: '030569', at: AT, origin_country: 'IN' });
    expect(categoryB.india_preference.duty).toMatchObject({ ad_valorem_rate_percent: 4 });
    const nextStage = buildOmanMarketAccess({ ...common, hs6: '030569', at: new Date('2027-06-01T00:00:00Z'), origin_country: 'IN' });
    expect(nextStage.india_preference.duty).toMatchObject({ ad_valorem_rate_percent: 3 });
    const before = buildOmanMarketAccess({ ...common, hs6: '030569', at: new Date('2026-05-31T23:59:59Z'), origin_country: 'IN' });
    expect(before.india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });

    const tile = buildOmanMarketAccess({ ...common, hs6: '690721', at: AT, origin_country: 'IN' });
    expect(tile.resolution.resolution).toBe('classification_refinement_required');
    expect(tile.resolution.candidate_count).toBe(5);
    expect(tile.general_duty).toBeNull();
    expect(tile.resolution.differences.join(' ')).toContain('material controls differ');
    const remedyLines = tile.lines.filter((item) => item.measure_kind === 'additional_duty');
    expect(remedyLines.map((item) => item.duty.ad_valorem_rate_percent)).toEqual(expect.arrayContaining([23.5, 70.2, 37, 17.6, 41.2]));
    expect(remedyLines.every((item) => item.conditions.producer_or_exporter_identity_required === true)).toBe(true);
    expect(remedyLines.every((item) => item.conditions.legal_measure === 'anti_dumping')).toBe(true);
    expect(tile.requirements).toContainEqual(expect.objectContaining({ requirement_code: 'OM_ANTIDUMPING_PRODUCER_EXPORTER_IDENTITY', requirement_obtainable: true }));
    expect(tile.raw_evidence).toMatchObject({ ceramic_antidumping: { not_selected_from_origin_alone: true } });
    const prohibited = buildOmanMarketAccess({ ...common, hs6: '010310', at: AT, origin_country: 'IN' });
    expect(prohibited.requirements[0]).toMatchObject({ rule_type: 'import_prohibition', requirement_obtainable: false });
  });

  test('is routed and no longer registered as unconfigured', () => {
    expect(DESTINATION_ADAPTERS.OM?.provider_key).toBe('om_rop_customs_tariff');
    expect(unconfiguredSourceForCountry('OM')).toBeNull();
  });
});

describe('Oman immutable replay', () => {
  test('imports the retained release and reparses it idempotently', async () => {
    const bytes = await fixtureBundle();
    const user = await prisma.user.create({ data: { email: `oman-pack-${Date.now()}@cleartrade.test`, name: 'Oman Pack Test', role: UserRole.admin } });
    const actor: Principal = { id: user.id, email: user.email, name: user.name, role: user.role, exporter_org_id: null, tier: OrgTier.paid };
    const args = { actor, bytes, release_identifier: RELEASE, reference_date: AT, retrieved_at: AT, source_url: 'https://www.customs.gov.om/media/gmglqkjb/2026-4.pdf', correlation_id: `om-${Date.now()}` };
    const first = await importOmanRelease(args);
    const second = await importOmanRelease({ ...args, correlation_id: `${args.correlation_id}-repeat` });
    expect(second.created).toBe(false);
    expect(second.release.id).toBe(first.release.id);
    expect(first.release).toMatchObject({ reader_version: OMAN_BUNDLE_READER_VERSION, parser_version: 'rop-customs-tariff-parser-v1' });
    const replay = { actor, release_id: first.release.id, hs6: '030569', parser_version: first.release.parser_version, now: AT, origin_country: 'IN' };
    const one = await reparseOmanAuthorityRelease({ ...replay, correlation_id: `reparse-${Date.now()}` });
    const two = await reparseOmanAuthorityRelease({ ...replay, correlation_id: `reparse-${Date.now()}-repeat` });
    expect(two.id).toBe(one.id);
    const historical = await reparseOmanAuthorityRelease({ ...replay, now: new Date('2026-05-31T23:59:59Z'), correlation_id: `reparse-historical-${Date.now()}` });
    expect(historical.authority_release_id).toBe(first.release.id);
    expect(historical.resolution_detail).toMatchObject({ india_preference: { applicability: 'not_applicable' } });
  });
});
