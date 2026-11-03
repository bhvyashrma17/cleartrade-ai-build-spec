import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { saudiOfficialUrl } from '../src/lib/market-access/providers/saudi-acquisition';
import {
  parseSaudi2025Operations,
  parseSaudi2026Operations,
  parseSaudiDuty,
  readSaudiAuthorityBundle,
  SAUDI_BUNDLE_READER_VERSION,
  SAUDI_PARSER_VERSION,
  type SaudiAuthorityBundle,
  type SaudiOverlayOperation,
  type SaudiPdfPage,
  type SaudiRateOverlay,
  type SaudiTariffLine,
} from '../src/lib/market-access/providers/saudi-bundle';
import { buildSaudiMarketAccess, replaySaudiTariff } from '../src/lib/market-access/providers/saudi-parser';
import {
  SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST,
  selectSaudiTradeRemedies,
} from '../src/lib/market-access/providers/saudi-remedies';

const adValorem = (rate: number) => parseSaudiDuty(`${rate}%`);

function synthetic2025Pages(): SaudiPdfPage[] {
  const operations = [
    ...Array.from({ length: 21 }, () => 'اﺳﺘﺤﺪاث'),
    ...Array.from({ length: 4 }, () => 'ﺣﺬف'),
    ...Array.from({ length: 11 }, () => 'ﺗﻌﺪﻳﻞ'),
  ];
  const pages = Array.from({ length: 5 }, (_, index) => ({ page_number: index + 1, width: 600, height: 800, items: [] as Array<{ str: string; x: number; y: number }> }));
  operations.forEach((status, index) => {
    const page = pages[index % pages.length]!;
    const row = Math.floor(index / pages.length);
    const y = 740 - row * 55;
    const code = String(index + 1).padStart(12, '0');
    page.items.push({ str: code, x: 50, y }, { str: `description ${code}`, x: 150, y }, { str: status, x: 500, y });
  });
  return pages;
}

function synthetic2026Pages(): SaudiPdfPage[] {
  const pages = Array.from({ length: 50 }, (_, index) => ({ page_number: index + 1, width: 600, height: 800, items: [] as Array<{ str: string; x: number; y: number }> }));
  const addRows = (firstPage: number, lastPage: number, count: number, offset: number) => {
    for (let index = 0; index < count; index += 1) {
      const pageNumber = firstPage + (index % (lastPage - firstPage + 1));
      const row = Math.floor(index / (lastPage - firstPage + 1));
      const y = 770 - row * 36;
      const code = String(offset + index + 1).padStart(12, '0').match(/.{2}/g)!.join(' ');
      pages[pageNumber - 1]!.items.push(
        { str: '5%', x: 50, y },
        { str: `description ${offset + index + 1}`, x: 150, y },
        { str: code, x: 450, y },
      );
    }
  };
  addRows(2, 45, 698, 0);
  addRows(46, 47, 29, 10_000);
  addRows(48, 50, 20, 20_000);
  return pages;
}

function line(code: string, rate = 5): SaudiTariffLine {
  return { code, description: `line ${code}`, declarable: true, duty: adValorem(rate), source: 'ZATCA public HTML tariff enumeration', source_pages: [], effective_from: '2025-06-01', effective_to: null };
}

function operation(operationKind: SaudiOverlayOperation['operation'], code: string, duty = 5): SaudiOverlayOperation {
  return { instrument: 'fixture structural decision', effective_from: '2026-01-01', operation: operationKind, code, description: `operation ${code}`, declarable: true, duty: operationKind === 'ADD_CODE' ? adValorem(duty) : null, source_page: 2 };
}

function overlay(codePrefix: string, rate: number, effectiveFrom: string): SaudiRateOverlay {
  return { instrument: 'fixture rate decision', effective_from: effectiveFrom, code_prefix: codePrefix, description: 'fixture overlay', duty: adValorem(rate) };
}

