import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { V5Breakdown } from '../src/app/app/markets/[marketAssessmentId]/V5Breakdown';
import { v5Detail } from '../src/lib/demand-discovery-v5/detail';
import type { MetricResult } from '../src/lib/demand-discovery-v5/metrics';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY, type MetricKey } from '../src/lib/demand-discovery-v5/policy';
import { marketDataContext, metricSource, type MarketDataContext } from '../src/lib/demand-discovery-v5/sources';

/**
 * Stage 1, item 8: every figure names its source and the years it covers, and says "Estimate" when it
 * is one. Runs before the engine recorded each figure's years fall back to the market's window, or
 * name the source without a year rather than invent one.
 */
const live = (key: MetricKey, inputs: MetricResult['inputs'] = {}, extra: Partial<MetricResult> = {}): MetricResult => ({ key, score: 60, quality: 1, reason: null, inputs, ...extra });
const BACI: MarketDataContext = { source: 'baci', window: [2019, 2020, 2021, 2022, 2023, 2024], structure_year: 2024, linked_year: null, partner_only: false, as_of: '2026-10-31' };

describe('the data context of a stored assessment', () => {
  test('reads the source, window, structure year, linked year and partner-only flag; tolerates anything else', () => {
    const breakdown = { source: 'baci', window: [2020, 2021, 2022, 2023, 2024, 2025], structure_year: 2024, newest_year: { linked: { year: 2025, total_usd: 1 }, refusal: null }, facts: { partner_only: true } };
    expect(marketDataContext(breakdown, new Date('2026-10-31T05:00:00Z'))).toEqual({
      source: 'baci', window: [2020, 2021, 2022, 2023, 2024, 2025], structure_year: 2024, linked_year: 2025, partner_only: true, as_of: '2026-10-31',
    });
    expect(marketDataContext(null, null)).toEqual({ source: null, window: [], structure_year: null, linked_year: null, partner_only: false, as_of: null });
    expect(marketDataContext({ source: 'elsewhere', window: 'x', newest_year: { linked: null } }, null)).toMatchObject({ source: null, window: [], linked_year: null });
  });
});

