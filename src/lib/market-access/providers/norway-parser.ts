import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import {
  determineIndiaPreference,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { NorwayAuthorityBundle, NorwayRate } from './norway-bundle';

export const NORWAY_PARSER_VERSION = 'tolletaten-parser-v1' as const;
export const NORWAY_PROVIDER = 'no_tolletaten_customs_tariff' as const;
export const NORWAY_SOURCE_AUTHORITY = 'Tolletaten (Norwegian Customs)' as const;
export const NORWAY_SOURCE_DATASET = 'Tolletaten open data — customs duty rates, commodity numbers, country groups and trade agreements' as const;

/** Tolletaten's general group: the duty that applies absent a preferential origin. */
const GENERAL_GROUP = 'TALL';

/**
 * Country groups that carry an India-specific rate, in the order Tolletaten's own preference
 * classification makes them relevant. `TIN` is the EFTA–India TEPA group (in force 2025-10-01);
 * `TGS3` is ordinary GSP for Indian agricultural goods; `TIST` is a shared India/Sri Lanka/Thailand
 * group. Each is a *published measure for India-origin goods* and never, on its own, proof that a
 * given shipment qualifies.
 */
const INDIA_GROUPS = ['TIN', 'TGS3', 'TIST'] as const;

/**
 * A published value the authority uses as a placeholder rather than a payable rate.
 *
 * Observed 10 times in 291,033 rate rows. Treating it as a real duty would report a 999,999.99%
 * tariff, so it is surfaced as `unparsed` with the source text retained instead of being guessed at
 * or silently dropped — missing is not zero, and a sentinel is not a rate.
 */
const SENTINEL_PREFIX = '999999';

const EMPTY = (kind: ParsedDuty['kind'], expression: string, note: string | null = null): ParsedDuty => ({
  kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
  specific_unit: null, specific_unit_quantity: null, expression, note,
});

/** "10,70" → 10.7. Norway publishes decimals with a comma; parsing it as a float loses the value. */
function numeric(value: string): number | null {
  const normalised = value.replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(normalised)) return null;
  const parsed = Number.parseFloat(normalised);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `YYYY-MM-DD` → Date, or null for the open-ended `""` Tolletaten uses for "no end date". */
function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isEffective(rate: NorwayRate, at: Date): boolean {
  const from = parseDate(rate.valid_from);
  const to = parseDate(rate.valid_to);
  if (from && from.getTime() > at.getTime()) return false;
  if (to && to.getTime() < at.getTime()) return false;
  return true;
}

/**
 * One Tolletaten rate → a canonical duty.
 *
 * Units are the authority's own codes: `P` percent of value, `K` per kilo, `L` per litre, `S` per
 * piece. A specific duty is never converted to an ad-valorem equivalent — the amount and its unit
 * are carried through as published.
 */
export function parseNorwayDuty(rate: NorwayRate): ParsedDuty {
  const expression = `${rate.value}${rate.unit ? ` ${rate.unit}` : ''}${rate.unit_description ? ` (${rate.unit_description})` : ''}`.trim();

  if (rate.value.startsWith(SENTINEL_PREFIX)) {
    return EMPTY('unparsed', expression, 'Tolletaten publishes this as a placeholder value rather than a payable rate; it is retained verbatim rather than reported as a duty.');
  }
  const amount = numeric(rate.value);
  if (amount === null) {
    return EMPTY('unparsed', expression, 'The published rate value did not parse as a Norwegian decimal number; retained verbatim rather than guessed.');
  }

  switch (rate.unit) {
    case 'P':
      return { kind: 'ad_valorem', ad_valorem_rate_percent: amount, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note: null };
    case 'K':
    case 'L':
    case 'S': {
      const unit = rate.unit === 'K' ? 'kg' : rate.unit === 'L' ? 'litre' : 'piece';
      // A published 0 per-unit rate is an observed zero — real evidence of duty-free treatment,
      // not an absent rate — so it keeps its specific kind and unit rather than collapsing.
      return {
        kind: 'specific', ad_valorem_rate_percent: null, specific_amount: amount,
        specific_currency: 'NOK', specific_unit: unit, specific_unit_quantity: 1,
        expression, note: null,
      };
    }
    default:
      return EMPTY('unparsed', expression, `Tolletaten rate unit "${rate.unit}" is not one of the documented value/kg/litre/piece codes; retained verbatim rather than assumed to be ad valorem.`);
  }
}

/** The rate in force at `at` for a group, or null when the group publishes none. */
function effectiveRate(bundle: NorwayAuthorityBundle, code: string, group: string, at: Date): NorwayRate | null {
  const commodity = bundle.rates.get(code);
  const rates = commodity?.groups[group];
  if (!rates?.length) return null;
  const current = rates.filter((rate) => isEffective(rate, at));
  if (!current.length) return null;
  // Latest commencement wins where the authority has published successive rates for one group.
  return current.reduce((newest, rate) => (
    (parseDate(rate.valid_from)?.getTime() ?? 0) >= (parseDate(newest.valid_from)?.getTime() ?? 0) ? rate : newest
  ));
}

export function buildNorwayMarketAccess(args: {
  bundle: NorwayAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const { bundle } = args;
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const at = args.at;

  const codes = [...bundle.rates.keys()].filter((code) => code.startsWith(hs6)).sort();

  const built: Array<{
    candidate: CandidateTariffLine;
    general: NorwayRate | null;
    india: { group: string; rate: NorwayRate } | null;
  }> = [];

  for (const code of codes) {
    const goods = bundle.goods.get(code);
    // A commodity number whose own validity window has closed is not a currently declarable line.
    if (goods && !isEffective({ value: '', unit: '', unit_description: null, valid_from: goods.valid_from, valid_to: goods.valid_to }, at)) continue;

    const general = effectiveRate(bundle, code, GENERAL_GROUP, at);
    let india: { group: string; rate: NorwayRate } | null = null;
    for (const group of INDIA_GROUPS) {
      const rate = effectiveRate(bundle, code, group, at);
      if (rate) { india = { group, rate }; break; }
    }

    const commodity = bundle.rates.get(code)!;
    // Every non-general group that publishes a currently effective rate is a preferential
    // programme this line is subject to. Recorded as area identifiers, never as India's rate.
    const preferenceAreas = Object.keys(commodity.groups)
      .filter((group) => group !== GENERAL_GROUP && effectiveRate(bundle, code, group, at))
      .sort();

    built.push({
      candidate: {
        national_tariff_code: code,
        description: `Norwegian commodity number ${code}`,
        declarable: true,
        effective_from: general ? parseDate(general.valid_from) : (goods ? parseDate(goods.valid_from) : null),
        effective_to: general ? parseDate(general.valid_to) : (goods ? parseDate(goods.valid_to) : null),
        general_duty: general ? parseNorwayDuty(general) : EMPTY('none', '', 'Tolletaten publishes no general (TALL) rate in force for this commodity at the assessment date.'),
        control_codes: [],
        preference_area_ids: preferenceAreas,
      },
      general,
      india,
    });
  }

  const resolution = resolveNationalTariffLine(built.map((entry) => entry.candidate));

  const lines: MarketAccessLineRecord[] = [];
  for (const entry of built) {
    const commodity = bundle.rates.get(entry.candidate.national_tariff_code);
    lines.push({
      national_tariff_code: entry.candidate.national_tariff_code,
      description: entry.candidate.description,
      declarable: true,
      measure_kind: 'third_country_duty',
      origin_geographic_area_id: GENERAL_GROUP,
      origin_scope: 'erga_omnes',
      applies_to_origin_country: null,
      duty: entry.candidate.general_duty,
      conditions: {
        statistical_unit: commodity?.statistical_unit ?? null,
        supplementary_unit: commodity?.supplementary_unit ?? null,
        country_group: GENERAL_GROUP,
      },
      effective_from: entry.candidate.effective_from ?? null,
      effective_to: entry.candidate.effective_to ?? null,
      source_reference: `Tolletaten tollavgiftssats ${bundle.release_identifier} · ${entry.candidate.national_tariff_code} (${GENERAL_GROUP})`,
      raw_measure: { code: entry.candidate.national_tariff_code, group: GENERAL_GROUP, rate: entry.general },
    });

    if (entry.india) {
      const group = bundle.country_groups.get(entry.india.group);
      lines.push({
        national_tariff_code: entry.candidate.national_tariff_code,
        description: entry.candidate.description,
        declarable: true,
        measure_kind: 'tariff_preference',
        origin_geographic_area_id: entry.india.group,
        origin_scope: 'programme',
        applies_to_origin_country: 'IN',
        duty: parseNorwayDuty(entry.india.rate),
        conditions: {
          country_group: entry.india.group,
          country_group_name: group?.name ?? null,
          tolletaten_preference_code: group?.preference_code ?? null,
          requires_origin_proof: true,
        },
        effective_from: parseDate(entry.india.rate.valid_from),
        effective_to: parseDate(entry.india.rate.valid_to),
        source_reference: `Tolletaten tollavgiftssats ${bundle.release_identifier} · ${entry.candidate.national_tariff_code} (${entry.india.group})`,
        raw_measure: { code: entry.candidate.national_tariff_code, group: entry.india.group, rate: entry.india.rate },
      });
    }
  }

  const resolvedEntry = resolution.resolved_line
    ? built.find((entry) => entry.candidate.national_tariff_code === resolution.resolved_line!.national_tariff_code)
    : null;

  const indiaPreference = resolvedEntry
    ? (resolvedEntry.india
      ? determineIndiaPreference({
        direct_india_measures: [{
          geographic_area_id: resolvedEntry.india.group,
          duty: parseNorwayDuty(resolvedEntry.india.rate),
          is_quota: false,
        }],
        proven_group_measures: [],
        beneficiary_enumeration_is_complete: true,
        unresolved_program_symbols: [],
      })
      : {
        applicability: 'not_applicable' as const,
        duty: null,
        geographic_area_id: null,
        basis: `Tolletaten publishes no India-specific country-group rate (${INDIA_GROUPS.join(', ')}) in force for ${resolvedEntry.candidate.national_tariff_code} at the assessment date. The groups exist in the authority's own vocabulary, so their absence for this line is observed evidence rather than missing data.`,
      })
    : {
      applicability: 'unknown' as const,
      duty: null,
      geographic_area_id: null,
      basis: 'No single Norwegian commodity number resolved for this HS6, so no line-specific India treatment can be stated.',
    };

  const parserVersion = args.parser_version ?? NORWAY_PARSER_VERSION;
  return {
    jurisdiction: 'NO',
    country_code: 'NO',
    hs6,
    hs_revision: `HS / Norwegian Customs Tariff — Tolletaten ${bundle.release_identifier}`,
    provider: NORWAY_PROVIDER,
    source_authority: NORWAY_SOURCE_AUTHORITY,
    source_dataset: NORWAY_SOURCE_DATASET,
    source_dataset_version: `${bundle.release_identifier}${bundle.rates_version ? ` (rates v${bundle.rates_version})` : ''}`,
    source_reference: `https://data.toll.no/ (bundle sha256 ${bundle.checksum})`,
    national_code_system: 'NO_VARENUMMER',
    parser_version: parserVersion,
    source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution,
    general_duty: resolution.resolved_line ? resolution.resolved_line.general_duty : null,
    india_preference: indiaPreference,
    lines,
    requirements: [],
    // The duty datasets prove tariff treatment only. Tolletaten publishes import restrictions as a
    // separate dataset that this release does not yet carry, so nothing here can establish that a
    // good faces no regulatory requirement.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: bundle.release_identifier,
      rates_version: bundle.rates_version,
      bundle_sha256: bundle.checksum,
      reader_version: bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      candidate_codes: built.map((entry) => entry.candidate.national_tariff_code),
      india_groups_considered: [...INDIA_GROUPS],
    },
  };
}
