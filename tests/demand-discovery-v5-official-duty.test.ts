import { describe, expect, test } from 'vitest';
import { selectTariffFactsOnly, type CountryTruthSelectionScope, type MarketAccessEvidenceRow } from '../src/lib/country-truth/fact-selection';
import { kilogramsPerDutyUnit, resolveOfficialDuty, type OfficialTariffRow } from '../src/lib/demand-discovery-v5/official-duty';

/**
 * The official duty on Indian goods in v5: Customs Atlas evidence rows, admitted under the deep
 * assessment's rules (`selectTariffFactsOnly`), resolved to one rate (`resolveOfficialDuty`).
 * Rows are in the shape `persistMarketAccessIngest` writes; values are invented.
 */
const AS_OF = new Date('2026-10-13T00:00:00Z');
const scope = (country: string): CountryTruthSelectionScope => ({ exporter_org_id: 'org-1', country_code: country, hs6: '100630', hs_revision: '2022', as_of_date: AS_OF.toISOString(), origin_country_code: 'IN' });

type Row = MarketAccessEvidenceRow & OfficialTariffRow;
const row = (id: string, overrides: Partial<Row>): Row => ({
  id, snapshot_id: 'snap-1', country_code: 'GB', hs_code_scope: '100630', rule_type: 'destination_tariff',
  source_authority: 'UK Trade Tariff', source_reference: 'https://www.trade-tariff.service.gov.uk/commodities/1006309800',
  retrieved_at: new Date('2026-10-01T00:00:00Z'), effective_at: new Date('2026-01-01T00:00:00Z'), expires_at: null, superseded_at: null,
  status: 'verified', confidence: 1, evidence_origin: 'fixture', tariff_rate_percent: null, preference_applicability: null, preference_basis: null,
  duty_expression: null, duty_kind: null, national_tariff_code: '1006309800', verification_grade: 'discovery_grade',
  requirement_code: null, requirement_description: null, requirement_obtainable: null,
  ...overrides,
});
const FX: Record<string, number> = { GBP: 1.3, EUR: 1.1, USD: 1 };

function resolve(country: string, rows: Row[], snapshots: { id: string; provider: string | null; source_dataset: string | null }[] = [{ id: 'snap-1', provider: 'uk_trade_tariff', source_dataset: null }], scoreIndiaPreference = false) {
  const selected = selectTariffFactsOnly({ scope: scope(country), snapshots, evidence: rows });
  return {
    selected,
    resolution: resolveOfficialDuty({ as_of: AS_OF, tariffs: selected.tariffs, rows: new Map(rows.map((item) => [item.id, item])), minimum_confidence: 50, usd_per_unit: (currency) => FX[currency] ?? null, score_india_preference: scoreIndiaPreference }),
  };
}
const preferred = (country: string, rows: Row[]) => resolve(country, rows, [{ id: 'snap-1', provider: 'uk_trade_tariff', source_dataset: null }], true).resolution;

