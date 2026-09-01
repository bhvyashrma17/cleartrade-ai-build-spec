/**
 * The deterministic EU TARIC parser.
 *
 * Turns an official monthly extraction into the same `MarketAccessIngestResult` the UK and US
 * providers produce, so TARIC flows through the existing classification-refinement engine,
 * `persistMarketAccessIngest` and Country Truth without a parallel tariff system.
 *
 * Four semantics carry the correctness of this file, each verified against the real September
 * 2026 bundle (see docs/18-taric-bundle-schema-map.md):
 *
 *  1. **The cascade.** A measure recorded against an ancestor goods code applies to every child
 *     (guide §14.1.4). Basmati `1006302712` has NO measure rows of its own; its third-country duty
 *     sits on `1006300000` and its import controls on `1006000000`. Joining on the exact 10-digit
 *     code finds nothing at all, so measures are gathered from the code and every zero-padded
 *     ancestor.
 *
 *  2. **The extraction contains the future.** It holds everything applicable on the reference day
 *     "and all data applicable after that day", so every measure and every group membership is
 *     filtered against the assessment clock. Without this a not-yet-in-force duty is published as
 *     today's rate.
 *
 *  3. **Membership does not survive exclusion.** India is a member of group 1008, and group 1008
 *     carries quota 094119 on rice — but India is explicitly excluded from that measure. Matching
 *     on group membership alone would apply to India a quota the Commission excluded India from.
 *
 *  4. **Declarability is a fact, not an inference.** `Declarable codes.IS_LEAF` is the only
 *     authority; a suffix of 80 does not by itself mean a code can be declared.
 */
import type { MarketAccessIngestResult, MarketAccessLineRecord, MarketAccessRequirementRecord } from '@/lib/market-access/contract';
import { parseDutyExpression, resolveNationalTariffLine, type CandidateTariffLine } from '@/lib/market-access/tariff-semantics';
import type { IndiaPreferenceDetermination } from '@/lib/market-access/tariff-semantics';
import { effectiveAt, taricText, type TaricBundle } from './bundle';

export const TARIC_PARSER_VERSION = 'taric-parser-v1' as const;
export const TARIC_PROVIDER = 'eu_taric' as const;
export const TARIC_SOURCE_AUTHORITY = 'European Commission — TARIC (Integrated Tariff of the European Union)' as const;
export const TARIC_SOURCE_DATASET = 'TARIC monthly database extraction (CIRCABC "TARIC & Quota Data and Information")' as const;

/** Measure types, from the Commission's TARIC business codes. */
const MEASURE_TYPE = {
  third_country_duty: '103',
  customs_union_duty: '106',
  low_value_consignment: '107',
  non_preferential_quota: '122',
  tariff_preference: '142',
  preferential_quota: '143',
  additional_duties: '695',
} as const;

/** Measure type codes that carry a duty rather than a control/restriction. */
const DUTY_TYPES = new Set<string>([
  MEASURE_TYPE.third_country_duty, MEASURE_TYPE.customs_union_duty, MEASURE_TYPE.low_value_consignment,
  MEASURE_TYPE.non_preferential_quota, MEASURE_TYPE.tariff_preference, MEASURE_TYPE.preferential_quota,
  MEASURE_TYPE.additional_duties,
]);

/** Only these are preferential. A quota is an entitlement, not a preference. */
const PREFERENCE_TYPES = new Set<string>([MEASURE_TYPE.tariff_preference]);
const QUOTA_TYPES = new Set<string>([MEASURE_TYPE.non_preferential_quota, MEASURE_TYPE.preferential_quota]);

/**
 * TARIC measurement-unit codes, expressed as the quantity they are DEFINED as.
 *
 * This is a renaming, never a conversion: `175.000 EUR TNE` becomes `175.000 EUR / 1 tonne` and
 * `X EUR DTN` becomes `X EUR / 100 kg`, because a decitonne IS 100 kg by definition. The amount is
 * never touched, so no magnitude can drift. Codes that are not an unambiguous quantity — `NAR`
 * (number of articles), qualifier-suffixed forms like `EUR TNE I` — are deliberately absent so
 * they fall through to the shared parser and are preserved verbatim as `unparsed` rather than
 * guessed at.
 */
