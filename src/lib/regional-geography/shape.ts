/**
 * The shape rule (D-048, docs/38 §3): how a market is divided, from how its cities are spread.
 *
 * 1. **Centres.** Places of 300,000 people or more, taken largest first; each one not yet merged
 *    starts a centre and takes in every smaller one within 30 km of it ("Dubai with Sharjah"). A
 *    centre's size is its largest place's.
 * 2. **Shape.** No centre or one → **one place**. Otherwise the effective number of centres,
 *    1 / Σ sᵢ² over the centres' shares sᵢ of their combined size, decides: 3 or more →
 *    **regions**; fewer → **hub and gateway** (one or two cities dominate).
 *
 * On Natural Earth 5.1.2 this gives one place 128, hub and gateway 48, regions 42; with the three
 * shapes set by hand (Nepal, Egypt, the Philippines) 127, 51 and 40, as approved. Merging at 20 km
 * instead moves the UAE; at 50 km Belgium, the Netherlands and North Korea.
 */
import { distanceKm } from './geometry';

export const REGIONAL_SHAPE_RULE_VERSION = 'regional-shape-rule-v1';
export const CENTRE_MERGE_KM = 30;
export const REGIONS_MIN_EFFECTIVE_CENTRES = 3;

export type MarketShape = 'one_place' | 'hub_and_gateway' | 'regions';

export interface RulePlace { ne_id: number; name: string; lat: number; lon: number; population: number }
export interface Centre<P extends RulePlace> { place: P; merged: P[]; population: number }

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Merges places into centres, largest first (see the module comment). Deterministic for ties. */
export function mergeCentres<P extends RulePlace>(places: readonly P[], radiusKm = CENTRE_MERGE_KM): Centre<P>[] {
  const ordered = [...places].sort((a, b) => b.population - a.population || byText(a.name, b.name) || a.ne_id - b.ne_id);
  const taken = new Array<boolean>(ordered.length).fill(false);
  const centres: Centre<P>[] = [];
  for (let i = 0; i < ordered.length; i++) {
    if (taken[i]) continue;
    taken[i] = true;
    const place = ordered[i];
    const merged: P[] = [];
    for (let j = i + 1; j < ordered.length; j++) {
      if (taken[j] || distanceKm(place.lat, place.lon, ordered[j].lat, ordered[j].lon) > radiusKm) continue;
      taken[j] = true;
      merged.push(ordered[j]);
    }
    centres.push({ place, merged, population: place.population });
  }
  return centres;
}

/** 1 / Σ sᵢ²: equals n when n centres are the same size, and nears 1 when one dominates. */
export function effectiveCentres(sizes: readonly number[]): number {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (!(total > 0)) return 0;
  return 1 / sizes.reduce((sum, size) => sum + (size / total) ** 2, 0);
}

export function ruleShape(sizes: readonly number[]): { shape: MarketShape; effective_centres: number } {
  const effective = effectiveCentres(sizes);
  if (sizes.length <= 1) return { shape: 'one_place', effective_centres: effective };
  return { shape: effective >= REGIONS_MIN_EFFECTIVE_CENTRES ? 'regions' : 'hub_and_gateway', effective_centres: effective };
}
