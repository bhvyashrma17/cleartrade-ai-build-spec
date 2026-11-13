/**
 * The regional geography registry (D-048, docs/38 §3): for each of the 218 markets, its shape, its
 * centres (hubs), its first-level regions and its gateways. Built from the Natural Earth snapshot by
 * the shape rule (`shape.ts`) and two short hand-kept lists, each entry with its reason:
 *
 * - **Shapes set by hand** where the rule's answer is wrong for buyer search (D-048: Nepal, Egypt,
 *   the Philippines). The top-30 review adds to this list, a source and reason per change.
 * - **Divisions not offered** in any market: territory whose status is disputed. Their places and
 *   gateways are left out before the rule runs, so no hub or search area is ever placed there.
 *
 * Pure: `market-geography.ts` reads the checked-in snapshot through this.
 */
import { createHash } from 'node:crypto';
import { REGIONAL_SHAPE_RULE_VERSION, mergeCentres, ruleShape, type MarketShape } from './shape';
import type { GeographySnapshot, SnapshotMarket } from './snapshot';

export const REGIONAL_GEOGRAPHY_VERSION = 'regional-geography-v1';
export const GEOGRAPHY_SNAPSHOT_PATH = 'src/lib/regional-geography/reference/natural-earth-geography.json';

export interface ShapeOverride {
  iso2: string;
  shape: MarketShape;
  reason: string;
  /** The ledger decision that set it. */
  decided_in: string;
}

/** Shapes set by hand over the rule. Each must differ from what the rule says (the tests check). */
export const SHAPE_OVERRIDES: readonly ShapeOverride[] = [
  {
    iso2: 'EG', shape: 'hub_and_gateway', decided_in: 'D-048',
    reason: 'Greater Cairo and the port of Alexandria are where importers sit; the rule also counts governorate capitals of about 600,000 (Ismailia, Port Said, Luxor, Sohag and others) as centres, which lifts it to regions.',
  },
  {
    iso2: 'NP', shape: 'hub_and_gateway', decided_in: 'D-048',
    reason: 'Kathmandu is the market, and goods from India enter at border customs offices such as Birgunj and Bhairahawa, so its gateways matter as much as its hub; the rule sees one centre.',
  },
  {
    iso2: 'PH', shape: 'hub_and_gateway', decided_in: 'D-048',
    reason: 'Metro Manila is the commercial centre; the rule also counts cities under 1.5 million (Davao, Cagayan de Oro, General Santos, Bacolod, Cebu and others) as centres, which lifts it to regions.',
  },
];

export interface DivisionExclusion {
  /** The division's code as Natural Earth records it (ISO 3166-2). */
  code: string;
  name: string;
  /** The market Natural Earth draws it in. */
  drawn_in: string;
  reason: string;
}

/**
 * Territory no market offers as a region, hub or gateway: the owner's decision of 12 Nov 2026
 * (D-049), over following ISO 3166-2's lists or Natural Earth's drawing.
 */
export const EXCLUDED_DIVISIONS: readonly DivisionExclusion[] = [
  {
    code: 'UA-43', name: 'Crimea', drawn_in: 'RU',
    reason: 'Disputed: Natural Earth draws it in Russia, ISO 3166-2 lists it in Ukraine. Under comprehensive US, EU and UK trade sanctions.',
  },
  {
    code: 'UA-40', name: 'Sevastopol', drawn_in: 'RU',
    reason: 'Disputed: Natural Earth draws it in Russia, ISO 3166-2 lists it in Ukraine. Under comprehensive US, EU and UK trade sanctions.',
  },
  {
    code: 'PK-JK', name: 'Azad Kashmir', drawn_in: 'PK',
    reason: "Disputed: part of Jammu and Kashmir on India's official map; Natural Earth and ISO 3166-2 list it in Pakistan.",
  },
  {
    code: 'PK-GB', name: 'Gilgit-Baltistan', drawn_in: 'PK',
    reason: "Disputed: part of Ladakh on India's official map; Natural Earth and ISO 3166-2 list it in Pakistan.",
  },
];

export interface GeographyPolicy { overrides: readonly ShapeOverride[]; exclusions: readonly DivisionExclusion[] }
export const DEFAULT_GEOGRAPHY_POLICY: GeographyPolicy = { overrides: SHAPE_OVERRIDES, exclusions: EXCLUDED_DIVISIONS };

export interface GeographyCentre {
  name: string;
  /** Places of 300,000 or more within 30 km, counted as part of this centre. */
  merged: string[];
  population: number;
  lat: number;
  lon: number;
  /** Code of the region it sits in, or null where Natural Earth's drawing left it outside every one. */
  region: string | null;
}