function bundle(overrides: Partial<SaudiAuthorityBundle> = {}): SaudiAuthorityBundle {
  const portalLines = [line('120110000000', 0), line('020712000000', 5), line('690721000001', 5), line('730300000001', 5), line('841810100000', 5)];
  return {
    checksum: 'fixture-sha256', size_bytes: 1, release_identifier: '2026-09-22',
    source_url: 'https://www.zatca.gov.sa/en/RulesRegulations/Taxes/Pages/Integrated-Tarrifs.aspx', files: [],
    portal_lines: new Map(portalLines.map((item) => [item.code, item])), operations_2025: [], operations_2026: [],
    protected_rates: new Map([['020712000000', parseSaudiDuty('20% بحد ادنى 1 ريال لكل كجم صافي')], ['690721000001', adValorem(20)]]),
    june_rates: [overlay('69072100', 15, '2026-06-26')], august_rates: [overlay('841810100000', 12, '2026-08-21')],
    remedies: SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST, reader_version: SAUDI_BUNDLE_READER_VERSION, parser_version: SAUDI_PARSER_VERSION,
    ...overrides,
  };
}

describe('Saudi authority pack', () => {
  test('parses blank, explicit zero, ordinary ad-valorem and poultry minimum-duty semantics without inventing AVEs', () => {
    expect(parseSaudiDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseSaudiDuty('0%')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseSaudiDuty('5%')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(parseSaudiDuty('% 5')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(parseSaudiDuty('سلع خاصة')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
    expect(parseSaudiDuty('20% بحد ادنى 1 ريال لكل كجم صافي')).toMatchObject({
      kind: 'mixed', ad_valorem_rate_percent: 20, specific_amount: 1, specific_currency: 'SAR', specific_unit: 'kg net', specific_unit_quantity: 1,
    });
  });

  test('pins both official structural layouts and their complete operation counts', () => {
    const first = parseSaudi2025Operations(synthetic2025Pages());
    expect(first.filter((item) => item.operation === 'ADD_CODE')).toHaveLength(21);
    expect(first.filter((item) => item.operation === 'DELETE_CODE')).toHaveLength(4);
    expect(first.filter((item) => item.operation === 'DESCRIPTION_CHANGE')).toHaveLength(11);

    const second = parseSaudi2026Operations(synthetic2026Pages());
    expect(second.filter((item) => item.operation === 'ADD_CODE')).toHaveLength(698);
    expect(second.filter((item) => item.operation === 'DELETE_CODE')).toHaveLength(29);
    expect(second.filter((item) => item.operation === 'DESCRIPTION_CHANGE')).toHaveLength(20);
  });

  test('replays structural and rate instruments chronologically with exact 12-digit refinement', () => {
    const added = operation('ADD_CODE', '999999999999', 7);
    const removed = operation('DELETE_CODE', '120110000000');
    const fixture = bundle({ operations_2026: [added, removed] });
    const before = replaySaudiTariff(fixture, new Date('2025-12-31T00:00:00Z'));
    expect(before.has('999999999999')).toBe(false);
    expect(before.get('120110000000')?.duty.ad_valorem_rate_percent).toBe(0);
    const january = replaySaudiTariff(fixture, new Date('2026-01-01T00:00:00Z'));
    expect(january.get('999999999999')?.duty.ad_valorem_rate_percent).toBe(7);
    expect(january.has('120110000000')).toBe(false);

    const june = replaySaudiTariff(bundle(), new Date('2026-06-26T00:00:00Z'));
    expect(june.get('690721000001')?.duty.ad_valorem_rate_percent).toBe(20);
    expect(june.get('690721000001')?.source).toMatch(/exact 12-digit ZATCA workbook refinement/);
    const august = replaySaudiTariff(bundle(), new Date('2026-08-21T00:00:00Z'));
    expect(august.get('841810100000')?.duty.ad_valorem_rate_percent).toBe(12);
    expect(august.get('020712000000')?.duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 20, specific_amount: 1 });
  });

  test('keeps India preference not applicable and fails closed on producer-specific anti-dumping rates', () => {
    const result = buildSaudiMarketAccess({
      bundle: bundle(), release_id: 'release-sa', release_reference_date: new Date('2026-09-22T00:00:00Z'),
      retrieved_at: new Date('2026-09-22T01:00:00Z'), hs6: '730300', at: new Date('2026-09-22T00:00:00Z'), origin_country: 'IN',
    });
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.lines.some((item) => item.measure_kind === 'additional_duty' && item.duty.ad_valorem_rate_percent === null)).toBe(true);
    expect(result.requirements).toEqual([expect.objectContaining({ requirement_code: 'SA_ANTIDUMPING_IDENTITY_EVIDENCE' })]);
    expect(result.raw_evidence).toMatchObject({ active_remedy_count: 14, remedy_status: 'producer_refinement_required', tariff_treatment_complete: false });
  });

  test('never invents a rate when ZATCA’s own public inquiry publishes two conflicting rates for the same 12-digit code', () => {
    const conflicted = line('021020000000', 0);
    conflicted.declarable = false;
    conflicted.duty = { kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '15% | 5%', note: 'ZATCA’s public tariff inquiry itself publishes more than one duty rate for this exact 12-digit code on the same result page, with no later structural/rate instrument or national workbook entry to disambiguate. This is retained as a non-declarable authority-source conflict rather than an invented rate.' };
    const fixture = bundle({ portal_lines: new Map([[conflicted.code, conflicted]]) });
    const result = buildSaudiMarketAccess({ bundle: fixture, release_id: 'release-sa', release_reference_date: new Date('2026-09-22T00:00:00Z'), retrieved_at: new Date('2026-09-22T01:00:00Z'), hs6: '021020', at: new Date('2026-09-22T00:00:00Z'), origin_country: 'IN' });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ declarable: false, duty: { kind: 'unparsed', ad_valorem_rate_percent: null } });
    expect(result.general_duty?.ad_valorem_rate_percent ?? null).toBeNull();
  });

  test('contains the complete bounded active-remedy inventory and applies product, origin and exclusion gates', () => {
    expect(SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST.measures).toHaveLength(14);
    expect(SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST.active_safeguard_count).toBe(0);
    expect(SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST.active_countervailing_count).toBe(0);
    expect(selectSaudiTradeRemedies({ manifest: SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST, code: '690721000001', origin_country: 'IN', at: new Date('2026-09-22') }).status).toBe('producer_refinement_required');
    expect(selectSaudiTradeRemedies({ manifest: SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST, code: '690730000000', origin_country: 'IN', at: new Date('2026-09-22') }).status).toBe('not_applicable');
    expect(selectSaudiTradeRemedies({ manifest: SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST, code: '690721000001', origin_country: 'US', at: new Date('2026-09-22') }).status).toBe('not_applicable');
  });

  test('is deterministic, official-host-only, corruption-intolerant and registered as an active adapter', async () => {
    const args = { bundle: bundle(), release_id: 'release-sa', release_reference_date: new Date('2026-09-22T00:00:00Z'), retrieved_at: new Date('2026-09-22T01:00:00Z'), hs6: '120110', at: new Date('2026-09-22T00:00:00Z'), origin_country: 'IN' };
    expect(buildSaudiMarketAccess(args)).toEqual(buildSaudiMarketAccess(args));
    expect(() => saudiOfficialUrl('https://example.com/not-official')).toThrow(/rejects example\.com/);
    await expect(readSaudiAuthorityBundle({ bytes: Buffer.from('not a zip'), release_identifier: '2026-09-22' })).rejects.toMatchObject({ code: 'corrupt_archive' });
    expect(unconfiguredSourceForCountry('SA')).toBeNull();
    expect(DESTINATION_ADAPTERS.SA?.provider_key).toBe('sa_zatca_integrated_tariff');
  });
});
