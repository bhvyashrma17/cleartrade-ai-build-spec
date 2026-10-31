import { afterEach, describe, expect, test } from 'vitest';
import type { MarketEstimatePolicy } from '@/lib/config';
import type { TradeFlowInput } from '@/lib/demand-discovery-v5/series';
import { clearMarketEstimateCache, computeMarketEstimate, DISCLAIMER, estimateFromBaciFlows, setBaciEstimateReaderForTesting } from '@/lib/market-estimate';

/** E-041: the free and guest estimate answers for every product from CEPII BACI, with the warehouse as the fallback. */
const POLICY: MarketEstimatePolicy = { top_n_markets: 3, volume_floor_usd: 250_000, quantity_band_breakpoints: [100, 1_000, 10_000] };
const flow = (year: number, exporter: string, importer: string, value_usd: number, quantity_kg: number | null): TradeFlowInput => ({ year, exporter, importer, value_usd, quantity_kg });

const FLOWS: TradeFlowInput[] = [
  // US: 50m in 2024 from three suppliers at 2, 2.5 and 4 USD/kg; 40m in 2023.
  flow(2024, 'CN', 'US', 30_000_000, 15_000_000), flow(2024, 'VN', 'US', 15_000_000, 6_000_000), flow(2024, 'IN', 'US', 5_000_000, 1_250_000),
  flow(2023, 'CN', 'US', 40_000_000, 20_000_000),
  // DE: 10m in 2024, one supplier with no quantity: no price band.
  flow(2024, 'CN', 'DE', 10_000_000, null),
  // AE last reported in 2023: its own latest year is shown.
  flow(2023, 'IN', 'AE', 20_000_000, 10_000_000),
  // Under the floor; India itself; a provider aggregate: all left out.
  flow(2024, 'CN', 'NP', 100_000, 50_000), flow(2024, 'CN', 'IN', 90_000_000, 45_000_000), flow(2024, 'CN', 'cepii_baci:490', 80_000_000, 40_000_000),
];

describe('the estimate from CEPII BACI', () => {
  afterEach(() => {
    setBaciEstimateReaderForTesting(null);
    clearMarketEstimateCache();
  });

  test('importers ordered by their latest year, with suppliers\' prices per kg weighted by value; India, aggregates and small markets left out', () => {
    const result = estimateFromBaciFlows(FLOWS, '741810', POLICY, 'CEPII BACI 202501 (HS22), 2022–2024');
    expect(result).toMatchObject({ hs_scope: '741810', hs_scope_widened: false, source: 'cepii_baci', source_label: 'CEPII BACI 202501 (HS22), 2022–2024', disclaimer: DISCLAIMER, data_years_covered: [2023, 2024] });
    expect(result.markets.map((market) => market.country_code)).toEqual(['US', 'AE', 'DE']);
    expect(result.markets[0]).toEqual({
      country_code: 'US', observed_import_value_usd: 90_000_000, data_years: [2023, 2024],
      // By value: 60% at 2.00, 30% at 2.50, 10% at 4.00 → the 10th percentile is 2.00 and the 90th 2.50.
      unit_price_band: { min: 2, max: 2.5, currency: 'USD', per: 'kg' },
      headline: 'Buyers in US imported HS 741810 worth 5,00,00,000 USD in 2024, at 2.00–2.50 USD per kg.',
    });
    expect(result.markets[1]).toMatchObject({ country_code: 'AE', data_years: [2023], headline: 'Buyers in AE imported HS 741810 worth 2,00,00,000 USD in 2023, at 2.00–2.00 USD per kg.' });
    expect(result.markets[2]).toMatchObject({ country_code: 'DE', unit_price_band: null, headline: 'Buyers in DE imported HS 741810 worth 1,00,00,000 USD in 2024.' });
    // Observed history only: nothing reads as a forecast or an earning.
    for (const market of result.markets) expect(market.headline).not.toMatch(/earn|could|will|forecast|project/i);
  });

  test('the estimate route reads BACI for any six-digit code, and falls back to the warehouse when BACI is missing or unreadable', async () => {
    const asked: string[] = [];
    setBaciEstimateReaderForTesting(async (hs6) => {
      asked.push(hs6);
      return { flows: FLOWS, label: 'CEPII BACI test (HS22), 2023–2024' };
    });
    const fromBaci = await computeMarketEstimate({ hs_code: '6403.99', monthly_quantity: 500 }, POLICY);
    expect(asked).toEqual(['640399']);
    expect(fromBaci).toMatchObject({ source: 'cepii_baci', hs_scope: '640399', source_label: 'CEPII BACI test (HS22), 2023–2024' });
    expect(fromBaci.markets).toHaveLength(3);

    // No BACI release: the warehouse answers (it holds nothing for this code here).
    clearMarketEstimateCache();
    setBaciEstimateReaderForTesting(async () => null);
    expect(await computeMarketEstimate({ hs_code: '999991' }, POLICY)).toMatchObject({ source: 'none', markets: [], disclaimer: DISCLAIMER });

    // BACI unreadable (storage down): still an answer, never an error.
    clearMarketEstimateCache();
    setBaciEstimateReaderForTesting(async () => { throw new Error('storage unavailable'); });
    expect(await computeMarketEstimate({ hs_code: '999992' }, POLICY)).toMatchObject({ source: 'none', markets: [] });
  });
});
