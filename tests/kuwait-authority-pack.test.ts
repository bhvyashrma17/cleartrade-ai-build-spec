import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { kuwaitOfficialUrl } from '../src/lib/market-access/providers/kuwait-acquisition';
import {
  normalizeKuwaitCode,
  parseKuwaitDuty,
  readKuwaitAuthorityBundle,
  KUWAIT_BUNDLE_READER_VERSION,
  KUWAIT_PARSER_VERSION,
  type KuwaitAuthorityBundle,
  type KuwaitTariffLine,
} from '../src/lib/market-access/providers/kuwait-bundle';
import { buildKuwaitMarketAccess, replayKuwaitTariff } from '../src/lib/market-access/providers/kuwait-parser';
import {
  KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST,
  selectKuwaitTradeRemedies,
} from '../src/lib/market-access/providers/kuwait-remedies';

const adValorem = (rate: number) => parseKuwaitDuty(`${rate}%`);

function line(code: string, rate = 5): KuwaitTariffLine {
  return { code, description: `line ${code}`, declarable: true, duty: adValorem(rate), source: 'Kuwait Customs public HS Code portal', source_pages: [], effective_from: '2025-01-01', effective_to: null };
}

function bundle(overrides: Partial<KuwaitAuthorityBundle> = {}): KuwaitAuthorityBundle {
  const scheduleLines = [line('120110000000', 0), line('850710000000', 5), line('760612100000', 5), line('690730000000', 5), line('721310000000', 5), line('245020000000', 100)];
  return {
    checksum: 'fixture-sha256', size_bytes: 1, release_identifier: '2026-09-23',
    source_url: 'https://www.customs.gov.kw/HSCode/HsCode', files: [],
    schedule_lines: new Map(scheduleLines.map((item) => [item.code, item])),
    remedies: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, reader_version: KUWAIT_BUNDLE_READER_VERSION, parser_version: KUWAIT_PARSER_VERSION,
    ...overrides,
  };
}

