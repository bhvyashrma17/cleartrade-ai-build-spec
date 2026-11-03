import { MarketAccessRuleType } from '@prisma/client';
import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { determineIndiaPreference, resolveNationalTariffLine, type CandidateTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { OmanAuthorityBundle, OmanIndiaCategory, OmanTariffLine } from './oman-bundle';

export const OMAN_PARSER_VERSION = 'rop-customs-tariff-parser-v1' as const;
export const OMAN_PROVIDER = 'om_rop_customs_tariff' as const;
export const OMAN_SOURCE_AUTHORITY = 'Royal Oman Police, Directorate General of Customs' as const;
export const OMAN_SOURCE_DATASET = 'Oman Customs Tariff 2026 with additional customs measures and Oman–India CEPA schedule' as const;

const TARIFF_EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');
const CEPA_EFFECTIVE_FROM = new Date('2026-06-01T00:00:00.000Z');
const CERAMIC_ANTIDUMPING_CONTINUED_FROM = new Date('2025-06-06T00:00:00.000Z');

function percentage(rate: number, note: string | null = null): ParsedDuty {
  return {
    kind: 'ad_valorem', ad_valorem_rate_percent: rate, specific_amount: null,
    specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression: `${rate}%`, note,
  };
}

function indiaSchedule(category: OmanIndiaCategory | null, at: Date) {
  if (!category || category === 'E' || category === 'X' || at < CEPA_EFFECTIVE_FROM) return null;
  if (category === 'A') return { rate: 0, from: CEPA_EFFECTIVE_FROM, to: null as Date | null };
  const rates = category === 'B' ? [4, 3, 2, 1, 0] : [4.5, 4, 3.5, 3, 2.5, 2, 1.5, 1, 0.5, 0];
  const yearIndex = Math.max(0, Math.min(rates.length - 1, at.getUTCFullYear() - 2026 - (at.getUTCMonth() < 5 ? 1 : 0)));
  const from = new Date(Date.UTC(2026 + yearIndex, 5, 1));
  const to = yearIndex === rates.length - 1 ? null : new Date(Date.UTC(2027 + yearIndex, 5, 1) - 1);
  return { rate: rates[yearIndex]!, from, to };
}

type CeramicRemedyScope = { kind: 'producer'; country: 'CN' | 'IN' } | { kind: 'exporter_country'; country: 'CN' | 'IN'; excludes_origin: 'CN' | 'IN' };

function ceramicRemedyScope(line: OmanTariffLine): CeramicRemedyScope | null {
  if (!/^6907(?:21|22|23|40)0009(?:01|02|03|05|06|07|08|09|11|12)$/.test(line.code)) return null;
  const suffix = line.code.slice(-2);
  if (['01', '02', '03', '05'].includes(suffix)) return { kind: 'producer', country: 'CN' };
  if (['07', '08', '09', '11'].includes(suffix)) return { kind: 'producer', country: 'IN' };
  if (suffix === '06') return { kind: 'exporter_country', country: 'CN', excludes_origin: 'CN' };
  return { kind: 'exporter_country', country: 'IN', excludes_origin: 'IN' };
}

function lineCanApplyToOrigin(line: OmanTariffLine, origin: string) {
  const scope = ceramicRemedyScope(line);
  if (!scope) return true;
  if (scope.kind === 'producer') return origin === scope.country;
  // The authority expressly covers non-origin goods exported from China/India. Origin alone
  // cannot exclude the line unless it is the country the row says is *not* the origin.
  return origin !== scope.excludes_origin;
}

function controlsFor(line: OmanTariffLine) {
  const remedyScope = ceramicRemedyScope(line);
  return [
    ...(line.additional_duty ? [`ADDITIONAL_DUTY:${line.additional_duty.expression}`] : []),
    ...(remedyScope ? [`ANTIDUMPING_SCOPE:${remedyScope.kind}:${remedyScope.country}:${line.code.slice(-2)}`] : []),
    ...(line.prohibited ? ['IMPORT_PROHIBITION'] : []),
  ];
}

export function buildOmanMarketAccess(args: {
  bundle: OmanAuthorityBundle;
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
  const entries = args.at < TARIFF_EFFECTIVE_FROM ? [] : [...args.bundle.lines.values()]
    .filter((line) => line.code.startsWith(hs6) && lineCanApplyToOrigin(line, origin))
    .sort((left, right) => left.code.localeCompare(right.code));
  const candidates: CandidateTariffLine[] = entries.map((line) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    effective_from: TARIFF_EFFECTIVE_FROM, effective_to: null,
    general_duty: line.general_duty, control_codes: controlsFor(line),
    preference_area_ids: indiaSchedule(line.india_category, args.at) ? [`OM_IN_CEPA_${line.india_category}`] : [],
  }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  const requirements: MarketAccessRequirementRecord[] = [];

  for (const entry of entries) {
    lines.push({
      national_tariff_code: entry.code, description: entry.description, declarable: true,
      measure_kind: 'third_country_duty', origin_geographic_area_id: null,
      origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: entry.general_duty,
      conditions: { authority_column: 'general_duty' }, effective_from: TARIFF_EFFECTIVE_FROM, effective_to: null,
      source_reference: `Oman Customs Tariff 2026 · page ${entry.source_pages.join(', ')} · ${entry.code}`,
      raw_measure: { authority_column: 'general_duty', expression: entry.general_duty.expression },
    });
    if (entry.additional_duty) {
      const remedyScope = ceramicRemedyScope(entry);
      lines.push({
      national_tariff_code: entry.code, description: entry.description, declarable: true,
      measure_kind: 'additional_duty', origin_geographic_area_id: null, origin_scope: 'unknown',
      applies_to_origin_country: null, duty: entry.additional_duty,
      conditions: remedyScope ? {
        authority_column: 'additional_duty', legal_measure: 'anti_dumping', calculation_basis: 'percentage_of_CIF',
        separate_trade_remedy_component_not_a_replacement_tariff: true,
        producer_or_exporter_identity_required: true, scope_kind: remedyScope.kind,
        scoped_country: remedyScope.country,
        ...(remedyScope.kind === 'exporter_country' ? { expressly_excludes_origin_country: remedyScope.excludes_origin } : {}),
        identity_not_resolved_by_origin_country: true,
      } : {
        authority_column: 'additional_duty', legal_measure: 'unclassified_additional_customs_measure',
        separate_component_not_a_replacement_tariff: true,
      },
      effective_from: remedyScope ? CERAMIC_ANTIDUMPING_CONTINUED_FROM : TARIFF_EFFECTIVE_FROM, effective_to: null,
      source_reference: remedyScope
        ? `Oman Customs Tariff 2026 · page ${entry.source_pages.join(', ')} · ${entry.code}; GCC Anti-Dumping Official Gazette 55 (21 April 2026)`
        : `Oman Customs Tariff 2026 · page ${entry.source_pages.join(', ')} · ${entry.code} additional-duty column`,
      raw_measure: { authority_column: 'additional_duty', expression: entry.additional_duty.expression, remedy_scope: remedyScope },
      });
    }
    const preference = origin === 'IN' ? indiaSchedule(entry.india_category, args.at) : null;
    if (preference) lines.push({
      national_tariff_code: entry.code, description: entry.description, declarable: true,
      measure_kind: 'tariff_preference', origin_geographic_area_id: 'IN', origin_scope: 'country',
      applies_to_origin_country: 'IN', duty: percentage(preference.rate),
      conditions: {
        agreement: 'Oman–India Comprehensive Economic Partnership Agreement', category: entry.india_category,
        requires_origin_proof: true,
        origin_criterion_must_be_established_from_annex_3b_for_this_product: true,
        possible_rule_classes_are_not_a_qualification_decision: ['WO', 'PSR'],
        qualification_status: 'not_established', direct_transport_or_approved_transit_required: true,
        customs_verification_may_require_security_or_refuse_preference: true,
      },
      effective_from: preference.from, effective_to: preference.to,
      source_reference: `Oman Customs Tariff 2026 · page ${entry.source_pages.join(', ')} · India category ${entry.india_category}; CEPA effective 1 June 2026`,
      raw_measure: { category: entry.india_category, staged_rate_percent: preference.rate, origin_proof_status: 'not_established_by_schedule' },
    });
    if (entry.prohibited) requirements.push({
      rule_type: MarketAccessRuleType.import_prohibition, requirement_code: 'OM_TARIFF_PROHIBITED',
      requirement_description: 'Oman Customs marks this tariff line prohibited (category E and/or a prohibited duty cell).',
      requirement_obtainable: false, national_tariff_code: entry.code,
      effective_from: TARIFF_EFFECTIVE_FROM, effective_to: null,
      source_reference: `Oman Customs Tariff 2026 · page ${entry.source_pages.join(', ')} · ${entry.code}`,
      raw: { india_category: entry.india_category, general_duty: entry.general_duty.expression, additional_duty: entry.additional_duty?.expression ?? null },
    });
  }

  const ceramicRemedyEntries = entries.filter((entry) => ceramicRemedyScope(entry));
  if (ceramicRemedyEntries.length) requirements.push({
    rule_type: MarketAccessRuleType.material_non_tariff_requirement,
    requirement_code: 'OM_ANTIDUMPING_PRODUCER_EXPORTER_IDENTITY',
    requirement_description: 'The GCC ceramic-tile anti-dumping rate depends on the producer/exporter category and, for re-export rows, the exporting country. Origin country alone cannot select the rate.',
    requirement_obtainable: true, national_tariff_code: null,
    effective_from: CERAMIC_ANTIDUMPING_CONTINUED_FROM, effective_to: null,
    source_reference: 'GCC Anti-Dumping Official Gazette 55 (21 April 2026), rate table and annexed producer/exporter lists',
    raw: { resolution_status: 'additional_evidence_required', required_inputs: ['producer_or_exporter_identity', 'exporting_country'], candidate_codes: ceramicRemedyEntries.map((entry) => entry.code) },
  });

  const resolvedEntry = resolution.resolved_line ? entries.find((line) => line.code === resolution.resolved_line!.national_tariff_code) : null;
  const resolvedPreference = origin === 'IN' && resolvedEntry ? indiaSchedule(resolvedEntry.india_category, args.at) : null;
  const indiaPreference = resolvedEntry && origin === 'IN'
    ? determineIndiaPreference({
      direct_india_measures: resolvedPreference ? [{ geographic_area_id: `OM_IN_CEPA_${resolvedEntry.india_category}`, duty: percentage(resolvedPreference.rate), is_quota: false }] : [],
      proven_group_measures: [], beneficiary_enumeration_is_complete: true, unresolved_program_symbols: [],
    })
    : resolvedEntry
      ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India; no India-origin measure is applied.` }
      : { applicability: 'unknown' as const, duty: null, geographic_area_id: null, basis: 'No single Omani tariff line resolved for this HS6, so line-specific India treatment cannot be stated.' };

  const parserVersion = args.parser_version ?? OMAN_PARSER_VERSION;
  return {
    jurisdiction: 'OM', country_code: 'OM', hs6,
    hs_revision: `HS / Oman Customs Tariff 2026 — acquired ${args.bundle.release_identifier}`,
    provider: OMAN_PROVIDER, source_authority: OMAN_SOURCE_AUTHORITY, source_dataset: OMAN_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.tariff_source_url} (composite bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'OM_CUSTOMS_TARIFF', parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: indiaPreference, lines, requirements,
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum,
      release_identifier: args.bundle.release_identifier, release_reference_date: args.release_reference_date.toISOString().slice(0, 10),
      reader_version: args.bundle.reader_version, table_parser_version: args.bundle.table_parser_version, parser_version: parserVersion,
      physical_row_count: args.bundle.physical_row_count, unique_tariff_code_count: args.bundle.lines.size,
      candidate_codes: entries.map((entry) => entry.code), origin_country: origin,
      tariff_treatment_complete: true, regulatory_coverage_complete: false,
      omitted_regulatory_layer: 'The live Oman permit/requirements lookup is not a versioned retained release; absence of a parsed requirement is not evidence of no restriction.',
      india_cepa: { effective_from: '2026-06-01', categories: ['A', 'B', 'C', 'E', 'X'], origin_proof_required: true, product_specific_rule_must_be_resolved_from_annex_3b: true, qualification_not_established_by_origin_country: true },
      ceramic_antidumping: { continued_from: '2025-06-06', duration: 'five additional years from original five-year expiry', calculation_basis: 'percentage_of_CIF', current_rates_source: 'GCC Official Gazette 55 and Oman Customs current ceramic schedule', producer_or_exporter_identity_required: true, not_selected_from_origin_alone: true },
    },
  };
}
