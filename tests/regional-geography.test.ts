import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { buildCountryScreeningUniverse } from '../src/lib/country-screening/universe';
import { deriveGeographySnapshot, divisionMarket, type Feature, type NeAirport, type NeDivision, type NePlace, type NePort } from '../src/lib/regional-geography/derive';
import { GEOGRAPHY_SNAPSHOT_SHA256, marketGeography, regionalGeography } from '../src/lib/regional-geography/market-geography';
import { EXCLUDED_DIVISIONS, GEOGRAPHY_SNAPSHOT_PATH, SHAPE_OVERRIDES, buildRegionalGeography } from '../src/lib/regional-geography/registry';
import { effectiveCentres, mergeCentres, ruleShape, type MarketShape } from '../src/lib/regional-geography/shape';
import { parseGeographySnapshot, serializeGeographySnapshot, type GeographySnapshot } from '../src/lib/regional-geography/snapshot';
import { NATURAL_EARTH_COMMIT, NATURAL_EARTH_FILES } from '../src/lib/regional-geography/source';

/** Regional geography registry (D-048, docs/38 §3): Natural Earth snapshot, shape rule, hand-kept lists. */
const text = readFileSync(join(__dirname, '..', GEOGRAPHY_SNAPSHOT_PATH), 'utf8');
const snapshot = parseGeographySnapshot(JSON.parse(text));

const defaultUniverse = () => {
  const policy = CONFIG_DEFAULTS['country_screening.policy'];
  return buildCountryScreeningUniverse({
    universe_version: policy.universe_version, reporter_identity_strategy: policy.reporter_identity_strategy, reporter_registry_version: policy.reporter_registry_version,
    excluded_iso2_codes: policy.excluded_iso2_codes, exclude_origin_country: policy.exclude_origin_country, origin_country_iso2: policy.origin_country_iso2,
  });
};

/** 1° of latitude on the registry's sphere, km. */
const KM_PER_DEGREE = (Math.PI / 180) * 6371.0088;
const place = (name: string, population: number, kmNorth: number, ne_id = population) => ({ ne_id, name, population, lat: kmNorth / KM_PER_DEGREE, lon: 0 });

describe('the checked-in Natural Earth snapshot', () => {
  test('is exactly what the build writes, from the pinned Natural Earth v5.1.2 files', () => {
    expect(createHash('sha256').update(text).digest('hex')).toBe(GEOGRAPHY_SNAPSHOT_SHA256);
    // Canonical form: a hand edit, or a file from another serializer, fails here.
    expect(serializeGeographySnapshot(snapshot)).toBe(text);
    expect(snapshot.source).toMatchObject({ provider: 'Natural Earth', release: 'v5.1.2', commit: NATURAL_EARTH_COMMIT });
    expect(snapshot.source.layers).toEqual(NATURAL_EARTH_FILES.map((file) => ({ layer: file.layer, sha256: file.sha256, bytes: file.bytes })));
  });

  test('covers exactly the 218 markets of the default screening universe', () => {
    const universe = defaultUniverse();
    expect(snapshot.universe).toEqual({ version: universe.version, checksum: universe.checksum, size: 218 });
    expect(snapshot.markets.map((market) => market.iso2)).toEqual(universe.entries.map((entry) => entry.iso2).sort());
  });

  test('places every kept place in a division of its own market, and keeps only places of 300,000 or more', () => {
    const places = snapshot.markets.flatMap((market) => market.places);
    expect(places.length).toBe(1362);
    expect(places.every((item) => item.division !== null && item.population >= 300_000)).toBe(true);
    expect(snapshot.markets.flatMap((market) => market.gateways).length).toBe(1054 + 820);
  });

  test('refuses a file whose items name a division the market does not list, or that repeats a division', () => {
    const body = JSON.parse(text) as { markets: { iso2: string; places: { division: string | null }[]; divisions: { code: string }[] }[] };
    const ae = body.markets.find((market) => market.iso2 === 'AE')!;
    ae.places[0].division = 'AE-ZZ';
    expect(() => parseGeographySnapshot(body)).toThrow(/AE: Dubai names division AE-ZZ/);
    ae.places[0].division = 'AE-DU';
    ae.divisions.push({ ...ae.divisions[0] });
    expect(() => parseGeographySnapshot(body)).toThrow(/AE lists division AE-AJ twice/);
  });
});

