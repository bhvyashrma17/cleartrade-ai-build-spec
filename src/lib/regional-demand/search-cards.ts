/**
 * The hand-off card for buyer discovery (D-048, docs/38 §1.4): where an agent should look for
 * importers in one market, built from its regional view (§1.3) and its geography (§3).
 *
 * Every whole market, hub or region hands buyer discovery the same card:
 * - its name, official code and cities (the hubs, with the places merged into them);
 * - what a buyer source can be filtered by: region codes, city names and, where known, postcode
 *   prefixes (the UK's postcode areas for its regions; elsewhere not recorded yet, and said so);
 * - its gateways: ports and airports (land border posts are not recorded yet, docs/38 §3.5);
 * - its place in the view: rank, share, and whether it is one of the areas holding 80% ("start here").
 *
 * The market's evidence label and source come with the cards. A market whose official figures have
 * not been read yet gets its market card only: the cards never fall back to an estimate silently.
 */
import { JobStatus } from '@prisma/client';
import { UK_POSTCODE_AREA_REGION } from '@/lib/buyer-discovery/uk-regions';
import { countryName } from '@/lib/country-discovery/country-names';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { allowedEvidenceOrigins, isRealWorkflowEnvironment, nonRealEvidenceOrigins } from '@/lib/evidence-environment';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { marketGeography } from '@/lib/regional-geography/market-geography';
import type { GeographyGateway } from '@/lib/regional-geography/registry';
import type { MarketShape } from '@/lib/regional-geography/shape';
import type { Principal } from '@/types';
import { regionalDemandView, type RegionalDemandView, type RegionalEvidenceInfo } from './service';
import type { PresentedImporterView, PresentedValueView, RankedMeta } from './view';

export const SEARCH_CARD_VERSION = 'buyer-search-card-v1';
/** Gateways listed on one card. */
export const CARD_GATEWAYS = 6;
/** India's land neighbours among the 218 markets: goods can enter them at border posts not recorded yet. */
const LAND_NEIGHBOURS = new Set(['BD', 'BT', 'CN', 'MM', 'NP', 'PK']);

export interface SearchCardGateway {
  kind: 'port' | 'airport';
  name: string;
  iata: string | null;
}

export interface SearchCard {
  scope: 'market' | 'region' | 'hub';
  name: string;
  /** ISO 3166-1 for the market; ISO 3166-2 for a region where one exists; else the source's own code. */
  code: string | null;
  rank: number | null;
  share_percent: number | null;
  /** One of the areas that together hold 80%: start here. */
  in_core: boolean;
  /** Cities to search, largest first, with the places merged into them. */
  cities: string[];
  search_terms: {
    /** Codes a buyer source can filter by. Natural Earth's placeholder codes are left out. */
    codes: string[];
    city_names: string[];
    /** Postcode prefixes, or null where none are recorded yet. */
    postcode_prefixes: string[] | null;
  };
  gateways: SearchCardGateway[];
}

export interface MarketSearchCards {
  version: string;
  country_code: string;
  country_name: string;
  shape: MarketShape | null;
  evidence: RegionalEvidenceInfo | null;
  /** Where the market's evidence comes from; null until official figures have been read. */
  source: { label: string; url: string } | null;
  cards: SearchCard[];
  notes: string[];
}

const ISO_3166_2 = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const titleCase = (value: string) => value.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());

/** The UK's postcode areas in each ITL1 region (D-033): the prefixes HMRC's list places importers by. */
const UK_AREAS_BY_REGION: ReadonlyMap<string, string[]> = (() => {
  const map = new Map<string, string[]>();
  for (const [area, region] of Object.entries(UK_POSTCODE_AREA_REGION)) map.set(region, [...(map.get(region) ?? []), area]);
  for (const areas of map.values()) areas.sort(byText);
  return map;
})();

const placement = (meta: RankedMeta | undefined) => ({ rank: meta?.rank ?? null, share_percent: meta?.share_percent ?? null, in_core: meta?.in_core ?? false });