describe('Kuwait authority pack', () => {
  test('parses ordinary ad-valorem and legal-zero semantics without inventing rates; blank is never zero', () => {
    expect(parseKuwaitDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseKuwaitDuty('0.00 %')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseKuwaitDuty('5.000 %')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(parseKuwaitDuty('100.000 %')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 100 });
  });

  test('normalizes the portal’s trimmed display codes to full 12-digit codes', () => {
    expect(normalizeKuwaitCode('0101.21.10.00.01')).toBe('010121100001');
    expect(normalizeKuwaitCode('9705.00.10')).toBe('970500100000');
    expect(normalizeKuwaitCode('3926.10.00.00.00')).toBe('392610000000');
    expect(() => normalizeKuwaitCode('12.34.56.78.90.12')).toThrow(/unexpected group structure/);
  });

  test('rejects a non-official host', () => {
    expect(() => kuwaitOfficialUrl('https://example.com/not-official')).toThrow(/rejects example\.com/);
  });

  test('the current live portal is authoritative for any date on/after the 2025-01-01 baseline; nothing before it', () => {
    const fixture = bundle();
    expect(replayKuwaitTariff(fixture, new Date('2024-12-31T00:00:00Z')).size).toBe(0);
    const current = replayKuwaitTariff(fixture, new Date('2026-09-23T00:00:00Z'));
    expect(current.get('120110000000')?.duty.ad_valorem_rate_percent).toBe(0);
    expect(current.get('721310000000')?.duty.ad_valorem_rate_percent).toBe(5);
    expect(current.get('245020000000')?.duty.ad_valorem_rate_percent).toBe(100);
  });

  test('keeps India preference not applicable (FTA still at Terms-of-Reference stage) and fails closed on producer-specific anti-dumping rates', () => {
    const result = buildKuwaitMarketAccess({ bundle: bundle(), release_id: 'release-kw', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T01:00:00Z'), hs6: '850710', at: new Date('2026-09-23T00:00:00Z'), origin_country: 'IN' });
    expect(result.india_preference.applicability).toBe('not_applicable');
    expect(result.india_preference.basis).toMatch(/Terms-of-Reference/);
    expect(result.lines.some((item) => item.measure_kind === 'additional_duty' && item.duty.ad_valorem_rate_percent === null)).toBe(false); // no China/Malaysia/Korea origin queried here
  });

  test('remedy manifest is bounded, complete and applies product/origin/exclusion/sunset-review gates', () => {
    expect(KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST.measures).toHaveLength(6);
    expect(KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST.register_enumeration_complete).toBe(true);
    expect(KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST.historical_measures).toHaveLength(1);

    // Korea automotive batteries: 5y + 5y-from-original-expiry, active through 2027-08-17.
    const korea = selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'KR', at: new Date('2026-09-23') });
    expect(korea.status).toBe('producer_refinement_required');
    if (korea.status === 'producer_refinement_required') {
      expect(korea.candidates[0]!.producers.map((p) => p.name)).toContain('ATLASBX CO. LTD (formerly Hankook & Company Co. Ltd)');
      expect(korea.candidates[0]!.other_producers_rate_percent).toBe(25);
    }
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'KR', at: new Date('2027-09-01') }).status).toBe('not_applicable');

    // China/Malaysia batteries: independently verified against Kuwait Instruction 64, not copied from Qatar.
    const cnMyBattery = selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'MY', at: new Date('2026-09-23') });
    expect(cnMyBattery.status).toBe('producer_refinement_required');

    // Aluminium (China).
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '760612100000', origin_country: 'CN', at: new Date('2026-09-23') }).status).toBe('producer_refinement_required');

    // Cement/clinker (Iran) and ceramic tiles (China/India) remain active "pending sunset review" with no fixed expiry.
    const cement = selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '252300000000', origin_country: 'IR', at: new Date('2026-09-23') });
    expect(cement.status).toBe('producer_refinement_required');
    if (cement.status === 'producer_refinement_required') expect(cement.candidates[0]!.ongoing_pending_sunset_review).toBe(true);
    const ceramic = selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '690721000000', origin_country: 'IN', at: new Date('2026-09-23') });
    expect(ceramic.status).toBe('producer_refinement_required');
    // Excluded subheading 6907.30 must never match the ceramic tiles remedy.
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '690730000000', origin_country: 'IN', at: new Date('2026-09-23') }).status).toBe('not_applicable');

    // Sanitary ware (China/India).
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '691010000000', origin_country: 'IN', at: new Date('2026-09-23') }).status).toBe('producer_refinement_required');

    // Paperboard (Spain/Poland) is expired: never active, retained only as historical evidence.
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '480511000000', origin_country: 'ES', at: new Date('2026-09-23') }).status).toBe('not_applicable');
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '480511000000', origin_country: 'ES', at: new Date('2020-01-01') }).status).toBe('not_applicable'); // historical measures are never selectable, even before their own expiry
    const historicalPaperboard = KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST.historical_measures.find((m) => m.id.includes('paperboard'))!;
    expect(historicalPaperboard.status).toBe('EXPIRED');
    expect(historicalPaperboard.effective_until).toBe('2024-04-30');

    // No origin/product match anywhere => not_applicable.
    expect(selectKuwaitTradeRemedies({ manifest: KUWAIT_ACTIVE_TRADE_REMEDY_MANIFEST, code: '850710000000', origin_country: 'FR', at: new Date('2026-09-23') }).status).toBe('not_applicable');
  });

  test('is deterministic, corruption-intolerant and registered as an active adapter', async () => {
    const args = { bundle: bundle(), release_id: 'release-kw', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T01:00:00Z'), hs6: '120110', at: new Date('2026-09-23T00:00:00Z'), origin_country: 'IN' };
    expect(buildKuwaitMarketAccess(args)).toEqual(buildKuwaitMarketAccess(args));
    await expect(readKuwaitAuthorityBundle({ bytes: Buffer.from('not a zip'), release_identifier: '2026-09-23' })).rejects.toMatchObject({ code: 'corrupt_archive' });
    expect(unconfiguredSourceForCountry('KW')).toBeNull();
    expect(DESTINATION_ADAPTERS.KW?.provider_key).toBe('kw_customs_integrated_tariff');
  });
});
