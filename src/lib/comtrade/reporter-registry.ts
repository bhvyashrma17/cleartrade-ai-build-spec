/**
 * Comtrade Reporter Registry — provider reporting identity, kept separate from country identity.
 *
 * WHY THIS EXISTS. Phase 1F originally derived reporter codes by inverting
 * `COMTRADE_LEGACY_AREA_TO_ISO2`, on the assumption that a code appearing in that compatibility
 * map was the identity the provider reports under. That assumption is wrong, and the provider's
 * own reference proves it: Italy reports as **380**, not 381 — 381 appears in neither the
 * reporter nor the partner reference at all. A screen built on the inverted map would have asked
 * for a reporter UN Comtrade does not recognise and recorded Italy as `unavailable`, silently,
 * with no error anywhere. An alias map is a parsing aid for area codes already sitting in stored
 * evidence; it was never an authority on who may be asked a question.
 *
 * WHAT IS AUTHORITATIVE. `reference/comtrade-reporters.json` is the verbatim body of
 * https://comtradeapi.un.org/files/v1/app/reference/Reporters.json — the same public, keyless
 * reference host `ComtradeApiClient.resolveChapter` already reads HS.json from. It carries no
 * trade observations and costs no authenticated quota. It is checked in rather than fetched so
 * that screening is deterministic and reproducible offline; refreshing it is a reviewed change
 * that produces a new registry version, never a silent drift under a completed run.
 *
 * IDENTITY SEPARATION. ISO-3166 alpha-2/alpha-3 and the UN M49 numeric remain the canonical
 * geographic identity. The reporter code is provider metadata that happens to be numeric and
 * happens to agree with M49 for all but five countries (FR 251, IN 699, NO 579, CH 757, US 842).
 * Historical and aggregate rows are retained as explicit aliases; they are never canonical.
 *
 * FAIL CLOSED. Ambiguity removes a market from the registry rather than guessing at it: a country
 * with two live reporter rows, or a reporter whose code does not round-trip back to its own ISO2
 * through `toIso2`, is recorded as an anomaly and excluded. A market with no reporter is reported
 * as exactly that, so it can never be mistaken for a market with no demand.
 */

import { createHash } from 'node:crypto';
import { COMTRADE_LEGACY_AREA_TO_ISO2, toIso2 } from './areas';
import reporterReference from './reference/comtrade-reporters.json';

/** Registry identity. Refreshing the provider snapshot or the derivation rules bumps this. */
export const COMTRADE_REPORTER_REGISTRY_VERSION = 'comtrade-reporter-registry-v1';

/** Provenance of the checked-in snapshot, recorded at the moment it was captured. */
export const COMTRADE_REPORTER_REFERENCE_SOURCE = {
  provider: 'un_comtrade',
  dataset: 'reference/Reporters.json',
  url: 'https://comtradeapi.un.org/files/v1/app/reference/Reporters.json',
  /** Provider's own last-modified for the snapshot body. */
  last_modified: 'Thu, 05 Jun 2025 02:23:36 GMT',
  etag: '0x8DDA3D7FA42F612',
  retrieved_at: '2026-08-26T17:40:49.955Z',
  /** SHA-256 of the verbatim response bytes as checked in. Asserted by the registry tests. */
  response_checksum: 'b4dcc8e9844a98e75222c8e87a8b8bb84f88b35f8fe29029ab6ccf89ecf7114f',
  authenticated: false,
  consumes_trade_data_quota: false,
} as const;

export type ReporterAliasReason =
  | 'expired_reporter'
  | 'aggregate_group'
  | 'no_iso_country_identity'
  | 'superseded_by_current_reporter'
  | 'repository_compatibility_alias';

export type ReporterAnomalyReason =
  | 'duplicate_iso_country_identity'
  | 'iso_mapping_conflict'
  | 'compatibility_alias_not_in_provider_reference';

