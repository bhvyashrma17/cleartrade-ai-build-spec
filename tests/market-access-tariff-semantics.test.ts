import { describe, expect, test } from 'vitest';
import {
  determineIndiaPreference,
  dutiesAreEquivalent,
  parseDutyExpression,
  resolveNationalTariffLine,
  type CandidateTariffLine,
} from '../src/lib/market-access/tariff-semantics';

const line = (over: Partial<CandidateTariffLine> & { national_tariff_code: string }): CandidateTariffLine => ({
  description: 'Rice',
  declarable: true,
  general_duty: parseDutyExpression('121.00 GBP / 1000 kg'),
  control_codes: [],
  preference_area_ids: [],
  ...over,
});

describe('duty expressions', () => {
  test('parses a pure ad-valorem rate', () => {
    expect(parseDutyExpression('11.2%')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 11.2, specific_amount: null });
    expect(parseDutyExpression('0.00 %')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
  });

  test('never reduces a specific duty to a percentage', () => {
    // The real UK third-country duty for HS 1006.30.
    const uk = parseDutyExpression('121.00 GBP / 1000 kg');
    expect(uk).toMatchObject({ kind: 'specific', ad_valorem_rate_percent: null, specific_amount: 121, specific_currency: 'GBP', specific_unit: 'kg', specific_unit_quantity: 1000 });
    expect(uk.expression).toBe('121.00 GBP / 1000 kg');

    // The real US general duty for HTS 1006.30.90, quoted in cents.
    const us = parseDutyExpression('1.4¢/kg');
    expect(us).toMatchObject({ kind: 'specific', ad_valorem_rate_percent: null, specific_currency: 'USD', specific_unit: 'kg', specific_unit_quantity: 1 });
    expect(us.specific_amount).toBeCloseTo(0.014, 10);
  });

  test('records compound and mixed duties without inventing a scalar', () => {
    expect(parseDutyExpression('5% + 30 EUR / 100 kg')).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: null, specific_amount: null });
    expect(parseDutyExpression('12% MAX 20 EUR / 100 kg')).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: null });
    // Unparsed still carries the verbatim text so an operator can read what was published.
    const odd = parseDutyExpression('see additional code 2601');
    expect(odd).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
    expect(odd.expression).toBe('see additional code 2601');
  });

  test('an absent duty is "none", never zero percent', () => {
    expect(parseDutyExpression(null)).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseDutyExpression('')).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(dutiesAreEquivalent(parseDutyExpression(''), parseDutyExpression('0%'))).toBe(false);
  });

  test('equivalence requires the same kind and magnitude', () => {
    expect(dutiesAreEquivalent(parseDutyExpression('11.2%'), parseDutyExpression('11.2 %'))).toBe(true);
    expect(dutiesAreEquivalent(parseDutyExpression('11.2%'), parseDutyExpression('1.4¢/kg'))).toBe(false);
    expect(dutiesAreEquivalent(parseDutyExpression('121.00 GBP / 1000 kg'), parseDutyExpression('121.00 GBP / 100 kg'))).toBe(false);
  });
});

