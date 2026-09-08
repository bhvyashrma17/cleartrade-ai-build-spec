import { MarketAccessRuleType } from '@prisma/client';
import type {
  MarketAccessIngestResult,
  MarketAccessLineRecord,
  MarketAccessRequirementRecord,
} from '@/lib/market-access/contract';
import {
  resolveNationalTariffLine,
  type CandidateTariffLine,
  type ParsedDuty,
} from '@/lib/market-access/tariff-semantics';
import type { IsraelAuthorityBundle, IsraelRequirementRow, IsraelTariffRow } from './israel-bundle';

export const ISRAEL_PARSER_VERSION = 'il-customs-book-parser-v1' as const;
export const ISRAEL_PROVIDER = 'il_tax_authority_customs_book' as const;
export const ISRAEL_SOURCE_AUTHORITY = 'Israel Tax Authority / data.gov.il' as const;
export const ISRAEL_SOURCE_DATASET = 'Israel Customs Tariff and Purchase Tax plus Legal Requirements' as const;

const emptyDuty = (kind: ParsedDuty['kind'], expression: string, note: string | null): ParsedDuty => ({
  kind,
  ad_valorem_rate_percent: null,
  specific_amount: null,
  specific_currency: null,
  specific_unit: null,
  specific_unit_quantity: null,
  expression,
  note,
});

const text = (value: unknown) => value == null ? '' : String(value).trim();

/** Israel-specific parser: shekel amounts and floor/cap operators are never coerced to AVEs. */
export function parseIsraelDuty(raw: unknown): ParsedDuty {
  const expression = text(raw);
  if (!expression) return emptyDuty('none', '', 'The source published no duty expression.');
  if (/^Tax Free$/i.test(expression)) {
    return { ...emptyDuty('ad_valorem', expression, 'Observed legal zero published by the authority.'), ad_valorem_rate_percent: 0 };
  }
  const percent = /^(\d+(?:\.\d+)?)\s*%$/.exec(expression);
  if (percent) return { ...emptyDuty('ad_valorem', expression, null), ad_valorem_rate_percent: Number(percent[1]) };

  const specific = /(\d+(?:\.\d+)?)\s*₪\s*per\s+([A-Za-z][A-Za-z ]*)/i.exec(expression);
  const components = specific ? {
    specific_amount: Number(specific[1]),
    specific_currency: 'ILS',
    specific_unit: specific[2]!.trim(),
    specific_unit_quantity: 1,
  } : {};
  if (/\+/.test(expression)) {
    return {
      ...emptyDuty('compound', expression, 'Compound duty: every published component and any floor/cap are retained without conversion.'),
      ...components,
    };
  }
  if (/\bbut\s+no\s+(?:less|more)\s+than\b/i.test(expression)) {
    return {
      ...emptyDuty('mixed', expression, 'Mixed duty: the published minimum/maximum operator is retained; no ad-valorem equivalent is calculated.'),
      ...components,
    };
  }
  if (specific && expression.replace(/\)\s*$/, '').trim() === specific[0]!.trim()) {
    return {
      ...emptyDuty('specific', expression, null),
      ...components,
    };
  }
  if (/%/.test(expression) || specific) {
    return {
      ...emptyDuty('mixed', expression, 'Conditional or referenced rate retained verbatim; no scalar rate is inferred.'),
      ...components,
    };
  }
  return emptyDuty('unparsed', expression, 'Duty expression is not in a recognised Israel Customs form and is retained verbatim.');
}