/** The cards for one market, from its regional view. Pure: the geography is the checked-in registry. */
export function marketSearchCards(args: { country_code: string; view: RegionalDemandView }): MarketSearchCards {
  const cc = args.country_code.trim().toUpperCase();
  const name = countryName(cc);
  const geography = marketGeography(cc);
  const notes: string[] = [];
  if (!geography) {
    return { version: SEARCH_CARD_VERSION, country_code: cc, country_name: name, shape: null, evidence: args.view.evidence, source: null, cards: [], notes: ['This market is not one of the 218 Demand Discovery markets, so it has no regional geography.'] };
  }
  const regions = new Map(geography.regions.map((region) => [region.code, region]));
  const merged = new Map(geography.centres.map((centre) => [centre.name, centre.merged]));
  const citiesOf = (hubs: string[]) => unique(hubs.flatMap((hub) => [hub, ...(merged.get(hub) ?? [])]));
  // Only codes of regions the market actually has, and real ISO codes, not Natural Earth's placeholders.
  const isoCodes = (codes: (string | null | undefined)[]) => unique(codes.filter((code): code is string => !!code && ISO_3166_2.test(code) && regions.get(code)?.iso_code === true));
  const gatewaysOf = (keep: (gateway: GeographyGateway) => boolean): SearchCardGateway[] => geography.gateways
    .filter(keep)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'port' ? -1 : 1) || a.map_rank - b.map_rank || byText(a.name, b.name))
    .slice(0, CARD_GATEWAYS)
    .map((gateway) => ({ kind: gateway.kind, name: gateway.name, iata: gateway.iata }));

  const mainCities = citiesOf(geography.centres.slice(0, 5).map((centre) => centre.name));
  const cards: SearchCard[] = [{
    scope: 'market', name, code: cc, rank: null, share_percent: null, in_core: false,
    cities: mainCities,
    search_terms: { codes: [cc], city_names: mainCities, postcode_prefixes: null },
    gateways: gatewaysOf(() => true),
  }];

  let source: MarketSearchCards['source'] = null;
  const shown = args.view.shown?.result ?? null;
  if (args.view.supported) {
    if (!shown) {
      notes.push('The official regional figures have not been read yet, so only the whole market is listed.');
    } else {
      source = { label: shown.source.label, url: shown.source.url };
      const primary = shown.views[0];
      if (primary && primary.measure === 'importers') {
        const view = primary as PresentedImporterView;
        view.areas.forEach((area, index) => {
          const towns = area.towns.map(titleCase);
          const postcodes = cc === 'GB' ? UK_AREAS_BY_REGION.get(area.code) ?? null : null;
          cards.push({
            scope: 'region', name: area.name, code: area.code, ...placement(view.ranked[index]),
            cities: towns, search_terms: { codes: [area.code], city_names: towns, postcode_prefixes: postcodes }, gateways: [],
          });
        });
      } else if (primary) {
        const view = primary as PresentedValueView;
        view.areas.forEach((area, index) => {
          const iso = `${cc}-${area.code}`;
          const region = regions.get(iso);
          const cities = region ? citiesOf(region.hubs) : [];
          cards.push({
            scope: 'region', name: area.name, code: region ? iso : area.code, ...placement(view.ranked[index]),
            cities, search_terms: { codes: unique([...isoCodes([iso]), area.code]), city_names: cities, postcode_prefixes: null },
            gateways: region ? gatewaysOf((gateway) => gateway.region === iso) : [],
          });
        });
      }
    }
  } else if (args.view.estimate) {
    const estimate = args.view.estimate;
    source = { label: estimate.source.label, url: estimate.source.url };
    if (estimate.evidence === 'not_needed') {
      notes.push('One search area: the whole market. No regional cards are needed.');
    } else {
      estimate.areas.forEach((area, index) => {
        const regionCode = area.kind === 'region' ? area.code : area.region?.code ?? null;
        const cities = area.kind === 'region' ? citiesOf(area.hubs) : unique([area.name, ...area.hubs]);
        cards.push({
          scope: area.kind, name: area.name, code: regionCode && regions.get(regionCode)?.iso_code !== false ? regionCode : null, ...placement(estimate.ranked[index]),
          cities, search_terms: { codes: isoCodes([regionCode]), city_names: cities, postcode_prefixes: null },
          gateways: regionCode ? gatewaysOf((gateway) => gateway.region === regionCode) : [],
        });
      });
      notes.push('Ranked by the size of the main cities (an estimate), not by imports.');
    }
  }
  if (cards.every((card) => card.search_terms.postcode_prefixes === null)) notes.push('Postcode prefixes are not recorded for this market yet.');
  if (LAND_NEIGHBOURS.has(cc)) notes.push('Goods from India can also enter by land; border posts are not recorded yet.');
  return { version: SEARCH_CARD_VERSION, country_code: cc, country_name: name, shape: geography.shape, evidence: args.view.evidence, source, cards, notes };
}

export interface ExporterSearchMarket {
  market_assessment_id: string;
  product: { id: string; name: string };
  rank: number | null;
  cards: MarketSearchCards;
}

/**
 * The cards for every market handed off to buyer discovery (D-019): the handed-off markets of each
 * product's newest completed v5 run. Checks the principal may see the exporter before reading.
 */
export async function exporterSearchMarkets(principal: Principal, exporterOrgId: string): Promise<ExporterSearchMarket[]> {
  await assertOrgAccess(principal, exporterOrgId);
  const runs = await prisma.discoveryRun.findMany({
    where: { exporter_org_id: exporterOrgId, model_version: DEMAND_DISCOVERY_V5_MODEL, status: JobStatus.completed },
    orderBy: [{ completed_at: 'desc' }, { created_at: 'desc' }],
    select: { id: true, product_id: true },
  });
  const newest = new Map<string, string>();
  for (const run of runs) if (run.product_id && !newest.has(run.product_id)) newest.set(run.product_id, run.id);
  if (newest.size === 0) return [];
  const real = isRealWorkflowEnvironment();
  const assessments = await prisma.marketAssessment.findMany({
    where: {
      run_id: { in: [...newest.values()] }, handed_off: true,
      ...(real ? { evidence_origins: { hasSome: allowedEvidenceOrigins() }, NOT: { evidence_origins: { hasSome: nonRealEvidenceOrigins() } } } : {}),
    },
    orderBy: [{ product_id: 'asc' }, { rank: 'asc' }],
    select: { id: true, country_code: true, rank: true, product: { select: { id: true, name: true } } },
  });
  const markets: ExporterSearchMarket[] = [];
  for (const assessment of assessments) {
    if (!assessment.product) continue;
    const view = await regionalDemandView(assessment.id, assessment.country_code);
    markets.push({ market_assessment_id: assessment.id, product: assessment.product, rank: assessment.rank, cards: marketSearchCards({ country_code: assessment.country_code, view }) });
  }
  return markets;
}
