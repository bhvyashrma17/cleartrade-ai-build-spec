/**
 * D-030 — one market's access from a retained tariff schedule: its own national tariff (labelled as
 * read from the official tariff, D-031) or its customs union's common tariff (labelled as such, D-028).
 *
 * A line's duty is its printed rate, or the dated rate in force on the day asked (Brazil's exception
 * lists); a line the release says is applied differently, or with two different dated rates in force,
 * states no duty and keeps the reason, so the product falls back to the estimate and the agent's
 * pointer. India's preferential rate is stated for the resolved line where the official text publishes
 * one (the UAE's CEPA schedule, China's APTA column), always as needing origin proof. A release past its
 * validity (China's 2026 tariff after 31 December) states nothing.
 */
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference, resolveNationalTariffLine, type CandidateTariffLine, type ClassificationResolutionResult, type IndiaPreferenceDetermination, type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { TariffScheduleBundle } from './tariff-schedule-bundle';
import { adValorem, cepaYear, type ScheduleLine, type TariffScheduleSource } from './tariff-schedule-sources';

export const TARIFF_SCHEDULE_PARSER_VERSION = 'tariff-schedule-market-access-v1' as const;

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const endOfDay = (value: string) => new Date(day(value).getTime() + 86_400_000 - 1);
const appliesTo = (countries: readonly string[], country: string) => countries.length === 0 || countries.includes(country);

/** The duty a line carries on `at`, or why none is stated. */
export function lineDutyAt(line: ScheduleLine, country: string, at: Date): { duty: ParsedDuty; locator: string; dated: boolean } | { duty: null; reason: string } {
  if (line.exception && appliesTo(line.exception.countries, country)) return { duty: null, reason: line.exception.reason };
  const inForce = (line.dated ?? []).filter((item) => (!item.from || at >= day(item.from)) && (!item.to || at <= endOfDay(item.to)));
  const distinct = [...new Map(inForce.map((item) => [item.duty.expression, item])).values()];
  if (distinct.length > 1) return { duty: null, reason: `Two different dated rates are in force (${distinct.map((item) => `${item.raw_rate}% under ${item.locator}`).join('; ')}).` };
  if (distinct.length === 1) return { duty: distinct[0]!.duty, locator: distinct[0]!.locator, dated: true };
  return { duty: line.duty, locator: line.locator, dated: false };
}

/** India's preferential duty on a line for a market on a date, if the official text publishes one. */
export function preferenceDutyAt(line: ScheduleLine, country: string, at: Date): { duty: ParsedDuty; year: number | null } | null {
  const preference = line.india_preference;
  if (!preference || !preference.countries.includes(country)) return null;
  if (preference.staging) {
    const year = cepaYear(at, preference.staging.entry_into_force);
    if (year == null) return null;
    const value = preference.staging.years[Math.min(year, preference.staging.years.length) - 1]!;
    if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
    return { duty: adValorem(Number(value), `${Number(value)}%`, `Year ${year} of the staged schedule, counted from ${preference.staging.entry_into_force}.`), year };
  }
  return preference.duty ? { duty: preference.duty, year: null } : null;
}

