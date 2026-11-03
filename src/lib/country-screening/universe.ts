/**
 * Country Screening Universe — the set of markets a Stage A global screen may consider.
 *
 * Two identity systems meet here and are deliberately kept apart.
 *
 *   - GEOGRAPHIC identity is ISO-3166 alpha-2/alpha-3 and the UN M49 numeric, from the same
 *     vendored snapshot `src/lib/comtrade/areas.ts` already uses. Regional, economic and
 *     miscellaneous partner aggregates — World included — have no entry there, so they are
 *     excluded by construction rather than by a blocklist, and no hand-curated list of
 *     "important export markets" exists anywhere in this module.
 *   - PROVIDER identity is the UN Comtrade reporter code, which comes from the provider's own
 *     reference through `comtradeReporterRegistry()`. It is not derived from the geographic
 *     code and it is not derived from the repository's legacy alias map: Italy reports as 380
 *     while that alias map holds 381, a code UN Comtrade does not list at all.
 *
 * A market is screenable only when BOTH exist. When the provider has no reporter for a country
 * — Taiwan, which reports inside the "Other Asia, nes" aggregate; Puerto Rico and Guam, folded
 * into USA 842; Liechtenstein, folded into Switzerland 757 — the country is excluded with the
 * explicit reason `no_provider_reporter_identity`, never left to resolve as a market that simply
 * happens to have no demand evidence.
 *
 * TERMINOLOGY. These are screening markets, not "sovereign countries". The set deliberately
 * contains separately reporting customs and economic territories, because a separately reporting
 * territory is a real export destination. Sovereignty is not a property either source records,
 * so this module does not assert it.
 *
 * Three exclusion classes are policy inputs rather than provider facts, each recorded with its
 * reason so a historical run can prove what it evaluated and why:
 *
 *   - `not_un_m49_identity` — ISO user-assigned codes M49 never assigned. XK/983 is the only one.
 *   - `no_resident_population` — territories with no permanent civilian population, which cannot
 *     import commercially at all.
 *   - `origin_country` — ClearTrade's own origin. An Indian exporter does not export to India.
 */

