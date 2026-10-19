import { describe, expect, test } from 'vitest';
import { formatInr, formatInrPerKg, formatUsdPerKg, withRupees } from '../src/lib/money-format';
import { metricSentence } from '../src/lib/demand-discovery-v5/explain';
import type { MetricResult } from '../src/lib/demand-discovery-v5/metrics';

/** D-023: rupees beside dollars, in lakh and crore. Rates are invented. */
describe('money formatting', () => {
  test('rupees read in crore, lakh or plain Indian grouping', () => {
    expect(formatInr(1_026_000_000)).toBe('₹103 crore');
    expect(formatInr(102_600_000)).toBe('₹10.3 crore');
    expect(formatInr(12_340_000)).toBe('₹1.23 crore');
    expect(formatInr(4_520_000)).toBe('₹45.2 lakh');
    expect(formatInr(840_000)).toBe('₹8.4 lakh');
    expect(formatInr(84_000)).toBe('₹84,000');
    expect(formatInrPerKg(176.4)).toBe('₹176/kg');
    expect(formatInrPerKg(4.254)).toBe('₹4.25/kg');
    expect([formatUsdPerKg(2.1), formatUsdPerKg(0.085), formatUsdPerKg(1250)]).toEqual(['$2.10/kg', '$0.085/kg', '$1,250/kg']);
  });

  test('every dollar amount in a sentence gets its rupee figure; no rate leaves the sentence alone', () => {
    expect(withRupees('Imports averaged $12.3 million a year over the last three years.', 84)).toBe('Imports averaged $12.3 million (₹103 crore) a year over the last three years.');
    expect(withRupees('It is a small market: imports averaged $950,000 a year.', 84)).toBe('It is a small market: imports averaged $950,000 (₹7.98 crore) a year.');
    expect(withRupees('A $1.2 billion market.', 84)).toBe('A $1.2 billion (₹10,080 crore) market.');
    expect(withRupees('They pay $2.10/kg; India usually sells at $1.80/kg.', 84)).toBe('They pay $2.10/kg (₹176/kg); India usually sells at $1.80/kg (₹151/kg).');
    expect(withRupees('Imports averaged $12.3 million a year.', null)).toBe('Imports averaged $12.3 million a year.');
    expect(withRupees('Duty on Indian goods is 5%.', 84)).toBe('Duty on Indian goods is 5%.');
  });

  test('price sentences state the prices per kilogram when the run recorded them', () => {
    const metric = (key: MetricResult['key'], inputs: Record<string, unknown>): MetricResult => ({ key, score: 60, quality: 1, reason: null, inputs } as MetricResult);
    expect(metricSentence(metric('price_headroom', { ratio: 1.1667, market_usd_per_kg: 2.1, india_usd_per_kg: 1.8 }))).toBe("Buyers here pay about 16.7% more than India's usual export price. They pay $2.10/kg; India usually sells at $1.80/kg.");
    expect(metricSentence(metric('price_fit', { ratio: 1.25, market_usd_per_kg: 2, your_usd_per_kg: 1.6 }))).toBe('Your price is about 20% below what this market usually pays. You quote $1.60/kg; buyers here usually pay $2.00/kg.');
  });
});
