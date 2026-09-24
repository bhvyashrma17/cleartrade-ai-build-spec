import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type ParsedDuty } from '@/lib/market-access/tariff-semantics';
import { MarketAccessRuleType } from '@prisma/client';
import { MOROCCO_BASE_FROM, MOROCCO_PARSER_VERSION, parseMoroccoDuty, type MoroccoAuthorityBundle, type MoroccoRateVersion, type MoroccoTariffLine } from './morocco-bundle';
import { moroccoRemedyDuty, moroccoRemedyIdentityRequired, selectMoroccoTradeRemedies } from './morocco-remedies';

export const MOROCCO_PROVIDER = 'ma_adii_tariff' as const;
export const MOROCCO_SOURCE_AUTHORITY = 'Kingdom of Morocco — Administration des Douanes et Impôts Indirects (ADII) / Ministry of Industry and Commerce' as const;
export const MOROCCO_SOURCE_DATASET = 'ADII Tarif des Droits de Douane à l\'Importation (TDI) chapter PDFs, 2026 Finance Law edition, with 2026 decree overlays and ADII trade-remedy circulars' as const;
const date = (value: Date) => value.toISOString().slice(0, 10);
const blank = (expression: string, note: string): ParsedDuty => ({ kind: 'unparsed', ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note });

export interface MoroccoReplayedLine { line: MoroccoTariffLine; duty: ParsedDuty; declarable: boolean; effective_from: string; effective_to: string | null; instrument: string; withheld: string | null }

/** Why a line printed by the TDI is still not declared: the reading of the authority's layout is not certain enough. */
export function moroccoWithheld(line: MoroccoTariffLine): string | null {
  if (line.conflicting_expressions) return `The TDI prints this line more than once with different rates (${line.conflicting_expressions.join(', ')}); the authority conflict makes it non-declarable.`;
  if (line.inferred_segment) return 'The TDI omits part of this line\'s code; the code is read with the conventional 00 segment and is not declared.';
  if (line.pairing === 'uncertain') return 'The printed rate sits between this line and a neighbouring one, so which line it belongs to cannot be established from the layout.';
  if (line.pairing === 'none') return 'The TDI prints no rate for this line; blank is not zero.';
  return null;
}

/** The statutory TDI rate, replaced by a dated decree suspension or rate change while it runs; the latest applicable instrument wins. */
export function replayMoroccoTariff(bundle: MoroccoAuthorityBundle, at: Date) {
  const on = date(at), out = new Map<string, MoroccoReplayedLine>();
  if (on < MOROCCO_BASE_FROM) return out;
  for (const [code, line] of bundle.schedule_lines) {
    const version = [...line.versions].filter(candidate => candidate.from <= on && (!candidate.until || on <= candidate.until)).sort((a, b) => a.from.localeCompare(b.from)).pop() as MoroccoRateVersion | undefined;
    const withheld = moroccoWithheld(line);
    let duty = parseMoroccoDuty(version?.expression ?? line.expression, line.footnote_text);
    if (version?.kind === 'suspension') duty = { ...duty, kind: 'ad_valorem', ad_valorem_rate_percent: 0, expression: '0%', note: `Collection of the ${line.expression}% statutory duty is suspended by ${version.instrument}.` };
    if (!line.expression && !version) duty = blank('', 'The TDI prints no rate for this line; blank is not zero.');
    const inSeason = !line.season || (() => { const md = on.slice(5); return line.season.from_month_day <= line.season.until_month_day ? line.season.from_month_day <= md && md <= line.season.until_month_day : md >= line.season.from_month_day || md <= line.season.until_month_day; })();
    const declarable = duty.kind === 'ad_valorem' && !withheld && inSeason && (!line.footnote || version?.kind === 'suspension');
    out.set(code, { line, duty, declarable, effective_from: version?.from ?? MOROCCO_BASE_FROM, effective_to: version?.until ?? null, instrument: version?.instrument ?? 'TDI (Finance Law 50-25 for 2026, circular 6702/210)', withheld: withheld ?? (inSeason ? null : `This line applies only ${line.season!.from_month_day} to ${line.season!.until_month_day}.`) });
  }
  return out;
}

