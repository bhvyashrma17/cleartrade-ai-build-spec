import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { determineIndiaPreference, resolveNationalTariffLine, type CandidateTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { SingaporeAuthorityBundle, SingaporeTariffLine } from './singapore-bundle';

export const SINGAPORE_PARSER_VERSION = 'sg-sso-customs-duties-parser-v1' as const;
export const SINGAPORE_PROVIDER = 'sg_sso_customs_duties_order' as const;
export const SINGAPORE_SOURCE_AUTHORITY = 'Attorney-General’s Chambers of Singapore — Singapore Statutes Online' as const;
export const SINGAPORE_SOURCE_DATASET = 'Customs (Duties) Order (O 4), current consolidated First Schedule' as const;
const EFFECTIVE_FROM = new Date('2026-02-12T09:00:00.000Z'); // 17:00 Singapore Time

function duty(fields: Partial<ParsedDuty> & Pick<ParsedDuty, 'kind' | 'expression'>): ParsedDuty {
  return {
    ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
    specific_unit: null, specific_unit_quantity: null, note: null, ...fields,
  };
}

function legalZero(note: string) {
  return duty({ kind: 'ad_valorem', expression: 'NON-DUTIABLE', ad_valorem_rate_percent: 0, note });
}

/** Paragraph 2(2): imported duty is customs duty plus excise duty, with components retained. */
export function aggregateSingaporeImportDuty(customs: ParsedDuty, excise: ParsedDuty, nonDutiable: boolean): ParsedDuty {
  if (nonDutiable) return legalZero('All three First Schedule duty cells are blank and the line is outside Singapore Customs’ four dutiable categories. This is a joint statutory-and-Customs non-dutiable conclusion, not blank-as-zero.');
  if (customs.kind === 'none' && excise.kind === 'none') return duty({ kind: 'unparsed', expression: '', note: 'No import-duty component was extracted for a line not proven non-dutiable.' });
  if (customs.kind === 'none') return { ...excise, note: [excise.note, 'Excise duty is the only published import-duty component.'].filter(Boolean).join(' ') };
  if (excise.kind === 'none') return { ...customs, note: [customs.note, 'Customs duty is the only published import-duty component.'].filter(Boolean).join(' ') };
  if (customs.kind === 'ad_valorem' && customs.ad_valorem_rate_percent === 0) return { ...excise, note: [excise.note, 'The separately retained customs component is expressly Free.'].filter(Boolean).join(' ') };
  if (excise.kind === 'ad_valorem' && excise.ad_valorem_rate_percent === 0) return { ...customs, note: [customs.note, 'The separately retained excise component is expressly zero.'].filter(Boolean).join(' ') };
  if (customs.kind === 'ad_valorem' && excise.kind === 'ad_valorem') {
    return duty({ kind: 'ad_valorem', expression: `${customs.expression} customs + ${excise.expression} excise`, ad_valorem_rate_percent: customs.ad_valorem_rate_percent! + excise.ad_valorem_rate_percent!, note: 'Aggregate of separately retained ad-valorem customs and excise components under paragraph 2(2).' });
  }
  if (customs.kind === 'specific' && excise.kind === 'specific'
    && customs.specific_currency === excise.specific_currency && customs.specific_unit === excise.specific_unit
    && customs.specific_unit_quantity === excise.specific_unit_quantity) {
    return duty({ kind: 'specific', expression: `${customs.expression} customs + ${excise.expression} excise`, specific_amount: customs.specific_amount! + excise.specific_amount!, specific_currency: customs.specific_currency, specific_unit: customs.specific_unit, specific_unit_quantity: customs.specific_unit_quantity, note: 'Aggregate of separately retained compatible specific customs and excise components under paragraph 2(2).' });
  }
  return duty({ kind: 'compound', expression: `(${customs.expression}) customs + (${excise.expression}) excise`, note: 'The customs and excise components aggregate under paragraph 2(2), but remain distinct because their bases or duty kinds differ; no AVE is invented.' });
}

function preferentialCustoms(line: SingaporeTariffLine) {
  // Paragraph 4(2): absence of a preferential rate means the full customs rate applies.
  return line.preferential_customs_duty.kind === 'none' ? line.full_customs_duty : line.preferential_customs_duty;
}

function componentLine(line: SingaporeTariffLine, kind: 'CUSTOMS_DUTY' | 'PREFERENTIAL_CUSTOMS_DUTY' | 'EXCISE_DUTY', component: ParsedDuty, bundle: SingaporeAuthorityBundle): MarketAccessLineRecord {
  return {
    national_tariff_code: line.code, description: line.description, declarable: true,
    measure_kind: kind === 'CUSTOMS_DUTY' ? 'third_country_duty' : kind === 'PREFERENTIAL_CUSTOMS_DUTY' ? 'tariff_preference' : 'additional_duty',
    origin_geographic_area_id: kind === 'PREFERENTIAL_CUSTOMS_DUTY' ? 'SG_ISCECA' : null,
    origin_scope: kind === 'PREFERENTIAL_CUSTOMS_DUTY' ? 'programme' : 'erga_omnes',
    applies_to_origin_country: kind === 'PREFERENTIAL_CUSTOMS_DUTY' ? 'IN' : null,
    duty: component,
    conditions: kind === 'PREFERENTIAL_CUSTOMS_DUTY' ? {
      component: kind, agreement: 'India–Singapore Comprehensive Economic Co-operation Agreement',
      requires_origin_proof: true, certificate_of_origin_required: true, qualification_status: 'not_established',
      never_selected_from_origin_country_alone: true,
    } : { component: kind, separate_import_duty_component: true },
    effective_from: EFFECTIVE_FROM, effective_to: null,
    source_reference: `${bundle.source_url} · First Schedule · ${line.code} · ${kind}`,
    raw_measure: { component: kind, expression: component.expression, schedule_unit: line.unit, source_row: line.source_row },
  };
}

export function buildSingaporeMarketAccess(args: {
  bundle: SingaporeAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(); const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const entries = args.at < EFFECTIVE_FROM ? [] : [...args.bundle.lines.values()].filter((line) => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code));
  const aggregateFull = (line: SingaporeTariffLine) => aggregateSingaporeImportDuty(line.full_customs_duty, line.excise_duty, line.non_dutiable);
  const aggregatePreferential = (line: SingaporeTariffLine) => aggregateSingaporeImportDuty(preferentialCustoms(line), line.excise_duty, line.non_dutiable);
  const candidates: CandidateTariffLine[] = entries.map((line) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    effective_from: EFFECTIVE_FROM, effective_to: null, general_duty: aggregateFull(line), control_codes: [],
    preference_area_ids: origin === 'IN' ? ['SG_ISCECA'] : [],
  }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  for (const line of entries) {
    const full = line.non_dutiable ? legalZero('Joint SSO and Singapore Customs evidence establishes this line as non-dutiable.') : line.full_customs_duty;
    if (full.kind !== 'none') lines.push(componentLine(line, 'CUSTOMS_DUTY', full, args.bundle));
    const preferentialCustomsComponent = line.non_dutiable
      ? legalZero('Joint SSO and Singapore Customs evidence establishes this line as non-dutiable.')
      : preferentialCustoms(line);
    lines.push(componentLine(line, 'PREFERENTIAL_CUSTOMS_DUTY', preferentialCustomsComponent, args.bundle));
    if (line.excise_duty.kind !== 'none') lines.push(componentLine(line, 'EXCISE_DUTY', line.excise_duty, args.bundle));
  }
  const resolvedEntry = resolution.resolved_line ? entries.find((line) => line.code === resolution.resolved_line!.national_tariff_code) ?? null : null;
  const indiaPreference = resolvedEntry && origin === 'IN'
    ? determineIndiaPreference({
      direct_india_measures: [{ geographic_area_id: 'SG_ISCECA', duty: aggregatePreferential(resolvedEntry), is_quota: false }],
      proven_group_measures: [], beneficiary_enumeration_is_complete: true, unresolved_program_symbols: [],
    })
    : resolvedEntry
      ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India; ISCECA is not applied.` }
      : { applicability: 'unknown' as const, duty: null, geographic_area_id: null, basis: 'No single Singapore 8-digit line resolved, so line-specific ISCECA treatment cannot be stated.' };
  const parserVersion = args.parser_version ?? SINGAPORE_PARSER_VERSION;
  return {
    jurisdiction: 'SG', country_code: 'SG', hs6, hs_revision: `AHTN/STCCED 2022 under Customs (Duties) Order — ${args.bundle.release_identifier}`,
    provider: SINGAPORE_PROVIDER, source_authority: SINGAPORE_SOURCE_AUTHORITY, source_dataset: SINGAPORE_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (canonical tariff sha256 ${args.bundle.canonical_tariff_checksum}; bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'SG_CUSTOMS_DUTIES_ORDER', parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`, retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public', recorded_by_id: null, resolution,
    general_duty: resolution.resolved_line?.general_duty ?? null, india_preference: indiaPreference,
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, canonical_tariff_sha256: args.bundle.canonical_tariff_checksum,
      release_identifier: args.bundle.release_identifier, consolidated_as_at: args.bundle.consolidated_as_at,
      consolidated_effective_version: args.bundle.consolidated_effective_version, amendments: args.bundle.amendments,
      release_reference_date: args.release_reference_date.toISOString(), reader_version: args.bundle.reader_version,
      table_parser_version: args.bundle.table_parser_version, parser_version: parserVersion, tariff_line_count: args.bundle.lines.size,
      candidate_codes: entries.map((line) => line.code), origin_country: origin,
      tariff_treatment_complete: true, regulatory_coverage_complete: false,
      omitted_regulatory_layer: 'The Customs (Duties) Order does not prove the complete controlled-goods and permit corpus; absence of a parsed requirement is not evidence of unrestricted import.',
      import_duty_composition: 'Customs duty plus excise duty under paragraph 2(2); GST is excluded from this tariff result.',
      india_ceca: { preference_exists: true, rules_of_origin_and_certificate_required: true, qualification_not_established_by_origin_country: true },
      attribution: args.bundle.attribution,
    },
  };
}
