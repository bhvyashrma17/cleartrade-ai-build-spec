import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { resolveNationalTariffLine, type IndiaPreferenceDetermination } from '@/lib/market-access/tariff-semantics';
import { MarketAccessRuleType } from '@prisma/client';
import { parseTunisiaValue, TUNISIA_BASE_FROM, TUNISIA_PARSER_VERSION, tunisiaCustomsDuty, type TunisiaAuthorityBundle, type TunisiaTariffLine } from './tunisia-bundle';
import { selectTunisiaConditionalReliefs, selectTunisiaSafeguards, selectTunisiaTariffQuotas, TUNISIA_TPR_URL, TUNISIA_TRQ_ADMINISTRATION_URL, tunisiaInQuotaDuty, tunisiaReliefDuty, tunisiaSafeguardPeriod } from './tunisia-remedies';

export const TUNISIA_PROVIDER = 'tn_douane_tarifweb' as const;
export const TUNISIA_SOURCE_AUTHORITY = 'Republic of Tunisia — Direction Générale des Douanes (Tarifweb 2026) / Ministry of Trade' as const;
export const TUNISIA_SOURCE_DATASET = 'Tunisian Customs Tarifweb 2026 line pages (sixth Tunisian nomenclature, HS 2022) with Finance Law 2026 overlays, WTO-notified trade remedies and tariff quotas' as const;
const TARIFF_RULES_URL = 'https://www.douane.gov.tn/tarif-douanier/';
const date = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The customs duty Tarifweb prints is the applicable conventional rate — the rate for goods from GATT/WTO
 * Members and, failing contrary provision, every third country — or the autonomous rate where that is lower.
 * The 15% legal minimum of collection in the autonomous tariff limits privileged regimes (suspensions and
 * exemptions) other than the excepted ones; it never raises a rate the tariff itself prints, so it is never
 * applied here.
 */
export const TUNISIA_DUTY_COLUMN_NOTE = 'Tarifweb prints the applicable conventional rate (GATT/WTO Members and, absent a contrary provision, every third country), or the autonomous rate where lower. The 15% legal minimum of collection in the autonomous tariff limits suspensions and exemptions, not the printed rate, and is not applied here.';

export function tunisiaIndiaPreference(origin: string): IndiaPreferenceDetermination {
  if (origin !== 'IN') return { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'The request origin is not India.' };
  return {
    applicability: 'unknown', duty: null, geographic_area_id: null,
    basis: 'Tarifweb publishes per-line preferential rates for 19 origins (EU, EFTA, UK, Agadir, Arab and African partners) and none for India. Tunisia and India are both participants in the Global System of Trade Preferences (GSTP) and the 1971 Protocol relating to Trade Negotiations among Developing Countries, and Tunisian Customs publishes no concession schedule under either, so an India preference can be neither confirmed nor excluded. India-origin goods are shown at the conventional (MFN) rate.',
    source_authority: TUNISIA_SOURCE_AUTHORITY, source_reference: TUNISIA_TPR_URL,
  };
}

export interface TunisiaReplayedLine { line: TunisiaTariffLine; declarable: boolean; withheld: string | null }
/** Tarifweb is the 2026 state; before 2026 it says nothing. A line without exactly one customs-duty row is never declared. */
export function replayTunisiaTariff(bundle: TunisiaAuthorityBundle, at: Date) {
  const out = new Map<string, TunisiaReplayedLine>();
  if (date(at) < TUNISIA_BASE_FROM) return out;
  for (const [code, line] of bundle.schedule_lines) {
    const duty = tunisiaCustomsDuty(line);
    const withheld = line.customs_duty.length > 1 ? 'Tarifweb prints conflicting customs-duty rows for this line.' : !line.customs_duty.length ? 'Tarifweb publishes no customs-duty row for this line; blank is not zero.' : duty.kind !== 'ad_valorem' ? 'The customs-duty value is not a recognised ad-valorem form.' : null;
    out.set(code, { line, declarable: !withheld, withheld });
  }
  return out;
}

