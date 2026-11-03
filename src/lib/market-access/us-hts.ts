/**
 * United States — official USITC Harmonized Tariff Schedule.
 *
 * Source: https://hts.usitc.gov/reststop/exportList (the USITC's own REST export, documented in
 * the HTS external user guide). Returns the published schedule rows verbatim: HTS number,
 * description, units, General / Special / Column 2 rates and footnotes.
 *
 * THE SPECIAL COLUMN IS NOT A COUNTRY LIST. It enumerates PROGRAMME SYMBOLS — `A+`, `D`, `E`,
 * `P`, `S`, plus two-letter partner codes for free-trade agreements. Deciding whether India
 * benefits requires the HTS General Notes, which publish each programme's beneficiary list and
 * are not part of this dataset. So a symbol we cannot resolve leaves India's eligibility
 * `unknown` rather than being read as "not eligible" — and certainly never as "Free".
 */
import { createHash } from 'node:crypto';
import {
  determineIndiaPreference,
  parseDutyExpression,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from './tariff-semantics';
import type { MarketAccessIngestResult, MarketAccessLineRecord } from './contract';

const BASE = 'https://hts.usitc.gov/reststop';
export const US_HTS_AUTHORITY = 'United States International Trade Commission — Harmonized Tariff Schedule';
export const US_HTS_PARSER_VERSION = 'us-hts-v1';
/** 19 CFR 101.1 defines the US customs territory as the States, DC and Puerto Rico. */
export const US_HTS_DESTINATIONS: readonly string[] = ['US', 'PR'];

interface HtsRow {
  htsno?: string;
  indent?: string;
  description?: string;
  units?: string[];
  general?: string;
  special?: string;
  other?: string;
  footnotes?: unknown[];
  quotaQuantity?: unknown;
  additionalDuties?: unknown;
}

/** `Free (AU,BH,CL,...)` / `Free (A+,AU,...)` / `1.4¢/kg (JP)` — symbols inside the parentheses. */
function specialProgrammeSymbols(special: string | undefined): string[] {
  if (!special) return [];
  const symbols = new Set<string>();
  for (const group of special.matchAll(/\(([^)]*)\)/g)) {
    for (const token of group[1]!.split(',')) {
      const trimmed = token.replace(/\s+/g, '');
      if (trimmed) symbols.add(trimmed);
    }
  }
  return [...symbols];
}

/** Two-letter tokens are ISO partner codes; anything else is a programme symbol. */
const isCountrySymbol = (symbol: string) => /^[A-Z]{2}$/.test(symbol);

export interface UsHtsFetchOptions { now?: Date; destination_country?: string }