describe('a source line for every measure', () => {
  test('trade figures name the dataset and the years recorded with them', () => {
    expect(metricSource(live('market_size', { first_year: 2022, last_year: 2024 }), BACI)).toBe('CEPII BACI, 2022–2024');
    expect(metricSource(live('growth', { first_year: 2019, last_year: 2024 }), BACI)).toBe('CEPII BACI, 2019–2024');
    expect(metricSource(live('openness', { first_year: 2024, last_year: 2024 }), BACI)).toBe('CEPII BACI supplier shares, 2024');
    expect(metricSource(live('price_fit', { first_year: 2024, last_year: 2024 }), BACI)).toBe('Your price on the product form, against CEPII BACI unit values, 2024');
    expect(metricSource(live('volume_fit', { first_year: 2024, last_year: 2024 }), BACI)).toBe('Your capacity on the product form, against CEPII BACI quantities, 2024');
    expect(metricSource(live('distance_fit', { first_year: 2024, last_year: 2024 }), BACI)).toBe('CEPII GeoDist capitals, weighted by CEPII BACI supplier shares, 2024');
    // A newest year linked from the market's own Comtrade report says so; a figure that stops before it does not.
    const linked = { ...BACI, window: [2020, 2021, 2022, 2023, 2024, 2025], linked_year: 2025 };
    expect(metricSource(live('india_sales', { first_year: 2023, last_year: 2025 }), linked)).toBe("CEPII BACI, 2023–2024; 2025 from the market's report to UN Comtrade (provisional)");
    expect(metricSource(live('india_foothold', { first_year: 2019, last_year: 2024 }), linked)).toBe('CEPII BACI, 2019–2024');
    expect(metricSource(live('openness', { first_year: 2024, last_year: 2024 }), linked)).toBe('CEPII BACI supplier shares, 2024');
    // Partners' reports and the market's own customs reports are named as such.
    expect(metricSource(live('stability', { first_year: 2019, last_year: 2024 }), { ...BACI, partner_only: true })).toBe("CEPII BACI (from the market's partners' reports), 2019–2024");
    expect(metricSource(live('india_foothold', { first_year: 2019, last_year: 2023 }), { ...BACI, source: 'comtrade_fallback' })).toBe("UN Comtrade (the market's own customs reports), 2019–2023");
  });

  test('a run from before the engine recorded years names a year only where the stored row says exactly which', () => {
    // Trends cover the stored window; structure measures the structure year.
    expect(metricSource(live('growth'), BACI)).toBe('CEPII BACI, 2019–2024');
    expect(metricSource(live('stability'), { ...BACI, window: [2020, 2021, 2022, 2023, 2024, 2025], linked_year: 2025 })).toBe("CEPII BACI, 2020–2024; 2025 from the market's report to UN Comtrade (provisional)");
    expect(metricSource(live('price_headroom', { year: 2024 }), BACI)).toBe("CEPII BACI unit values, this market's and India's exports, 2024");
    expect(metricSource(live('openness'), BACI)).toBe('CEPII BACI supplier shares, 2024');
    // Size averages the last few years and India's figures may stop before a linked year: no year is guessed.
    for (const key of ['market_size', 'india_sales', 'india_foothold'] as MetricKey[]) expect(metricSource(live(key), BACI), key).toBe('CEPII BACI');
    expect(metricSource(live('logistics', { lpi: 3.8 }), BACI)).toBe('World Bank Logistics Performance Index');
    expect(metricSource(live('country_risk', { grade: 'A1', cover: 'open' }), BACI)).toBe('ECGC country risk classification');
  });

  test('duty names its official source and the date it is in force on, or says it is an estimate and from what', () => {
    expect(metricSource(live('duty', { basis: 'official', duty_percent: 5, source: 'EU TARIC 1008909000' }), BACI)).toBe('Official tariff: EU TARIC 1008909000, in force on 31 Oct 2026');
    expect(metricSource(live('duty', { basis: 'official', duty_percent: 10, common_tariff: 'ECOWAS common external tariff' }), BACI)).toBe('ECOWAS common external tariff, in force on 31 Oct 2026');
    expect(metricSource(live('duty', { basis: 'official', duty_percent: 6, schedule_read: "China's 2026 customs tariff schedule" }), BACI)).toBe("China's 2026 customs tariff schedule, in force on 31 Oct 2026");
    expect(metricSource(live('duty', { basis: 'official', duty_percent: 8, source: 'Gazette 12', recorded_by_agent: 'yes' }), BACI)).toBe('Official tariff read by a ClearTrade agent: Gazette 12, in force on 31 Oct 2026');
    // A run without a date names the source and no date.
    expect(metricSource(live('duty', { basis: 'official', duty_percent: 5, source: 'EU TARIC 1008909000' }), { ...BACI, as_of: null })).toBe('Official tariff: EU TARIC 1008909000');
    expect(metricSource(live('duty', { basis: 'rule', duty_percent: 0, source: 'Free port: no customs duty' }), BACI)).toBe('Published rule: Free port: no customs duty');
    expect(metricSource(live('duty', { basis: 'estimate', duty_percent: 7.5, sector_average_year: 2022, agreement: 'India–UAE CEPA' }, { estimated: true }), BACI))
      .toBe("Estimate: World Bank average applied tariff, 2022, with India's India–UAE CEPA");
    expect(metricSource(live('duty', { basis: 'estimate', duty_percent: 10, customs_union: 'EAC', agreement: null }, { estimated: true }), BACI))
      .toBe("Estimate: World Bank average applied tariff (the EAC's common external tariff), with no trade agreement in force");
  });

  test('logistics and payment risk name their year or list; the connectivity estimate says it is one', () => {
    expect(metricSource(live('logistics', { lpi: 3.8, lpi_year: 2023 }), BACI)).toBe('World Bank Logistics Performance Index, 2023');
    expect(metricSource(live('logistics', { basis: 'lsci_estimate', predicted_lpi: 3.1, lsci_year: 2024 }, { estimated: true }), BACI)).toBe('Estimate: UNCTAD liner shipping connectivity, fitted to the World Bank LPI, 2024');
    expect(metricSource(live('country_risk', { grade: 'A1', cover: 'open', list: 'ECGC short-term list w.e.f. 2026-07-01' }), BACI)).toBe('ECGC country risk classification, short-term list in force from 1 Jul 2026');
    // A list named some other way is shown as stored.
    expect(metricSource(live('country_risk', { grade: 'A1', cover: 'open', list: 'ECGC list, March 2026' }), BACI)).toBe('ECGC country risk classification (ECGC list, March 2026)');
  });

  test('every policy measure gets a line when it has data, and none when it has not', () => {
    for (const key of Object.keys(POLICY.points) as MetricKey[]) {
      expect(metricSource(live(key, { first_year: 2024, last_year: 2024, basis: key === 'duty' ? 'official' : null }), BACI)).toEqual(expect.any(String));
      expect(metricSource({ key, score: null, quality: 0, reason: 'No data.', inputs: {} }, BACI)).toBeNull();
    }
  });
});

describe('the market page', () => {
  test('shows each live measure with its source line; a measure without data keeps its reason', () => {
    const detail = v5Detail({
      model_version: 'market-opportunity-v5', market_status: 'ranked', rank: 1, overall_score: 72, confidence_score: 80, live_points: 95, data_year: 2024,
      labels: [], reasons: [], flag_reasons: [], handed_off: true, as_of_date: new Date('2026-10-31T05:00:00Z'),
      score_breakdown: {
        source: 'baci', window: [2019, 2020, 2021, 2022, 2023, 2024], structure_year: 2024, newest_year: null, facts: { partner_only: false },
        parts: [{ part: 'demand', points: 30, live_points: 30, score: 70 }, { part: 'access', points: 20, live_points: 15, score: 60 }],
        metrics: [
          { key: 'market_size', score: 80, quality: 1, reason: null, inputs: { average_imports_usd: 32_000_000, largest_market_usd: 900_000_000, first_year: 2022, last_year: 2024 } },
          { key: 'duty', score: 70, quality: 0.5, reason: null, estimated: true, inputs: { basis: 'estimate', duty_percent: 7.5, sector_average_percent: 7.5, sector_average_year: 2022, agreement_scope: 'none', agreement: null } },
          { key: 'logistics', score: null, quality: 0, reason: 'No logistics performance score for this market.', inputs: {} },
        ],
      },
    }, 12)!;
    const html = renderToStaticMarkup(createElement(V5Breakdown, { detail }));
    expect(html).toContain('Source: CEPII BACI, 2022–2024');
    expect(html).toContain('Source: Estimate: World Bank average applied tariff, 2022, with no trade agreement in force');
    expect(html).toContain('No logistics performance score for this market.');
    expect(html.match(/Source: /g)).toHaveLength(2);
  });
});