const TARIC_UNITS: Readonly<Record<string, { quantity: number; unit: string }>> = Object.freeze({
  TNE: { quantity: 1, unit: 'tonne' },
  DTN: { quantity: 100, unit: 'kg' },
  KGM: { quantity: 1, unit: 'kg' },
  HLT: { quantity: 100, unit: 'litre' },
  LTR: { quantity: 1, unit: 'litre' },
  MTK: { quantity: 1, unit: 'm²' },
  MTQ: { quantity: 1, unit: 'm³' },
});

/**
 * Rewrite a TARIC duty into the idiom the shared tariff-semantics parser reads.
 *
 * Only the unambiguous `AMOUNT CURRENCY UNITCODE` form is rewritten. A percentage, a compound
 * (`5 % + 30 EUR DTN`), a mixed (`... MAX ...`), an agricultural-component form (`EA`, `ADSZ`),
 * `NIHIL`, a bare `EUR` with no unit, and any qualifier-suffixed variant are all passed through
 * untouched so the shared parser classifies them — and, where it cannot, keeps the Commission's
 * text verbatim instead of inventing a number.
 */
export function normalizeTaricDuty(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  const match = /^(-?\d+(?:[.,]\d+)?)\s+([A-Z]{3})\s+([A-Z]{3})$/.exec(text);
  if (!match) return text;
  const unit = TARIC_UNITS[match[3]!];
  if (!unit) return text;
  return `${match[1]} ${match[2]} / ${unit.quantity} ${unit.unit}`;
}

export interface TaricMeasure {
  goods_code: string;
  additional_code: string | null;
  quota_order_number: string | null;
  start_date: string;
  end_date: string | null;
  origin_code: string;
  origin_description: string;
  measure_type_code: string;
  measure_type_description: string;
  legal_base: string | null;
  /** Exactly as the Commission published it. Never normalised into a number. */
  duty_expression: string;
  /** True when the duty column carries a conditional expression rather than a plain rate. */
  conditional: boolean;
  is_quota: boolean;
  /** The ancestor level the measure was recorded at, for provenance. */
  applied_via: 'exact' | 'ancestor';
  conditions: Array<{ condition: string; sequence: string; certificate: string | null; action: string | null }>;
  footnotes: string[];
}

/** Ancestors of a 10-digit TARIC code: itself, then the zero-padded 8/6/4/2-digit parents. */
export function taricAncestors(goodsCode: string): string[] {
  const code = goodsCode.replace(/\D/g, '').padEnd(10, '0').slice(0, 10);
  const out = new Set<string>([code]);
  for (const width of [8, 6, 4, 2]) out.add(`${code.slice(0, width)}${'0'.repeat(10 - width)}`);
  return [...out];
}

interface NomenclatureRow {
  code: string;      // 10 digits
  suffix: string;    // product line suffix
  start: string;
  end: string | null;
  level: number;
  indent: number;
  description: string;
}

function parseNomenclature(bundle: TaricBundle, hs6: string, at: Date): NomenclatureRow[] {
  const rows: NomenclatureRow[] = [];
  for (const row of bundle.sheet('Nomenclature EN.xlsx')) {
    const raw = (row[0] ?? '').trim();
    if (!raw.startsWith(hs6)) continue;
    if (!effectiveAt(row[1], row[2], at)) continue;
    const [code, suffix = '80'] = raw.split(/\s+/);
    rows.push({
      code: code!,
      suffix,
      start: row[1] ?? '',
      end: row[2] || null,
      level: Number(row[4] ?? 0),
      // The indent column is a run of "- " pairs; its length is the depth in the tree.
      indent: ((row[5] ?? '').match(/-/g) ?? []).length,
      description: taricText(row[6]),
    });
  }
  return rows;
}

