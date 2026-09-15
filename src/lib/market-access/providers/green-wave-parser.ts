import type { MarketAccessIngestResult, MarketAccessLineRecord } from '@/lib/market-access/contract';
import { determineIndiaPreference, resolveNationalTariffLine, type CandidateTariffLine, type IndiaPreferenceDetermination, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import type { PdfAuthorityBundle, PdfTariffLine } from './pdf-table-family';
import { GREEN_WAVE_CONFIGS, type GreenWaveConfig, type GreenWaveCountry } from './green-wave-config';

function zeroDuty(): ParsedDuty {
  return { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '0%', note: 'The bilateral tariff rule publishes customs-duty exemption; origin qualification and proof remain required.' };
}

function preferenceFor(config: GreenWaveConfig, line: PdfTariffLine | null, origin: string): IndiaPreferenceDetermination {
  if (origin !== 'IN') return { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India; no India-origin preference is selected.` };
  if (!line) return { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'No single national tariff line resolved, so line-specific India treatment cannot be stated.' };
  if (config.india_basis === 'complete_list_excludes_india') return {
    applicability: 'not_applicable', duty: null, geographic_area_id: null,
    basis: 'The retained authority programme index completely enumerates the 2026 preferential programmes and does not list India.',
    source_reference: `${config.tariff_url} and retained preferential-programmes.html`, raw_evidence: config.preference_evidence,
  };
  const candidate = config.india_basis === 'bilateral_zero_requires_origin' ? zeroDuty() : config.india_column ? line.cells[config.india_column] ?? null : null;
  if (!candidate || candidate.kind === 'none') return { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'The retained schedule does not publish a usable India-origin measure for this resolved line; absence is not treated as zero.' };
  const isQuota = /\b(?:TRQ|tons?|pieces?)\b/i.test(candidate.expression);
  const result = determineIndiaPreference({
    direct_india_measures: config.india_basis === 'direct_requires_origin' || config.india_basis === 'bilateral_zero_requires_origin'
      ? [{ geographic_area_id: config.india_area_id!, duty: candidate, is_quota: isQuota }] : [],
    proven_group_measures: config.india_basis === 'group_requires_origin'
      ? [{ geographic_area_id: config.india_area_id!, duty: candidate, is_quota: isQuota }] : [],
    beneficiary_enumeration_is_complete: false, unresolved_program_symbols: [],
  });
  return { ...result, source_authority: config.authority, source_reference: config.tariff_url,
    raw_evidence: { ...config.preference_evidence, schedule_expression: candidate.expression, origin_qualification_status: 'not_established' } };
}

function controlCodes(config: GreenWaveConfig, line: PdfTariffLine) {
  return Object.entries(line.cells).filter(([key, value]) => key !== config.general_column && key !== config.india_column && value.kind !== 'none')
    .map(([key, value]) => `${key}:${value.expression}`).sort();
}

function preferenceAreaIds(config: GreenWaveConfig, line: PdfTariffLine) {
  if (!config.india_area_id) return [];
  if (config.india_basis === 'bilateral_zero_requires_origin') return [config.india_area_id];
  const cell = config.india_column ? line.cells[config.india_column] : null;
  return cell && cell.kind !== 'none' ? [config.india_area_id] : [];
}

export function buildGreenWaveMarketAccess(args: {
  country: GreenWaveCountry; bundle: PdfAuthorityBundle; release_id: string; release_reference_date: Date;
  retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string;
}): MarketAccessIngestResult {
  const config = GREEN_WAVE_CONFIGS[args.country];
  const hs6 = args.hs6.trim();
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const effectiveFrom = new Date(`${config.profile.effective_from}T00:00:00.000Z`);
  const entries = args.at < effectiveFrom ? [] : [...args.bundle.lines.values()].filter((line) => line.code.startsWith(hs6)).sort((a, b) => a.code.localeCompare(b.code));
  const candidates: CandidateTariffLine[] = entries.map((line) => ({
    national_tariff_code: line.code, description: line.description, declarable: true,
    effective_from: effectiveFrom, effective_to: null, general_duty: line.cells[config.general_column]!,
    control_codes: controlCodes(config, line), preference_area_ids: preferenceAreaIds(config, line),
  }));
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  for (const entry of entries) {
    const pageReference = entry.source_pages.join(', ');
    lines.push({
      national_tariff_code: entry.code, description: entry.description, declarable: true,
      measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null,
      duty: entry.cells[config.general_column]!, conditions: { authority_column: config.general_column },
      effective_from: effectiveFrom, effective_to: null,
      source_reference: `${config.dataset} · page ${pageReference} · ${entry.code}`,
      raw_measure: { authority_column: config.general_column, expression: entry.raw_cells[config.general_column] ?? '' },
    });
    for (const [key, value] of Object.entries(entry.cells)) {
      if (key === config.general_column || key === config.india_column || value.kind === 'none') continue;
      lines.push({
        national_tariff_code: entry.code, description: entry.description, declarable: true,
        measure_kind: key === 'vat' ? 'vat' : key.includes('excise') ? 'additional_duty' : 'other',
        origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: value,
        conditions: { authority_column: key, separate_component_not_a_replacement_tariff: true }, effective_from: effectiveFrom, effective_to: null,
        source_reference: `${config.dataset} · page ${pageReference} · ${entry.code} · ${key}`,
        raw_measure: { authority_column: key, expression: entry.raw_cells[key] ?? '' },
      });
    }
    const preference = preferenceFor(config, entry, origin);
    if (origin === 'IN' && preference.duty && preference.geographic_area_id) lines.push({
      national_tariff_code: entry.code, description: entry.description, declarable: true,
      measure_kind: /\b(?:TRQ|tons?|pieces?)\b/i.test(preference.duty.expression) ? 'tariff_quota' : 'tariff_preference',
      origin_geographic_area_id: preference.geographic_area_id, origin_scope: config.india_basis === 'group_requires_origin' ? 'group' : 'country',
      applies_to_origin_country: 'IN', duty: preference.duty,
      conditions: { requires_origin_proof: true, qualification_status: 'not_established', never_selected_from_origin_country_alone: true,
        ...(config.india_basis === 'bilateral_zero_requires_origin' ? { gst_and_excise_remain_separate: true } : {}) },
      effective_from: effectiveFrom, effective_to: null,
      source_reference: `${config.dataset} · page ${pageReference} · ${entry.code} · ${preference.geographic_area_id}`,
      raw_measure: preference.raw_evidence ?? {},
    });
  }
  const resolved = resolution.resolved_line ? entries.find((line) => line.code === resolution.resolved_line!.national_tariff_code) ?? null : null;
  const parserVersion = args.parser_version ?? config.parser_version;
  return {
    jurisdiction: config.jurisdiction, country_code: config.country_code, hs6,
    hs_revision: `HS / ${config.dataset} — acquired ${args.bundle.release_identifier}`,
    provider: config.provider, source_authority: config.authority, source_dataset: config.dataset,
    source_dataset_version: args.bundle.release_identifier, source_reference: `${config.tariff_url} (composite bundle sha256 ${args.bundle.checksum})`,
    national_code_system: config.national_code_system, parser_version: parserVersion, source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: resolution.resolved_line?.general_duty ?? null, india_preference: preferenceFor(config, resolved, origin),
    lines, requirements: [], regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_identifier: args.bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString().slice(0, 10), reader_version: args.bundle.reader_version,
      parser_version: parserVersion, tariff_line_count: args.bundle.line_count, candidate_codes: entries.map((entry) => entry.code),
      origin_country: origin, tariff_treatment_complete: true, regulatory_coverage_complete: false,
      rights_evidence: args.bundle.rights_evidence, preference_evidence: args.bundle.preference_evidence,
      amendment_operations: args.bundle.amendment_operations,
      omitted_regulatory_layer: args.bundle.scope.omitted_regulatory_layer,
    },
  };
}