describe('the shape rule', () => {
  test('merges smaller places within 30 km into the largest, never by chaining, and at 30 km but not beyond', () => {
    const centres = mergeCentres([place('Small', 400_000, 50), place('Big', 1_000_000, 0), place('Middle', 500_000, 25)]);
    expect(centres.map((centre) => [centre.place.name, centre.merged.map((item) => item.name), centre.population])).toEqual([['Big', ['Middle'], 1_000_000], ['Small', [], 400_000]]);
    expect(mergeCentres([place('A', 900_000, 0), place('B', 300_000, 29.99)])).toHaveLength(1);
    expect(mergeCentres([place('A', 900_000, 0), place('B', 300_000, 30.01)])).toHaveLength(2);
  });

  test('counts effective centres as 1 / Σ share²: equal centres count fully, a dominant one counts once', () => {
    expect(effectiveCentres([5, 5, 5])).toBeCloseTo(3, 12);
    expect(effectiveCentres([2, 1])).toBeCloseTo(1.8, 12);
    expect(effectiveCentres([7])).toBe(1);
    expect(effectiveCentres([])).toBe(0);
  });

  test('none or one centre is one place; 3 effective centres or more is regions; fewer is hub and gateway', () => {
    const shape = (sizes: number[]): MarketShape => ruleShape(sizes).shape;
    expect([shape([]), shape([9]), shape([1, 1]), shape([2, 1]), shape([1, 1, 1]), shape([10, 1, 1, 1])]).toEqual(['one_place', 'one_place', 'hub_and_gateway', 'hub_and_gateway', 'regions', 'hub_and_gateway']);
  });
});

