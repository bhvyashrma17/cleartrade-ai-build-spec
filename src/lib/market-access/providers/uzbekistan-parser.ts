import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { MarketAccessRuleType } from '@prisma/client';
import { UZBEKISTAN_BASE_FROM, UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM, UZBEKISTAN_PARSER_VERSION, type UzbekistanAuthorityBundle, type UzbekistanTariffLine } from './uzbekistan-bundle';
import { selectUzbekistanTradeRemedies } from './uzbekistan-remedies';

export const UZBEKISTAN_PROVIDER = 'uz_lex_customs_tariff' as const;
export const UZBEKISTAN_SOURCE_AUTHORITY = 'National Database of Legislation of the Republic of Uzbekistan (lex.uz) — President of the Republic of Uzbekistan' as const;
export const UZBEKISTAN_SOURCE_DATASET = 'PP-3818 Annex 1 import customs duty rates (PP-58/2026 consolidated edition) resolved over the PP-181 Annex 1 2022 TN VED nomenclature' as const;
const date = (value: Date) => value.toISOString().slice(0, 10);

/** The consolidated PP-58 edition is authoritative on/after its effective date; live footnote rates apply through their own end date. */
export function replayUzbekistanTariff(bundle: UzbekistanAuthorityBundle, at: Date) {
  const on = date(at);
  if (on < UZBEKISTAN_BASE_FROM) return new Map<string, UzbekistanTariffLine>();
  return new Map([...bundle.schedule_lines].map(([code, line]) => {
    const temporary = line.temporary && on <= line.temporary.until ? line.temporary : null;
    return [code, { ...line, duty: { ...(temporary?.duty ?? line.duty) }, declarable: temporary ? temporary.declarable : line.declarable, effective_to: temporary ? temporary.until : line.effective_to }];
  }));
}

/**
 * Customs Code art. 300¹: goods from a country Uzbekistan does not grant most-favoured-nation treatment,
 * or of unestablished origin, pay an additional duty banded by the line's ad-valorem rate. A rate of
 * exactly 10% or 20% sits on an ambiguous statutory boundary, so both candidate bands are shown.
 */
export function uzbekistanNonMfnAdditionalDuty(base: ParsedDuty): ParsedDuty {
  const rate = base.ad_valorem_rate_percent;
  const empty = { ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null };
  if (rate === null) return { kind: 'unparsed', ...empty, expression: 'Additional duty under Customs Code art. 300¹ if the origin is not an MFN-treatment country', note: 'The base rate has no ad-valorem component from which the statutory band can be selected.' };
  const bands = rate === 10 ? [5, 10] : rate === 20 ? [10, 15] : [rate < 10 ? 5 : rate < 20 ? 10 : rate < 30 ? 15 : 20];
  return { kind: 'unparsed', ...empty, expression: `Additional ${bands.map(value => `${value}%`).join(' or ')} (Customs Code art. 300¹) if the origin country is not an MFN-treatment partner or origin is not established`, note: bands.length > 1 ? `A ${rate}% base rate sits on the statutory band boundary; the band cannot be selected without an official interpretation.` : 'Applies only when the origin country lacks MFN treatment or origin is not established; never applied from origin alone.' };
}

