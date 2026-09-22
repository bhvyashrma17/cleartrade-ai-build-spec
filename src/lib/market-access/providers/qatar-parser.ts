import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { MarketAccessRuleType } from '@prisma/client';
import { QATAR_PARSER_VERSION, type QatarAuthorityBundle, type QatarTariffLine } from './qatar-bundle';
import { selectQatarTradeRemedies, unresolvedQatarRemedyDuty } from './qatar-remedies';

export const QATAR_PROVIDER = 'qa_customs_integrated_tariff' as const;
export const QATAR_SOURCE_AUTHORITY = 'Qatar General Authority of Customs, with Ministry of Commerce and Industry anti-dumping decisions' as const;
export const QATAR_SOURCE_DATASET = 'Qatar GCC Integrated Customs Tariff (12 digit) with Decree 63/2025 and Decree 31/2026 chronological overlays through 2026-09-23' as const;
const BASE_FROM = '2025-01-01', AMEND_2025 = '2025-06-01';
const date = (value: Date) => value.toISOString().slice(0, 10);
const clone = (line: QatarTariffLine): QatarTariffLine => ({ ...line, duty: { ...line.duty }, source_pages: [...line.source_pages] });
const blank = (reason: string): ParsedDuty => ({ kind: 'none', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '', note: reason });

/**
 * Qatar's current schedule artifact already reflects Decree 63/2025 and Decree 31/2026 cumulatively
 * (it is dated after both). Decree 31/2026's own itemised add/delete/description tables are not
 * machine-available (see `decree_31_2026.note`), so from 2025-06-01 onward the current schedule is
 * used directly; only the pre-2025-06-01 (Decree 98 baseline) window is reconstructed by reversing
 * Decree 63's known operations. This assumes Decree 31/2026 did not later touch the same codes Decree
 * 63/2025 touched, which is not independently provable without Decree 31's tables.
 */
export function replayQatarTariff(bundle: QatarAuthorityBundle, at: Date) {
  const on = date(at);
  if (on < BASE_FROM) return new Map<string, QatarTariffLine>();
  const lines = new Map([...bundle.schedule_lines].map(([code, line]) => [code, clone(line)]));
  if (on < AMEND_2025) {
    for (const operation of bundle.operations_2025) {
      if (operation.operation === 'ADD_CODE') lines.delete(operation.code);
      else if (operation.operation === 'DELETE_CODE') lines.set(operation.code, { code: operation.code, description: operation.description, declarable: false, duty: blank('Decree 63/2025 proves this line existed before its deletion but does not republish its former rate; no rate is inferred.'), source: operation.instrument, source_pages: [operation.source_page], effective_from: BASE_FROM, effective_to: '2025-05-31' });
      else if (operation.operation === 'RATE_REPLACE') { const prior = lines.get(operation.code); if (prior) lines.set(operation.code, { ...prior, duty: blank('Decree 63/2025 replaced this line’s rate on 2025-06-01 but the pre-replacement Decree 98/2024 rate was not separately published; no rate is inferred for the base period.') }); }
    }
  }
  return lines;
}

export function buildQatarMarketAccess(args: { bundle: QatarAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(), origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const replayed = replayQatarTariff(args.bundle, args.at), entries = [...replayed.values()].filter(line => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code));
  const candidates = entries.map(line => ({ national_tariff_code: line.code, description: line.description, declarable: line.declarable, effective_from: new Date(`${line.effective_from}T00:00:00.000Z`), effective_to: line.effective_to ? new Date(`${line.effective_to}T23:59:59.999Z`) : null, general_duty: line.duty, control_codes: [], preference_area_ids: [] }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = entries.map(line => ({ national_tariff_code: line.code, description: line.description, declarable: line.declarable, measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: line.duty, conditions: { regional_integrated_base_separate_from_qatar_national_overlays: true }, effective_from: new Date(`${line.effective_from}T00:00:00.000Z`), effective_to: line.effective_to ? new Date(`${line.effective_to}T23:59:59.999Z`) : null, source_reference: line.source, raw_measure: { source_pages: line.source_pages, expression: line.duty.expression } }));
  const resolvedCode = resolution.resolved_line?.national_tariff_code ?? '', remedies = selectQatarTradeRemedies({ manifest: args.bundle.remedies, code: resolvedCode, origin_country: origin, at: args.at }), requirements: MarketAccessRequirementRecord[] = [];
  if (remedies.status === 'producer_refinement_required') {
    for (const remedy of remedies.candidates) lines.push({ national_tariff_code: resolvedCode, description: remedy.product, declarable: true, measure_kind: 'additional_duty', origin_geographic_area_id: origin, origin_scope: 'country', applies_to_origin_country: origin, duty: unresolvedQatarRemedyDuty(remedy), conditions: { component: 'ANTI_DUMPING', instrument: remedy.id, evidence_grade: remedy.evidence_grade, producer_or_exporter_identity_required: true, rate_not_selected_from_origin_alone: true, required_evidence: remedies.required_evidence }, effective_from: new Date(`${remedy.effective_from}T00:00:00.000Z`), effective_to: remedy.effective_until ? new Date(`${remedy.effective_until}T23:59:59.999Z`) : null, source_reference: remedy.source_url, raw_measure: remedy });
    requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'QA_ANTIDUMPING_IDENTITY_EVIDENCE', requirement_description: 'An active Qatar/GCC anti-dumping measure matches this line and origin. Producer/exporter and commercial-invoice evidence plus the applicable detailed schedule are required before selecting the additional duty.', requirement_obtainable: true, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: remedies.candidates[0]!.source_url, raw: { required_evidence: remedies.required_evidence, candidate_measure_ids: remedies.candidates.map(item => item.id) } });
  }
  const parser_version = args.parser_version ?? QATAR_PARSER_VERSION;
  return {
    jurisdiction: 'QA', country_code: 'QA', hs6, hs_revision: `GCC HS 2022 / Qatar 12-digit integrated tariff — ${args.bundle.release_identifier}`, provider: QATAR_PROVIDER, source_authority: QATAR_SOURCE_AUTHORITY, source_dataset: QATAR_SOURCE_DATASET, source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`, national_code_system: 'GCC_INTEGRATED', parser_version, source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${date(args.at)}`, retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution, general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'Qatar Customs’ complete official Agreements register at 2026-09-23 lists only a bilateral customs-cooperation agreement with India, not a preferential goods tariff agreement; India origin does not create a preference.', source_authority: 'General Authority of Customs (Qatar)', source_reference: 'https://www.customs.gov.qa/English/Legislations/Pages/Customs-Agreements.aspx' },
    lines, requirements, regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: args.release_reference_date.toISOString().slice(0, 10), reader_version: args.bundle.reader_version, parser_version,
      schedule_unique_code_count: args.bundle.schedule_lines.size, overlay_counts: { decree_63_2025: args.bundle.operations_2025.length }, decree_31_2026_tables_machine_available: args.bundle.decree_31_2026.tables_machine_available,
      active_remedy_count: args.bundle.remedies.measures.length, remedy_register_enumeration_complete: args.bundle.remedies.register_enumeration_complete, remedy_status: remedies.status, tariff_treatment_complete: remedies.status === 'not_applicable',
      regulatory_coverage_complete: false, omitted_regulatory_layer: 'Ordinary permits, prohibitions beyond the tariff schedule’s own explicit PROHIBITED lines, and product-control requirements are not represented by this tariff provider.',
    },
  };
}
