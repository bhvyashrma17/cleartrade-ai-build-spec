/**
 * Writes the regional geography snapshot from Natural Earth (D-048, docs/38 §3):
 * src/lib/regional-geography/reference/natural-earth-geography.json.
 *
 * Download the four GeoJSON files named in src/lib/regional-geography/source.ts (their URLs pin
 * Natural Earth's v5.1.2 commit) into one folder, then:
 *
 *   npx tsx scripts/build-regional-geography.ts --source-dir=/path/to/natural-earth
 *
 * No database and no network. Each file's size and sha256 must equal the pinned ones, or nothing is
 * written. The 218 markets are the screening universe of the default policy. Rebuilding from the same
 * files writes the same bytes. Afterwards, set GEOGRAPHY_SNAPSHOT_SHA256 in market-geography.ts to the
 * printed sha256; the tests fail until it matches.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CONFIG_DEFAULTS } from '@/lib/config';
import { buildCountryScreeningUniverse } from '@/lib/country-screening/universe';
import { deriveGeographySnapshot, type Feature } from '@/lib/regional-geography/derive';
import { GEOGRAPHY_SNAPSHOT_PATH, buildRegionalGeography } from '@/lib/regional-geography/registry';
import { serializeGeographySnapshot } from '@/lib/regional-geography/snapshot';
import { NATURAL_EARTH_COMMIT, NATURAL_EARTH_FILES, NATURAL_EARTH_RELEASE, type NaturalEarthLayer } from '@/lib/regional-geography/source';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim() || undefined;

function readLayer(directory: string, layer: NaturalEarthLayer): { features: Feature<never>[]; sha256: string; bytes: number } {
  const pinned = NATURAL_EARTH_FILES.find((entry) => entry.layer === layer);
  if (!pinned) throw new Error(`No pinned file for ${layer}.`);
  const bytes = readFileSync(join(directory, pinned.file));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length !== pinned.bytes || sha256 !== pinned.sha256) {
    throw new Error(`${pinned.file} is ${bytes.length} bytes with sha256 ${sha256}; the pinned file is ${pinned.bytes} bytes with ${pinned.sha256} (${pinned.url}).`);
  }
  const body = JSON.parse(bytes.toString('utf8')) as { type?: string; features?: Feature<never>[] };
  if (body.type !== 'FeatureCollection' || !Array.isArray(body.features)) throw new Error(`${pinned.file} is not a GeoJSON FeatureCollection.`);
  return { features: body.features, sha256, bytes: bytes.length };
}

function main() {
  const directory = arg('source-dir');
  if (!directory) throw new Error('Missing --source-dir=... (the folder holding the four Natural Earth GeoJSON files).');
  const policy = CONFIG_DEFAULTS['country_screening.policy'];
  const universe = buildCountryScreeningUniverse({
    universe_version: policy.universe_version, reporter_identity_strategy: policy.reporter_identity_strategy, reporter_registry_version: policy.reporter_registry_version,
    excluded_iso2_codes: policy.excluded_iso2_codes, exclude_origin_country: policy.exclude_origin_country, origin_country_iso2: policy.origin_country_iso2,
  });
  const layers = Object.fromEntries((['populated_places_simple', 'admin_1_states_provinces', 'ports', 'airports'] as const).map((layer) => [layer, readLayer(resolve(directory), layer)]));
  const { snapshot, report } = deriveGeographySnapshot({
    places: layers.populated_places_simple.features,
    divisions: layers.admin_1_states_provinces.features,
    ports: layers.ports.features,
    airports: layers.airports.features,
    universe: { version: universe.version, checksum: universe.checksum, markets: universe.entries.map((entry) => ({ iso2: entry.iso2, iso3: entry.iso3 })) },
    source: {
      provider: 'Natural Earth', release: NATURAL_EARTH_RELEASE, commit: NATURAL_EARTH_COMMIT,
      layers: NATURAL_EARTH_FILES.map((file) => ({ layer: file.layer, sha256: layers[file.layer].sha256, bytes: layers[file.layer].bytes })),
    },
  });
  const text = serializeGeographySnapshot(snapshot);
  writeFileSync(resolve(GEOGRAPHY_SNAPSHOT_PATH), text);
  const registry = buildRegionalGeography(snapshot);
  console.log(JSON.stringify({
    written: GEOGRAPHY_SNAPSHOT_PATH,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text),
    markets: snapshot.markets.length,
    shapes: registry.counts,
    rule_shapes: registry.rule_counts,
    report: { ...report, places_without_division: report.places_without_division, gateways_unplaced: report.gateways_unplaced },
  }, null, 2));
}

main();
