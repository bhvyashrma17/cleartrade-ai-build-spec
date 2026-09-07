import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildTaiwanMarketAccess, parseTaiwanDuty, readTaiwanAuthorityCsv } from '@/lib/market-access/providers/taiwan-parser';

const HEADER = '貨品分類號列,中文貨名,英文貨名,第一欄稅率,第二欄稅率,第三欄稅率,統計數量單位,統計重量單位,稽徵規定,輸入規定,輸出規定';
const fixture = (rows: string[]) => readTaiwanAuthorityCsv({ bytes: Buffer.from(`\uFEFF${HEADER}\n${rows.join('\n')}\n`), release_identifier: '2026-08-31', source_url: 'https://opendata.customs.gov.tw/data/80871/csv.csv' });
const AT = new Date('2026-08-31T00:00:00.000Z');

describe('Taiwan Customs dataset 80871', () => {
  test('reads the authority\'s exact Chinese schema and keeps the 11th check digit', () => {
    const bundle = fixture(['01012100003,純種繁殖用馬,"Live horses, pure-bred breeding animals",2.5%,"0% (PA,GT,NI,SV,HN,NZ,SG)",2.5%,HED,KGM,,B01,']);
    expect(bundle.rows[0]).toMatchObject({ commodity_code: '01012100003', column_i_duty: '2.5%', import_rules: 'B01' });
    expect(bundle.beneficiary_tokens).toEqual(['GT', 'HN', 'NI', 'NZ', 'PA', 'SG', 'SV']);
  });

  test('rejects an English/guessed header rather than silently parsing zero rows', () => {
    expect(() => readTaiwanAuthorityCsv({ bytes: Buffer.from('code,description,mfn\n01012100003,Horse,2.5%'), release_identifier: 'x', source_url: 'https://opendata.customs.gov.tw/data/80871/csv.csv' })).toThrow(/documented 11-column/);
  });

  test('preserves specific and alternative duties without manufacturing an AVE', () => {
    expect(parseTaiwanDuty('NT$30/KGM')).toMatchObject({ kind: 'specific', specific_amount: 30, specific_currency: 'TWD', specific_unit: 'KGM', specific_unit_quantity: 1, ad_valorem_rate_percent: null });
    expect(parseTaiwanDuty('NT$5800/TNE or 10.2% whichever is higher')).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: null, expression: 'NT$5800/TNE or 10.2% whichever is higher' });
    expect(parseTaiwanDuty('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
  });

  test('executes HS6 resolution, preserves controls and uses the release reference date', () => {
    const bundle = fixture([
      '01012100003,馬,Horse,2.5%,"0% (PA,NZ,SG)",2.5%,HED,KGM,L01,B01,',
      '01012100011,其他馬,Other horse,5%,"0% (PA,NZ,SG)",5%,HED,KGM,,B02,',
    ]);
    const result = buildTaiwanMarketAccess({ bundle, release_id: 'tw-release-1', release_reference_date: AT, retrieved_at: AT, hs6: '010121', at: AT, origin_country: 'IN' });
    expect(result.resolution.resolution).toBe('classification_refinement_required');
    expect(result.general_duty).toBeNull();
    expect(result.lines.filter((line) => line.measure_kind === 'third_country_duty')).toHaveLength(2);
    expect(result.lines.some((line) => line.measure_kind === 'tariff_preference' && line.origin_geographic_area_id === 'PA')).toBe(true);
    expect(result.lines[0]!.effective_from).toEqual(AT);
    expect(result.regulatory_coverage_complete).toBe(false);
    expect(result.india_preference.applicability).toBe('unknown');
  });

  test.runIf(Boolean(process.env.CLEARTRADE_TAIWAN_RELEASE))('real release canary: parses the official current CSV', () => {
    const bytes = readFileSync(process.env.CLEARTRADE_TAIWAN_RELEASE!);
    const bundle = readTaiwanAuthorityCsv({ bytes, release_identifier: 'real-local-canary', source_url: 'https://opendata.customs.gov.tw/data/80871/csv.csv' });
    expect(bundle.rows.length).toBeGreaterThan(12_000);
    expect(bundle.rows[0]!.commodity_code).toMatch(/^\d{11}$/);
  });
});