import { getName, getNumericCodes, registerLocale } from 'i18n-iso-countries';
import englishCountryNames from 'i18n-iso-countries/langs/en.json';
import { comtradeReporterRegistry, type ComtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { canonicalHash } from '@/lib/country-evidence/planner';

registerLocale(englishCountryNames as unknown as Parameters<typeof registerLocale>[0]);

/** Registry snapshot identity. A change to the derivation rules requires a new version. */
export const COUNTRY_SCREENING_UNIVERSE_VERSION = 'country-screening-universe-v2';

export type CountryScreeningExclusionReason =
  | 'not_un_m49_identity'
  | 'no_resident_population'
  | 'origin_country'
  | 'no_provider_reporter_identity';

export interface CountryScreeningUniverseEntry {
  /** ISO 3166-1 alpha-2 — the country identity the rest of the platform speaks. */
  iso2: string;
  iso3: string;
  /** Zero-padded ISO 3166-1 / UN M49 numeric, retained verbatim for provenance. */
  iso_numeric: string;
  /** Unpadded provider reporter code. This is what a Comtrade request and its rows carry. */
  reporter_code: string;
  /** The provider's own label and coverage note for that reporter. Provenance, not policy. */
  reporter_text: string;
  reporter_note: string | null;
  country_name: string;
  /** Historical or superseded provider area codes for the same country. Never canonical. */
  provider_area_aliases: string[];
}

export interface CountryScreeningExclusion {
  iso2: string;
  iso_numeric: string;
  reason: CountryScreeningExclusionReason;
}

/** A live provider reporter that no screening market claims, and why. */
export interface UnmatchedReporter {
  reporter_code: string;
  iso2: string;
  reason: 'no_iso_country_identity' | 'excluded_by_policy';
}

export interface CountryScreeningUniverse {
  version: string;
  checksum: string;
  size: number;
  reporter_identity_strategy: string;
  reporter_registry_version: string;
  reporter_registry_checksum: string;
  entries: CountryScreeningUniverseEntry[];
  exclusions: CountryScreeningExclusion[];
  unmatched_reporters: UnmatchedReporter[];
}

export interface CountryScreeningUniverseInput {
  universe_version: string;
  reporter_identity_strategy: string;
  reporter_registry_version: string;
  /** ISO 3166-1 alpha-2 → why that identity can never be a ClearTrade target market. */
  excluded_iso2_codes: Readonly<Record<string, CountryScreeningExclusionReason>>;
  /** ClearTrade exports FROM this country; it is not one of its own target markets. */
  exclude_origin_country: boolean;
  origin_country_iso2: string;
  /** Test seam. Production always uses the frozen provider snapshot. */
  registry?: ComtradeReporterRegistry;
}

/**
 * Build the frozen universe for one screening policy.
 *
 * Deterministic in content and order: entries are sorted by numeric reporter code, so the
 * checksum is stable across processes. The checksum covers the reporter-registry identity as
 * well, which is what makes a reporter-reference refresh a visible universe change rather than
 * a silent one.
 */
export function buildCountryScreeningUniverse(input: CountryScreeningUniverseInput): CountryScreeningUniverse {
  if (input.universe_version !== COUNTRY_SCREENING_UNIVERSE_VERSION) throw new Error(`Unsupported country screening universe version ${input.universe_version}.`);
  if (input.reporter_identity_strategy !== 'comtrade_reporter_reference_v1') throw new Error(`Unsupported reporter identity strategy ${input.reporter_identity_strategy}.`);
  const registry = input.registry ?? comtradeReporterRegistry();
  if (registry.version !== input.reporter_registry_version) throw new Error(`Country screening expects reporter registry ${input.reporter_registry_version}; the build supplies ${registry.version}.`);
  if (!registry.reporters.length) throw new Error('Comtrade reporter registry resolved to no live reporters.');

  const excluded = new Map(Object.entries(input.excluded_iso2_codes).map(([iso2, reason]) => [iso2.trim().toUpperCase(), reason]));
  const origin = input.origin_country_iso2.trim().toUpperCase();
  const byIso2 = new Map(registry.reporters.map(row => [row.iso2, row]));
  const aliasesByIso2 = new Map<string, string[]>();
  for (const alias of registry.aliases) {
    if (!alias.iso2) continue;
    aliasesByIso2.set(alias.iso2, [...(aliasesByIso2.get(alias.iso2) ?? []), alias.reporter_code]);
  }

  const entries: CountryScreeningUniverseEntry[] = [];
  const exclusions: CountryScreeningExclusion[] = [];
  const claimed = new Set<string>();

  for (const [isoNumeric, iso2] of Object.entries(getNumericCodes()).sort(([a], [b]) => Number(a) - Number(b))) {
    const configured = excluded.get(iso2);
    if (configured) { exclusions.push({ iso2, iso_numeric: isoNumeric, reason: configured }); continue; }
    if (input.exclude_origin_country && iso2 === origin) { exclusions.push({ iso2, iso_numeric: isoNumeric, reason: 'origin_country' }); continue; }
    const reporter = byIso2.get(iso2);
    // No reporter means the provider cannot be asked about this market at all. Saying so is the
    // whole point: it is a different fact from "asked, and the market imports nothing".
    if (!reporter) { exclusions.push({ iso2, iso_numeric: isoNumeric, reason: 'no_provider_reporter_identity' }); continue; }
    claimed.add(iso2);
    const aliases = [...new Set([...(aliasesByIso2.get(iso2) ?? []), ...(String(Number(isoNumeric)) === reporter.reporter_code ? [] : [String(Number(isoNumeric))])])].sort((a, b) => Number(a) - Number(b));
    entries.push({ iso2, iso3: reporter.iso3, iso_numeric: isoNumeric, reporter_code: reporter.reporter_code, reporter_text: reporter.reporter_text, reporter_note: reporter.reporter_note, country_name: getName(iso2, 'en') ?? reporter.reporter_text, provider_area_aliases: aliases });
  }

  const unmatched: UnmatchedReporter[] = registry.reporters
    .filter(row => !claimed.has(row.iso2))
    .map(row => ({ reporter_code: row.reporter_code, iso2: row.iso2, reason: excluded.has(row.iso2) || (input.exclude_origin_country && row.iso2 === origin) ? 'excluded_by_policy' as const : 'no_iso_country_identity' as const }));

  entries.sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code));
  exclusions.sort((a, b) => Number(a.iso_numeric) - Number(b.iso_numeric));
  unmatched.sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code));
  const checksum = canonicalHash({ version: input.universe_version, reporter_identity_strategy: input.reporter_identity_strategy, reporter_registry_version: registry.version, reporter_registry_checksum: registry.checksum, entries, exclusions, unmatched_reporters: unmatched });
  return { version: input.universe_version, checksum, size: entries.length, reporter_identity_strategy: input.reporter_identity_strategy, reporter_registry_version: registry.version, reporter_registry_checksum: registry.checksum, entries, exclusions, unmatched_reporters: unmatched };
}