/**
 * Build the description ancestry for a candidate.
 *
 * TARIC expresses the tree through the `Indent` column, and the SAME code can appear several
 * times with different suffixes as intermediary headings: `1006302712 10` is "In immediate
 * packings … not exceeding 5 kg", `… 20` is "Aromatic rice" and `… 80` is "Basmati rice". The
 * meaningful path is therefore the chain of strictly-shallower rows that precede this one in file
 * order, which is exactly what the refinement engine needs in order to ask about packing size,
 * aroma and grain length.
 */
function ancestryFor(rows: NomenclatureRow[], index: number): string[] {
  const path: string[] = [];
  let depth = rows[index]!.indent;
  for (let i = index - 1; i >= 0 && depth > 0; i -= 1) {
    const row = rows[i]!;
    if (row.indent < depth) {
      if (row.description) path.unshift(row.description);
      depth = row.indent;
    }
  }
  return path;
}

export interface TaricResolution {
  hs6: string;
  reference_date: Date;
  candidates: CandidateTariffLine[];
  /** Every measure applicable to the destination for the exporter's origin. */
  measures: TaricMeasure[];
  india_measures: TaricMeasure[];
  third_country_measures: TaricMeasure[];
  india_groups: string[];
  excluded_from: string[];
}

/**
 * Resolve the declarable candidate set and the measures that reach it.
 *
 * `originCountry` is the exporter's origin (India for ClearTrade), NOT the destination: TARIC is
 * the EU's single schedule and the destination member state does not change the tariff.
 */
