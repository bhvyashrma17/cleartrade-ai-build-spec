import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { MarketAccessRuleType } from '@prisma/client';
import { parseVietnamDuty, VIETNAM_AIFTA_PERIODS, VIETNAM_BASE_FROM, VIETNAM_PARSER_VERSION, type VietnamAuthorityBundle, type VietnamTariffLine } from './vietnam-bundle';
import { selectVietnamTradeRemedies, vietnamRemedyDuty, vietnamRemedyProducerIdentityRequired } from './vietnam-remedies';

export const VIETNAM_PROVIDER = 'vn_congbao_tariff' as const;
export const VIETNAM_SOURCE_AUTHORITY = 'Government of Viet Nam — Official Gazette (Công báo) / Ministry of Industry and Trade Trade Remedies Authority' as const;
export const VIETNAM_SOURCE_DATASET = 'Decree 26/2023/NĐ-CP Annex II MFN schedule with Decrees 144/2024, 73/2025, 199/2025 and temporary 72/2026 (extended by Resolutions 25/2026 and 34/2026); AIFTA Decree 122/2022/NĐ-CP; MOIT trade remedies' as const;
const AIFTA_SOURCE = 'https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-122-2022-nd-cp-38802.htm';
const date = (value: Date) => value.toISOString().slice(0, 10);

export interface VietnamReplayedLine { line: VietnamTariffLine; /** The schedule (in-quota where a quota exists) rate in force on the date. */ expression: string; duty: ParsedDuty; declarable: boolean; effective_from: string; effective_to: string | null; instrument: string }

/** Latest version whose window contains the date; permanent amendments supersede the base, temporary ones supersede both while they run. */
export function replayVietnamTariff(bundle: VietnamAuthorityBundle, at: Date) {
  const on = date(at), out = new Map<string, VietnamReplayedLine>();
  if (on < VIETNAM_BASE_FROM) return out;
  for (const [code, line] of bundle.schedule_lines) {
    const applicable = line.versions.filter(version => version.from <= on && (!version.until || on <= version.until));
    const version = applicable.sort((a, b) => (a.until ? 1 : 0) - (b.until ? 1 : 0) || a.from.localeCompare(b.from)).pop();
    const expression = version?.expression ?? line.base_expression;
    const quota = line.out_of_quota_expression !== null;
    const duty = quota ? parseVietnamDuty(line.out_of_quota_expression!) : parseVietnamDuty(expression);
    out.set(code, { line, expression, duty, declarable: duty.kind === 'ad_valorem' && !(line.import_condition && on >= '2024-12-16'), effective_from: version?.from ?? VIETNAM_BASE_FROM, effective_to: version?.until ?? null, instrument: version?.instrument ?? 'Decree 26/2023/NĐ-CP' });
  }
  return out;
}

function aiftaDuty(raw: string): ParsedDuty {
  if (raw === '*') return { kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '*', note: 'Decree 122/2022 marks this line "*": imports are not eligible for the AIFTA rate in this period.' };
  return parseVietnamDuty(raw);
}

