import { MarketAccessRuleType } from '@prisma/client';
import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { determineIndiaPreference, resolveNationalTariffLine, type CandidateTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { IcelandAuthorityBundle, IcelandRawMeasure, IcelandTariffLine } from './iceland-bundle';

export const ICELAND_PARSER_VERSION = 'skatturinn-tollskrarlyklar-parser-v1' as const;
export const ICELAND_PROVIDER = 'is_skatturinn_tollskrarlyklar' as const;
export const ICELAND_SOURCE_AUTHORITY = 'Iceland Revenue and Customs (Skatturinn)' as const;
export const ICELAND_SOURCE_DATASET = 'Tollskrárlyklar for import declarations, controlling printed tariff and EFTA–India TEPA notice' as const;

function amount(value: number) { return value / 100; }

export function parseIcelandDuty(measure: IcelandRawMeasure, unit: 'kg' | 'piece'): ParsedDuty {
  const percent = amount(measure.percent_hundredths);
  const specific = amount(measure.specific_hundredths);
  if (percent > 0 && specific > 0) {
    return {
      kind: 'compound', ad_valorem_rate_percent: percent, specific_amount: specific,
      specific_currency: 'ISK', specific_unit: unit, specific_unit_quantity: 1,
      expression: `${percent.toFixed(2)} % + ${specific.toFixed(2)} ISK / ${unit}`,
      note: 'The authority publishes both an ad-valorem and a specific component; neither is converted to an ad-valorem equivalent.',
    };
  }
  if (specific > 0) {
    return {
      kind: 'specific', ad_valorem_rate_percent: null, specific_amount: specific,
      specific_currency: 'ISK', specific_unit: unit, specific_unit_quantity: 1,
      expression: `${specific.toFixed(2)} ISK / ${unit}`, note: null,
    };
  }
  return {
    kind: 'ad_valorem', ad_valorem_rate_percent: percent, specific_amount: null,
    specific_currency: null, specific_unit: null, specific_unit_quantity: null,
    expression: `${percent.toFixed(2)} %`, note: null,
  };
}

function generalDuty(line: IcelandTariffLine): ParsedDuty {
  const measure = line.measures.get('A');
  return measure ? parseIcelandDuty(measure, line.base_unit) : {
    kind: 'none', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null,
    specific_unit: null, specific_unit_quantity: null, expression: '',
    note: 'Skatturinn publishes no general-duty (A) measure for this declarable line; absence is retained as missing and is not reported as zero.',
  };
}

const effectiveDate = (releaseIdentifier: string) => new Date(`${releaseIdentifier}T00:00:00.000Z`);
const controlsFor = (line: IcelandTariffLine) => [
  ...line.fees.map((item) => `FEE:${item.code}`),
  ...line.permit_codes.map((item) => `PERMIT:${item}`),
  ...line.prohibition_codes.map((item) => `PROHIBITION:${item}`),
  ...line.flag_codes.map((item) => `FLAG:${item}`),
  ...line.quantity_codes.map((item) => `QUANTITY:${item}`),
  ...(line.requires_vehicle_serial ? ['REQUIRES:VEHICLE_SERIAL'] : []),
  ...(line.requires_unit_count ? ['REQUIRES:UNIT_COUNT'] : []),
  ...(line.requires_litres ? ['REQUIRES:LITRES'] : []),
  ...(line.requires_net_weight ? ['REQUIRES:NET_WEIGHT'] : []),
].sort();

export function buildIcelandMarketAccess(args: {
  bundle: IcelandAuthorityBundle;
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
  const from = effectiveDate(args.bundle.release_identifier);
  const entries = args.at.getTime() < from.getTime()
    ? []
    : [...args.bundle.lines.values()].filter((line) => line.code.startsWith(hs6)).sort((left, right) => left.code.localeCompare(right.code));
  const candidates: CandidateTariffLine[] = entries.map((line) => ({
    national_tariff_code: line.code,
    description: `Icelandic tariff line ${line.code}`,
    declarable: true,
    effective_from: from,
    effective_to: null,
    general_duty: generalDuty(line),
    control_codes: controlsFor(line),
    preference_area_ids: line.measures.has('YX') ? ['YX'] : [],
  }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  const requirements: MarketAccessRequirementRecord[] = [];

  for (const entry of entries) {
    const general = entry.measures.get('A');
    lines.push({
      national_tariff_code: entry.code, description: `Icelandic tariff line ${entry.code}`, declarable: true,
      measure_kind: 'third_country_duty', origin_geographic_area_id: 'A', origin_scope: 'erga_omnes', applies_to_origin_country: null,
      duty: generalDuty(entry),
      conditions: { authority_measure_code: 'A', base_unit: entry.base_unit }, effective_from: from, effective_to: null,
      source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code} (A)`, raw_measure: general ?? { authority_measure_code: 'A', status: 'missing' },
    });
    const india = entry.measures.get('YX');
    if (india) lines.push({
      national_tariff_code: entry.code, description: `Icelandic tariff line ${entry.code}`, declarable: true,
      measure_kind: 'tariff_preference', origin_geographic_area_id: 'YX', origin_scope: 'country', applies_to_origin_country: 'IN',
      duty: parseIcelandDuty(india, entry.base_unit),
      conditions: { agreement: 'EFTA–India Trade and Economic Partnership Agreement', requires_origin_proof: true, direct_transport_required: true },
      effective_from: new Date('2025-10-01T00:00:00.000Z'), effective_to: null,
      source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code} (YX)`, raw_measure: india,
    });
    for (const fee of entry.fees) lines.push({
      national_tariff_code: entry.code, description: `Icelandic import fee ${fee.code}`, declarable: true,
      measure_kind: 'other', origin_geographic_area_id: null, origin_scope: 'unknown', applies_to_origin_country: null,
      duty: parseIcelandDuty(fee, entry.base_unit), conditions: { authority_fee_code: fee.code, not_customs_duty: true },
      effective_from: from, effective_to: null, source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code} (fee ${fee.code})`, raw_measure: fee,
    });
    for (const code of entry.prohibition_codes) requirements.push({
      rule_type: MarketAccessRuleType.import_prohibition, requirement_code: code,
      requirement_description: `Skatturinn prohibition code ${code}; consult the retained controlling tariff/legal text before execution.`, requirement_obtainable: null,
      national_tariff_code: entry.code, effective_from: from, effective_to: null,
      source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code}`, raw: { authority_code: code, kind: 'prohibition' },
    });
    for (const code of entry.permit_codes) requirements.push({
      rule_type: MarketAccessRuleType.import_restriction, requirement_code: code,
      requirement_description: `Skatturinn permit code ${code}; the permit is not inferred to be obtainable.`, requirement_obtainable: null,
      national_tariff_code: entry.code, effective_from: from, effective_to: null,
      source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code}`, raw: { authority_code: code, kind: 'permit' },
    });
    for (const [kind, codes] of [['flag', entry.flag_codes], ['quantity', entry.quantity_codes]] as const) {
      for (const code of codes) requirements.push({
        rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: code,
        requirement_description: `Skatturinn ${kind} code ${code}; the retained legal tariff and field documentation control its execution meaning.`, requirement_obtainable: null,
        national_tariff_code: entry.code, effective_from: from, effective_to: null,
        source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code}`, raw: { authority_code: code, kind },
      });
    }
    for (const [required, code, description] of [
      [entry.requires_vehicle_serial, 'VEHICLE_SERIAL', 'Vehicle serial number required'],
      [entry.requires_unit_count, 'UNIT_COUNT', 'Unit count required'],
      [entry.requires_litres, 'LITRES', 'Litre quantity required'],
      [entry.requires_net_weight, 'NET_WEIGHT', 'Net weight required'],
    ] as const) if (required) requirements.push({
      rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: code,
      requirement_description: description, requirement_obtainable: null, national_tariff_code: entry.code,
      effective_from: from, effective_to: null, source_reference: `Skatturinn tollskrárlyklar ${args.bundle.release_identifier} · ${entry.code}`,
      raw: { authority_code: code, kind: 'required_declaration_quantity' },
    });
  }

  const resolvedEntry = resolution.resolved_line ? entries.find((line) => line.code === resolution.resolved_line!.national_tariff_code) : null;
  const india = resolvedEntry?.measures.get('YX');
  const indiaPreference = resolvedEntry
    ? determineIndiaPreference({
      direct_india_measures: india ? [{ geographic_area_id: 'YX', duty: parseIcelandDuty(india, resolvedEntry.base_unit), is_quota: false }] : [],
      proven_group_measures: [], beneficiary_enumeration_is_complete: true, unresolved_program_symbols: [],
    })
    : { applicability: 'unknown' as const, duty: null, geographic_area_id: null, basis: 'No single Icelandic tariff line resolved for this HS6, so line-specific India treatment cannot be stated.' };

  const parserVersion = args.parser_version ?? ICELAND_PARSER_VERSION;
  return {
    jurisdiction: 'IS', country_code: 'IS', hs6,
    hs_revision: `HS / Icelandic Customs Tariff — Skatturinn ${args.bundle.release_identifier}`,
    provider: ICELAND_PROVIDER, source_authority: ICELAND_SOURCE_AUTHORITY, source_dataset: ICELAND_SOURCE_DATASET,
    source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.keys_source_url} (composite bundle sha256 ${args.bundle.checksum})`,
    national_code_system: 'IS_TOLLSKRARLYKILL', parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: resolution.resolved_line?.general_duty ?? null, india_preference: indiaPreference,
    lines, requirements,
    // The authority's deviations document says some quantity-dependent/manual quota reductions
    // and requirements live outside the key file, so tariff coverage must not imply regulatory completeness.
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum,
      release_identifier: args.bundle.release_identifier, release_reference_date: args.release_reference_date.toISOString().slice(0, 10),
      reader_version: args.bundle.reader_version, parser_version: parserVersion,
      physical_record_count: args.bundle.physical_record_count, record_type_counts: args.bundle.record_type_counts,
      candidate_codes: entries.map((entry) => entry.code), india_measure_code: 'YX', origin_country: origin,
      omitted_from_keys: ['quantity-dependent/manual quota reductions described in retained known-deviations.pdf'],
    },
  };
}