export interface ComtradeReporterIdentity {
  /** Unpadded provider reporter code — exactly what a request and its response rows carry. */
  reporter_code: string;
  reporter_text: string;
  /** Provider's own coverage note, e.g. "Switzerland, Liechtenstein". Provenance, not policy. */
  reporter_note: string | null;
  iso2: string;
  iso3: string;
  effective_from: string | null;
}

export interface ComtradeReporterAlias {
  reporter_code: string;
  reporter_text: string;
  iso2: string | null;
  iso3: string | null;
  reason: ReporterAliasReason;
  expired_on: string | null;
}

export interface ComtradeReporterAnomaly {
  reporter_code: string;
  iso2: string | null;
  reason: ReporterAnomalyReason;
  detail: string;
}

export interface ComtradeReporterRegistry {
  version: string;
  checksum: string;
  source: typeof COMTRADE_REPORTER_REFERENCE_SOURCE & { row_count: number };
  /** Live, unambiguous, ISO-resolvable reporters, ordered by numeric code. */
  reporters: ComtradeReporterIdentity[];
  aliases: ComtradeReporterAlias[];
  anomalies: ComtradeReporterAnomaly[];
}

interface ReferenceRow {
  id: number;
  text: string;
  reporterCode: number;
  reporterDesc?: string;
  reporterNote?: string;
  reporterCodeIsoAlpha2?: string;
  reporterCodeIsoAlpha3?: string;
  entryEffectiveDate?: string;
  entryExpiredDate?: string;
  isGroup?: boolean;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalJson(item)]));
  return value;
}

let cached: ComtradeReporterRegistry | null = null;

/**
 * Derive the registry from the frozen snapshot. Deterministic and memoized.
 *
 * The rules are the provider's own flags, not a curated opinion: `isGroup` marks an aggregate,
 * `entryExpiredDate` marks a historical identity, and a missing ISO alpha-2 marks a row that
 * cannot be a country. Everything filtered out is retained as an alias with its reason.
 */
