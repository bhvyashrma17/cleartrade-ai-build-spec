/**
 * The labelled estimate for a market with no official regional figures (D-048 (4), docs/38 §1.3).
 *
 * Built from the regional geography registry (docs/38 §3), so every one of the 218 markets has a
 * view without any request or job:
 *
 * - **One place** → "Not needed": one search area, the whole market. Its main city and gateways are
 *   still listed, for buyer discovery.
 * - **Hub and gateway** → "Estimate": the main cities, ranked by population.
 * - **Regions** → "Estimate": the regions, ranked by the population of their cities of 300,000 or
 *   more. Regions with no such city are counted, not ranked.
 *
 * The estimate is the same for every product and measures city size, not imports; the page says both.
 * D-048 also names the regional economy as an input; it is not in the registry yet, so this estimate
 * uses city size and gateways only (an open decision listed in docs/38 §1.3).
 */
import { marketGeography, regionalGeography } from '@/lib/regional-geography/market-geography';
import type { MarketShape } from '@/lib/regional-geography/shape';
import { REGIONAL_TOP_AREAS, REGIONAL_VIEW_VERSION, rankShares, type CoreSummary, type RankedMeta } from './view';

export const REGIONAL_ESTIMATE_VERSION = 'regional-estimate-v1';
/** Gateways listed with an estimate: enough to name the main ports and airports. */
export const ESTIMATE_GATEWAYS = 8;

export interface EstimateArea {
  code: string;
  name: string;
  kind: 'region' | 'hub';
  /** Population of its cities of 300,000 or more (Natural Earth's estimates, of varying years). */
  population: number;
  /** Cities inside it, largest first; for a hub, the places merged into it. */
  hubs: string[];
  /** For a hub: the region it sits in. */
  region: { code: string; name: string } | null;
}

export interface EstimateGateway {
  kind: 'port' | 'airport';
  name: string;
  iata: string | null;
  region: { code: string; name: string } | null;
}

export interface RegionalEstimate {
  view_version: string;
  estimate_version: string;
  evidence: 'estimate' | 'not_needed';
  country_code: string;
  shape: MarketShape;
  ranked_by: 'city_population';
  title: string;
  areas: EstimateArea[];
  ranked: RankedMeta[];
  others: { count: number; population: number } | null;
  /** Regions with no city of 300,000 or more: counted, not ranked. */
  unranked_regions: number;
  total: number;
  core: CoreSummary;
  gateways: EstimateGateway[];
  source: { label: string; url: string; geography_version: string; geography_checksum: string; rule_version: string };
  notes: string[];
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The estimate for one of the 218 markets, or null for a code that is not one of them. */
export function regionalEstimate(countryCode: string): RegionalEstimate | null {
  const market = marketGeography(countryCode);
  if (!market) return null;
  const registry = regionalGeography();
  const regionName = new Map(market.regions.map((region) => [region.code, region.name]));
  const regionRef = (code: string | null) => (code ? { code, name: regionName.get(code) ?? code } : null);

  let title: string;
  let candidates: EstimateArea[];
  let unranked = 0;
  if (market.shape === 'regions') {
    title = 'Regions, by the size of their main cities';
    const withHubs = market.regions.filter((region) => region.hubs.length > 0);
    unranked = market.regions.length - withHubs.length;
    const population = new Map(market.centres.map((centre) => [centre.name, centre.population]));
    candidates = withHubs.map((region) => ({
      code: region.code, name: region.name, kind: 'region' as const,
      population: region.hubs.reduce((sum, hub) => sum + (population.get(hub) ?? 0), 0),
      hubs: region.hubs, region: null,
    }));
  } else {
    title = market.shape === 'hub_and_gateway' ? 'Main cities, by size' : 'Main city';
    candidates = market.centres.map((centre) => ({
      code: centre.region ? `${centre.region}:${centre.name}` : centre.name, name: centre.name, kind: 'hub' as const,
      population: centre.population, hubs: centre.merged, region: regionRef(centre.region),
    }));
  }
  const sorted = candidates.sort((a, b) => b.population - a.population || byText(a.name, b.name));
  const { total, ranked, core } = rankShares(sorted.map((area) => area.code), sorted.map((area) => area.population));
  const rest = sorted.slice(REGIONAL_TOP_AREAS);

  const gateways = [...market.gateways]
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'port' ? -1 : 1) || a.map_rank - b.map_rank || byText(a.name, b.name))
    .slice(0, ESTIMATE_GATEWAYS)
    .map((gateway) => ({ kind: gateway.kind, name: gateway.name, iata: gateway.iata, region: regionRef(gateway.region) }));

  const notes = market.shape === 'one_place'
    ? ['One search area: buyers anywhere in the market can be reached from its main city and gateways.']
    : [
        'Nothing official is published for this market, so this is an estimate: ranked by the population of the main cities (Natural Earth), not by imports.',
        'It is the same for every product. It shows where importers are likely to sit, not where this product goes.',
        ...(unranked > 0 ? [`${unranked} more ${unranked === 1 ? 'region has' : 'regions have'} no city of 300,000 or more and ${unranked === 1 ? 'is' : 'are'} not ranked.`] : []),
      ];

  return {
    view_version: REGIONAL_VIEW_VERSION,
    estimate_version: REGIONAL_ESTIMATE_VERSION,
    evidence: market.shape === 'one_place' ? 'not_needed' : 'estimate',
    country_code: market.iso2,
    shape: market.shape,
    ranked_by: 'city_population',
    title,
    areas: sorted.slice(0, REGIONAL_TOP_AREAS),
    ranked,
    others: rest.length ? { count: rest.length, population: rest.reduce((sum, area) => sum + area.population, 0) } : null,
    unranked_regions: unranked,
    total,
    core,
    gateways,
    source: {
      label: 'Natural Earth v5.1.2: places of 300,000 or more, ports and airports (public domain)',
      url: 'https://www.naturalearthdata.com/',
      geography_version: registry.version,
      geography_checksum: registry.checksum,
      rule_version: registry.rule_version,
    },
    notes,
  };
}