export function resolveTaric(bundle: TaricBundle, args: { hs6: string; at: Date; origin_country: string }): TaricResolution {
  const { hs6, at } = args;
  const origin = args.origin_country.trim().toUpperCase();
  const nomenclature = parseNomenclature(bundle, hs6, at);

  // Declarability comes only from the Commission's own IS_LEAF flag.
  const declarable = new Set<string>();
  for (const row of bundle.sheet('Declarable codes.xlsx')) {
    const raw = (row[0] ?? '').trim();
    if (!raw.startsWith(hs6)) continue;
    if (row[3] !== '1') continue;
    if (!effectiveAt(row[1], row[4], at)) continue;
    declarable.add(raw);
  }

  // Which country groups is the origin an effective member of, at the assessment clock?
  const originGroups = new Set<string>();
  for (const row of bundle.sheet('Geographical areas composition.xlsx')) {
    if ((row[5] ?? '').trim().toUpperCase() !== origin) continue;
    if (!effectiveAt(row[8], row[9], at)) continue;   // membership window
    if (!effectiveAt(row[1], row[10], at)) continue;  // group's own window
    originGroups.add((row[0] ?? '').trim());
  }
  const originOrigins = new Set<string>([...originGroups, origin]);

  // Measures the origin is EXCLUDED from, keyed by measure identity. Position 10 holds the ISO
  // code; the header above it is mislabelled (see the schema map).
  const excluded = new Set<string>();
  const excludedFrom: string[] = [];
  for (const row of bundle.sheet('Measure exclusions.xlsx')) {
    if ((row[10] ?? '').trim().toUpperCase() !== origin) continue;
    if (!effectiveAt(row[3], row[4], at)) continue;
    const key = measureKey(row[0], row[2], row[8], row[9]);
    excluded.add(key);
    excludedFrom.push(key);
  }

  const conditions = indexConditions(bundle, at);
  const footnotes = indexFootnotes(bundle, at);

  // Gather measures by the cascade: the candidate's own code and every zero-padded ancestor.
  const ancestorSet = new Set<string>(taricAncestors(`${hs6}0000`));
  for (const row of nomenclature) for (const a of taricAncestors(row.code)) ancestorSet.add(a);

  const measures: TaricMeasure[] = [];
  for (const row of bundle.sheet('Duties Import 01-99.xlsx')) {
    const goods = (row[0] ?? '').trim();
    if (!ancestorSet.has(goods)) continue;
    if (!effectiveAt(row[3], row[4], at)) continue;
    const originCode = (row[10] ?? '').trim();
    const typeCode = (row[11] ?? '').trim();
    const key = measureKey(goods, row[2], originCode, typeCode);
    const duty = (row[9] ?? '').trim();
    measures.push({
      goods_code: goods,
      additional_code: (row[1] ?? '').trim() || null,
      quota_order_number: (row[2] ?? '').trim() || null,
      start_date: row[3] ?? '',
      end_date: (row[4] ?? '').trim() || null,
      origin_code: originCode,
      origin_description: taricText(row[6]),
      measure_type_code: typeCode,
      measure_type_description: taricText(row[7]),
      legal_base: (row[8] ?? '').trim() || null,
      duty_expression: duty,
      conditional: /^Cond:/i.test(duty),
      is_quota: QUOTA_TYPES.has(typeCode),
      applied_via: goods === `${hs6}0000` ? 'exact' : 'ancestor',
      conditions: conditions.get(key) ?? [],
      footnotes: footnotes.get(key) ?? [],
    });
  }

  // Applicable to this origin: origin-specific, or a group it belongs to, minus explicit exclusion.
  const applicable = measures.filter((m) => originOrigins.has(m.origin_code)
    && !excluded.has(measureKey(m.goods_code, m.quota_order_number, m.origin_code, m.measure_type_code)));

  const candidates: CandidateTariffLine[] = [];
  for (const [index, row] of nomenclature.entries()) {
    if (!declarable.has(`${row.code} ${row.suffix}`)) continue;
    const forCode = new Set(taricAncestors(row.code));
    const own = applicable.filter((m) => forCode.has(m.goods_code));
    // The general duty for a candidate is its third-country duty; a quota or a preference is not
    // the ordinary rate and must not stand in for one.
    const general = own.find((m) => m.measure_type_code === MEASURE_TYPE.third_country_duty && !m.conditional);
    candidates.push({
      national_tariff_code: row.code,
      description: row.description,
      description_path: ancestryFor(nomenclature, index),
      declarable: true,
      general_duty: parseDutyExpression(normalizeTaricDuty(general?.duty_expression)),
      // Controls and preferential coverage are what `resolveNationalTariffLine` compares to decide
      // whether the children are materially equivalent.
      control_codes: [...new Set(own.filter((m) => !DUTY_TYPES.has(m.measure_type_code)).map((m) => m.measure_type_code))].sort(),
      preference_area_ids: [...new Set(own.filter((m) => PREFERENCE_TYPES.has(m.measure_type_code) || m.is_quota).map((m) => m.origin_code))].sort(),
      effective_from: null,
      effective_to: null,
    });
  }

  return {
    hs6,
    reference_date: at,
    candidates,
    measures: applicable,
    india_measures: applicable.filter((m) => m.origin_code === origin),
    third_country_measures: applicable.filter((m) => m.measure_type_code === MEASURE_TYPE.third_country_duty),
    india_groups: [...originGroups].sort(),
    excluded_from: excludedFrom,
  };
}

const measureKey = (goods: unknown, quota: unknown, origin: unknown, type: unknown) =>
  `${String(goods ?? '').trim()}|${String(quota ?? '').trim()}|${String(origin ?? '').trim()}|${String(type ?? '').trim()}`;

function indexConditions(bundle: TaricBundle, at: Date) {
  const map = new Map<string, TaricMeasure['conditions']>();
  for (const row of bundle.sheet('Measure conditions.xlsx')) {
    if (!effectiveAt(row[3], row[4], at)) continue;
    const key = measureKey(row[0], row[2], row[5], row[6]);
    const list = map.get(key) ?? [];
    list.push({
      condition: (row[7] ?? '').trim(),
      sequence: (row[8] ?? '').trim(),
      certificate: (row[9] ?? '').trim() || null,
      action: (row[14] ?? '').trim() || null,
    });
    map.set(key, list);
  }
  return map;
}

