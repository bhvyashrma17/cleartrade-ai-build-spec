import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine } from '@/lib/market-access/tariff-semantics';
import { MarketAccessRuleType } from '@prisma/client';
import { KUWAIT_PARSER_VERSION, type KuwaitAuthorityBundle, type KuwaitTariffLine } from './kuwait-bundle';
import { selectKuwaitTradeRemedies, unresolvedKuwaitRemedyDuty } from './kuwait-remedies';

export const KUWAIT_PROVIDER = 'kw_customs_integrated_tariff' as const;
export const KUWAIT_SOURCE_AUTHORITY = 'Kuwait General Administration of Customs' as const;
export const KUWAIT_SOURCE_DATASET = 'Kuwait GCC Integrated Customs Tariff (12 digit) live public HS Code portal, with Customs Instructions national-rate and anti-dumping overlays through 2026-09-23' as const;
const BASE_FROM = '2025-01-01';
const date = (value: Date) => value.toISOString().slice(0, 10);
const clone = (line: KuwaitTariffLine): KuwaitTariffLine => ({ ...line, duty: { ...line.duty }, source_pages: [...line.source_pages] });

/**
 * Kuwait's base source is the LIVE current portal, not a dated historical document, so it is already
 * authoritative for any date on/after the 2025-01-01 Instruction 57 baseline. There is no separate
 * structural-amendment layer to reconstruct backward from; the only date-sensitive component is the
 * anti-dumping remedy manifest, applied by `buildKuwaitMarketAccess` based on each measure's own
 * effective window.
 */
export function replayKuwaitTariff(bundle: KuwaitAuthorityBundle, at: Date) {
  const on = date(at);
  if (on < BASE_FROM) return new Map<string, KuwaitTariffLine>();
  return new Map([...bundle.schedule_lines].map(([code, line]) => [code, clone(line)]));
}

export function buildKuwaitMarketAccess(args: { bundle: KuwaitAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(), origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const replayed = replayKuwaitTariff(args.bundle, args.at), entries = [...replayed.values()].filter(line => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code));
  const candidates = entries.map(line => ({ national_tariff_code: line.code, description: line.description, declarable: line.declarable, effective_from: new Date(`${line.effective_from}T00:00:00.000Z`), effective_to: line.effective_to ? new Date(`${line.effective_to}T23:59:59.999Z`) : null, general_duty: line.duty, control_codes: [], preference_area_ids: [] }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = entries.map(line => ({ national_tariff_code: line.code, description: line.description, declarable: line.declarable, measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: line.duty, conditions: { regional_integrated_base_separate_from_kuwait_national_overlays: true }, effective_from: new Date(`${line.effective_from}T00:00:00.000Z`), effective_to: line.effective_to ? new Date(`${line.effective_to}T23:59:59.999Z`) : null, source_reference: line.source, raw_measure: { source_pages: line.source_pages, expression: line.duty.expression } }));
  const resolvedCode = resolution.resolved_line?.national_tariff_code ?? '', remedies = selectKuwaitTradeRemedies({ manifest: args.bundle.remedies, code: resolvedCode, origin_country: origin, at: args.at }), requirements: MarketAccessRequirementRecord[] = [];
  if (remedies.status === 'producer_refinement_required') {
    for (const remedy of remedies.candidates) lines.push({ national_tariff_code: resolvedCode, description: remedy.product, declarable: true, measure_kind: 'additional_duty', origin_geographic_area_id: origin, origin_scope: 'country', applies_to_origin_country: origin, duty: unresolvedKuwaitRemedyDuty(remedy), conditions: { component: 'ANTI_DUMPING', instrument: remedy.id, producer_or_exporter_identity_required: true, rate_not_selected_from_origin_alone: true, ongoing_pending_sunset_review: remedy.ongoing_pending_sunset_review, required_evidence: remedies.required_evidence }, effective_from: new Date(`${remedy.effective_from}T00:00:00.000Z`), effective_to: remedy.effective_until ? new Date(`${remedy.effective_until}T23:59:59.999Z`) : null, source_reference: remedy.source_url, raw_measure: remedy });
    requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'KW_ANTIDUMPING_IDENTITY_EVIDENCE', requirement_description: 'An active Kuwait/GCC anti-dumping measure matches this line and origin. Producer/exporter and commercial-invoice evidence plus the applicable detailed schedule are required before selecting the additional duty.', requirement_obtainable: true, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: remedies.candidates[0]!.source_url, raw: { required_evidence: remedies.required_evidence, candidate_measure_ids: remedies.candidates.map(item => item.id) } });
  }
  const parser_version = args.parser_version ?? KUWAIT_PARSER_VERSION;
  return {
    jurisdiction: 'KW', country_code: 'KW', hs6, hs_revision: `GCC HS 2022 / Kuwait 12-digit integrated tariff — ${args.bundle.release_identifier}`, provider: KUWAIT_PROVIDER, source_authority: KUWAIT_SOURCE_AUTHORITY, source_dataset: KUWAIT_SOURCE_DATASET, source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`, national_code_system: 'GCC_INTEGRATED', parser_version, source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${date(args.at)}`, retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution, general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'The India-GCC Free Trade Agreement remains at Terms-of-Reference/negotiation stage as of 2026-09-23 (signed 2026-02-05); no operative preferential goods agreement exists between India and Kuwait.', source_authority: 'Press Information Bureau, Government of India / Kuwait General Administration of Customs', source_reference: 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2223875&reg=3&lang=1' },
    lines, requirements, regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: args.release_reference_date.toISOString().slice(0, 10), reader_version: args.bundle.reader_version, parser_version,
      schedule_unique_code_count: args.bundle.schedule_lines.size,
      active_remedy_count: args.bundle.remedies.measures.length, remedy_register_enumeration_complete: args.bundle.remedies.register_enumeration_complete, remedy_status: remedies.status, tariff_treatment_complete: remedies.status === 'not_applicable',
      regulatory_coverage_complete: false, omitted_regulatory_layer: 'Ordinary permits, prohibitions and product-control requirements are not represented by this tariff provider.',
    },
  };
}
