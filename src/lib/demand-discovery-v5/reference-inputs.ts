/**
 * ECGC ratings and capital coordinates in the engine's shapes (docs/36 §4, metrics 8 and 10).
 *
 * Both are keyed by ISO alpha-2. Trade in BACI also flows under provider identities the archive's
 * country file gives no ISO code (`cepii_baci:490`, "Other Asia, nes"); for the distance fit such a
 * supplier is placed on the map only where CEPII itself documents what the code is.
 */
import type { CapitalRow } from '@/lib/reference-datasets/geodist';
import type { EcgcRatingRow } from '@/lib/reference-datasets/ecgc';
import { baciProviderIdentity } from './baci-flows';
import type { EcgcRating } from './metrics';

/**
 * BACI codes without an ISO identity whose geography CEPII documents: 490 is Taiwan (BACI's
 * description). Used only when GeoDist — also CEPII — numbers Taiwan 490 too, so the two sources
 * have to agree before any trade is placed.
 */
export const BACI_PROVIDER_GEOGRAPHY: Readonly<Record<string, string>> = { '490': 'TW' };

/** `list` is the ECGC release's version, e.g. "ECGC short-term list w.e.f. 2026-07-01", kept with each grade (item 8). */
export function ecgcInputs(rows: readonly EcgcRatingRow[], list: string | null = null): Map<string, EcgcRating> {
  return new Map(rows.map((row) => [row.iso2, { grade: row.grade, cover: row.cover, ...(list ? { list } : {}) }]));
}

export interface CoordinateInputs {
  map: Map<string, { lat: number; lon: number }>;
  /** Provider identities placed through BACI_PROVIDER_GEOGRAPHY. */
  provider_links: { identity: string; iso2: string; city: string }[];
  /** Provider codes left off the map: their share of supply counts as without coordinates. */
  unplaced_provider_codes: string[];
}

export function coordinateInputs(args: { capitals: readonly CapitalRow[]; provider_codes_without_iso: readonly string[]; supplement?: readonly { iso2: string; lat: number; lon: number }[] }): CoordinateInputs {
  const map = new Map<string, { lat: number; lon: number }>(args.capitals.map((row) => [row.iso2, { lat: row.lat, lon: row.lon }]));
  // Curated capitals fill only markets GeoDist has no row for; GeoDist's own row always wins.
  for (const row of args.supplement ?? []) if (!map.has(row.iso2)) map.set(row.iso2, { lat: row.lat, lon: row.lon });
  const byIso2 = new Map(args.capitals.map((row) => [row.iso2, row]));
  const links: CoordinateInputs['provider_links'] = [];
  const unplaced: string[] = [];
  for (const code of [...new Set(args.provider_codes_without_iso)].sort((a, b) => Number(a) - Number(b))) {
    const iso2 = BACI_PROVIDER_GEOGRAPHY[code];
    const row = iso2 ? byIso2.get(iso2) : undefined;
    if (!iso2 || !row || row.cnum !== code) { unplaced.push(code); continue; }
    const identity = baciProviderIdentity(code);
    map.set(identity, { lat: row.lat, lon: row.lon });
    links.push({ identity, iso2, city: row.city });
  }
  return { map, provider_links: links, unplaced_provider_codes: unplaced };
}