export function buildTariffScheduleMarketAccess(args: {
  source: TariffScheduleSource;
  bundle: TariffScheduleBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  country: string;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const country = args.country.trim().toUpperCase();
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const { source, bundle } = args;
  const served = source.countries[country];
  if (!served) throw new Error(`${country} is not served by the ${source.key} release.`);
  const effectiveFrom = day(bundle.effective_from);
  const validUntil = bundle.valid_until ? endOfDay(bundle.valid_until) : null;
  const inForce = args.at >= effectiveFrom && (!validUntil || args.at <= validUntil);
  const entries = inForce ? [...bundle.lines.values()].filter((line) => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code)) : [];
  const duties = entries.map((line) => ({ line, at: lineDutyAt(line, country, args.at) }));
  const candidates: CandidateTariffLine[] = duties.map(({ line, at }) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    effective_from: effectiveFrom, effective_to: validUntil, general_duty: at.duty ?? line.duty, control_codes: [], preference_area_ids: [],
  }));
  const withheld = duties.filter((item) => item.at.duty === null);
  let resolution: ClassificationResolutionResult;
  if (!inForce) {
    resolution = {
      resolution: 'unavailable', resolved_line: null, candidates: [], candidate_count: 0, differences: [],
      reason: args.at < effectiveFrom
        ? `The ${source.label} release ${bundle.release_identifier} is in force from ${bundle.effective_from}.`
        : `The ${source.label} release ${bundle.release_identifier} covers the tariff to ${bundle.valid_until}; the next edition must be imported before it is used again.`,
    };
  } else if (withheld.length) {
    const first = withheld[0]!.at as { reason: string };
    resolution = {
      resolution: 'unavailable', resolved_line: null, candidates, candidate_count: candidates.length, differences: [],
      reason: `${withheld.map((item) => item.line.code).join(', ')} not read automatically for ${country} from the ${source.label}: ${first.reason}`,
    };
  } else {
    resolution = resolveNationalTariffLine(candidates);
  }

  const resolvedCode = resolution.resolved_line?.national_tariff_code ?? null;
  const resolvedLine = resolvedCode ? entries.find((line) => line.code === resolvedCode) ?? null : null;
  // Lines with the same duty can still differ in India's rate (one staged under CEPA, one excluded);
  // then no single India rate is stated for the HS6.
  const considered = resolution.resolution === 'all_children_equivalent' ? entries : resolvedLine ? [resolvedLine] : [];
  const indiaRate = (line: ScheduleLine) => {
    const found = preferenceDutyAt(line, country, args.at);
    if (found) return found.duty.expression;
    return line.notes?.some((note) => /Excluded from/.test(note)) ? 'excluded' : 'none';
  };
  const indiaRates = [...new Set(considered.map(indiaRate))];
  let india: IndiaPreferenceDetermination;
  if (origin !== 'IN') {
    india = { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India.` };
  } else if (indiaRates.length > 1) {
    india = {
      applicability: 'unknown', duty: null, geographic_area_id: null,
      basis: `The national lines beneath ${hs6} carry different India rates (${considered.map((line) => `${line.code}: ${indiaRate(line)}`).join('; ')}); the product's declarable line decides which applies.`,
    };
  } else if (resolvedLine && preferenceDutyAt(resolvedLine, country, args.at)) {
    const preference = resolvedLine.india_preference!;
    const measure = { geographic_area_id: preference.program, duty: preferenceDutyAt(resolvedLine, country, args.at)!.duty, is_quota: preference.is_quota };
    india = {
      ...determineIndiaPreference({
        direct_india_measures: preference.scope === 'direct' ? [measure] : [], proven_group_measures: preference.scope === 'group' ? [measure] : [],
        beneficiary_enumeration_is_complete: true, unresolved_program_symbols: [],
      }),
      source_reference: `${bundle.source_url} · ${preference.locator}`,
      raw_evidence: { program: preference.program, scope: preference.scope, raw_rate: preference.raw_rate, ...(preference.staging ? { staging: preference.staging } : {}) },
    };
  } else {
    const excluded = resolvedLine?.notes?.find((note) => /Excluded from/.test(note));
    india = { applicability: excluded ? 'not_applicable' : served.india_preference.applicability, duty: null, geographic_area_id: null, basis: excluded ?? served.india_preference.basis };
  }

  const lines: MarketAccessLineRecord[] = duties.map(({ line, at }) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null,
    duty: at.duty ?? line.duty,
    conditions: { schedule: source.key, basis: served.basis, market: country, trade_remedies_modelled: false, ...(at.duty === null ? { not_read_automatically: true } : {}), ...('dated' in at && at.dated ? { dated_rate: at.locator } : {}) },
    effective_from: effectiveFrom, effective_to: validUntil,
    source_reference: `${bundle.source_url} · ${line.locator} · ${line.code}`,
    raw_measure: { raw_rate: line.raw_rate, unit: line.unit, locator: line.locator, exception: line.exception, notes: line.notes ?? [], dated: line.dated ?? [] },
  }));
  const parserVersion = args.parser_version ?? TARIFF_SCHEDULE_PARSER_VERSION;
  const label = served.basis === 'common_tariff'
    ? { common_tariff: { union: source.key, label: source.label, member: country, national_exceptions_modelled: false, note: served.note } }
    : { schedule_read: { schedule: source.key, label: source.label, market: country, trade_remedies_modelled: false, note: served.note } };
  return {
    jurisdiction: country, country_code: country, hs6, hs_revision: `HS2022 (${source.label}, ${bundle.release_identifier})`,
    provider: source.provider, source_authority: source.authority, source_dataset: source.name,
    source_dataset_version: bundle.release_identifier,
    source_reference: `${bundle.source_url} (bundle sha256 ${bundle.checksum})`,
    national_code_system: source.national_code_system, parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `market=${country};origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`, retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public', recorded_by_id: null, resolution,
    general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: india,
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: {
      ...label,
      authority_release_id: args.release_id, bundle_sha256: bundle.checksum, release_identifier: bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(), effective_from: bundle.effective_from, valid_until: bundle.valid_until,
      provenance: bundle.provenance, reader_version: bundle.reader_version, parser_version: parserVersion,
      tariff_line_count: bundle.lines.size, candidate_codes: entries.map((line) => line.code),
      ...(withheld.length ? { not_read_automatically: withheld.map((item) => ({ code: item.line.code, reason: (item.at as { reason: string }).reason })) } : {}),
      notes: entries.flatMap((line) => (line.notes ?? []).map((note) => `${line.code}: ${note}`)),
      origin_country: origin, tariff_treatment_complete: false, regulatory_coverage_complete: false,
      omitted_regulatory_layer: 'A tariff schedule does not prove import controls, licences, trade remedies or national taxes; absence of a requirement here is not evidence of unrestricted import.',
    },
  };
}