export async function fetchUsMarketAccess(hs6: string, options: UsHtsFetchOptions = {}): Promise<MarketAccessIngestResult> {
  if (!/^\d{6}$/.test(hs6)) throw new Error('US market-access ingest requires an exact HS6.');
  const destination = (options.destination_country ?? 'US').trim().toUpperCase();
  if (!US_HTS_DESTINATIONS.includes(destination)) throw new Error(`${destination} is outside the customs territory of the United States.`);
  const now = options.now ?? new Date();
  const dotted = `${hs6.slice(0, 4)}.${hs6.slice(4, 6)}`;
  const url = `${BASE}/exportList?from=${dotted}.00.00&to=${dotted}.99.99&format=JSON&styles=false`;
  const response = await fetch(url, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`USITC HTS returned ${response.status} for ${dotted}.`);
  const text = await response.text();
  const rows = JSON.parse(text) as HtsRow[];
  const checksum = createHash('sha256').update(text).digest('hex');

  const inScope = rows.filter((row) => typeof row.htsno === 'string' && row.htsno.replace(/\./g, '').startsWith(hs6));
  const raw = { hs6, url, sha256: checksum, row_count: rows.length, in_scope: inScope.length, rows: inScope };

  // A schedule row carries a rate only where the duty is actually stated; the deeper statistical
  // breakouts inherit it from their parent and publish empty rate columns.
  const rated = inScope.filter((row) => (row.general ?? '').trim().length > 0);
  const lines: MarketAccessLineRecord[] = [];
  const candidates: CandidateTariffLine[] = [];
  const unresolvedSymbols = new Set<string>();
  const directIndia: Array<{ geographic_area_id: string; duty: ParsedDuty; is_quota: boolean }> = [];

  for (const row of rated) {
    const code = row.htsno!.replace(/\./g, '');
    const general = parseDutyExpression(row.general);
    const other = parseDutyExpression(row.other);
    const symbols = specialProgrammeSymbols(row.special);
    for (const symbol of symbols) {
      if (isCountrySymbol(symbol)) {
        // An explicit partner code IS resolvable: it names the country directly.
        if (symbol === 'IN') directIndia.push({ geographic_area_id: 'IN', duty: parseDutyExpression((row.special ?? '').split('(')[0]), is_quota: false });
      } else {
        unresolvedSymbols.add(symbol);
      }
    }
    const base = { national_tariff_code: code, description: row.description ?? '', declarable: true, effective_from: null, effective_to: null, source_reference: `${url}#${row.htsno}`, conditions: { units: row.units ?? [], footnotes: row.footnotes ?? [], quota_quantity: row.quotaQuantity ?? null, additional_duties: row.additionalDuties ?? null, special_text: row.special ?? null }, applies_to_origin_country: null };
    lines.push({ ...base, measure_kind: 'third_country_duty', origin_geographic_area_id: 'GENERAL', origin_scope: 'erga_omnes', duty: general, raw_measure: row as unknown });
    if ((row.special ?? '').trim()) lines.push({ ...base, measure_kind: 'tariff_preference', origin_geographic_area_id: 'SPECIAL', origin_scope: 'programme', duty: parseDutyExpression((row.special ?? '').split('(')[0]), raw_measure: { htsno: row.htsno, special: row.special } });
    if (other.kind !== 'none') lines.push({ ...base, measure_kind: 'additional_duty', origin_geographic_area_id: 'COLUMN_2', origin_scope: 'group', duty: other, raw_measure: { htsno: row.htsno, other: row.other } });
    candidates.push({ national_tariff_code: code, description: row.description ?? '', declarable: true, general_duty: general, control_codes: (row.footnotes ?? []).map((note) => JSON.stringify(note)), preference_area_ids: symbols.sort() });
  }

  const resolution = resolveNationalTariffLine(candidates);
  const preference = determineIndiaPreference({
    direct_india_measures: directIndia,
    proven_group_measures: [],
    // The Special column does enumerate every programme that grants relief on the line, so its
    // beneficiary set is closed — but only once each SYMBOL has been resolved to countries.
    beneficiary_enumeration_is_complete: true,
    unresolved_program_symbols: [...unresolvedSymbols].sort(),
  });

  return {
    jurisdiction: destination === 'US' ? 'US' : 'US_CUSTOMS_TERRITORY', country_code: destination, hs6, hs_revision: 'HS2022',
    provider: 'usitc_hts', source_authority: US_HTS_AUTHORITY,
    source_dataset: 'Harmonized Tariff Schedule of the United States', source_dataset_version: null,
    source_reference: url, national_code_system: 'US_HTS',
    parser_version: US_HTS_PARSER_VERSION, retrieved_at: now,
    evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution,
    general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: preference,
    lines,
    // The HTS is a duty schedule. Import controls for rice live with USDA/FDA/APHIS, which this
    // source does not publish, so regulatory coverage is explicitly incomplete rather than being
    // reported as "no restrictions found".
    requirements: [],
    regulatory_coverage_complete: false,
    raw_evidence: {
      ...raw, destination_country: destination,
      tariff_treatment_complete: Boolean(resolution.resolved_line),
      regulatory_coverage_complete: false,
    },
  };
}