describe('the registry on Natural Earth v5.1.2', () => {
  const registry = regionalGeography();
  const shapesAt = (radiusKm: number) => new Map(snapshot.markets.map((market) => {
    const built = registry.markets.find((entry) => entry.iso2 === market.iso2)!;
    const offered = market.places.filter((item) => !built.excluded_divisions.some((exclusion) => exclusion.code === item.division));
    return [market.iso2, ruleShape(mergeCentres(offered, radiusKm).map((centre) => centre.population)).shape];
  }));

  test('divides the 218 markets as approved: 127 one place, 51 hub and gateway, 40 regions (the rule alone: 128, 48, 42)', () => {
    expect(registry.markets).toHaveLength(218);
    expect(registry.counts).toEqual({ one_place: 127, hub_and_gateway: 51, regions: 40 });
    expect(registry.rule_counts).toEqual({ one_place: 128, hub_and_gateway: 48, regions: 42 });
    expect(registry).toMatchObject({ version: 'regional-geography-v1', rule_version: 'regional-shape-rule-v1' });
    expect(registry.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  test('is stable at other merge distances: 20 km moves only the UAE, 50 km Belgium, the Netherlands and North Korea', () => {
    const at30 = shapesAt(30);
    const moved = (radiusKm: number) => [...shapesAt(radiusKm)].filter(([iso2, shape]) => shape !== at30.get(iso2)).map(([iso2]) => iso2).sort();
    expect(moved(20)).toEqual(['AE']);
    expect(moved(50)).toEqual(['BE', 'KP', 'NL']);
  });

  test("keeps the rule's answer beside each hand-set shape, and each hand-set shape changes it", () => {
    expect(SHAPE_OVERRIDES.map((entry) => entry.iso2)).toEqual(['EG', 'NP', 'PH']);
    for (const entry of SHAPE_OVERRIDES) {
      const market = marketGeography(entry.iso2)!;
      expect(market.shape).toBe(entry.shape);
      expect(market.override).toEqual(entry);
      expect(market.rule.shape).not.toBe(entry.shape);
      expect(entry.reason.length).toBeGreaterThan(40);
      expect(entry.decided_in).toBe('D-048');
    }
    expect([marketGeography('NP')!.rule, marketGeography('EG')!.rule, marketGeography('PH')!.rule].map((rule) => [rule.shape, rule.centres, rule.effective_centres])).toEqual([
      ['one_place', 1, 1], ['regions', 17, 3.32], ['regions', 15, 3.21],
    ]);
    expect(registry.markets.filter((market) => market.override === null).every((market) => market.shape === market.rule.shape)).toBe(true);
  });

  test('the UAE: Dubai with Sharjah, and Abu Dhabi, each in its emirate, with its ports and airports', () => {
    const ae = marketGeography('ae')!;
    expect(ae).toBe(marketGeography('AE'));
    expect(ae.shape).toBe('hub_and_gateway');
    expect(ae.centres.slice(0, 2).map((centre) => [centre.name, centre.merged, centre.region])).toEqual([['Dubai', ['Sharjah'], 'AE-DU'], ['Abu Dhabi', [], 'AE-AZ']]);
    expect(ae.regions.find((region) => region.code === 'AE-AZ')).toMatchObject({ name: 'Emirate of Abu Dhabi', iso_code: true, hubs: ['Abu Dhabi', 'Al Ayn'] });
    expect(ae.gateways.filter((gateway) => gateway.kind === 'airport').map((gateway) => gateway.iata)).toEqual(expect.arrayContaining(['DXB', 'SHJ', 'AUH']));
    expect(ae.gateways.every((gateway) => ae.regions.some((region) => region.code === gateway.region))).toBe(true);
  });

  test('the United States: 112 centres across its 50 states, DC and Puerto Rico, which Comtrade counts as the US', () => {
    const us = marketGeography('US')!;
    expect([us.shape, us.rule.centres, us.regions.length]).toEqual(['regions', 112, 52]);
    expect(us.centres.slice(0, 2).map((centre) => [centre.name, centre.merged])).toEqual([['New York', []], ['Los Angeles', ['Long Beach']]]);
    expect(us.centres.every((centre) => centre.region !== null && us.regions.some((region) => region.code === centre.region))).toBe(true);
    expect(us.regions.find((region) => region.code === 'US-PR')).toMatchObject({ name: 'Puerto Rico', hubs: ['San Juan'] });
  });

  test('offers no region, hub or gateway in disputed territory, though the snapshot still records it', () => {
    expect(EXCLUDED_DIVISIONS.map((entry) => entry.code)).toEqual(['UA-43', 'UA-40', 'PK-JK', 'PK-GB']);
    const russia = marketGeography('RU')!;
    expect(russia.excluded_divisions.map((entry) => entry.code)).toEqual(['UA-43', 'UA-40']);
    expect(russia.rule.centres).toBe(66);
    expect(russia.centres.map((centre) => centre.name)).not.toEqual(expect.arrayContaining(['Sevastopol']));
    expect(russia.centres.map((centre) => centre.name)).not.toEqual(expect.arrayContaining(['Simferopol']));
    expect(marketGeography('PK')!.excluded_divisions.map((entry) => entry.code)).toEqual(['PK-JK', 'PK-GB']);
    const codes = new Set(EXCLUDED_DIVISIONS.map((entry) => entry.code));
    for (const market of registry.markets) {
      expect(market.regions.some((region) => codes.has(region.code))).toBe(false);
      expect(market.gateways.some((gateway) => codes.has(gateway.region))).toBe(false);
      expect(market.centres.some((centre) => centre.region !== null && codes.has(centre.region))).toBe(false);
    }
    const drawn = snapshot.markets.find((market) => market.iso2 === 'RU')!;
    expect(drawn.places.filter((item) => item.division === 'UA-40' || item.division === 'UA-43').map((item) => item.name).sort()).toEqual(['Sevastopol', 'Simferopol']);
  });

  test('refuses a hand-kept entry for a market or division the snapshot does not hold', () => {
    expect(() => buildRegionalGeography(snapshot, { overrides: [{ iso2: 'IN', shape: 'regions', reason: 'x', decided_in: 'D-0' }], exclusions: [] })).toThrow(/IN, which is not one of the snapshot's markets/);
    expect(() => buildRegionalGeography(snapshot, { overrides: [], exclusions: [{ code: 'XX-1', name: 'x', drawn_in: 'XX', reason: 'x' }] })).toThrow(/XX-1 is in no market/);
  });

  test('answers null for a code that is not one of the 218 markets', () => {
    expect(marketGeography('IN')).toBeNull();
    expect(marketGeography('ZZ')).toBeNull();
  });
});

describe('the build from Natural Earth', () => {
  const universe = new Map([['AAA', 'AA'], ['BBB', 'BB'], ['SXM', 'SX']]);
  const markets = new Set(universe.values());
  const division = (iso: string | null, adm0: string, gu = adm0, adm1 = `${adm0}-${iso}`): NeDivision => ({ iso_3166_2: iso, adm1_code: adm1, name: iso, name_en: iso, type_en: 'Province', adm0_a3: adm0, gu_a3: gu });

  test("places a division in its geounit's market, else its country's, else the one its ISO code names", () => {
    expect(divisionMarket(division('NL-SX', 'SXM'), universe, markets)).toBe('SX');
    expect(divisionMarket(division('AA-9', 'AAA', 'ZZZ'), universe, markets)).toBe('AA');
    expect(divisionMarket(division('BB-1', 'SOL'), universe, markets)).toBe('BB');
    expect(divisionMarket(division('XK-1', 'KOS'), universe, markets)).toBeNull();
  });

  test('merges pieces that share a code, locates places and gateways, and reports what it could not place', () => {
    // Squares one degree wide on the equator: AA-1 drawn in two pieces, AA-2 between them, BB-1 far
    // east, and CC-1, which belongs to no market.
    const square = (west: number): Feature<never>['geometry'] => ({ type: 'Polygon', coordinates: [[[west, 0], [west + 1, 0], [west + 1, 1], [west, 1], [west, 0]]] });
    const divisions: Feature<NeDivision>[] = [
      { properties: { ...division('AA-1', 'AAA'), adm1_code: 'A1a', name_en: 'Big Piece' }, geometry: { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]]] } },
      { properties: { ...division('AA-1', 'AAA'), adm1_code: 'A1b', name_en: 'Small Piece' }, geometry: { type: 'Polygon', coordinates: [[[2, 0], [2.5, 0], [2.5, 0.5], [2, 0.5], [2, 0]]] } },
      { properties: division('AA-2', 'AAA'), geometry: square(1) },
      { properties: division('BB-1', 'BBB'), geometry: square(10) },
      { properties: division('CC-1', 'CCC'), geometry: square(20) },
    ];
    const at = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });
    const places: Feature<NePlace>[] = [
      { properties: { ne_id: 1, name: 'In Small Piece', latitude: 0.25, longitude: 2.25, pop_max: 500_000, iso_a2: 'AA', adm0_a3: 'AAA' }, geometry: at(2.25, 0.25) },
      { properties: { ne_id: 2, name: 'Just Offshore', latitude: 0.5, longitude: -0.1, pop_max: 400_000, iso_a2: '-99', adm0_a3: 'AAA' }, geometry: at(-0.1, 0.5) },
      { properties: { ne_id: 3, name: 'Far Offshore', latitude: 0.5, longitude: -1, pop_max: 400_000, iso_a2: 'AA', adm0_a3: 'AAA' }, geometry: at(-1, 0.5) },
      { properties: { ne_id: 4, name: 'Too Small', latitude: 0.5, longitude: 1.5, pop_max: 299_999, iso_a2: 'AA', adm0_a3: 'AAA' }, geometry: at(1.5, 0.5) },
      { properties: { ne_id: 5, name: 'No Market', latitude: 0.5, longitude: 20.5, pop_max: 900_000, iso_a2: 'CC', adm0_a3: 'CCC' }, geometry: at(20.5, 0.5) },
      // Recorded under BB, drawn inside AA-2: the division decides, as it does for San Juan.
      { properties: { ne_id: 6, name: 'Moved Town', latitude: 0.6, longitude: 1.6, pop_max: 350_000, iso_a2: 'BB', adm0_a3: 'BBB' }, geometry: at(1.6, 0.6) },
    ];
    const ports: Feature<NePort>[] = [
      { properties: { ne_id: 11, name: 'Port of AA', scalerank: 4 }, geometry: at(1.5, 0.5) },
      { properties: { ne_id: 12, name: 'Port of CC', scalerank: 4 }, geometry: at(20.5, 0.5) },
      { properties: { ne_id: 13, name: 'Mid-Ocean', scalerank: 8 }, geometry: at(5, 5) },
    ];
    const airports: Feature<NeAirport>[] = [
      { properties: { ne_id: 21, name: 'BB Intl', iata_code: 'bbx ', type: 'major', scalerank: 2 }, geometry: at(10.5, 0.5) },
      { properties: { ne_id: 22, name: 'BB Air Base', iata_code: '', type: 'military major', scalerank: 3 }, geometry: at(10.4, 0.4) },
    ];
    const source: GeographySnapshot['source'] = { provider: 'Natural Earth', release: 'test', commit: '0'.repeat(40), layers: NATURAL_EARTH_FILES.map((file) => ({ layer: file.layer, sha256: '0'.repeat(64), bytes: 1 })) };
    const { snapshot: built, report } = deriveGeographySnapshot({
      places, divisions, ports, airports, source,
      universe: { version: 'test-universe', checksum: 'f'.repeat(16), markets: [...universe].map(([iso3, iso2]) => ({ iso2, iso3 })) },
    });
    const aa = built.markets.find((market) => market.iso2 === 'AA')!;
    expect(aa.divisions).toEqual([{ code: 'AA-1', name: 'Big Piece', local_name: 'AA-1', type: 'Province' }, { code: 'AA-2', name: 'AA-2', local_name: null, type: 'Province' }]);
    expect(aa.places.map((item) => [item.name, item.division])).toEqual([['In Small Piece', 'AA-1'], ['Far Offshore', null], ['Just Offshore', 'AA-1'], ['Moved Town', 'AA-2']]);
    expect(aa.gateways.map((gateway) => [gateway.name, gateway.division])).toEqual([['Port of AA', 'AA-2']]);
    expect(built.markets.find((market) => market.iso2 === 'BB')!.gateways).toMatchObject([{ kind: 'airport', name: 'BB Intl', iata: 'BBX', division: 'BB-1', map_rank: 2 }]);
    expect(report).toMatchObject({
      places_kept: 4, places_outside_markets: 1, places_without_division: ['AA Far Offshore'], places_moved: ['Moved Town: BB → AA'], divisions_kept: 3, divisions_outside_markets: 1,
      divisions_merged: ['AA AA-1: Big Piece, Small Piece'], ports_kept: 1, airports_kept: 1, airports_not_civil: 1, gateways_outside_markets: 1,
    });
    expect(report.gateways_unplaced).toEqual(['port Mid-Ocean (5, 5)']);
  });
});