describe('national tariff-line resolution', () => {
  test('a single declarable line resolves exactly', () => {
    const result = resolveNationalTariffLine([line({ national_tariff_code: '1006302110' }), line({ national_tariff_code: '1006302100', declarable: false })]);
    expect(result).toMatchObject({ resolution: 'exact', candidate_count: 2 });
    expect(result.resolved_line?.national_tariff_code).toBe('1006302110');
  });

  test('identical children collapse; differing children demand refinement', () => {
    const same = resolveNationalTariffLine([line({ national_tariff_code: 'A' }), line({ national_tariff_code: 'B' })]);
    expect(same.resolution).toBe('all_children_equivalent');

    // The real US case: 1006.30.10 is 11.2% while 1006.30.90 is 1.4¢/kg.
    const differing = resolveNationalTariffLine([
      line({ national_tariff_code: '1006301000', general_duty: parseDutyExpression('11.2%') }),
      line({ national_tariff_code: '1006309000', general_duty: parseDutyExpression('1.4¢/kg') }),
    ]);
    expect(differing.resolution).toBe('classification_refinement_required');
    expect(differing.resolved_line).toBeNull();
    // Every candidate is retained so the choice can actually be made by someone who knows.
    expect(differing.candidates).toHaveLength(2);
    expect(differing.differences[0]).toMatch(/general_duty differs/);
  });

  test('equal duties still demand refinement when controls or preferences differ', () => {
    const controls = resolveNationalTariffLine([
      line({ national_tariff_code: 'A', control_codes: ['N853'] }),
      line({ national_tariff_code: 'B', control_codes: [] }),
    ]);
    expect(controls.resolution).toBe('classification_refinement_required');
    expect(controls.differences.join(' ')).toMatch(/material controls differ/);

    // The real UK case: the Basmati line carries a 0% preference the packing-size lines do not.
    const preferences = resolveNationalTariffLine([
      line({ national_tariff_code: '1006302712', preference_area_ids: ['1013', '2052'] }),
      line({ national_tariff_code: '1006302110', preference_area_ids: ['1013'] }),
    ]);
    expect(preferences.resolution).toBe('classification_refinement_required');
    expect(preferences.differences.join(' ')).toMatch(/preferential coverage differs/);
  });

  test('no declarable line is unavailable, not an empty answer', () => {
    expect(resolveNationalTariffLine([]).resolution).toBe('unavailable');
    expect(resolveNationalTariffLine([line({ national_tariff_code: 'X', declarable: false })]).resolution).toBe('unavailable');
  });

  test('refinement never silently picks the lowest, first or modal rate', () => {
    const result = resolveNationalTariffLine([
      line({ national_tariff_code: 'A', general_duty: parseDutyExpression('11.2%') }),
      line({ national_tariff_code: 'B', general_duty: parseDutyExpression('0%') }),
      line({ national_tariff_code: 'C', general_duty: parseDutyExpression('0%') }),
    ]);
    expect(result.resolution).toBe('classification_refinement_required');
    expect(result.resolved_line).toBeNull();
  });
});

describe('India preference applicability', () => {
  const duty = parseDutyExpression('0.00 %');

  test('a preferential measure published for India is never applicable on its own', () => {
    const result = determineIndiaPreference({ direct_india_measures: [{ geographic_area_id: 'IN', duty, is_quota: false }], proven_group_measures: [], beneficiary_enumeration_is_complete: false, unresolved_program_symbols: [] });
    expect(result.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(result.basis).toMatch(/rules-of-origin/);
    expect(result.duty?.ad_valorem_rate_percent).toBe(0);
  });

  test('a tariff quota is not an unconditional rate', () => {
    // The real UK case for HS 1006.30: the only India measure is a non-preferential quota.
    const result = determineIndiaPreference({ direct_india_measures: [{ geographic_area_id: 'IN', duty, is_quota: true }], proven_group_measures: [], beneficiary_enumeration_is_complete: false, unresolved_program_symbols: [] });
    expect(result.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(result.basis).toMatch(/volume entitlement, not an unconditional applied rate/);
  });

  test('absence is unknown unless the source proves its beneficiary list is complete', () => {
    const open = determineIndiaPreference({ direct_india_measures: [], proven_group_measures: [], beneficiary_enumeration_is_complete: false, unresolved_program_symbols: [] });
    expect(open).toMatchObject({ applicability: 'unknown', duty: null });
    expect(open.basis).toMatch(/absence is not evidence/);

    const closed = determineIndiaPreference({ direct_india_measures: [], proven_group_measures: [], beneficiary_enumeration_is_complete: true, unresolved_program_symbols: [] });
    expect(closed.applicability).toBe('not_applicable');
  });

  test('unreadable programme symbols keep applicability unknown', () => {
    // The real US case: the Special column names programmes (A+, D, E, P), not countries.
    const result = determineIndiaPreference({ direct_india_measures: [], proven_group_measures: [], beneficiary_enumeration_is_complete: true, unresolved_program_symbols: ['A+', 'D', 'E', 'P'] });
    expect(result.applicability).toBe('unknown');
    expect(result.basis).toMatch(/programme symbols/);
  });

  test('a group measure only counts when the source proves India is in the group', () => {
    const proven = determineIndiaPreference({ direct_india_measures: [], proven_group_measures: [{ geographic_area_id: '2020', duty, is_quota: false }], beneficiary_enumeration_is_complete: false, unresolved_program_symbols: [] });
    expect(proven.applicability).toBe('potentially_applicable_requires_origin_proof');
    expect(proven.geographic_area_id).toBe('2020');
  });
});