describe('official duty on Indian goods (v5)', () => {
  test('an ad-valorem ordinary duty is the rate; a preference published for India is noted, not scored', () => {
    const { resolution } = resolve('US', [
      row('us-mfn', { country_code: 'US', source_authority: 'USITC HTS', duty_expression: '11.2%', duty_kind: 'ad_valorem', tariff_rate_percent: 11.2, national_tariff_code: '1006304010' }),
      row('us-pref', { country_code: 'US', rule_type: 'preferential_tariff_india', source_authority: 'USITC HTS', duty_expression: 'Free', duty_kind: 'unparsed', preference_applicability: 'potentially_applicable_requires_origin_proof', confidence: 0.5, national_tariff_code: '1006304010' }),
    ]);
    expect(resolution).toEqual({
      status: 'percent', duty_percent: 11.2, source: 'USITC HTS 1006304010', national_line: '1006304010',
      preference: { applicability: 'potentially_applicable_requires_origin_proof', duty_expression: 'Free', percent: null }, basis: 'standard',
      fact_ids: ['market_access_tariff:us-mfn', 'market_access_tariff:us-pref'], snapshot_ids: ['snap-1'],
    });
  });

  // D-026 (policy v6): India's published preference is scored unless it is a tariff quota.
  test('with the switch on, a preference published for India is scored and the standard rate kept beside it', () => {
    const mfn = row('us-mfn', { country_code: 'US', source_authority: 'USITC HTS', duty_expression: '11.2%', duty_kind: 'ad_valorem', tariff_rate_percent: 11.2, national_tariff_code: '1006304010' });
    const pref = (overrides: Partial<Row>) => row('us-pref', { country_code: 'US', rule_type: 'preferential_tariff_india', source_authority: 'USITC HTS', preference_applicability: 'potentially_applicable_requires_origin_proof', confidence: 0.5, national_tariff_code: '1006304010', ...overrides });
    expect(preferred('US', [mfn, pref({ duty_expression: '2.5%', duty_kind: 'ad_valorem' })])).toMatchObject({
      status: 'percent', duty_percent: 2.5, basis: 'india_preference', standard: { duty_percent: 11.2, expression: '11.2%' },
      preference: { duty_expression: '2.5%', percent: 2.5 }, fact_ids: ['market_access_tariff:us-mfn', 'market_access_tariff:us-pref'],
    });
    // "Free" is read from the pack's own parsed duty, which the evidence row now keeps.
    const free = { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: 'Free', note: null };
    expect(preferred('US', [mfn, pref({ duty_expression: 'Free', duty_kind: 'ad_valorem', raw_evidence: { duty: free } })])).toMatchObject({ status: 'percent', duty_percent: 0, basis: 'india_preference', preference: { percent: 0 } });
    // A specific preference is converted like the ordinary duty.
    expect(preferred('GB', [
      row('gb-mfn', { duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' }),
      row('gb-pref', { rule_type: 'preferential_tariff_india', duty_expression: '50.00 GBP / 1000 kg', duty_kind: 'specific', preference_applicability: 'potentially_applicable_requires_origin_proof', confidence: 0.5 }),
    ])).toMatchObject({ status: 'specific', expression: '50.00 GBP / 1000 kg', basis: 'india_preference', standard: { duty_percent: null, expression: '121.00 GBP / 1000 kg' } });
    // The switch off keeps the ordinary rate.
    expect(resolve('US', [mfn, pref({ duty_expression: '2.5%', duty_kind: 'ad_valorem' })]).resolution).toMatchObject({ status: 'percent', duty_percent: 11.2, basis: 'standard' });
  });

  test('a quota preference, a preference above the standard rate, or one that is not one rate is not scored', () => {
    const mfn = row('jp-mfn', { country_code: 'JP', source_authority: 'Japan Customs', duty_expression: '10%', duty_kind: 'ad_valorem', tariff_rate_percent: 10, national_tariff_code: '100630090' });
    const pref = (overrides: Partial<Row>) => row('jp-pref', { country_code: 'JP', rule_type: 'preferential_tariff_india', source_authority: 'Japan Customs', preference_applicability: 'potentially_applicable_requires_origin_proof', confidence: 0.5, national_tariff_code: '100630090', ...overrides });
    // Older rows say "tariff quota" in their basis; newer ones also carry the flag.
    const quotaByWords = preferred('JP', [mfn, pref({ duty_expression: '0%', duty_kind: 'ad_valorem', preference_basis: 'The only India-specific measure is a tariff quota. A quota rate is a volume entitlement, not an unconditional applied rate, and requires quota availability at the time of import.' })]);
    expect(quotaByWords).toMatchObject({ status: 'percent', duty_percent: 10, basis: 'standard', preference: { percent: 0, quota: true } });
    expect(preferred('JP', [mfn, pref({ duty_expression: '0%', duty_kind: 'ad_valorem', raw_evidence: { is_quota: true } })])).toMatchObject({ duty_percent: 10, basis: 'standard', preference: { quota: true } });
    expect(preferred('JP', [mfn, pref({ duty_expression: '12%', duty_kind: 'ad_valorem' })])).toMatchObject({ duty_percent: 10, basis: 'standard' });
    expect(preferred('JP', [mfn, pref({ duty_expression: '5% + 20 JPY / kg', duty_kind: 'compound' })])).toMatchObject({ duty_percent: 10, basis: 'standard' });
    // Unknown applicability is no preference at all.
    expect(preferred('JP', [mfn, pref({ duty_expression: '0%', duty_kind: 'ad_valorem', preference_applicability: 'unknown' })])).toMatchObject({ duty_percent: 10, basis: 'standard', preference: null });
  });

  test('a specific duty per mass becomes USD per kg at the frozen exchange rate', () => {
    const { resolution } = resolve('GB', [
      row('gb-mfn', { duty_expression: '121.00 GBP / 1000 kg', duty_kind: 'specific' }),
      row('gb-pref', { rule_type: 'preferential_tariff_india', duty_expression: '0.00 %', duty_kind: 'ad_valorem', preference_applicability: 'potentially_applicable_requires_origin_proof', confidence: 0.5 }),
    ]);
    expect(resolution).toMatchObject({ status: 'specific', expression: '121.00 GBP / 1000 kg', fx: { currency: 'GBP', usd_per_unit: 1.3 }, preference: { percent: 0 } });
    expect((resolution as { usd_per_kg: number }).usd_per_kg).toBeCloseTo(0.1573, 6);
  });

  test('an ordinary duty published in words is read from the pack’s own parsed duty (EAEU euro per kilogram)', () => {
    const eaeu = { kind: 'specific', ad_valorem_rate_percent: null, specific_amount: 0.03, specific_currency: 'EUR', specific_unit: 'kg', specific_unit_quantity: 1, expression: '0,03 евро за 1 кг', note: null };
    const words = { country_code: 'KZ', source_authority: 'EEC Council Decision No. 80', duty_expression: '0,03 евро за 1 кг', duty_kind: 'specific', national_tariff_code: '1006300000' };
    const union = [{ id: 'snap-1', provider: 'eaeu_common_customs_tariff', source_dataset: null }];
    expect(resolve('KZ', [row('kz-cct', { ...words, raw_evidence: { duty: eaeu } })], union).resolution).toMatchObject({ status: 'specific', usd_per_kg: expect.closeTo(0.033, 9), expression: '0,03 евро за 1 кг', fx: { currency: 'EUR', usd_per_unit: 1.1 } });
    // Without the pack's reading, the words are not a rate.
    expect(resolve('KZ', [row('kz-cct', words)], union).resolution).toMatchObject({ status: 'unusable' });
  });

  test('official but not one rate: compound, per litre, or a currency without a published rate', () => {
    expect(resolve('GB', [row('a', { duty_expression: '12% + 50 EUR / 100 kg', duty_kind: 'compound' })]).resolution).toMatchObject({ status: 'unusable', reason: expect.stringMatching(/cannot be reduced to one rate: Compound duty/) });
    expect(resolve('GB', [row('b', { duty_expression: '2.00 GBP / l', duty_kind: 'specific' })]).resolution).toMatchObject({ status: 'unusable', reason: expect.stringMatching(/per l, which a price per kilogram cannot convert/) });
    expect(resolve('GB', [row('c', { duty_expression: '10.00 TWD / kg', duty_kind: 'specific' })]).resolution).toMatchObject({ status: 'unusable', reason: expect.stringMatching(/in TWD, for which no published exchange rate/) });
  });

  test('nothing official: no rows, a heading-level tariff, a row from after the clock, an expired line, a preference alone, or unapproved licensed content', () => {
    expect(resolve('GB', []).resolution).toEqual({ status: 'none', reason: 'No official tariff evidence is stored for this market and product.' });
    const heading = resolve('GB', [row('h', { hs_code_scope: '1006', duty_expression: '5%', tariff_rate_percent: 5 })]);
    expect(heading.selected.rejected).toEqual([{ row_id: 'h', reason: 'tariff_scope_is_not_the_exact_hs6_line' }]);
    expect(heading.resolution.status).toBe('none');
    expect(resolve('GB', [row('late', { retrieved_at: new Date('2026-10-20T00:00:00Z'), tariff_rate_percent: 5 })]).selected.rejected).toEqual([{ row_id: 'late', reason: 'retrieved_after_assessment_clock' }]);
    expect(resolve('GB', [row('old', { tariff_rate_percent: 5, expires_at: new Date('2026-06-30T00:00:00Z') })]).resolution).toEqual({ status: 'none', reason: 'No current official ordinary duty for this exact HS6 line.' });
    expect(resolve('GB', [row('p', { rule_type: 'preferential_tariff_india', preference_applicability: 'potentially_applicable_requires_origin_proof', duty_expression: '0%', confidence: 0.5 })]).resolution.status).toBe('none');
    const licensed = resolve('GB', [row('l', { tariff_rate_percent: 5 })], [{ id: 'snap-1', provider: 'avalara', source_dataset: 'tariffs' }]);
    expect(licensed.selected.tariffs).toEqual([]);
    expect(licensed.resolution.status).toBe('none');
  });

  test('the newest current ordinary row wins, and a low-confidence row is not used', () => {
    const { resolution } = resolve('GB', [
      row('older', { tariff_rate_percent: 8, retrieved_at: new Date('2026-09-01T00:00:00Z') }),
      row('newer', { tariff_rate_percent: 6, retrieved_at: new Date('2026-10-05T00:00:00Z') }),
      row('weak', { tariff_rate_percent: 1, retrieved_at: new Date('2026-10-10T00:00:00Z'), confidence: 0.3 }),
    ]);
    expect(resolution).toMatchObject({ status: 'percent', duty_percent: 6, fact_ids: ['market_access_tariff:newer'] });
  });

  test('duty units: mass only, by definition', () => {
    expect([kilogramsPerDutyUnit('kg', 1), kilogramsPerDutyUnit('kg', 100), kilogramsPerDutyUnit('KG', 1000), kilogramsPerDutyUnit('tonne', null), kilogramsPerDutyUnit('l', 1), kilogramsPerDutyUnit('kg net eda', 1)]).toEqual([1, 100, 1000, 1000, null, null]);
  });
});