export function buildTunisiaMarketAccess(args: { bundle: TunisiaAuthorityBundle; release_id: string; release_reference_date: Date; retrieved_at: Date; hs6: string; at: Date; origin_country?: string; parser_version?: string }): MarketAccessIngestResult {
  const hs6 = args.hs6.trim(), origin = (args.origin_country ?? 'IN').trim().toUpperCase(), on = date(args.at);
  const replayed = [...replayTunisiaTariff(args.bundle, args.at).values()].filter(item => item.line.code.startsWith(hs6)).sort((a, b) => a.line.code.localeCompare(b.line.code));
  const window = { effective_from: new Date(`${TUNISIA_BASE_FROM}T00:00:00.000Z`), effective_to: null };
  const controls = (line: TunisiaTariffLine) => [
    ...selectTunisiaSafeguards(args.bundle.remedies, line.code, args.at).map(measure => measure.id),
    ...selectTunisiaTariffQuotas(args.bundle.remedies, line.code).map(quota => quota.id),
    ...selectTunisiaConditionalReliefs(args.bundle.remedies, line.code, args.at).map(relief => relief.id),
    ...(line.import_status === 'authorisation_required' ? ['TN_IMPORT_AUTHORISATION'] : []),
  ];
  const resolution = resolveNationalTariffLine(replayed.map(item => ({ national_tariff_code: item.line.code, description: item.line.description, declarable: item.declarable, ...window, general_duty: tunisiaCustomsDuty(item.line), control_codes: controls(item.line), preference_area_ids: [] })));
  const published = (line: TunisiaTariffLine) => (args.bundle.preference_tables.get(line.preference_table_id) ?? []);
  const lines: MarketAccessLineRecord[] = replayed.map(item => ({
    national_tariff_code: item.line.code, description: item.line.description, declarable: item.declarable, measure_kind: 'third_country_duty', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null,
    duty: item.withheld ? { ...tunisiaCustomsDuty(item.line), note: item.withheld } : { ...tunisiaCustomsDuty(item.line), note: TUNISIA_DUTY_COLUMN_NOTE },
    conditions: {
      customs_duty_component: item.line.customs_duty.map(row => row.code), withheld_reason: item.withheld, import_status: item.line.import_status, statistical_unit: item.line.statistical_unit,
      // Other import components are published per line and kept separate; they are never part of the customs duty.
      other_import_components: item.line.other_components.map(component => ({ ...component, parsed: parseTunisiaValue(component.value, component.basis) })),
      published_preferences_not_applied: published(item.line), duplicated_rows_merged: item.line.duplicated_rows,
    },
    ...window, source_reference: `https://www.douane.gov.tn/tarifwebnew/getresultat.php?choix=&chap=&sel=${item.line.code}`, raw_measure: { customs_duty: item.line.customs_duty, documents: item.line.documents },
  }));
  const requirements: MarketAccessRequirementRecord[] = [];
  const resolvedCode = resolution.resolved_line?.national_tariff_code ?? '', candidates = resolvedCode ? replayed.filter(item => item.line.code === resolvedCode) : replayed;
  let safeguardApplies = false, quotaScope = false;
  for (const item of candidates) {
    for (const quota of selectTunisiaTariffQuotas(args.bundle.remedies, item.line.code)) {
      quotaScope = true;
      lines.push({ national_tariff_code: item.line.code, description: `${item.line.description} — within WTO tariff quota ${quota.id}`, declarable: false, measure_kind: 'tariff_quota', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: tunisiaInQuotaDuty(quota), conditions: { quota_id: quota.id, quota_quantity_tonnes: quota.quota_quantity_tonnes, ex_scope: quota.ex_scope, special_tariff_quota_authorization_required: true, quota_availability_not_established: true, in_quota_rate_status: quota.in_quota_rate_status }, ...window, source_reference: TUNISIA_TRQ_ADMINISTRATION_URL, raw_measure: quota });
    }
    for (const relief of selectTunisiaConditionalReliefs(args.bundle.remedies, item.line.code, args.at)) {
      lines.push({ national_tariff_code: item.line.code, description: `${item.line.description} — ${relief.instrument}`, declarable: false, measure_kind: 'other', origin_geographic_area_id: null, origin_scope: 'erga_omnes', applies_to_origin_country: null, duty: tunisiaReliefDuty(relief), conditions: { relief_id: relief.id, condition: relief.condition, ex_scope: relief.ex_scope }, effective_from: new Date(`${relief.from}T00:00:00.000Z`), effective_to: relief.until ? new Date(`${relief.until}T23:59:59.999Z`) : null, source_reference: relief.source_url, raw_measure: relief });
    }
    for (const measure of selectTunisiaSafeguards(args.bundle.remedies, item.line.code, args.at)) {
      safeguardApplies = true;
      const period = tunisiaSafeguardPeriod(measure, args.at)!;
      requirements.push({ rule_type: MarketAccessRuleType.import_restriction, requirement_code: 'TN_SAFEGUARD_QUOTA', requirement_description: `A safeguard caps imports of this line at ${period.quantity_tonnes.toLocaleString('en-US')} tonnes from ${period.from} to ${period.until}. It is a quantitative restriction, not a duty, and applies to every origin; developing-country WTO Members are exempt only while their import shares stay within 3% each and 9% together, which cannot be established here. Quota existence is not quota availability.`, requirement_obtainable: null, national_tariff_code: item.line.code, effective_from: new Date(`${period.from}T00:00:00.000Z`), effective_to: new Date(`${period.until}T23:59:59.999Z`), source_reference: measure.source_url, raw: { measure_id: measure.id, instrument: measure.instrument, period, developing_country_exemption: measure.developing_country_exemption } });
    }
  }
  if (quotaScope) requirements.push({ rule_type: MarketAccessRuleType.import_restriction, requirement_code: 'TN_TARIFF_QUOTA_AUTHORIZATION', requirement_description: args.bundle.remedies.trq_administration, requirement_obtainable: null, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: TUNISIA_TRQ_ADMINISTRATION_URL, raw: { quotas: [...new Set(candidates.flatMap(item => selectTunisiaTariffQuotas(args.bundle.remedies, item.line.code).map(quota => quota.id)))] } });
  const restricted = candidates.filter(item => item.line.import_status === 'authorisation_required');
  if (restricted.length) requirements.push({ rule_type: MarketAccessRuleType.import_restriction, requirement_code: 'TN_IMPORT_AUTHORISATION', requirement_description: 'Tarifweb marks import of this line "Prohibé": the goods are excluded from the free-import regime (Law 94-41, Decree 94-1742) and need a prior import authorisation (non-automatic licence).', requirement_obtainable: true, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: TARIFF_RULES_URL, raw: { national_tariff_codes: restricted.map(item => item.line.code) } });
  const documents = [...new Map(candidates.flatMap(item => item.line.documents).map(entry => [entry.code, entry])).values()].sort((a, b) => a.code.localeCompare(b.code));
  if (documents.length) requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: 'TN_REQUIRED_DOCUMENTS', requirement_description: `Tarifweb lists documents required at import: ${documents.map(entry => `${entry.code} ${entry.description}`).join('; ')}.`, requirement_obtainable: true, national_tariff_code: resolvedCode || null, effective_from: null, effective_to: null, source_reference: `https://www.douane.gov.tn/tarifwebnew/getresultat.php?choix=&chap=&sel=${candidates[0]!.line.code}`, raw: { documents } });
  const parser_version = args.parser_version ?? TUNISIA_PARSER_VERSION;
  const tariffTreatmentComplete = !quotaScope && !safeguardApplies && replayed.length > 0;
  return {
    jurisdiction: 'TN', country_code: 'TN', hs6, hs_revision: `HS 2022 / sixth Tunisian nomenclature (11-digit NDP) — ${args.bundle.release_identifier}`, provider: TUNISIA_PROVIDER, source_authority: TUNISIA_SOURCE_AUTHORITY, source_dataset: TUNISIA_SOURCE_DATASET, source_dataset_version: args.bundle.release_identifier,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum})`, national_code_system: 'TN_NDP_2022', parser_version, source_release_id: args.release_id, request_identity: `origin=${origin};as_of=${on}`, retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null, resolution, general_duty: resolution.resolved_line?.general_duty ?? null,
    india_preference: tunisiaIndiaPreference(origin),
    lines, requirements, regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id, bundle_sha256: args.bundle.checksum, release_reference_date: date(args.release_reference_date), reader_version: args.bundle.reader_version, parser_version,
      schedule_line_count: args.bundle.schedule_lines.size, remedy_register_enumeration_complete: args.bundle.remedies.register_enumeration_complete,
      anti_dumping_or_countervailing_measures: 0, safeguard_quota_applies: safeguardApplies, tariff_quota_scope: quotaScope,
      tariff_treatment_complete: tariffTreatmentComplete, regulatory_coverage_complete: false,
      omitted_regulatory_layer: 'VAT, consumption duties, the customs services fee and other Tarifweb components are shown separately and not assessed; privileged regimes (exemptions, suspensions and their 15% legal minimum), technical controls and licensing beyond the Tarifweb import status are not represented.',
    },
  };
}