export interface GeographyRegion {
  code: string;
  name: string;
  local_name: string | null;
  type: string | null;
  /** False for Natural Earth's own placeholder codes (e.g. `TK-X01~`), which no buyer source uses. */
  iso_code: boolean;
  /** Names of the centres inside it, largest first. */
  hubs: string[];
}

export interface GeographyGateway {
  kind: 'port' | 'airport';
  name: string;
  iata: string | null;
  lat: number;
  lon: number;
  region: string;
  /** Natural Earth's map rank, smaller drawn first. Not a measure of cargo. */
  map_rank: number;
}

export interface MarketGeography {
  iso2: string;
  shape: MarketShape;
  /** What the rule said, kept beside any hand-set shape. */
  rule: { version: string; shape: MarketShape; centres: number; effective_centres: number };
  override: ShapeOverride | null;
  centres: GeographyCentre[];
  regions: GeographyRegion[];
  gateways: GeographyGateway[];
  excluded_divisions: DivisionExclusion[];
}

export type ShapeCounts = Record<MarketShape, number>;

export interface RegionalGeography {
  version: string;
  rule_version: string;
  source: GeographySnapshot['source'];
  universe: GeographySnapshot['universe'];
  /** sha256 over the versions and every market, so a stored view can name the geography it used. */
  checksum: string;
  counts: ShapeCounts;
  rule_counts: ShapeCounts;
  markets: MarketGeography[];
}

const ISO_3166_2 = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildMarketGeography(market: SnapshotMarket, policy: GeographyPolicy = DEFAULT_GEOGRAPHY_POLICY): MarketGeography {
  const excluded = policy.exclusions.filter((exclusion) => market.divisions.some((division) => division.code === exclusion.code));
  const excludedCodes = new Set(excluded.map((exclusion) => exclusion.code));
  const offered = (division: string | null) => division === null || !excludedCodes.has(division);

  const centres = mergeCentres(market.places.filter((place) => offered(place.division)));
  const rule = ruleShape(centres.map((centre) => centre.population));
  const override = policy.overrides.find((entry) => entry.iso2 === market.iso2) ?? null;
  return {
    iso2: market.iso2,
    shape: override?.shape ?? rule.shape,
    rule: { version: REGIONAL_SHAPE_RULE_VERSION, shape: rule.shape, centres: centres.length, effective_centres: round2(rule.effective_centres) },
    override,
    centres: centres.map((centre) => ({
      name: centre.place.name, merged: centre.merged.map((place) => place.name), population: centre.population,
      lat: centre.place.lat, lon: centre.place.lon, region: centre.place.division,
    })),
    regions: market.divisions.filter((division) => !excludedCodes.has(division.code)).map((division) => ({
      ...division,
      iso_code: ISO_3166_2.test(division.code),
      hubs: centres.filter((centre) => centre.place.division === division.code).map((centre) => centre.place.name),
    })),
    gateways: market.gateways.filter((gateway) => offered(gateway.division)).map((gateway) => ({
      kind: gateway.kind, name: gateway.name, iata: gateway.iata, lat: gateway.lat, lon: gateway.lon, region: gateway.division, map_rank: gateway.map_rank,
    })),
    excluded_divisions: excluded,
  };
}

/** Builds the registry. Refuses a policy that names a market or division the snapshot does not hold. */
export function buildRegionalGeography(snapshot: GeographySnapshot, policy: GeographyPolicy = DEFAULT_GEOGRAPHY_POLICY): RegionalGeography {
  const markets = new Set(snapshot.markets.map((market) => market.iso2));
  for (const entry of policy.overrides) if (!markets.has(entry.iso2)) throw new Error(`Shape override for ${entry.iso2}, which is not one of the snapshot's markets.`);
  const divisions = new Set(snapshot.markets.flatMap((market) => market.divisions.map((division) => division.code)));
  for (const entry of policy.exclusions) if (!divisions.has(entry.code)) throw new Error(`Excluded division ${entry.code} is in no market of the snapshot.`);

  const built = snapshot.markets.map((market) => buildMarketGeography(market, policy));
  const count = (pick: (market: MarketGeography) => MarketShape): ShapeCounts => {
    const counts: ShapeCounts = { one_place: 0, hub_and_gateway: 0, regions: 0 };
    for (const market of built) counts[pick(market)] += 1;
    return counts;
  };
  const checksum = createHash('sha256').update(JSON.stringify({ version: REGIONAL_GEOGRAPHY_VERSION, rule: REGIONAL_SHAPE_RULE_VERSION, source: snapshot.source, markets: built })).digest('hex');
  return {
    version: REGIONAL_GEOGRAPHY_VERSION, rule_version: REGIONAL_SHAPE_RULE_VERSION, source: snapshot.source, universe: snapshot.universe,
    checksum, counts: count((market) => market.shape), rule_counts: count((market) => market.rule.shape), markets: built,
  };
}
