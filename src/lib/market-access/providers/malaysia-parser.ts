import { MarketAccessRuleType } from '@prisma/client';
import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type CandidateTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { MalaysiaAuthorityBundle } from './malaysia-bundle';
import { MALAYSIA_RIGHTS_STATUS } from './malaysia-bundle';
import { selectMalaysiaTradeRemedies } from './malaysia-remedies';

export const MALAYSIA_PARSER_VERSION = 'my-jkdm-customs-atlas-parser-v1' as const;
export const MALAYSIA_PROVIDER = 'my_jkdm_customs_duties_order' as const;
export const MALAYSIA_SOURCE_AUTHORITY = 'Royal Malaysian Customs Department (JKDM/RMCD)' as const;
export const MALAYSIA_SOURCE_DATASET = 'Customs Duties Order 2025 P.U. (A) 384/2025, First Schedule and Appendix B' as const;
const EFFECTIVE_FROM = new Date('2025-11-01T00:00:00.000Z');

function remedyDuty(rate: number): ParsedDuty {
  return { kind: 'ad_valorem', ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression: `${rate}% of CIF value`, note: 'Separate anti-dumping duty; it does not replace or alter the First Schedule MFN rate.' };
}

export function buildMalaysiaMarketAccess(args: { bundle: MalaysiaAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; producer_or_exporter?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(); const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const entries = args.at < EFFECTIVE_FROM ? [] : [...args.bundle.lines.values()].filter((line) => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code));
  const candidates: CandidateTariffLine[] = entries.map((line) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    effective_from: EFFECTIVE_FROM, effective_to: null, general_duty: line.cells.import_duty!,
    control_codes: args.bundle.trq.has(line.code) ? ['MY_TRQ_APPENDIX_B'] : [], preference_area_ids: origin === 'IN' ? ['MICECA_UNRESOLVED_CURRENT_MAPPING'] : [],
  }));
  const resolution = resolveNationalTariffLine(candidates); const lines: MarketAccessLineRecord[] = []; const requirements: MarketAccessRequirementRecord[] = [];
  for (const entry of entries) {
    const trq = args.bundle.trq.get(entry.code); const published = entry.cells.import_duty!;
    lines.push({ national_tariff_code: entry.code, description: entry.description, declarable: true,
      measure_kind: trq ? 'tariff_quota' : 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null,
      duty: published, conditions: trq ? {
        quota_availability: 'not_established', never_assume_in_quota: true, quota_evidence_required: true, quota_agency: trq.quota_agency,
        in_quota_duty: trq.in_quota_duty, out_of_quota_duty: trq.out_of_quota_duty, appendix: 'Appendix B',
      } : { authority_column: 5, export_duty_column_6_excluded: true, passenger_non_commercial_flat_rate_excluded: true, schedule_unit: entry.unit ?? '' },
      effective_from: EFFECTIVE_FROM, effective_to: null,
      source_reference: `P.U. (A) 384/2025 · First Schedule · page ${entry.source_pages.join(', ')} · ${entry.code}${trq ? ` · Appendix B page ${trq.source_page}` : ''}`,
      raw_measure: { expression: entry.raw_cells.import_duty ?? '', schedule_unit: entry.unit ?? '', trq: trq ?? null },
    });
  }
  const resolvedCode = resolution.resolved_line?.national_tariff_code;
  const remedy = resolvedCode ? selectMalaysiaTradeRemedies({ manifest: args.bundle.remedies, code: resolvedCode, origin_country: origin, at: args.at, producer_or_exporter: args.producer_or_exporter }) : { status: 'not_applicable' as const, remedies: [] as const };
  if (remedy.status === 'producer_refinement_required') requirements.push({
    rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'MY_ANTI_DUMPING_PRODUCER_EXPORTER_IDENTITY',
    requirement_description: 'A Malaysian anti-dumping schedule covers this line and origin. The exact producer or exporter identity is required before a rate can be selected.',
    requirement_obtainable: true, national_tariff_code: resolvedCode ?? null, effective_from: null, effective_to: null,
    source_reference: remedy.candidates.map((item) => item.instrument).join('; '),
    raw: { resolution_status: 'producer_refinement_required', required_input: 'producer_or_exporter_identity', candidate_instruments: remedy.candidates.map((item) => item.instrument) },
  });
  if (remedy.status === 'applicable') for (const selected of remedy.remedies) lines.push({
    national_tariff_code: resolvedCode!, description: selected.remedy.description, declarable: true,
    measure_kind: 'additional_duty', origin_geographic_area_id: origin, origin_scope: 'country', applies_to_origin_country: origin,
    duty: remedyDuty(selected.rate.rate_percent_cif), conditions: { trade_remedy: 'anti_dumping', producer_or_exporter: selected.rate.producer_or_exporter, catch_all_rate: selected.rate.catch_all,
      separate_from_mfn: true, operation: selected.remedy.operation, cif_basis: true },
    effective_from: new Date(`${selected.remedy.effective_from}T00:00:00.000Z`), effective_to: new Date(`${selected.remedy.effective_to}T23:59:59.999Z`),
    source_reference: `${selected.remedy.instrument}${selected.remedy.amendments.length ? ` as amended by ${selected.remedy.amendments.join(', ')}` : ''}`,
    raw_measure: { remedy_id: selected.remedy.id, source_url: selected.remedy.source_url, source_sha256: selected.remedy.source_sha256, source_documents: selected.remedy.source_documents },
  });
  const indiaPreference = origin !== 'IN'
    ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India; MICECA is not selected.` }
    : { applicability: 'potentially_applicable_requires_origin_proof' as const, duty: null, geographic_area_id: 'MY_MICECA',
      basis: 'MICECA exists and origin proof is required, but no current HS 2022/Customs Duties Order 2025 line mapping was established from the reviewed official materials; no line rate is guessed.',
      source_authority: 'Ministry of Investment, Trade and Industry Malaysia (MITI)', source_reference: 'https://fta.miti.gov.my/index.php/pages/view/Malaysia-India',
      raw_evidence: { preference_exists: true, historical_order: 'P.U. (A) 215/2011', current_line_mapping: 'unresolved', certificate_of_origin_required: true } };
  const parserVersion = args.parser_version ?? MALAYSIA_PARSER_VERSION;
  return { jurisdiction: 'MY', country_code: 'MY', hs6, hs_revision: `AHTN/HS 2022 under P.U. (A) 384/2025 — ${args.bundle.release_identifier}`,
    provider: MALAYSIA_PROVIDER, source_authority: MALAYSIA_SOURCE_AUTHORITY, source_dataset: MALAYSIA_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier, source_reference: `${args.bundle.source_url} (local bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'MY_CUSTOMS_DUTIES_ORDER', parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};producer=${args.producer_or_exporter?.trim() || 'UNRESOLVED'};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution,
    general_duty: resolution.resolved_line?.general_duty ?? null, india_preference: indiaPreference, lines, requirements,
    regulatory_coverage_complete: false,
    raw_evidence: { authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: args.release_reference_date.toISOString().slice(0, 10),
      reader_version: args.bundle.reader_version, parser_version: parserVersion, tariff_line_count: args.bundle.lines.size, trq_line_count: args.bundle.trq.size,
      candidate_codes: entries.map((entry) => entry.code), origin_country: origin, rights_status: MALAYSIA_RIGHTS_STATUS,
      tariff_treatment_complete: true, regulatory_coverage_complete: false,
      sales_tax: { coverage: 'partial_separate', source: 'MySST 2025 principal orders with July/August 2026 amendment chain', stacked_into_customs_duty: false },
      miceca: { preference_exists: true, current_line_mapping_available: false, origin_proof_required: true },
      trade_remedy_resolution: remedy.status,
      passenger_non_commercial_rate_excluded: true, export_duty_column_excluded: true,
      omitted_regulatory_layer: 'P.U. (A) 384/2025 does not prove the complete prohibition, permit, standards or other regulatory corpus; absence of a parsed requirement is not evidence of unrestricted import.',
    } };
}