export function buildMoroccoMarketAccess(args: { bundle: MoroccoAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(), origin = (args.origin_country ?? 'IN').trim().toUpperCase(), on = date(args.at);
  const replayed = [...replayMoroccoTariff(args.bundle, args.at).values()].filter(item => item.line.code.startsWith(hs6)).sort((a, b) => a.line.code.localeCompare(b.line.code));
  const window = (item: MoroccoReplayedLine) => ({ effective_from: new Date(`${item.effective_from}T00:00:00.000Z`), effective_to: item.effective_to ? new Date(`${item.effective_to}T23:59:59.999Z`) : null });
  const remediesFor = (code: string) => selectMoroccoTradeRemedies({ manifest: args.bundle.remedies, code, origin_country: origin, at: args.at });
  // Lines are equivalent only if their remedies and conditional overlays also match, not just the MFN rate.
  const resolution = resolveNationalTariffLine(replayed.map(item => ({
    national_tariff_code: item.line.code, description: item.line.description, declarable: item.declarable, ...window(item), general_duty: item.duty,
    control_codes: [...remediesFor(item.line.code).map(measure => measure.id), ...item.line.quota_suspensions.map(entry => `QUOTA:${entry.instrument}`), ...item.line.partial_versions.map(entry => `PARTIAL:${entry.instrument}`)], preference_area_ids: [],
  })));
  const lines: MarketAccessLineRecord[] = replayed.map(item => ({
    national_tariff_code: item.line.code, description: item.line.description, declarable: item.declarable, measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null,
    duty: item.withheld && item.duty.kind === 'ad_valorem' ? { ...item.duty, note: item.withheld } : item.duty,
    conditions: { instrument: item.instrument, withheld_reason: item.withheld, footnote: item.line.footnote ? { letter: item.line.footnote, text: item.line.footnote_text } : null, season: item.line.season, unit: item.line.unit },
    ...window(item), source_reference: `TDI chapter ${item.line.chapter}`, raw_measure: { statutory_expression: item.line.expression, versions: item.line.versions, pairing: item.line.pairing },
  }));
  const requirements: MarketAccessRequirementRecord[] = [];
  const resolvedCode = resolution.resolved_line?.national_tariff_code ?? '', candidates = resolvedCode ? replayed.filter(item => item.line.code === resolvedCode) : replayed;
  for (const item of candidates) {
    for (const quota of item.line.quota_suspensions) if (quota.from <= on && on <= quota.until) lines.push({ national_tariff_code: item.line.code, description: `${item.line.description} — duty suspended within quota`, declarable: false, measure_kind: 'tariff_quota', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 0, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '0%', note: `${quota.condition} Quota: ${quota.quota}.` }, conditions: { quota: quota.quota, customs_franchise_request_required: true, quota_availability_not_established: true }, effective_from: new Date(`${quota.from}T00:00:00.000Z`), effective_to: new Date(`${quota.until}T23:59:59.999Z`), source_reference: quota.instrument, raw_measure: quota });
    for (const partial of item.line.partial_versions) if (partial.from <= on && (!partial.until || on <= partial.until)) lines.push({ national_tariff_code: item.line.code, description: `${item.line.description} — ${partial.scope}`, declarable: false, measure_kind: 'other', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: parseMoroccoDuty(partial.expression), conditions: { applies_only_to: partial.scope }, effective_from: new Date(`${partial.from}T00:00:00.000Z`), effective_to: partial.until ? new Date(`${partial.until}T23:59:59.999Z`) : null, source_reference: partial.instrument, raw_measure: partial });
  }
  const selections = candidates.map(item => ({ code: item.line.code, measures: remediesFor(item.line.code) })).filter(selection => selection.measures.length);
  for (const selection of selections) for (const measure of selection.measures) {
    const identity = moroccoRemedyIdentityRequired(measure, origin);
    lines.push({ national_tariff_code: selection.code, description: measure.product, declarable: true, measure_kind: 'additional_duty', origin_geographic_area_id: origin, origin_scope: 'country', applies_to_origin_country: origin, duty: moroccoRemedyDuty(measure, origin, args.at), conditions: { component: measure.kind, instrument: measure.instrument, producer_or_product_identity_required: identity, exclusions: measure.exclusions, product_scope_condition: measure.product_scope_condition }, effective_from: new Date(`${measure.effective_from}T00:00:00.000Z`), effective_to: measure.effective_until ? new Date(`${measure.effective_until}T23:59:59.999Z`) : null, source_reference: measure.source_url, raw_measure: measure });
  }
  if (selections.length) requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'MA_TRADE_REMEDY_EVIDENCE', requirement_description: 'An active Moroccan anti-dumping or safeguard measure matches this line and origin. Proof of origin, and where the measure distinguishes them the producer/exporter identity or the product definition, are required; an invoice visaed by the department in charge of industry or an in-quota franchise request can exclude the duty where the measure provides.', requirement_obtainable: true, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: selections[0]!.measures[0]!.source_url, raw: { candidate_measures: [...new Set(selections.flatMap(selection => selection.measures.map(measure => measure.id)))], national_tariff_codes: selections.map(selection => selection.code) } });
  const remedyStatus = selections.length ? 'additional_duty_applies' as const : 'not_applicable' as const;
  const parser_version = args.parser_version ?? MOROCCO_PARSER_VERSION;
  return {
    jurisdiction: 'MA', country_code: 'MA', hs6, hs_revision: `HS 2022 / Morocco 10-digit TDI — ${args.bundle.release_identifier}`, provider: MOROCCO_PROVIDER, source_authority: MOROCCO_SOURCE_AUTHORITY, source_dataset: MOROCCO_SOURCE_DATASET, source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`, national_code_system: 'MA_TDI_2022', parser_version, source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${on}`, retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution, general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: origin !== 'IN'
      ? { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'The request origin is not India.' }
      : { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'Morocco applies no preferential tariff to India: the complete ADII circular record 2015–2026 contains preferential-origin circulars for the EU, UK, EFTA, Türkiye, the USA, Tunisia, the Agadir and Arab agreements and AfCFTA, and none for India; India-origin goods take the MFN (droit commun) rate.', source_authority: MOROCCO_SOURCE_AUTHORITY, source_reference: 'https://www.douane.gov.ma/web/guest/circulaires' },
    lines, requirements, regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: date(args.release_reference_date), reader_version: args.bundle.reader_version, parser_version,
      schedule_line_count: args.bundle.schedule_lines.size, active_remedy_count: args.bundle.remedies.measures.length, remedy_register_enumeration_complete: args.bundle.remedies.register_enumeration_complete, remedy_status: remedyStatus,
      tariff_treatment_complete: remedyStatus === 'not_applicable', regulatory_coverage_complete: false,
      omitted_regulatory_layer: 'VAT, domestic consumption taxes (TIC), the parafiscal import tax, import licensing and quantitative restrictions are not represented by this tariff provider.',
    },
  };
}
