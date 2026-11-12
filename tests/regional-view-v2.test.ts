import { describe, expect, test } from 'vitest';
import type { ImporterView, RegionalArea, RegionalDemandResultV1 } from '../src/lib/regional-demand/census';
import { regionalEstimate } from '../src/lib/regional-demand/estimate';
import { REGIONAL_EVIDENCE, presentRegionalResult, rankShares, type PresentedImporterView, type PresentedValueView } from '../src/lib/regional-demand/view';
import { regionalGeography } from '../src/lib/regional-geography/market-geography';

/** The regional view v2 (D-048, docs/38 §1.3): top 10, the 80% marked, the rest summed, evidence labels, estimates. */

const area = (code: string, india: number, world: number | null): RegionalArea => ({
  code, name: code, india_value_usd: india, world_value_usd: world, india_share_percent: null,
  container_value_usd: 0, container_weight_kg: 0, air_value_usd: 0, india_months: 12,
});

const result = (views: RegionalDemandResultV1['views'], key = 'us_census_intltrade'): RegionalDemandResultV1 => ({
  version: 1, country_code: 'US', hs6: '570110',
  source: { key, label: 'test', url: 'https://example.test/', attribution: 'test', retrieved_at: '2026-11-12T00:00:00.000Z', requests: [] },
  period: { from: '2025-09', to: '2026-08', months: 12, label: 'Sep 2025 – Aug 2026' },
  totals: { india_value_usd: null, world_value_usd: null, india_share_percent: null, container_share_percent: null, air_share_percent: null },
  views, notes: [],
});

describe('shares and the 80% mark', () => {
  test('marks the smallest set of the largest areas that reaches 80%, counting exactly 80% as reached', () => {
    const { total, ranked, core } = rankShares(['A', 'B', 'C', 'D'], [50, 30, 15, 5]);
    expect(total).toBe(100);
    expect(ranked.map((row) => [row.code, row.share_percent, row.cumulative_percent, row.in_core])).toEqual([
      ['A', 50, 50, true], ['B', 30, 80, true], ['C', 15, 95, false], ['D', 5, 100, false],
    ]);
    expect(core).toEqual({ count: 2, listed_share_percent: 80 });
  });

  test('lists 10 at most; a core that runs past them is counted, and a summed tail can hide it', () => {
    const twelve = rankShares(Array.from({ length: 12 }, (_, index) => `R${index + 1}`), Array.from({ length: 12 }, () => 10));
    expect(twelve.ranked).toHaveLength(10);
    expect(twelve.core).toEqual({ count: 10, listed_share_percent: 83.33 });
    const hidden = rankShares(['A', 'B'], [30, 20], 50);
    expect(hidden.core).toEqual({ count: null, listed_share_percent: 50 });
    expect(hidden.ranked.every((row) => row.in_core)).toBe(true);
    expect(rankShares(['A'], [0]).core).toEqual({ count: null, listed_share_percent: null });
  });
});

describe('a stored run, as the v2 view shows it', () => {
  test('a run listing every area ranks by imports from all origins, lists 10 and sums the rest', () => {
    const areas = Array.from({ length: 12 }, (_, index) => area(`S${String(index + 1).padStart(2, '0')}`, index === 11 ? 900 : 10, (12 - index) * 100));
    const shown = presentRegionalResult(result([{ kind: 'state', title: 'Destination states', areas, others: null }]));
    const states = shown.views[0] as PresentedValueView;
    expect(shown).toMatchObject({ view_version: 'regional-view-v2', evidence: 'your_product' });
    expect(states.ranked_by).toBe('all_origins_value');
    expect(states.areas.map((row) => row.code)).toEqual(['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09', 'S10']);
    // The two smallest by all origins are summed, though one of them is India's largest.
    expect(states.others).toEqual({ count: 2, india_value_usd: 910, world_value_usd: 300 });
    expect(states.total).toBe(7800);
    expect(states.core.count).toBe(7);
    expect(states.ranked.filter((row) => row.in_core)).toHaveLength(7);
  });

  test('a run stored before v2 (top 15 by India, the rest summed) keeps its order by India and is cut to 10', () => {
    const areas = Array.from({ length: 15 }, (_, index) => area(`P${String(index + 1).padStart(2, '0')}`, 150 - index * 10, 1000));
    const shown = presentRegionalResult(result([{ kind: 'port', title: 'Ports of entry', areas, others: { count: 20, india_value_usd: 100, world_value_usd: 5000 } }]));
    const ports = shown.views[0] as PresentedValueView;
    expect(ports.ranked_by).toBe('india_value');
    expect(ports.areas[0]!.code).toBe('P01');
    expect(ports.areas).toHaveLength(10);
    expect(ports.others).toEqual({ count: 25, india_value_usd: 250, world_value_usd: 10000 });
    expect(ports.total).toBe(1300);
  });

  test('without the all-countries figures a run ranks by India', () => {
    const shown = presentRegionalResult(result([{ kind: 'state', title: 'States', areas: [area('NY', 5, null), area('GA', 9, null)], others: null }]));
    const states = shown.views[0] as PresentedValueView;
    expect(states.ranked_by).toBe('india_value');
    expect(states.areas.map((row) => row.code)).toEqual(['GA', 'NY']);
  });

  test('a list of importers ranks by the importers in each region and is labelled "Traders"', () => {
    const importers: ImporterView = {
      kind: 'region', measure: 'importers', title: 'Regions', others: null,
      areas: [['TLI', 40], ['TLJ', 25], ['TLD', 20], ['TLG', 10], ['TLM', 5]].map(([code, count]) => ({ code: code as string, name: code as string, importer_count: count as number, india_importer_count: null, towns: [] })),
    };
    const shown = presentRegionalResult(result([importers], 'uk_hmrc_importers'));
    const regions = shown.views[0] as PresentedImporterView;
    expect(shown.evidence).toBe('traders');
    expect(regions.ranked_by).toBe('importers');
    expect(regions.core).toEqual({ count: 3, listed_share_percent: 85 });
    expect(REGIONAL_EVIDENCE[shown.evidence].label).toBe('Traders');
  });

  test('refuses a source with no evidence label rather than guessing one', () => {
    expect(() => presentRegionalResult(result([], 'somewhere_else'))).toThrow(/no evidence label/);
  });
});