export function buildVietnamMarketAccess(args: { bundle: VietnamAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(), origin = (args.origin_country ?? 'IN').trim().toUpperCase(), on = date(args.at);
  const replayed = [...replayVietnamTariff(args.bundle, args.at).values()].filter(item => item.line.code.startsWith(hs6)).sort((a, b) => a.line.code.localeCompare(b.line.code));
  const window = (item: VietnamReplayedLine) => ({ effective_from: new Date(`${item.effective_from}T00:00:00.000Z`), effective_to: item.effective_to ? new Date(`${item.effective_to}T23:59:59.999Z`) : null });
  const period = VIETNAM_AIFTA_PERIODS.findIndex(([from, until]) => from <= on && on <= until);
  // Seven Section I lines appear in Decree 122/2022 only as ten-digit sub-lines; the sub-line decides the rate.
  const aiftaFor = (code: string) => (period < 0 ? [] : args.bundle.aifta.has(code) ? [args.bundle.aifta.get(code)!] : [...args.bundle.aifta.values()].filter(entry => entry.code.length === 10 && entry.code.startsWith(code)));
  const remediesFor = (code: string) => selectVietnamTradeRemedies({ manifest: args.bundle.remedies, code, origin_country: origin, at: args.at });
  // Lines are equivalent only if their remedies, import conditions and AIFTA rates also match, not just the MFN rate.
  const resolution = resolveNationalTariffLine(replayed.map(item => ({
    national_tariff_code: item.line.code, description: item.line.description, declarable: item.declarable, ...window(item), general_duty: item.duty,
    control_codes: [...remediesFor(item.line.code).candidates.map(measure => measure.id), ...(item.line.import_condition ? ['VN_IMPORT_PERMISSION_CONDITION'] : [])],
    preference_area_ids: aiftaFor(item.line.code).map(entry => (entry.code.length === 10 ? `AIFTA:sub-line-${entry.code.slice(8)}:${entry.rates[period]!}` : `AIFTA:${entry.rates[period]!}`)),
  })));
  const lines: MarketAccessLineRecord[] = replayed.map(item => ({
    national_tariff_code: item.line.code, description: item.line.description, declarable: item.declarable, measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: item.duty,
    conditions: { instrument: item.instrument, import_condition: item.line.import_condition, tariff_quota_out_of_quota_rate: item.line.out_of_quota_expression !== null, used_vehicle_annex_iii_applies_separately: item.line.used_vehicle_annex_iii },
    ...window(item), source_reference: item.instrument, raw_measure: { base_expression: item.line.base_expression, versions: item.line.versions },
  }));
  const requirements: MarketAccessRequirementRecord[] = [];
  for (const item of replayed) {
    if (item.line.out_of_quota_expression !== null) lines.push({ national_tariff_code: item.line.code, description: `${item.line.description} — within tariff quota`, declarable: false, measure_kind: 'tariff_quota', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: parseVietnamDuty(item.expression), conditions: { in_quota_rate_requires_quota_allocation: true, quota_availability_not_established: true }, ...window(item), source_reference: 'Decree 26/2023/NĐ-CP Annex IV', raw_measure: { out_of_quota: item.line.out_of_quota_expression } });
    if (item.line.used_vehicle_annex_iii) lines.push({ national_tariff_code: item.line.code, description: `${item.line.description} — used vehicle`, declarable: false, measure_kind: 'other', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: { kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: 'Annex III absolute or mixed duty for used passenger vehicles (USD per vehicle)', note: 'Used vehicles of ≤15 seats pay Decree 26/2023 Annex III absolute (USD 10,000, ≤1,000cc) or mixed duties (X + USD 10,000/15,000); vehicle age, seating and engine capacity are required.' }, conditions: { used_vehicle: true }, ...window(item), source_reference: 'Decree 26/2023/NĐ-CP Annex III', raw_measure: null });
  }
  for (const ch98 of args.bundle.chapter98.filter(entry => entry.corresponding_codes.some(code => code.startsWith(hs6)))) {
    lines.push({ national_tariff_code: ch98.code, description: `Chapter 98 alternative for ${ch98.corresponding_codes.filter(code => code.startsWith(hs6)).join(', ')}`, declarable: false, measure_kind: 'other', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: parseVietnamDuty(ch98.expression), conditions: { chapter_98_criteria_must_be_met: true, corresponding_codes: ch98.corresponding_codes }, effective_from: new Date(`${VIETNAM_BASE_FROM}T00:00:00.000Z`), effective_to: null, source_reference: ch98.instrument, raw_measure: ch98 });
  }
  const resolved = resolution.resolved_line, resolvedCode = resolved?.national_tariff_code ?? '';
  // Without a single resolved national line, preferences, remedies and conditions are evaluated on every candidate line.
  const candidateCodes = resolvedCode ? [resolvedCode] : replayed.map(item => item.line.code);
  const aiftaEntries = candidateCodes.flatMap(aiftaFor);
  for (const entry of aiftaEntries) {
    const raw = entry.rates[period]!;
    lines.push({ national_tariff_code: entry.code, description: entry.code.length === 10 ? 'AIFTA special preferential rate (Decree 122/2022 ten-digit sub-line)' : 'AIFTA special preferential rate', declarable: raw !== '*', measure_kind: 'tariff_preference', origin_geographic_area_id: 'IN', origin_scope: 'group', applies_to_origin_country: 'IN', duty: aiftaDuty(raw), conditions: { certificate_of_origin_form_ai_required: true, direct_consignment_required: true, product_specific_rules_of_origin_required: true, sub_line_classification_required: entry.code.length === 10 }, effective_from: new Date(`${VIETNAM_AIFTA_PERIODS[period]![0]}T00:00:00.000Z`), effective_to: new Date(`${VIETNAM_AIFTA_PERIODS[period]![1]}T23:59:59.999Z`), source_reference: AIFTA_SOURCE, raw_measure: entry });
  }
  const aiftaRates = [...new Set(aiftaEntries.map(entry => entry.rates[period]!))];
  const selections = candidateCodes.map(code => ({ code, ...remediesFor(code) })).filter(selection => selection.status === 'producer_refinement_required');
  const remedyStatus = selections.length ? 'producer_refinement_required' as const : 'not_applicable' as const;
  for (const selection of selections) {
    for (const measure of selection.candidates) lines.push({ national_tariff_code: selection.code, description: measure.product, declarable: true, measure_kind: 'additional_duty', origin_geographic_area_id: origin, origin_scope: 'country', applies_to_origin_country: origin, duty: vietnamRemedyDuty(measure, origin), conditions: { component: measure.kind, instrument: measure.decision, producer_or_exporter_identity_required: vietnamRemedyProducerIdentityRequired(measure, origin), rate_not_selected_from_origin_alone: vietnamRemedyProducerIdentityRequired(measure, origin), required_evidence: selection.required_evidence }, effective_from: new Date(`${measure.effective_from}T00:00:00.000Z`), effective_to: measure.effective_until ? new Date(`${measure.effective_until}T23:59:59.999Z`) : null, source_reference: measure.source_url, raw_measure: measure });
  }
  if (selections.length) requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'VN_TRADE_REMEDY_PRODUCER_EVIDENCE', requirement_description: 'An active Vietnamese trade-remedy measure matches this line and origin. Certificate of origin, the producer\'s original quality certificate and contract/invoice evidence naming the producer/exporter are required before the additional duty can be selected.', requirement_obtainable: true, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: selections[0]!.candidates[0]!.source_url, raw: { candidate_measures: [...new Set(selections.flatMap(selection => selection.candidates.map(measure => measure.id)))], national_tariff_codes: selections.map(selection => selection.code), required_evidence: selections[0]!.required_evidence } });
  const conditional = replayed.filter(item => candidateCodes.includes(item.line.code) && item.line.import_condition);
  if (conditional.length) requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'VN_IMPORT_PERMISSION_CONDITION', requirement_description: conditional[0]!.line.import_condition!, requirement_obtainable: false, national_tariff_code: resolvedCode || null, effective_from: new Date('2024-12-16T00:00:00.000Z'), effective_to: null, source_reference: 'Decree 144/2024/NĐ-CP art. 2(2)', raw: { national_tariff_codes: conditional.map(item => item.line.code) } });
  const parser_version = args.parser_version ?? VIETNAM_PARSER_VERSION;
  const aiftaBasis = 'Decree 122/2022 art. 4: the AIFTA rate requires import from an AIFTA party, satisfaction of the rules of origin including direct consignment, and a C/O Form AI or equivalent origin documentation.';
  const indiaPreference = origin !== 'IN'
    ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: 'The request origin is not India.' }
    : !aiftaRates.length ? { applicability: 'unknown' as const, duty: null, geographic_area_id: null, basis: 'Decree 122/2022 publishes no AIFTA line for this HS6 and date.' }
      : aiftaRates.every(raw => raw === '*') ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: 'AIFTA', basis: 'Decree 122/2022 marks every candidate line "*" for the period: it is not eligible for the AIFTA rate.', source_authority: VIETNAM_SOURCE_AUTHORITY, source_reference: AIFTA_SOURCE }
        : aiftaRates.length === 1 ? { applicability: 'potentially_applicable_requires_origin_proof' as const, duty: aiftaDuty(aiftaRates[0]!), geographic_area_id: 'AIFTA', basis: aiftaBasis, source_authority: VIETNAM_SOURCE_AUTHORITY, source_reference: AIFTA_SOURCE }
          : { applicability: 'potentially_applicable_requires_origin_proof' as const, duty: null, geographic_area_id: 'AIFTA', basis: `${aiftaBasis} Decree 122/2022 publishes different rates for the candidate national lines or ten-digit sub-lines (${aiftaRates.join(', ')}); the line classification selects the rate.`, source_authority: VIETNAM_SOURCE_AUTHORITY, source_reference: AIFTA_SOURCE };
  return {
    jurisdiction: 'VN', country_code: 'VN', hs6, hs_revision: `AHTN 2022 / Vietnam 8-digit — ${args.bundle.release_identifier}`, provider: VIETNAM_PROVIDER, source_authority: VIETNAM_SOURCE_AUTHORITY, source_dataset: VIETNAM_SOURCE_DATASET, source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`, national_code_system: 'VN_AHTN_2022', parser_version, source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${on}`, retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution, general_duty: resolved?.general_duty ?? null,
    india_preference: indiaPreference, lines, requirements, regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: date(args.release_reference_date), reader_version: args.bundle.reader_version, parser_version,
      section_i_line_count: args.bundle.schedule_lines.size, aifta_entry_count: args.bundle.aifta.size, chapter98_entry_count: args.bundle.chapter98.length,
      active_remedy_count: args.bundle.remedies.measures.length, remedy_register_enumeration_complete: args.bundle.remedies.register_enumeration_complete, remedy_status: remedyStatus, tariff_treatment_complete: remedyStatus === 'not_applicable',
      regulatory_coverage_complete: false, omitted_regulatory_layer: 'VAT, excise, environmental protection tax, import licensing and specialised inspection are not represented by this tariff provider.',
    },
  };
}