export function comtradeReporterRegistry(): ComtradeReporterRegistry {
  if (cached) return cached;
  const rows = (reporterReference as { results: ReferenceRow[] }).results;
  const seenCodes = new Set<string>();
  const live: ComtradeReporterIdentity[] = [];
  const aliases: ComtradeReporterAlias[] = [];
  const anomalies: ComtradeReporterAnomaly[] = [];

  for (const row of [...rows].sort((a, b) => Number(a.reporterCode) - Number(b.reporterCode))) {
    const code = String(Number(row.reporterCode));
    // A repeated reporter code is structural corruption of the reference, not an ambiguity a
    // policy decision could resolve. Nothing downstream can be trusted, so refuse to build.
    if (seenCodes.has(code)) throw new Error(`Comtrade reporter reference contains duplicate reporter code ${code}.`);
    seenCodes.add(code);
    const iso2 = row.reporterCodeIsoAlpha2?.trim().toUpperCase() ?? null;
    const iso3 = row.reporterCodeIsoAlpha3?.trim().toUpperCase() ?? null;
    const alias = (reason: ReporterAliasReason) => aliases.push({ reporter_code: code, reporter_text: row.text, iso2, iso3, reason, expired_on: row.entryExpiredDate ?? null });
    if (row.isGroup === true) { alias('aggregate_group'); continue; }
    if (row.entryExpiredDate) { alias('expired_reporter'); continue; }
    if (!iso2 || !iso3) { alias('no_iso_country_identity'); continue; }
    // The registry supplies reporter codes to a pipeline that maps provider areas back to ISO
    // through `toIso2`. A code that does not round-trip would produce evidence the deep Country
    // Truth job rejects as an identity mismatch, so it is excluded here rather than there.
    if (toIso2(code) !== iso2) {
      anomalies.push({ reporter_code: code, iso2, reason: 'iso_mapping_conflict', detail: `toIso2(${code}) resolved to ${toIso2(code) ?? 'null'}, provider reference says ${iso2}.` });
      alias('no_iso_country_identity');
      continue;
    }
    live.push({ reporter_code: code, reporter_text: row.text, reporter_note: row.reporterNote ?? null, iso2, iso3, effective_from: row.entryEffectiveDate ?? null });
  }

  // One country, one live reporter. Two would make "which code do we ask?" a guess.
  const byIso2 = new Map<string, ComtradeReporterIdentity[]>();
  for (const identity of live) byIso2.set(identity.iso2, [...(byIso2.get(identity.iso2) ?? []), identity]);
  const reporters: ComtradeReporterIdentity[] = [];
  for (const [iso2, matches] of [...byIso2].sort(([a], [b]) => a.localeCompare(b))) {
    if (matches.length === 1) { reporters.push(matches[0]!); continue; }
    for (const match of matches) {
      anomalies.push({ reporter_code: match.reporter_code, iso2, reason: 'duplicate_iso_country_identity', detail: `${iso2} resolves to ${matches.map(row => row.reporter_code).join(', ')}; screening refuses an ambiguous reporter.` });
      aliases.push({ reporter_code: match.reporter_code, reporter_text: match.reporter_text, iso2, iso3: match.iso3, reason: 'superseded_by_current_reporter', expired_on: null });
    }
  }
  reporters.sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code));

  // The repository's legacy area map exists to read stored evidence; it is not an authority on
  // reporter identity. Any code in it the provider reference does not know is surfaced here —
  // this is precisely how the Italy 381 defect stayed invisible.
  const known = new Set([...reporters.map(row => row.reporter_code), ...aliases.map(row => row.reporter_code)]);
  for (const legacy of Object.keys(COMTRADE_LEGACY_AREA_TO_ISO2).sort((a, b) => Number(a) - Number(b))) {
    const code = String(Number(legacy));
    if (known.has(code)) continue;
    anomalies.push({ reporter_code: code, iso2: COMTRADE_LEGACY_AREA_TO_ISO2[legacy] ?? null, reason: 'compatibility_alias_not_in_provider_reference', detail: `Area code ${code} is a repository parsing alias only; UN Comtrade lists no reporter under it.` });
    aliases.push({ reporter_code: code, reporter_text: `repository compatibility alias for ${COMTRADE_LEGACY_AREA_TO_ISO2[legacy]}`, iso2: COMTRADE_LEGACY_AREA_TO_ISO2[legacy] ?? null, iso3: null, reason: 'repository_compatibility_alias', expired_on: null });
  }

  aliases.sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code) || a.reason.localeCompare(b.reason));
  anomalies.sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code) || a.reason.localeCompare(b.reason));
  const source = { ...COMTRADE_REPORTER_REFERENCE_SOURCE, row_count: rows.length };
  const checksum = createHash('sha256').update(JSON.stringify(canonicalJson({ version: COMTRADE_REPORTER_REGISTRY_VERSION, source, reporters, aliases, anomalies }))).digest('hex');
  cached = { version: COMTRADE_REPORTER_REGISTRY_VERSION, checksum, source, reporters, aliases, anomalies };
  return cached;
}

/** The live reporter for one ISO country, or null when the provider has none. */
export function reporterForIso2(iso2: string): ComtradeReporterIdentity | null {
  const wanted = iso2.trim().toUpperCase();
  return comtradeReporterRegistry().reporters.find(row => row.iso2 === wanted) ?? null;
}

/** Every provider area code that has ever stood for this country, current identity first. */
export function reporterAliasesForIso2(iso2: string): string[] {
  const wanted = iso2.trim().toUpperCase();
  return comtradeReporterRegistry().aliases.filter(row => row.iso2 === wanted).map(row => row.reporter_code).sort((a, b) => Number(a) - Number(b));
}

/** Test seam only: forget the memoized registry so a suite can rebuild it. */
export function __resetComtradeReporterRegistry() { cached = null; }