function indexFootnotes(bundle: TaricBundle, at: Date) {
  const map = new Map<string, string[]>();
  for (const row of bundle.sheet('Measure footnotes.xlsx')) {
    if (!effectiveAt(row[4], row[5], at)) continue;
    const key = measureKey(row[0], row[2], row[3], row[6]);
    const list = map.get(key) ?? [];
    const code = (row[9] ?? '').trim();
    if (code) list.push(code);
    map.set(key, list);
  }
  return map;
}

/**
 * Determine India's preferential position from the measures, without inferring eligibility.
 *
 * A tariff preference published for India means the EU offers a rate to Indian-origin goods; it
 * does NOT mean this exporter's goods qualify, which depends on rules of origin the tariff file
 * cannot answer. A quota is weaker still: a volume entitlement, usually conditional on a licence.
 * So the strongest state this function can return is
 * `potentially_applicable_requires_origin_proof`, and it reaches `not_applicable` only when the
 * origin genuinely has no preferential measure at all.
 */
export function determineTaricIndiaPreference(resolution: TaricResolution, origin: string): IndiaPreferenceDetermination {
  const preferential = resolution.measures.filter((m) => PREFERENCE_TYPES.has(m.measure_type_code));
  const quotas = resolution.measures.filter((m) => m.is_quota);

  if (preferential.length) {
    const direct = preferential.find((m) => m.origin_code === origin) ?? preferential[0]!;
    return {
      applicability: 'potentially_applicable_requires_origin_proof',
      duty: parseDutyExpression(normalizeTaricDuty(direct.duty_expression)),
      geographic_area_id: direct.origin_code,
      basis: `TARIC publishes a tariff preference (measure type ${direct.measure_type_code}, ${direct.origin_description}) reaching this product under ${direct.legal_base ?? 'an unstated legal act'}. A published preference is not an entitlement: it applies only to goods that satisfy the agreement's rules-of-origin requirements, which this tariff evidence cannot establish.`,
    };
  }

  if (quotas.length) {
    const quota = quotas.find((m) => m.origin_code === origin) ?? quotas[0]!;
    const conditionNote = quota.conditions.length
      ? ` It is conditional: ${quota.conditions.filter((c) => c.certificate).map((c) => c.certificate).join(', ') || 'a licence or certificate must be presented'}.`
      : '';
    return {
      applicability: 'potentially_applicable_requires_origin_proof',
      duty: null,
      geographic_area_id: quota.origin_code,
      basis: `The only measure TARIC publishes for this origin is tariff quota ${quota.quota_order_number ?? '(unnumbered)'} (${quota.measure_type_description}), which is a volume entitlement, not an unconditional applied rate.${conditionNote} The ordinary third-country duty applies outside the quota.`,
    };
  }

  return {
    applicability: 'not_applicable',
    duty: null,
    geographic_area_id: null,
    basis: 'TARIC publishes no tariff preference and no tariff quota reaching this product for goods of Indian origin at the assessment date; the ordinary third-country duty applies.',
  };
}

/**
 * Build the ingest result the shared Market Access contract persists.
 *
 * `regulatory_coverage_complete` is always false. TARIC carries the customs-facing measures, not
 * the whole product-regulatory corpus of a member state, so "no restriction found here" can never
 * be published as "no requirements exist".
 */