describe('the labelled estimate, for every market without official figures', () => {
  test('a hub-and-gateway market: its main cities by size, the 80% marked, its gateways, the geography it used', () => {
    const uae = regionalEstimate('AE')!;
    expect(uae).toMatchObject({ evidence: 'estimate', shape: 'hub_and_gateway', ranked_by: 'city_population', title: 'Main cities, by size', unranked_regions: 0, others: null });
    expect(uae.areas.map((row) => [row.name, row.hubs, row.region?.code])).toEqual([['Dubai', ['Sharjah'], 'AE-DU'], ['Abu Dhabi', [], 'AE-AZ'], ['Al Ayn', [], 'AE-AZ']]);
    expect(uae.ranked.map((row) => row.in_core)).toEqual([true, true, false]);
    expect(uae.core).toEqual({ count: 2, listed_share_percent: 82.91 });
    expect(uae.gateways[0]).toMatchObject({ kind: 'port', name: 'Dubai' });
    expect(uae.gateways.map((gateway) => gateway.iata).filter(Boolean)).toEqual(['DXB', 'SHJ', 'AUH']);
    expect(uae.source).toMatchObject({ geography_version: 'regional-geography-v1', geography_checksum: regionalGeography().checksum, rule_version: 'regional-shape-rule-v1' });
    expect(uae.notes.join(' ')).toMatch(/not by imports/);
    expect(uae.notes.join(' ')).toMatch(/same for every product/);
  });

  test('a regions market: its regions by the size of their cities; regions with no large city are counted, not ranked', () => {
    const germany = regionalEstimate('DE')!;
    expect(germany).toMatchObject({ evidence: 'estimate', shape: 'regions', title: 'Regions, by the size of their main cities', unranked_regions: 5, others: { count: 1 } });
    expect(germany.areas).toHaveLength(10);
    expect(germany.areas.every((row) => row.kind === 'region' && row.hubs.length > 0)).toBe(true);
    expect(germany.areas.map((row) => row.population)).toEqual([...germany.areas.map((row) => row.population)].sort((a, b) => b - a));
    expect(germany.areas.find((row) => row.code === 'DE-BE')?.hubs).toEqual(['Berlin']);
    expect(germany.notes.join(' ')).toMatch(/5 more regions have no city of 300,000 or more/);
  });

  test('a one-place market is "Not needed": one search area, still with its main city and gateways', () => {
    const singapore = regionalEstimate('SG')!;
    expect(singapore).toMatchObject({ evidence: 'not_needed', shape: 'one_place', title: 'Main city' });
    expect(singapore.areas.map((row) => row.name)).toEqual(['Singapore']);
    expect(singapore.gateways.map((gateway) => gateway.name)).toEqual(['Singapore', 'Singapore Changi']);
    expect(singapore.notes).toEqual(['One search area: buyers anywhere in the market can be reached from its main city and gateways.']);
  });

  test('every one of the 218 markets has a view; a code outside them has none', () => {
    const labels = regionalGeography().markets.map((market) => regionalEstimate(market.iso2)!.evidence);
    expect(labels.filter((label) => label === 'not_needed')).toHaveLength(127);
    expect(labels.filter((label) => label === 'estimate')).toHaveLength(91);
    expect(regionalEstimate('IN')).toBeNull();
    expect(regionalEstimate('ZZ')).toBeNull();
  });
});
