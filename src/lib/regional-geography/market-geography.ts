/**
 * The regional geography of every market, read from the checked-in Natural Earth snapshot
 * (D-048, docs/38 §3). Server-side only.
 *
 *   marketGeography('AE') → shape hub and gateway; centres Dubai (with Sharjah) and Abu Dhabi;
 *   its seven emirates as regions; Jebel Ali and Dubai International among its gateways.
 *
 * The snapshot is parsed and checked once per process. A rebuilt snapshot changes
 * GEOGRAPHY_SNAPSHOT_SHA256, which the tests hold to the file's bytes.
 */
import snapshotJson from './reference/natural-earth-geography.json';
import { buildRegionalGeography, type MarketGeography, type RegionalGeography } from './registry';
import { parseGeographySnapshot } from './snapshot';

/** sha256 of `reference/natural-earth-geography.json` as checked in (Natural Earth v5.1.2). */
export const GEOGRAPHY_SNAPSHOT_SHA256 = '8ddfd30752fdebdc2f0845c2bf9b9b4d4a8b15bba98baf4a561c7d12532c3ea4';

let cached: { registry: RegionalGeography; byIso2: Map<string, MarketGeography> } | null = null;

function load() {
  if (!cached) {
    const registry = buildRegionalGeography(parseGeographySnapshot(snapshotJson as unknown));
    cached = { registry, byIso2: new Map(registry.markets.map((market) => [market.iso2, market])) };
  }
  return cached;
}

/** The whole registry: versions, source, shape counts and all 218 markets. */
export function regionalGeography(): RegionalGeography {
  return load().registry;
}

/** One market's geography, or null for a code that is not one of the 218 markets. */
export function marketGeography(iso2: string): MarketGeography | null {
  return load().byIso2.get(iso2.trim().toUpperCase()) ?? null;
}