export function buildTaricIngest(args: {
  bundle: TaricBundle;
  resolution: TaricResolution;
  destination_country: string;
  release_label: string;
  release_reference_date: Date;
  retrieved_at: Date;
  origin_country: string;
}): MarketAccessIngestResult {
  const { resolution } = args;
  const destination = args.destination_country.trim().toUpperCase();
  const resolved = resolveNationalTariffLine(resolution.candidates);

  const lines: MarketAccessLineRecord[] = resolution.measures.map((measure) => ({
    national_tariff_code: measure.goods_code,
    description: measure.measure_type_description,
    declarable: false,
    measure_kind: measure.measure_type_code === MEASURE_TYPE.third_country_duty ? 'third_country_duty'
      : PREFERENCE_TYPES.has(measure.measure_type_code) ? 'tariff_preference'
        : measure.is_quota ? 'tariff_quota'
          : measure.measure_type_code === MEASURE_TYPE.additional_duties ? 'additional_duty'
            : 'other',
    origin_geographic_area_id: measure.origin_code,
    origin_scope: measure.origin_code === args.origin_country ? 'country' : /^\d/.test(measure.origin_code) ? 'group' : 'country',
    applies_to_origin_country: args.origin_country,
    duty: parseDutyExpression(measure.conditional ? null : normalizeTaricDuty(measure.duty_expression)),
    conditions: {
      raw_duty_expression: measure.duty_expression,
      conditional: measure.conditional,
      quota_order_number: measure.quota_order_number,
      measure_conditions: measure.conditions,
      footnotes: measure.footnotes,
      legal_base: measure.legal_base,
      applied_via: measure.applied_via,
    },
    effective_from: null,
    effective_to: null,
    source_reference: `TARIC ${args.release_label} · measure ${measure.measure_type_code} on ${measure.goods_code} for ${measure.origin_code}`,
    raw_measure: measure as unknown,
  }));

  // Restrictions and controls become requirements; a duty measure does not.
  const requirements: MarketAccessRequirementRecord[] = resolution.measures
    .filter((measure) => !DUTY_TYPES.has(measure.measure_type_code))
    .map((measure) => ({
      rule_type: 'mandatory_certification' as const,
      requirement_code: measure.conditions.find((c) => c.certificate)?.certificate ?? measure.measure_type_code,
      requirement_description: `${measure.measure_type_description}${measure.conditions.length ? ` — conditions: ${measure.conditions.filter((c) => c.certificate).map((c) => c.certificate).join(', ') || 'see measure'}` : ''}`,
      requirement_obtainable: null,
      national_tariff_code: measure.goods_code,
      effective_from: null,
      effective_to: null,
      source_reference: `TARIC ${args.release_label} · measure ${measure.measure_type_code} on ${measure.goods_code}`,
      raw: measure as unknown,
    }));

  return {
    // The tariff authority is the EU; the destination stays its own member state so assessments,
    // requirements and future national measures remain separately scoped.
    jurisdiction: 'EU',
    country_code: destination,
    hs6: resolution.hs6,
    hs_revision: 'HS2022',
    provider: TARIC_PROVIDER,
    source_authority: TARIC_SOURCE_AUTHORITY,
    source_dataset: TARIC_SOURCE_DATASET,
    source_dataset_version: args.release_label,
    source_reference: `CIRCABC TARIC monthly extraction ${args.release_label} (bundle sha256 ${args.bundle.bundle_sha256})`,
    national_code_system: 'EU_TARIC',
    parser_version: TARIC_PARSER_VERSION,
    retrieved_at: args.retrieved_at,
    evidence_class: 'authoritative_public',
    recorded_by_id: null,
    resolution: resolved,
    general_duty: resolved.resolved_line?.general_duty ?? null,
    india_preference: determineTaricIndiaPreference(resolution, args.origin_country),
    lines,
    requirements,
    // TARIC is not a complete product-regulatory corpus for any member state.
    regulatory_coverage_complete: false,
    raw_evidence: {
      release: args.release_label,
      reference_date: args.release_reference_date.toISOString(),
      bundle_sha256: args.bundle.bundle_sha256,
      files: args.bundle.files,
      parser_version: TARIC_PARSER_VERSION,
      reader_version: args.bundle.reader_version,
      origin_country: args.origin_country,
      origin_groups: resolution.india_groups,
      excluded_measures: resolution.excluded_from,
      candidate_count: resolution.candidates.length,
      measure_count: resolution.measures.length,
    },
  };
}
