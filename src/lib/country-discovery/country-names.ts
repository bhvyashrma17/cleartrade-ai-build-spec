/**
 * Country identity for the product surface.
 *
 * The pilot carried a three-entry `COUNTRY_NAMES` table (DE/AE/US) and anything outside it
 * rendered as a bare ISO code. Phase 1F/1G screen the whole world, so the name has to come
 * from the same checked-in provider reference the screening run resolved its reporters
 * through — otherwise the UI would name a market differently from the evidence beneath it.
 *
 * Falling back to the ISO code is deliberate: an unrecognised code is shown as itself rather
 * than as a guessed name.
 */
import { comtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';

let cached: Map<string, string> | null = null;

function table(): Map<string, string> {
  if (cached) return cached;
  const map = new Map<string, string>();
  for (const reporter of comtradeReporterRegistry().reporters) {
    // The registry is ordered by numeric reporter code; the first live entry for an ISO2 wins,
    // which is the same identity `country-truth-deep-request` binds a shortlist to.
    if (!map.has(reporter.iso2)) map.set(reporter.iso2, reporter.reporter_text);
  }
  cached = map;
  return map;
}

export function countryName(code: string): string {
  const iso2 = code.trim().toUpperCase();
  return table().get(iso2) ?? iso2;
}

/** Exposed for tests that need to prove the whole screening universe is nameable. */
export function knownCountryCount(): number {
  return table().size;
}