export function buildUzbekistanMarketAccess(args: { bundle: UzbekistanAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(), origin = (args.origin_country ?? 'IN').trim().toUpperCase(), on = date(args.at);
  const entries = [...replayUzbekistanTariff(args.bundle, args.at).values()].filter(line => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code));
  const effective = (line: UzbekistanTariffLine) => ({ effective_from: new Date(`${line.effective_from}T00:00:00.000Z`), effective_to: line.effective_to ? new Date(`${line.effective_to}T23:59:59.999Z`) : null });
  const resolution = resolveNationalTariffLine(entries.map(line => ({ national_tariff_code: line.code, description: line.description, declarable: line.declarable, ...effective(line), general_duty: line.duty, control_codes: [], preference_area_ids: [] })));
  const lines: MarketAccessLineRecord[] = entries.map(line => ({
    national_tariff_code: line.code, description: line.description, declarable: line.declarable, measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: line.duty,
    conditions: { rate_grid_prefix: line.rate_prefix, supplementary_unit: line.unit, applies_to_mfn_treatment_origins: on >= UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM, temporary_footnote: line.temporary && on <= line.temporary.until ? line.temporary.footnote : null, end_use_condition: line.temporary && on <= line.temporary.until ? line.temporary.condition : null },
    ...effective(line), source_reference: line.source, raw_measure: { rate_grid_prefix: line.rate_prefix, rate_row_description: line.rate_row_description, expression: line.duty.expression },
  }));
  const resolved = resolution.resolved_line, requirements: MarketAccessRequirementRecord[] = [];
  const nonMfnExposure = on >= UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM && resolved !== null;
  if (nonMfnExposure) {
    lines.push({ national_tariff_code: resolved.national_tariff_code, description: 'Additional customs duty for goods of non-MFN or unestablished origin', declarable: false, measure_kind: 'additional_duty', origin_geographic_area_id: origin, origin_scope: 'country', applies_to_origin_country: origin, duty: uzbekistanNonMfnAdditionalDuty(resolved.general_duty), conditions: { component: 'NON_MFN_ADDITIONAL_DUTY', instrument: 'Customs Code art. 300¹ (ZRU-1097)', applies_only_if_origin_lacks_mfn_treatment_or_origin_unestablished: true, origin_mfn_status: 'unverified_requires_evidence' }, effective_from: new Date(`${UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM}T00:00:00.000Z`), effective_to: null, source_reference: 'https://lex.uz/docs/2876352', raw_measure: { base_expression: resolved.general_duty.expression } });
    requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'UZ_MFN_TREATMENT_ORIGIN_EVIDENCE', requirement_description: 'Uzbekistan levies an additional 5–20% duty (Customs Code art. 300¹, from 2026-02-28) on goods of non-MFN or unestablished origin. A certificate of origin and official confirmation that Uzbekistan grants the origin country MFN treatment are required before the tariff-grid rate alone can be declared.', requirement_obtainable: true, national_tariff_code: resolved.national_tariff_code, effective_from: new Date(`${UZBEKISTAN_NON_MFN_ADDITIONAL_DUTY_FROM}T00:00:00.000Z`), effective_to: null, source_reference: 'https://lex.uz/docs/2876352', raw: { origin_country: origin, india_bilateral_instrument: 'Uzbekistan–India Agreement on Trade and Economic Cooperation, in force 1993-05-24 (operative text not published on lex.uz)' } });
  }
  const remedies = selectUzbekistanTradeRemedies({ manifest: args.bundle.remedies, code: resolved?.national_tariff_code ?? '', origin_country: origin, at: args.at });
  const parser_version = args.parser_version ?? UZBEKISTAN_PARSER_VERSION;
  return {
    jurisdiction: 'UZ', country_code: 'UZ', hs6, hs_revision: `TN VED 2022 (PP-181) / PP-3818 Annex 1 — ${args.bundle.release_identifier}`, provider: UZBEKISTAN_PROVIDER, source_authority: UZBEKISTAN_SOURCE_AUTHORITY, source_dataset: UZBEKISTAN_SOURCE_DATASET, source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`, national_code_system: 'UZ_TN_VED', parser_version, source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${on}`, retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution, general_duty: resolved?.general_duty ?? null,
    india_preference: { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'No free-trade or preferential tariff regime between Uzbekistan and India exists in the National Database of Legislation; the only bilateral trade instrument is the 1993 Agreement on Trade and Economic Cooperation, and the Uzbekistan–Pakistan preferential arrangement does not extend to India.', source_authority: UZBEKISTAN_SOURCE_AUTHORITY, source_reference: 'https://lex.uz/docs/2651526' },
    lines, requirements, regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: date(args.release_reference_date), reader_version: args.bundle.reader_version, parser_version,
      schedule_unique_code_count: args.bundle.schedule_lines.size, active_remedy_count: 0, remedy_register_enumeration_complete: args.bundle.remedies.register_enumeration_complete, remedy_status: remedies.status, pending_remedy_work: remedies.pending_work.map(item => item.instrument),
      origin_mfn_status: nonMfnExposure ? 'unverified_requires_evidence' : 'not_yet_in_force', tariff_treatment_complete: !nonMfnExposure,
      regulatory_coverage_complete: false, omitted_regulatory_layer: 'VAT, excise, utilisation fees, certification and other non-tariff requirements are not represented by this tariff provider.',
    },
  };
}
