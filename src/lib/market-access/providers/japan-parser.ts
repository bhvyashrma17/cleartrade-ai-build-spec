import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  parseDutyExpression,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { JapanAuthorityBundle, JapanTariffRow } from './japan-bundle';

export const JAPAN_PARSER_VERSION = 'jp-customs-tariff-parser-v1' as const;
export const JAPAN_PROVIDER = 'japan_customs_tariff_schedule' as const;
export const JAPAN_SOURCE_AUTHORITY = 'Ministry of Finance — Japan Customs' as const;
export const JAPAN_SOURCE_DATASET = "Japan's Tariff Schedule (Statistical Code for Import)" as const;

/**
 * Japan-specific normalization while retaining the authority's exact expression verbatim.
 * Parenthesised and asterisked values are a real published convention on this page (seen on both
 * heading-level reference figures and on WTO bound-ceiling figures); this parser preserves the
 * marking in `note` rather than asserting what it means, since no legend for it was located.
 */
export function parseJapanDuty(raw: string): ParsedDuty {
  const value = raw.trim();
  if (!value) return parseDutyExpression(null);
  if (/^\(?free\)?$/i.test(value)) {
    return { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: value, note: null };
  }
  const marked = /^[*]?\(([^)]+)\)$/.exec(value);
  const inner = marked ? marked[1]! : value;
  const yen = /^(\d+(?:[.,]\d+)?)\s*yen\s*\/\s*([A-Za-z][A-Za-z0-9²³ ]*)$/i.exec(inner.replace(/\s+/g, ' '));
  if (yen) {
    const parsed = parseDutyExpression(`${yen[1]} JPY / 1 ${yen[2]!.trim()}`);
    return { ...parsed, expression: value, note: marked ? "Published in parentheses/asterisked on the authority's own page; the marking's exact legal meaning was not located and is preserved verbatim rather than interpreted." : null };
  }
  const parsed = parseDutyExpression(inner);
  return { ...parsed, expression: value, note: marked ? "Published in parentheses/asterisked on the authority's own page; the marking's exact legal meaning was not located and is preserved verbatim rather than interpreted." : parsed.note };
}

interface AssembledLine {
  code: string;
  description: string;
  descriptionPath: string[];
  row: JapanTariffRow;
}

/** The multilateral rate columns a suffix-only child may inherit from its heading row. */
const INHERITABLE_MULTILATERAL_COLUMNS = ['General', 'Temporary', 'WTO', 'GSP', 'LDC'] as const;

/** A parenthesised/asterisked heading value is a reference figure of uncertain applicability
 *  (this parser's own `parseJapanDuty` already flags it as such) and is never inherited — only
 *  a plain, unmarked heading rate is safe to treat as the applicable base for its children. */
