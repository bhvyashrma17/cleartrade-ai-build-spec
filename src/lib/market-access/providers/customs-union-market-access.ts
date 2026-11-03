/**
 * D-028 — one member's market access from its customs union's common external tariff.
 *
 * The duty is the union's published line for the product, read as official and labelled a common
 * tariff (`raw_evidence.common_tariff`): national exceptions are not modelled, which every result
 * says, member by member. Where the release itself records that a member applies a line differently
 * (an EAC stay of application, an EAEU tariff note), no duty is stated for that member and the
 * reason is kept, so the product falls back to the estimate and the agent's pointer to the national
 * source. A release past its validity (the EAC's year of measures) states nothing at all.
 */
import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type CandidateTariffLine, type ClassificationResolutionResult } from '@/lib/market-access/tariff-semantics';
import type { CustomsUnionBundle } from './customs-union-bundle';
import type { CustomsUnionLine, CustomsUnionSource } from './customs-union-sources';

export const CUSTOMS_UNION_PARSER_VERSION = 'customs-union-market-access-v1' as const;

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const appliesTo = (line: CustomsUnionLine, member: string) => !!line.exception && (line.exception.members.length === 0 || line.exception.members.includes(member));

export function buildCustomsUnionMarketAccess(args: {
  source: CustomsUnionSource;
  bundle: CustomsUnionBundle;
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
  if (!source.members.includes(country)) throw new Error(`${country} is not served by the ${source.key} release.`);
  const effectiveFrom = day(bundle.effective_from);
  const validUntil = bundle.valid_until ? new Date(day(bundle.valid_until).getTime() + 86_400_000 - 1) : null;
  const inForce = args.at >= effectiveFrom && (!validUntil || args.at <= validUntil);
  const entries = inForce ? [...bundle.lines.values()].filter((line) => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code)) : [];
  const candidates: CandidateTariffLine[] = entries.map((line) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    effective_from: effectiveFrom, effective_to: validUntil, general_duty: line.duty, control_codes: [], preference_area_ids: [],
  }));
  const excepted = entries.filter((line) => appliesTo(line, country));
  let resolution: ClassificationResolutionResult;
  if (!inForce) {
    resolution = {
      resolution: 'unavailable', resolved_line: null, candidates: [], candidate_count: 0, differences: [],
      reason: args.at < effectiveFrom
        ? `The ${source.label} release ${bundle.release_identifier} is in force from ${bundle.effective_from}.`
        : `The ${source.label} release ${bundle.release_identifier} covers measures to ${bundle.valid_until}; the next year's measures must be imported before it is used again.`,
    };
  } else if (excepted.length) {
    resolution = {
      resolution: 'unavailable', resolved_line: null, candidates, candidate_count: candidates.length, differences: [],
      reason: `${excepted.map((line) => line.code).join(', ')} not read automatically for ${country} from the ${source.label}: ${excepted[0]!.exception!.reason}`,
    };
  } else {
    resolution = resolveNationalTariffLine(candidates);
  }
  const lines: MarketAccessLineRecord[] = entries.map((line) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null,
    duty: line.duty,
    conditions: { common_tariff: source.key, member: country, national_exceptions_modelled: false, ...(appliesTo(line, country) ? { applied_differently_by_member: true } : {}) },
    effective_from: effectiveFrom, effective_to: validUntil,
    source_reference: `${bundle.source_url} · ${line.locator} · ${line.code}`,
    raw_measure: { raw_rate: line.raw_rate, unit: line.unit, locator: line.locator, exception: line.exception },
  }));
  const parserVersion = args.parser_version ?? CUSTOMS_UNION_PARSER_VERSION;
  return {
    jurisdiction: country, country_code: country, hs6, hs_revision: `HS2022 (${source.label}, ${bundle.release_identifier})`,
    provider: source.provider, source_authority: source.authority, source_dataset: source.name,
    source_dataset_version: bundle.release_identifier,
    source_reference: `${bundle.source_url} (bundle sha256 ${bundle.checksum})`,
    national_code_system: source.national_code_system, parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `member=${country};origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`, retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public', recorded_by_id: null, resolution,
    general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: { applicability: origin === 'IN' ? source.india_preference.applicability : 'not_applicable', duty: null, geographic_area_id: null, basis: origin === 'IN' ? source.india_preference.basis : `The requested origin is ${origin}, not India.` },
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: {
      common_tariff: { union: source.key, label: source.label, member: country, national_exceptions_modelled: false, note: source.member_notes[country] ?? null },
      authority_release_id: args.release_id, bundle_sha256: bundle.checksum, release_identifier: bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(), effective_from: bundle.effective_from, valid_until: bundle.valid_until,
      provenance: bundle.provenance, reader_version: bundle.reader_version, parser_version: parserVersion,
      tariff_line_count: bundle.lines.size, candidate_codes: entries.map((line) => line.code),
      ...(excepted.length ? { applied_differently: excepted.map((line) => ({ code: line.code, reason: line.exception!.reason })) } : {}),
      origin_country: origin, tariff_treatment_complete: false, regulatory_coverage_complete: false,
      omitted_regulatory_layer: 'A common external tariff does not prove import controls, licences or national taxes; absence of a requirement here is not evidence of unrestricted import.',
    },
  };
}
