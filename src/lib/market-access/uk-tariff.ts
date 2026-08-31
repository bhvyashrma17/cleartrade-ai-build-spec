/**
 * UK Integrated Online Tariff — official GOV.UK Trade Tariff API.
 *
 * Source: https://www.trade-tariff.service.gov.uk/uk/api (public, keyless, JSON:API, versioned
 * through the `application/vnd.hmrc.2.0+json` Accept header). The managed developer portal at
 * api.trade-tariff.service.gov.uk fronts the same data behind OAuth; the public host is used
 * here because it needs no credential and serves the identical documents.
 *
 * WHAT CHANGED, AND WHY. The previous implementation took `Math.max` of the ad-valorem rates
 * across every declarable child line and published that as "the" UK tariff. For HS 1006.30 that
 * is wrong twice over: the third-country duty is `121.00 GBP / 1000 kg`, a SPECIFIC duty with
 * no percentage at all — so the old parser returned null and the whole ingest threw — and the
 * 108 declarable children beneath 1006.30 do not share preferential coverage (the Basmati line
 * 1006302712 carries preferences the packing-size lines do not). Collapsing them answers a
 * classification question that only the exporter's actual product can answer.
 */
import { createHash } from 'node:crypto';
import { MarketAccessRuleType } from '@prisma/client';
import {
  determineIndiaPreference,
  parseDutyExpression,
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from './tariff-semantics';
import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from './contract';

const BASE = 'https://www.trade-tariff.service.gov.uk/uk/api';
export const UK_TARIFF_AUTHORITY = 'HM Revenue & Customs — UK Integrated Online Tariff';
export const UK_TARIFF_PARSER_VERSION = 'uk-tariff-v2';
const ACCEPT = 'application/vnd.hmrc.2.0+json';

/** Measure type identifiers published by the UK tariff. */
const THIRD_COUNTRY_DUTY = '103';
const TARIFF_PREFERENCE = '142';
const NON_PREFERENTIAL_QUOTA = '122';
const PREFERENTIAL_QUOTA = '143';
const ERGA_OMNES = '1011';

type Resource = { id: string; type: string; attributes: Record<string, unknown>; relationships?: Record<string, { data: { id: string; type: string } | Array<{ id: string; type: string }> | null }> };
type Document = { data: Resource; included?: Resource[] };

const key = (resource: { id: string; type: string }) => `${resource.type}:${resource.id}`;
const related = (resource: Resource, name: string, index: Map<string, Resource>) => {
  const data = resource.relationships?.[name]?.data;
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]).map((entry) => index.get(key(entry))).filter((entry): entry is Resource => Boolean(entry));
};
const str = (value: unknown) => (value == null ? null : String(value));
const date = (value: unknown) => (value ? new Date(String(value)) : null);

async function getJson(url: string): Promise<Document> {
  const response = await fetch(url, { headers: { accept: ACCEPT } });
  if (!response.ok) throw new Error(`UK Trade Tariff returned ${response.status} for ${new URL(url).pathname}.`);
  return response.json() as Promise<Document>;
}

export interface UkTariffFetchOptions {
  /**
   * Hard ceiling on commodity documents fetched. Deciding whether children are equivalent needs
   * ALL of them, so exceeding the cap yields `unavailable` rather than a verdict drawn from a
   * partial candidate set.
   */
  max_commodity_requests?: number;
  now?: Date;
}

