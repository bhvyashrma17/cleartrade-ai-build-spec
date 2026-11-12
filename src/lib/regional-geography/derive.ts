/**
 * Builds the geography snapshot from Natural Earth's GeoJSON (D-048, docs/38 §3). Pure: the build
 * script reads the files and writes the result; tests drive it with small shapes.
 *
 * Each item is placed as follows, and nothing is guessed beyond it:
 *
 * - A **division** (Natural Earth admin-1) belongs to the market of its geounit, else of its
 *   country, else of the country its ISO 3166-2 code names. The geounit comes first because a
 *   territory with its own ISO code is its own market (Sint Maarten's division sits in the
 *   Netherlands' list, Martinique's in France's). Divisions are recorded as Natural Earth draws
 *   them; which ones a market may show is decided when the registry is read (`registry.ts`).
 * - Pieces of one market that carry the **same code** are one division, because no buyer source can
 *   tell them apart: a province drawn in two parts, or a city Natural Earth draws apart from the
 *   province ISO counts it in (Cebu City in Cebu, Metro Manila's seventeen cities). The division
 *   takes its largest piece's name, or its ISO 3166-2 name where no piece names the whole
 *   (`MERGED_DIVISION_NAMES`). Every merge is reported, so a wrong code in Natural Earth (Bogotá
 *   under CO-CUN) is visible to the market's review.
 * - A **place, port or airport** belongs to the division that contains it, or failing that the
 *   nearest one within 25 km (a coastal city or harbour drawn just offshore), and so to that
 *   division's market: San Juan sits in Puerto Rico's division, which is the United States', as
 *   Comtrade counts it. A place in no division at all keeps the country Natural Earth records for
 *   it, with no division; a port or airport there is left out. The build reports both, and every
 *   place whose market differs from the country Natural Earth records for it.
 *
 * Only places of 300,000 people or more are kept, ports, and civil airports (Natural Earth's types
 * "major", "mid" and "small", with or without "and military"; military bases and spaceports are not
 * gateways for goods).
 */
import { approximateAreaKm2, boundingBox, distanceToEdgesKm, nearBox, polygonContains, type BoundingBox, type PolygonRings } from './geometry';
import {
  GEOGRAPHY_SNAPSHOT_SCHEMA_VERSION, MINIMUM_PLACE_POPULATION, parseGeographySnapshot,
  type GeographySnapshot, type SnapshotDivision, type SnapshotGateway, type SnapshotPlace,
} from './snapshot';

/** How far outside every division a point may lie and still be placed in the nearest one. */
export const NEAREST_DIVISION_KM = 25;

export const CIVIL_AIRPORT_TYPES: ReadonlySet<string> = new Set(['major', 'mid', 'small', 'major and military', 'mid and military']);

/**
 * ISO 3166-2's names for codes Natural Earth draws in several pieces none of which names the whole:
 * Bosnia's ten cantons are its Federation, Madagascar's 22 regions its six ISO provinces, Dublin's
 * four councils County Dublin, and Metro Manila's cities Natural Earth's own Metro Manila.
 */
export const MERGED_DIVISION_NAMES: Readonly<Record<string, string>> = {
  'BA-BIH': 'Federation of Bosnia and Herzegovina',
  'IE-D': 'Dublin',
  'MG-A': 'Toamasina',
  'MG-D': 'Antsiranana',
  'MG-F': 'Fianarantsoa',
  'MG-M': 'Mahajanga',
  'MG-T': 'Antananarivo',
  'MG-U': 'Toliara',
  'PH-MNL': 'Metro Manila',
};

interface Geometry { type: string; coordinates: unknown }
export interface Feature<P> { properties: P; geometry: Geometry | null }

export interface NePlace { ne_id: number; name: string; latitude: number; longitude: number; pop_max: number; iso_a2: string; adm0_a3: string }
export interface NeDivision { iso_3166_2: string | null; adm1_code: string; name: string | null; name_en: string | null; type_en: string | null; adm0_a3: string; gu_a3: string }
export interface NePort { ne_id: number; name: string | null; scalerank: number }
export interface NeAirport { ne_id: number; name: string | null; iata_code: string | null; type: string | null; scalerank: number }

export interface UniverseMarket { iso2: string; iso3: string }
export interface DeriveInput {
  places: Feature<NePlace>[];
  divisions: Feature<NeDivision>[];
  ports: Feature<NePort>[];
  airports: Feature<NeAirport>[];
  universe: { version: string; checksum: string; markets: UniverseMarket[] };
  source: GeographySnapshot['source'];
}