function sourceDate(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function activeThrough(end: Date | null, at: Date) {
  if (!end) return true;
  return end.toISOString().slice(0, 10) >= at.toISOString().slice(0, 10);
}

function codeDigits(code: unknown) {
  const raw = text(code);
  if (!/^\d/.test(raw)) return '';
  return (raw.split('/')[0] ?? '').replace(/\D/g, '');
}

function description(row: IsraelTariffRow) {
  return text(row.FullGoodsDescription) || text(row.GoodsDescription) || 'Description unavailable in source';
}

function requirementDescription(row: IsraelRequirementRow) {
  const parts = [
    text(row.ConfirmationType),
    text(row.RegularityRequirement_GoodsDescription),
    text(row.RegularityRequirement_Authority),
    text(row.RegularityPublication),
    text(row.RegularitySource),
  ].filter(Boolean);
  return [...new Set(parts)].join(' · ') || text(row.FullGoodsDescription) || 'Import requirement published by the authority';
}

function requirementReference(bundle: IsraelAuthorityBundle, row: IsraelRequirementRow) {
  const key = row.source_resource ?? 'free_import';
  const resource = bundle.resources[key];
  return `${resource.url} · requirement ${text(row.RegularityRequirementID) || text(row._id)}`;
}

export function buildIsraelMarketAccess(args: {
  bundle: IsraelAuthorityBundle;
  release_id: string;
  release_reference_date: Date;
  retrieved_at: Date;
  hs6: string;
  at: Date;
  origin_country?: string;
  parser_version?: string;
}): MarketAccessIngestResult {
  const origin = (args.origin_country ?? 'IN').trim().toUpperCase();
  const tariffRows = args.bundle.tariff_rows.filter((row) => {
    if (!codeDigits(row.CustomsItemFullClassification).startsWith(args.hs6)) return false;
    return activeThrough(sourceDate(row.CustomsItemEndDate), args.at);
  });
  const requirementRows = args.bundle.requirement_rows.filter((row) => {
    if (!codeDigits(row.CustomsItemFullClassification).startsWith(args.hs6)) return false;
    if (text(row.CustomsBookTypeID) && text(row.CustomsBookTypeID) !== '1') return false;
    return activeThrough(sourceDate(row.EndDate), args.at);
  });
  const requirementIdsByCode = new Map<string, string[]>();
  for (const row of requirementRows) {
    const code = text(row.CustomsItemFullClassification);
    const ids = requirementIdsByCode.get(code) ?? [];
    ids.push(`${row.source_resource ?? 'free_import'}:${text(row.RegularityRequirementID) || text(row._id)}`);
    requirementIdsByCode.set(code, ids);
  }

  const candidates: CandidateTariffLine[] = tariffRows.map((row) => {
    const code = text(row.CustomsItemFullClassification);
    const tariffEnd = sourceDate(row.CustomsTariffEndDate);
    const publishedDuty = parseIsraelDuty(row.CustomsTariff);
    const generalDuty = activeThrough(tariffEnd, args.at)
      ? publishedDuty
      : emptyDuty('none', '', `The published customs tariff expired on ${tariffEnd!.toISOString().slice(0, 10)}.`);
    const category = text(row.CustomsItemCategoryID);
    return {
      national_tariff_code: code,
      description: description(row),
      declarable: /^\d{10}\/\d$/.test(code),
      effective_from: args.release_reference_date,
      effective_to: tariffEnd ?? sourceDate(row.CustomsItemEndDate),
      general_duty: generalDuty,
      control_codes: [
        ...(category && category !== '1' ? [`CONDITIONAL_CATEGORY:${category}`] : []),
        ...(requirementIdsByCode.get(code) ?? []).sort(),
      ],
      preference_area_ids: [],
    };
  });
  const resolution = resolveNationalTariffLine(candidates);
  const lines: MarketAccessLineRecord[] = [];
  for (const row of tariffRows) {
    const code = text(row.CustomsItemFullClassification);
    const common = {
      national_tariff_code: code,
      description: description(row),
      declarable: /^\d{10}\/\d$/.test(code),
      origin_geographic_area_id: null,
      origin_scope: 'erga_omnes' as const,
      applies_to_origin_country: origin,
      effective_from: args.release_reference_date,
      source_reference: `${args.bundle.resources.tariff.url} · code ${code}`,
    };
    lines.push({
      ...common,
      measure_kind: 'third_country_duty',
      duty: parseIsraelDuty(row.CustomsTariff),
      effective_to: sourceDate(row.CustomsTariffEndDate) ?? sourceDate(row.CustomsItemEndDate),
      conditions: {
        measurement_unit_id: text(row.MeasurementUnitID) || null,
        measurement_unit: text(row.MeasurementUnitDescription) || null,
        route_measurement_unit: text(row.MaslulMeasurementUnit) || null,
        customs_item_category_id: text(row.CustomsItemCategoryID) || null,
        conditional_category: text(row.CustomsItemCategoryID) !== '1',
        percentage_cap_addition_tariff: text(row.PercentageCapAdditionTariff) || null,
      },
      raw_measure: row,
    });
    if (text(row.PurchaseTaxTariff)) {
      lines.push({
        ...common,
        measure_kind: 'other',
        duty: parseIsraelDuty(row.PurchaseTaxTariff),
        effective_to: sourceDate(row.PurchaseTaxTariffEndDate) ?? sourceDate(row.CustomsItemEndDate),
        conditions: {
          tax_type: 'purchase_tax',
          separate_from_customs_duty: true,
          measurement_unit_id: text(row.MeasurementUnitID) || null,
          measurement_unit: text(row.MeasurementUnitDescription) || null,
          customs_item_category_id: text(row.CustomsItemCategoryID) || null,
        },
        raw_measure: row,
      });
    }
  }

  const requirements: MarketAccessRequirementRecord[] = requirementRows.map((row) => ({
    rule_type: text(row.ConfirmationType)
      ? MarketAccessRuleType.mandatory_certification
      : MarketAccessRuleType.import_restriction,
    requirement_code: text(row.ConfirmationTypeID) || text(row.RegularityRequirementID) || null,
    requirement_description: requirementDescription(row),
    requirement_obtainable: null,
    national_tariff_code: text(row.CustomsItemFullClassification) || null,
    effective_from: args.release_reference_date,
    effective_to: sourceDate(row.EndDate),
    source_reference: requirementReference(args.bundle, row),
    raw: row,
  }));

  const indiaPreference = origin !== 'IN'
    ? { applicability: 'not_applicable' as const, duty: null, geographic_area_id: null, basis: `The requested origin is ${origin}, not India.` }
    : {
      applicability: 'unknown' as const,
      duty: null,
      geographic_area_id: null,
      basis: 'The Israel Customs Book bundle does not enumerate preferential origin programmes; no India preference is inferred from an absent measure.',
    };
  const parserVersion = args.parser_version ?? ISRAEL_PARSER_VERSION;
  const generalDuty = resolution.resolved_line?.general_duty.kind === 'none'
    ? null
    : resolution.resolved_line?.general_duty ?? null;
  const resourceVersions = Object.entries(args.bundle.resources)
    .map(([name, resource]) => `${name}:${resource.last_modified}`)
    .join(';');
  return {
    jurisdiction: 'IL',
    country_code: 'IL',
    hs6: args.hs6,
    hs_revision: `Israel Customs Book full classification · release ${args.bundle.release_identifier}`,
    provider: ISRAEL_PROVIDER,
    source_authority: ISRAEL_SOURCE_AUTHORITY,
    source_dataset: ISRAEL_SOURCE_DATASET,
    source_dataset_version: `${args.bundle.release_identifier} (${resourceVersions})`,
    source_reference: `${args.bundle.source_url} (bundle sha256 ${args.bundle.checksum}; licence: other-open)`,
    national_code_system: 'IL_CUSTOMS_BOOK',
    parser_version: parserVersion,
    source_release_id: args.release_id,
    request_identity: `origin=${origin};as_of=${args.at.toISOString().slice(0, 10)}`,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution,
    general_duty: generalDuty,
    india_preference: indiaPreference,
    lines,
    requirements,
    regulatory_coverage_complete: false,
    raw_evidence: {
      authority_release_id: args.release_id,
      release_identifier: args.bundle.release_identifier,
      release_reference_date: args.release_reference_date.toISOString(),
      bundle_sha256: args.bundle.checksum,
      reader_version: args.bundle.reader_version,
      parser_version: parserVersion,
      origin_country: origin,
      tariff_candidates: tariffRows,
      requirement_rows: requirementRows,
    },
  };
}