export async function fetchUkMarketAccess(hs6: string, options: UkTariffFetchOptions = {}): Promise<MarketAccessIngestResult> {
  if (!/^\d{6}$/.test(hs6)) throw new Error('UK market-access ingest requires an exact HS6.');
  const now = options.now ?? new Date();
  const cap = options.max_commodity_requests ?? 150;

  const searchUrl = `${BASE}/search?q=${hs6}`;
  const search = await getJson(searchUrl);
  const entry = (search.data.attributes.entry ?? null) as { endpoint?: string; id?: string } | null;
  if (!entry?.endpoint || !entry.id) throw new Error(`UK tariff has no exact entry for HS ${hs6}.`);
  const treeUrl = `${BASE}/${entry.endpoint}/${entry.id}`;
  const tree = await getJson(treeUrl);

  const declarable = (tree.included ?? [])
    .filter((resource) => resource.type === 'commodity' && resource.attributes.declarable === true && String(resource.attributes.goods_nomenclature_item_id).startsWith(hs6))
    .reduce<Map<string, Resource>>((map, resource) => map.set(String(resource.attributes.goods_nomenclature_item_id), resource), new Map());

  const raw: Record<string, unknown> = { hs6, search_url: searchUrl, tree_url: treeUrl, declarable_count: declarable.size, responses: [] as unknown[] };
  const responses = raw.responses as unknown[];

  if (!declarable.size) {
    const resolution = resolveNationalTariffLine([]);
    return baseResult(hs6, now, searchUrl, resolution, null, { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'The UK tariff publishes no declarable commodity beneath this HS6, so no duty can be stated.' }, [], [], false, raw);
  }
  if (declarable.size > cap) {
    const resolution = resolveNationalTariffLine([]);
    return baseResult(hs6, now, searchUrl, { ...resolution, candidate_count: declarable.size, reason: `HS6 has ${declarable.size} declarable UK commodity lines, above the ${cap}-document evaluation ceiling; equivalence cannot be established from a partial candidate set.` }, null, { applicability: 'unknown', duty: null, geographic_area_id: null, basis: 'The candidate line set was not fully evaluated.' }, [], [], false, raw);
  }

  const candidates: CandidateTariffLine[] = [];
  const lines: MarketAccessLineRecord[] = [];
  const requirements: MarketAccessRequirementRecord[] = [];
  const directIndia: Array<{ geographic_area_id: string; duty: ParsedDuty; is_quota: boolean }> = [];
  let regulatoryComplete = true;

  for (const [code, commodity] of [...declarable.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const url = `${BASE}/commodities/${code}`;
    const document = await getJson(url);
    const resources = document.included ?? [];
    const index = new Map(resources.map((resource) => [key(resource), resource]));
    responses.push({ commodity_code: code, url, sha256: createHash('sha256').update(JSON.stringify(document)).digest('hex') });

    // A measure whose validity has ended is history, not law. A measure whose validity has not
    // begun is a future change and must not be applied before its effective date.
    const measures = resources.filter((resource) => {
      if (resource.type !== 'measure' || resource.attributes.import !== true) return false;
      const from = date(resource.attributes.effective_start_date);
      const to = date(resource.attributes.effective_end_date);
      if (from && from.getTime() > now.getTime()) return false;
      if (to && to.getTime() <= now.getTime()) return false;
      return true;
    });

    let generalDuty: ParsedDuty = parseDutyExpression(null);
    const controlCodes: string[] = [];
    const preferenceAreas: string[] = [];

    for (const measure of measures) {
      const measureType = related(measure, 'measure_type', index)[0];
      if (!measureType) { regulatoryComplete = false; continue; }
      const dutyExpression = related(measure, 'duty_expression', index)[0];
      const duty = parseDutyExpression(str(dutyExpression?.attributes.base));
      const geo = related(measure, 'geographical_area', index)[0];
      const geoId = geo?.id ?? null;
      const excludesIndia = related(measure, 'excluded_countries', index).some((area) => area.id === 'IN');
      const conditions = related(measure, 'measure_conditions', index);
      const measureKind: MarketAccessLineRecord['measure_kind'] =
        measureType.id === THIRD_COUNTRY_DUTY ? 'third_country_duty'
          : measureType.id === TARIFF_PREFERENCE ? 'tariff_preference'
            : measureType.id === NON_PREFERENTIAL_QUOTA || measureType.id === PREFERENTIAL_QUOTA ? 'tariff_quota'
              : measure.attributes.vat === true ? 'vat' : 'other';

      lines.push({
        national_tariff_code: code,
        description: String(commodity.attributes.description ?? ''),
        declarable: true,
        measure_kind: measureKind,
        origin_geographic_area_id: geoId,
        origin_scope: geoId === ERGA_OMNES ? 'erga_omnes' : geoId && /^[A-Z]{2}$/.test(geoId) ? 'country' : geoId ? 'group' : 'unknown',
        applies_to_origin_country: geoId && /^[A-Z]{2}$/.test(geoId) ? geoId : null,
        duty,
        conditions: {
          measure_id: measure.id,
          measure_type_id: measureType.id,
          measure_type: String(measureType.attributes.description ?? ''),
          excludes_india: excludesIndia,
          // TARIC/UK measure conditions are retained rather than flattened: a document
          // requirement or a quota membership is what makes a published rate conditional.
          conditions: conditions.map((condition) => ({ id: condition.id, action: str(condition.attributes.action), class: str(condition.attributes.measure_condition_class), document_code: str(condition.attributes.document_code), requirement: str(condition.attributes.requirement) })),
          additional_code: related(measure, 'additional_code', index).map((additional) => additional.id),
        },
        effective_from: date(measure.attributes.effective_start_date),
        effective_to: date(measure.attributes.effective_end_date),
        source_reference: `${url}#measure-${measure.id}`,
        raw_measure: { measure_id: measure.id, measure_type_id: measureType.id, geographical_area: geoId, duty: str(dutyExpression?.attributes.base) },
      });

      if (measureType.id === THIRD_COUNTRY_DUTY && geoId === ERGA_OMNES) generalDuty = duty;
      if (measureType.id === TARIFF_PREFERENCE) {
        preferenceAreas.push(geoId ?? 'unknown');
        if (geoId === 'IN' && !excludesIndia) directIndia.push({ geographic_area_id: geoId, duty, is_quota: false });
      }
      if ((measureType.id === NON_PREFERENTIAL_QUOTA || measureType.id === PREFERENTIAL_QUOTA) && geoId === 'IN' && !excludesIndia) {
        directIndia.push({ geographic_area_id: geoId, duty, is_quota: true });
      }

      // Controls: only measures that reach India-origin goods. A control published for another
      // country is not this exporter's control, and a measure whose group membership we cannot
      // resolve makes coverage incomplete rather than being silently dropped.
      if (measureKind === 'other' && !excludesIndia) {
        const reachesIndia = geoId === ERGA_OMNES || geoId === 'IN';
        if (!reachesIndia && geoId && /^[A-Z]{2}$/.test(geoId)) continue;
        if (!reachesIndia) {
          if (measure.attributes.vat === true || measure.attributes.excise === true) continue;
          regulatoryComplete = false;
          continue;
        }
        controlCodes.push(`${measureType.id}:${conditions.map((condition) => str(condition.attributes.document_code) ?? '').sort().join('+')}`);
        const denied = conditions.length > 0 && conditions.every((condition) => String(condition.attributes.action ?? '').toLowerCase() === 'import is not allowed');
        const documents = conditions.filter((condition) => condition.attributes.measure_condition_class === 'document');
        if (denied) {
          requirements.push({ rule_type: MarketAccessRuleType.import_prohibition, requirement_code: null, requirement_description: String(measureType.attributes.description ?? ''), requirement_obtainable: null, national_tariff_code: code, effective_from: date(measure.attributes.effective_start_date), effective_to: date(measure.attributes.effective_end_date), source_reference: `${url}#measure-${measure.id}`, raw: { measure_id: measure.id, measure_type_id: measureType.id } });
        } else if (documents.length) {
          for (const condition of documents) {
            requirements.push({ rule_type: MarketAccessRuleType.mandatory_certification, requirement_code: str(condition.attributes.document_code), requirement_description: str(condition.attributes.requirement) ?? str(condition.attributes.certificate_description) ?? String(measureType.attributes.description ?? ''), requirement_obtainable: null, national_tariff_code: code, effective_from: date(measure.attributes.effective_start_date), effective_to: date(measure.attributes.effective_end_date), source_reference: `${url}#condition-${condition.id}`, raw: { measure_id: measure.id, condition_id: condition.id, action: str(condition.attributes.action) } });
          }
        } else {
          requirements.push({ rule_type: MarketAccessRuleType.material_non_tariff_requirement, requirement_code: null, requirement_description: String(measureType.attributes.description ?? ''), requirement_obtainable: null, national_tariff_code: code, effective_from: date(measure.attributes.effective_start_date), effective_to: date(measure.attributes.effective_end_date), source_reference: `${url}#measure-${measure.id}`, raw: { measure_id: measure.id, measure_type_id: measureType.id } });
        }
      }
    }

    candidates.push({ national_tariff_code: code, description: String(commodity.attributes.description ?? ''), declarable: true, general_duty: generalDuty, control_codes: controlCodes, preference_area_ids: preferenceAreas });
  }

  const resolution = resolveNationalTariffLine(candidates);
  const preference = determineIndiaPreference({
    direct_india_measures: directIndia,
    proven_group_measures: [],
    // The UK tariff publishes preferences per geographical area; a group's membership list is a
    // separate resource we do not read here, so absence cannot be proven to mean exclusion.
    beneficiary_enumeration_is_complete: false,
    unresolved_program_symbols: [],
  });
  const generalDuty = resolution.resolved_line ? resolution.resolved_line.general_duty : null;
  return baseResult(hs6, now, searchUrl, resolution, generalDuty && generalDuty.kind !== 'none' ? generalDuty : null, preference, lines, requirements, regulatoryComplete, raw);
}

function baseResult(
  hs6: string,
  now: Date,
  sourceReference: string,
  resolution: MarketAccessIngestResult['resolution'],
  generalDuty: ParsedDuty | null,
  preference: MarketAccessIngestResult['india_preference'],
  lines: MarketAccessLineRecord[],
  requirements: MarketAccessRequirementRecord[],
  regulatoryComplete: boolean,
  raw: unknown,
): MarketAccessIngestResult {
  return {
    jurisdiction: 'GB', country_code: 'GB', hs6, hs_revision: 'HS2022',
    provider: 'uk_trade_tariff', source_authority: UK_TARIFF_AUTHORITY,
    source_dataset: 'UK Integrated Online Tariff', source_dataset_version: 'vnd.hmrc.2.0',
    source_reference: sourceReference, national_code_system: 'UK_COMMODITY',
    parser_version: UK_TARIFF_PARSER_VERSION, retrieved_at: now,
    evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution, general_duty: generalDuty, india_preference: preference,
    lines, requirements, regulatory_coverage_complete: regulatoryComplete, raw_evidence: raw,
  };
}