export interface DeriveReport {
  places_kept: number;
  places_outside_markets: number;
  places_without_division: string[];
  /** `name: recorded → placed` where a place's division puts it in another market than its own record. */
  places_moved: string[];
  divisions_kept: number;
  divisions_outside_markets: number;
  divisions_without_iso_code: string[];
  /** `market code: piece, piece, …` for every code drawn in more than one piece. */
  divisions_merged: string[];
  ports_kept: number;
  airports_kept: number;
  airports_not_civil: number;
  gateways_outside_markets: number;
  gateways_unplaced: string[];
}

interface IndexedDivision { market: string | null; division: SnapshotDivision; polygons: PolygonRings[]; box: BoundingBox }

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();

function polygonsOf(geometry: Geometry | null): PolygonRings[] {
  if (geometry?.type === 'Polygon') return [geometry.coordinates as PolygonRings];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates as PolygonRings[];
  return [];
}

function pointOf(geometry: Geometry | null): { lon: number; lat: number } | null {
  if (geometry?.type !== 'Point') return null;
  const [lon, lat] = geometry.coordinates as [number, number];
  return Number.isFinite(lon) && Number.isFinite(lat) ? { lon, lat } : null;
}

/** The market a Natural Earth division belongs to (see the module comment), or null. */
export function divisionMarket(division: NeDivision, iso2ByIso3: ReadonlyMap<string, string>, markets: ReadonlySet<string>): string | null {
  const byGeounit = iso2ByIso3.get(division.gu_a3);
  if (byGeounit) return byGeounit;
  const byCountry = iso2ByIso3.get(division.adm0_a3);
  if (byCountry) return byCountry;
  const prefix = clean(division.iso_3166_2).slice(0, 2);
  return markets.has(prefix) ? prefix : null;
}