function isPlainRate(value: string): boolean {
  return !/^[*]?\(/.test(value.trim());
}

function assembleDeclarableLines(rows: readonly JapanTariffRow[]): AssembledLine[] {
  const assembled: AssembledLine[] = [];
  let currentHeadingCode = '';
  let headingDescription = '';
  let inheritableHeadingRates: Record<string, string> = {};
  for (const row of rows) {
    if (row.statistical_code) {
      currentHeadingCode = row.statistical_code.replace(/\./g, '');
      headingDescription = row.description;
      inheritableHeadingRates = Object.fromEntries(
        INHERITABLE_MULTILATERAL_COLUMNS
          .map((label) => [label, row.rates[label]])
          .filter((entry): entry is [string, string] => Boolean(entry[1]) && isPlainRate(entry[1])),
      );
      // Three real, distinct row shapes were observed against live pages. A pure heading (e.g.
      // "1006.30") carries its own statistical_code and no rates at all — its suffix children
      // follow as separate rows with an EMPTY statistical_code, self-supplying their own General/
      // Temporary/WTO. A self-contained shape (e.g. "8479.10") carries its own statistical_code
      // AND its own suffix AND its own full rate set in the same row — itself a declarable line.
      // A third shape (e.g. "7407.10") carries only the multilateral columns on the heading row,
      // with each suffix child beneath it publishing only the EPA/bilateral columns and inheriting
      // General/Temporary/WTO/GSP/LDC from the heading — handled by the merge below.
      if (row.hs_code_suffix && Object.keys(row.rates).length) {
        assembled.push({
          code: `${currentHeadingCode}${row.hs_code_suffix}`,
          description: row.description || headingDescription,
          descriptionPath: [headingDescription].filter(Boolean),
          row,
        });
      }
      continue;
    }
    if (!row.hs_code_suffix || !currentHeadingCode) continue;
    const merged: JapanTariffRow = {
      ...row,
      rates: { ...inheritableHeadingRates, ...row.rates },
    };
    assembled.push({
      code: `${currentHeadingCode}${row.hs_code_suffix}`,
      description: row.description || headingDescription,
      descriptionPath: [headingDescription].filter(Boolean),
      row: merged,
    });
  }
  return assembled;
}

/**
 * The rate-priority Japan's own tariff law applies when more than one of General/Temporary/WTO is
 * published for the same line: a Temporary (時限) rate supersedes the General (基本) rate for as
 * long as it is in force, and the WTO column is a bound ceiling rather than the applied rate. This
 * is a real characteristic of the source confirmed by observing a rice line where General was
 * blank and Temporary carried the actual duty — not an assumption made to fill a gap.
 */
function applicableRate(rates: Record<string, string>): { label: string; duty: ParsedDuty } | null {
  for (const label of ['Temporary', 'General', 'WTO'] as const) {
    const raw = rates[label];
    if (raw) return { label, duty: parseJapanDuty(raw) };
  }
  return null;
}

/**
 * Quota language observed on real pages ("tariff rate quota", "access commitment") can appear in
 * any published column, not only a dedicated quota column — this line's own "010" example carries
 * it inside the CPTPP cell. A rate published alongside that language is never an unconditional
 * general/erga-omnes duty, whichever column it happened to land in.
 */
function isQuotaConditioned(rates: Record<string, string>): boolean {
  return Object.values(rates).some((value) => /tariff rate quota|access commitment/i.test(value));
}

export function buildJapanMarketAccess(args: {
  bundle: JapanAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const declarable = assembleDeclarableLines(args.bundle.rows).filter((entry) => entry.code.startsWith(hs6));

  const built: Array<{ candidate: CandidateTariffLine; entry: AssembledLine; applicable: { label: string; duty: ParsedDuty } | null; quota: boolean }> = [];
  for (const entry of declarable) {
    const applicable = applicableRate(entry.row.rates);
    if (!applicable) continue; // a line with no published rate at all is not a declarable candidate
    const quota = isQuotaConditioned(entry.row.rates);
    built.push({
      entry,
      applicable,
      quota,
      candidate: {
        national_tariff_code: entry.code,
        description: entry.description,
        description_path: entry.descriptionPath,
        declarable: true,
        // Japan publishes a new dated schedule page (a new URL) per effective-date change rather
        // than a per-row date column — the release's own reference date IS this line's effective
        // date, not an unknown. Leaving it null would understate real evidence the source carries.
        effective_from: args.release_reference_date,
        effective_to: null,
        general_duty: applicable.duty,
        control_codes: quota ? ['TARIFF_QUOTA:JP_ACCESS_COMMITMENT'] : [],
        preference_area_ids: Object.keys(entry.row.rates).filter((label) => !['General', 'Temporary', 'WTO', 'GSP', 'LDC'].includes(label)),
      },
    });
  }

  const resolution = resolveNationalTariffLine(built.map((item) => item.candidate));
  const lines: MarketAccessLineRecord[] = [];
  for (const item of built) {
    const common = {
      national_tariff_code: item.candidate.national_tariff_code,
      description: item.candidate.description,
      declarable: true,
      effective_from: item.candidate.effective_from ?? null,
      effective_to: null,
      source_reference: `Japan Customs ${args.bundle.release_identifier} · statistical code ${item.candidate.national_tariff_code}`,
    };
    lines.push({
      ...common,
      measure_kind: item.quota ? 'tariff_quota' : 'third_country_duty',
      origin_geographic_area_id: 'MFN',
      origin_scope: 'erga_omnes',
      applies_to_origin_country: origin,
      duty: item.applicable!.duty,
      conditions: { applicable_rate_column: item.applicable!.label, all_published_columns: item.entry.row.rates, unconditional_rate: !item.quota },
      raw_measure: { rates: item.entry.row.rates, applicable_column: item.applicable!.label },
    });
    const indiaRate = item.entry.row.rates.India;
    if (indiaRate) {
      lines.push({
        ...common,
        measure_kind: 'tariff_preference',
        origin_geographic_area_id: 'India-EPA',
        origin_scope: 'country',
        applies_to_origin_country: 'IN',
        duty: parseJapanDuty(indiaRate),
        conditions: { programme: 'Japan-India Comprehensive Economic Partnership Agreement', beneficiary_eligibility_required: true },
        raw_measure: { rate_column: 'India', value: indiaRate },
      });
    }
  }

  const resolvedIndiaRate = resolution.resolved_line
    ? built.find((item) => item.candidate.national_tariff_code === resolution.resolved_line!.national_tariff_code)?.entry.row.rates.India
    : undefined;
  const indiaPreference = resolution.resolved_line == null
    ? { applicability: 'unknown' as const, duty: null, geographic_area_id: null, basis: 'No single declarable line was resolved, so no India-EPA determination can be made for an exact line.' }
    : resolvedIndiaRate
      ? determineIndiaPreference({
        direct_india_measures: [{ geographic_area_id: 'India-EPA', duty: parseJapanDuty(resolvedIndiaRate), is_quota: /quota|access commitment/i.test(resolvedIndiaRate) }],
        proven_group_measures: [],
        beneficiary_enumeration_is_complete: true,
        unresolved_program_symbols: [],
      })
      : {
        applicability: 'not_applicable' as const,
        duty: null,
        geographic_area_id: null,
        basis: `Japan Customs' own published schedule carries a dedicated "India" rate column for this line, alongside every other EPA partner's own column, and it is empty — the Japan-India CEPA grants no preference on this specific statistical line. Absence in an explicitly-enumerated column is read as no current preference, not as unknown.`,
      };

  const parserVersion = args.parser_version ?? JAPAN_PARSER_VERSION;
  return {
    jurisdiction: 'JP',
    country_code: 'JP',
    hs6,
    hs_revision: `HS / Japan Statistical Code — schedule effective ${args.bundle.effective_date_label}`,
    provider: JAPAN_PROVIDER,
    source_authority: JAPAN_SOURCE_AUTHORITY,
    source_dataset: JAPAN_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'JP_STATISTICAL_CODE',
    parser_version: parserVersion,
    source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution,
    general_duty: resolution.resolved_line && !resolution.resolved_line.control_codes.includes('TARIFF_QUOTA:JP_ACCESS_COMMITMENT')
      ? resolution.resolved_line.general_duty
      : null,
    india_preference: indiaPreference,
    lines,
    requirements: [],
    // The tariff schedule is not a complete SPS/TBT/licensing corpus.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: args.bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(),
      bundle_sha256: args.bundle.checksum,
      reader_version: args.bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      column_labels: args.bundle.column_labels,
      candidate_lines: built.map((item) => ({ code: item.candidate.national_tariff_code, applicable_column: item.applicable!.label, rates: item.entry.row.rates })),
    },
  };
}