/** The division containing the point, else the nearest within `NEAREST_DIVISION_KM`, else null. */
export function locateDivision(candidates: readonly IndexedDivision[], lon: number, lat: number): IndexedDivision | null {
  for (const candidate of candidates) {
    if (nearBox(candidate.box, lon, lat, 0) && candidate.polygons.some((polygon) => polygonContains(polygon, lon, lat))) return candidate;
  }
  let best: IndexedDivision | null = null;
  let bestDistance = NEAREST_DIVISION_KM;
  for (const candidate of candidates) {
    if (!nearBox(candidate.box, lon, lat, NEAREST_DIVISION_KM)) continue;
    const distance = distanceToEdgesKm(candidate.polygons, lon, lat);
    if (distance <= bestDistance) { best = candidate; bestDistance = distance; }
  }
  return best;
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function deriveGeographySnapshot(input: DeriveInput): { snapshot: GeographySnapshot; report: DeriveReport } {
  const markets = new Set(input.universe.markets.map((market) => market.iso2));
  const iso2ByIso3 = new Map(input.universe.markets.map((market) => [market.iso3, market.iso2]));
  const report: DeriveReport = {
    places_kept: 0, places_outside_markets: 0, places_without_division: [], places_moved: [], divisions_kept: 0, divisions_outside_markets: 0,
    divisions_without_iso_code: [], divisions_merged: [], ports_kept: 0, airports_kept: 0, airports_not_civil: 0, gateways_outside_markets: 0, gateways_unplaced: [],
  };

  // Divisions, indexed by market. Sorted first so that overlapping drawings resolve the same way every run.
  // Every division is indexed, a market's or not, so that a port in India or Taiwan is known to lie
  // outside the 218 rather than reported as lying nowhere.
  const pieces = new Map<string, { market: string | null; code: string; name: string; local_name: string | null; type: string | null; polygons: PolygonRings[]; area: number }[]>();
  const divisionFeatures = [...input.divisions].sort((a, b) => byText(a.properties.adm1_code, b.properties.adm1_code));
  for (const feature of divisionFeatures) {
    const p = feature.properties;
    const market = divisionMarket(p, iso2ByIso3, markets);
    const code = clean(p.iso_3166_2) || clean(p.adm1_code);
    const name = clean(p.name_en) || clean(p.name) || code;
    const own = clean(p.name);
    const polygons = polygonsOf(feature.geometry);
    if (!polygons.length) throw new Error(`Division ${code} has no polygon.`);
    const key = `${market ?? '-'} ${code}`;
    pieces.set(key, [...(pieces.get(key) ?? []), { market, code, name, local_name: own && own !== name ? own : null, type: clean(p.type_en) || null, polygons, area: approximateAreaKm2(polygons) }]);
  }
  const indexed: IndexedDivision[] = [];
  for (const group of pieces.values()) {
    const largest = [...group].sort((a, b) => b.area - a.area)[0];
    const fixed = MERGED_DIVISION_NAMES[largest.code];
    const polygons = group.flatMap((piece) => piece.polygons);
    indexed.push({
      market: largest.market,
      division: { code: largest.code, name: fixed ?? largest.name, local_name: fixed ? null : largest.local_name, type: largest.type },
      polygons, box: boundingBox(polygons),
    });
    if (!largest.market) { report.divisions_outside_markets += 1; continue; }
    if (group.length > 1) report.divisions_merged.push(`${largest.market} ${largest.code}: ${group.map((piece) => piece.name).sort(byText).join(', ')}`);
    if (!/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(largest.code)) report.divisions_without_iso_code.push(`${largest.market} ${largest.code} ${largest.name}`);
    report.divisions_kept += 1;
  }
  const byMarket = new Map<string, IndexedDivision[]>();
  for (const division of indexed) if (division.market) byMarket.set(division.market, [...(byMarket.get(division.market) ?? []), division]);

  const places = new Map<string, SnapshotPlace[]>();
  for (const feature of input.places) {
    const p = feature.properties;
    if (!(p.pop_max >= MINIMUM_PLACE_POPULATION)) continue;
    const recorded = markets.has(p.iso_a2) ? p.iso_a2 : iso2ByIso3.get(p.adm0_a3) ?? null;
    const located = locateDivision(indexed, p.longitude, p.latitude);
    const market = located ? located.market : recorded;
    if (located && market !== recorded) report.places_moved.push(`${clean(p.name)}: ${recorded ?? 'none'} → ${market ?? 'none'}`);
    if (!market) { report.places_outside_markets += 1; continue; }
    if (!located) report.places_without_division.push(`${market} ${p.name}`);
    places.set(market, [...(places.get(market) ?? []), {
      ne_id: p.ne_id, name: clean(p.name), lat: round4(p.latitude), lon: round4(p.longitude), population: Math.round(p.pop_max), division: located?.division.code ?? null,
    }]);
    report.places_kept += 1;
  }

  const gateways = new Map<string, SnapshotGateway[]>();
  const placeGateway = (kind: SnapshotGateway['kind'], feature: Feature<NePort | NeAirport>, iata: string | null) => {
    const point = pointOf(feature.geometry);
    const name = clean(feature.properties.name);
    if (!point || !name) { report.gateways_unplaced.push(`${kind} ${feature.properties.ne_id} (no point or name)`); return false; }
    const located = locateDivision(indexed, point.lon, point.lat);
    if (!located) { report.gateways_unplaced.push(`${kind} ${name} (${round4(point.lat)}, ${round4(point.lon)})`); return false; }
    if (!located.market) { report.gateways_outside_markets += 1; return false; }
    gateways.set(located.market, [...(gateways.get(located.market) ?? []), {
      ne_id: feature.properties.ne_id, kind, name, iata, lat: round4(point.lat), lon: round4(point.lon), division: located.division.code, map_rank: Math.round(feature.properties.scalerank),
    }]);
    return true;
  };
  for (const feature of input.ports) if (placeGateway('port', feature, null)) report.ports_kept += 1;
  for (const feature of input.airports) {
    if (!CIVIL_AIRPORT_TYPES.has(clean(feature.properties.type))) { report.airports_not_civil += 1; continue; }
    const iata = clean(feature.properties.iata_code).toUpperCase();
    if (placeGateway('airport', feature, /^[A-Z0-9]{3}$/.test(iata) ? iata : null)) report.airports_kept += 1;
  }

  const snapshot = parseGeographySnapshot({
    schema_version: GEOGRAPHY_SNAPSHOT_SCHEMA_VERSION,
    source: input.source,
    universe: { version: input.universe.version, checksum: input.universe.checksum, size: markets.size },
    minimum_place_population: MINIMUM_PLACE_POPULATION,
    markets: [...markets].sort(byText).map((iso2) => ({
      iso2,
      places: (places.get(iso2) ?? []).sort((a, b) => b.population - a.population || byText(a.name, b.name) || a.ne_id - b.ne_id),
      divisions: (byMarket.get(iso2) ?? []).map((entry) => entry.division).sort((a, b) => byText(a.code, b.code)),
      gateways: (gateways.get(iso2) ?? []).sort((a, b) => byText(a.kind, b.kind) || a.map_rank - b.map_rank || byText(a.name, b.name) || a.ne_id - b.ne_id),
    })),
  });
  report.places_without_division.sort(byText);
  report.places_moved.sort(byText);
  report.divisions_without_iso_code.sort(byText);
  report.divisions_merged.sort(byText);
  report.gateways_unplaced.sort(byText);
  return { snapshot, report };
}
