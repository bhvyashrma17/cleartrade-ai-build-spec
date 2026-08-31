/**
 * Tariff semantics: duty expressions and national tariff-line resolution.
 *
 * Pure, no IO, no provider knowledge. Two rules dominate this file, and both exist because the
 * comfortable shortcut is wrong in a way that is invisible downstream:
 *
 *  1. A duty is whatever the authority published. `121.00 GBP / 1000 kg` has NO ad-valorem
 *     equivalent without a unit value, so `ad_valorem_rate_percent` stays null and the verbatim
 *     expression is carried instead. Inventing a percentage would produce a landed cost that
 *     looks precise and is fiction.
 *
 *  2. An HS6 is not a declarable tariff line. HS 1006.30 fans out into 108 declarable UK
 *     commodity codes and into US lines whose duties are 11.2% and 1.4¢/kg respectively —
 *     different rates AND different duty kinds. Choosing one (the first, the lowest, the modal,
 *     the maximum) silently answers a classification question that only the exporter's actual
 *     product can answer. When the candidates disagree materially, the honest result is
 *     `classification_refinement_required`.
 */

export const TARIFF_SEMANTICS_VERSION = 'tariff-semantics-v1' as const;

export type DutyKind = 'ad_valorem' | 'specific' | 'compound' | 'mixed' | 'none' | 'unparsed';

export interface ParsedDuty {
  kind: DutyKind;
  /** Populated only when the expression is purely ad valorem. */
  ad_valorem_rate_percent: number | null;
  specific_amount: number | null;
  specific_currency: string | null;
  specific_unit: string | null;
  specific_unit_quantity: number | null;
  /** Verbatim source text, always retained. */
  expression: string;
  /** Why a kind could not be established, when it could not. */
  note: string | null;
}

const AD_VALOREM = /^\s*(-?\d+(?:[.,]\d+)?)\s*%\s*$/;
/** e.g. `121.00 GBP / 1000 kg`, `1.4¢/kg`, `EUR 175.00 / 1000 kg` */
// Groups: 1 leading currency, 2 amount, 3 trailing currency/symbol, 4 unit quantity, 5 unit.
// Numbered rather than named because the compile target predates named capture groups.
const SPECIFIC = /^\s*(?:([A-Z]{3})\s*)?(-?\d+(?:[.,]\d+)?)\s*([A-Z]{3}|¢|c|\$|€|£)?\s*\/\s*(?:(\d+(?:[.,]\d+)?)\s*)?([A-Za-z][A-Za-z0-9³²%\s]*?)\s*$/;

const CENT_CURRENCY: Record<string, { currency: string; divisor: number }> = {
  '¢': { currency: 'USD', divisor: 100 },
  c: { currency: 'USD', divisor: 100 },
};
const SYMBOL_CURRENCY: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP' };

const num = (value: string) => Number(value.replace(',', '.'));

function empty(expression: string, kind: DutyKind, note: string | null = null): ParsedDuty {
  return { kind, ad_valorem_rate_percent: null, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression, note };
}

/**
 * Classify a published duty expression.
 *
 * Anything this cannot decompose is `unparsed` — never silently zero and never coerced into a
 * percentage. `unparsed` still carries the verbatim expression, so an operator can read exactly
 * what the authority said.
 */
export function parseDutyExpression(raw: string | null | undefined): ParsedDuty {
  const expression = (raw ?? '').trim();
  if (!expression) return empty('', 'none', 'The source published no duty expression.');

  const adValorem = AD_VALOREM.exec(expression);
  if (adValorem) {
    const rate = num(adValorem[1]!);
    if (!Number.isFinite(rate) || rate < 0) return empty(expression, 'unparsed', 'Ad-valorem rate is not a finite non-negative number.');
    return { ...empty(expression, 'ad_valorem'), ad_valorem_rate_percent: rate };
  }

  const specific = SPECIFIC.exec(expression);
  if (specific) {
    const [, cur1, amount, cur2, qty, unit] = specific;
    let value = num(amount!);
    let currency = cur1 ?? null;
    if (!currency && cur2) {
      if (CENT_CURRENCY[cur2]) { currency = CENT_CURRENCY[cur2]!.currency; value /= CENT_CURRENCY[cur2]!.divisor; }
      else if (SYMBOL_CURRENCY[cur2]) currency = SYMBOL_CURRENCY[cur2]!;
      else if (/^[A-Z]{3}$/.test(cur2)) currency = cur2;
    }
    const normalizedUnit = (unit ?? '').trim();
    if (currency && Number.isFinite(value) && normalizedUnit) {
      return { kind: 'specific', ad_valorem_rate_percent: null, specific_amount: value, specific_currency: currency, specific_unit: normalizedUnit, specific_unit_quantity: qty ? num(qty) : 1, expression, note: null };
    }
    return empty(expression, 'unparsed', 'Specific duty is missing a currency or a unit.');
  }

  // A compound or mixed duty carries more than one component; it has no single scalar and is
  // recorded as such rather than reduced to whichever component happens to parse.
  if (/\+/.test(expression) && /%/.test(expression)) return empty(expression, 'compound', 'Compound duty: an ad-valorem and a specific component apply together.');
  if (/\b(MAX|MIN)\b/i.test(expression) || /%/.test(expression)) return empty(expression, 'mixed', 'Mixed duty: the applicable component depends on a threshold.');
  return empty(expression, 'unparsed', 'Duty expression is not in a recognised published form.');
}

/** Two duties are equivalent only if they are the same KIND and the same magnitude. */
export function dutiesAreEquivalent(left: ParsedDuty, right: ParsedDuty): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case 'ad_valorem':
      return left.ad_valorem_rate_percent === right.ad_valorem_rate_percent;
    case 'specific':
      return left.specific_amount === right.specific_amount
        && left.specific_currency === right.specific_currency
        && left.specific_unit === right.specific_unit
        && left.specific_unit_quantity === right.specific_unit_quantity;
    case 'none':
      return true;
    default:
      // Compound, mixed and unparsed expressions are only equivalent when textually identical:
      // we cannot prove two differently-worded thresholds mean the same thing.
      return left.expression === right.expression;
  }
}

export type ClassificationResolution =
  | 'exact'
  | 'all_children_equivalent'
  | 'classification_refinement_required'
  | 'unavailable';

export interface CandidateTariffLine {
  national_tariff_code: string;
  description: string;
  declarable: boolean;
  /** The general/third-country duty applicable to this line. */
  general_duty: ParsedDuty;
  /**
   * Material non-tariff controls on this line, as opaque comparable tokens. Two lines with
   * different control sets are NOT equivalent even when their duty matches.
   */
  control_codes: readonly string[];
  /** Preferential measures keyed by the authority's own geographic-area identifier. */
  preference_area_ids: readonly string[];
}

export interface ClassificationResolutionResult {
  resolution: ClassificationResolution;
  /** The single line the answer rests on, when one could be established. */
  resolved_line: CandidateTariffLine | null;
  candidates: readonly CandidateTariffLine[];
  candidate_count: number;
  /** What differs across candidates. Empty when they are equivalent. */
  differences: readonly string[];
  reason: string;
}

const sortedUnique = (values: readonly string[]) => [...new Set(values)].sort();

/**
 * Resolve an HS6 against the national lines beneath it.
 *
 * Every candidate is retained regardless of outcome, so an operator asked to refine a
 * classification can see exactly what the choice is between.
 */
export function resolveNationalTariffLine(candidates: readonly CandidateTariffLine[]): ClassificationResolutionResult {
  const declarable = candidates.filter((line) => line.declarable);
  if (!declarable.length) {
    return { resolution: 'unavailable', resolved_line: null, candidates, candidate_count: candidates.length, differences: [], reason: candidates.length ? 'The authority publishes no declarable line beneath this HS6.' : 'The authority returned no tariff line for this HS6.' };
  }
  if (declarable.length === 1) {
    return { resolution: 'exact', resolved_line: declarable[0]!, candidates, candidate_count: candidates.length, differences: [], reason: 'Exactly one declarable national line exists beneath this HS6.' };
  }

  const differences: string[] = [];
  const [head, ...rest] = declarable;
  if (rest.some((line) => !dutiesAreEquivalent(head!.general_duty, line.general_duty))) {
    const shapes = sortedUnique(declarable.map((line) => `${line.general_duty.kind}:${line.general_duty.expression}`));
    differences.push(`general_duty differs across ${declarable.length} declarable lines: ${shapes.join(' | ')}`);
  }
  const controlSets = sortedUnique(declarable.map((line) => sortedUnique(line.control_codes).join(',')));
  if (controlSets.length > 1) differences.push(`material controls differ across declarable lines: ${controlSets.map((set) => set || '(none)').join(' | ')}`);
  const preferenceSets = sortedUnique(declarable.map((line) => sortedUnique(line.preference_area_ids).join(',')));
  if (preferenceSets.length > 1) differences.push(`preferential coverage differs across declarable lines (${preferenceSets.length} distinct sets)`);

  if (!differences.length) {
    return { resolution: 'all_children_equivalent', resolved_line: head!, candidates, candidate_count: candidates.length, differences: [], reason: `All ${declarable.length} declarable lines carry the same duty, controls and preferential coverage.` };
  }
  return {
    resolution: 'classification_refinement_required',
    resolved_line: null,
    candidates,
    candidate_count: candidates.length,
    differences,
    reason: `HS6 maps to ${declarable.length} declarable national lines that are not equivalent; the declarable line must be established before a tariff can be stated.`,
  };
}

export type IndiaPreferenceApplicability =
  | 'confirmed_applicable'
  | 'potentially_applicable_requires_origin_proof'
  | 'not_applicable'
  | 'unknown';

export interface IndiaPreferenceDetermination {
  applicability: IndiaPreferenceApplicability;
  /** The preferential duty, when a candidate measure exists at all. */
  duty: ParsedDuty | null;
  basis: string;
  /** The authority's geographic-area identifier the candidate measure was published under. */
  geographic_area_id: string | null;
}

export interface IndiaPreferenceInput {
  /** Measures whose geographic area is exactly India. */
  direct_india_measures: readonly { geographic_area_id: string; duty: ParsedDuty; is_quota: boolean }[];
  /** Measures published for a group that the source proves contains India. */
  proven_group_measures: readonly { geographic_area_id: string; duty: ParsedDuty; is_quota: boolean }[];
  /**
   * True only when the source enumerates its preference beneficiaries completely, so that
   * India's ABSENCE from that enumeration is itself evidence rather than a gap in what we read.
   */
  beneficiary_enumeration_is_complete: boolean;
  /** Present when the source publishes eligibility conditions we have not ingested. */
  unresolved_program_symbols: readonly string[];
}

/**
 * Decide whether an India-origin preference actually applies.
 *
 * The existence of a preferential line is never applicability. A quota is never an unconditional
 * rate — it is a volume entitlement that may be exhausted, so it can at best be
 * `potentially_applicable_requires_origin_proof`. And absence only means `not_applicable` when
 * the source enumerated its beneficiaries completely; otherwise it means `unknown`.
 */
export function determineIndiaPreference(input: IndiaPreferenceInput): IndiaPreferenceDetermination {
  const direct = input.direct_india_measures;
  const unconditionalDirect = direct.filter((measure) => !measure.is_quota);
  if (unconditionalDirect.length) {
    const measure = unconditionalDirect[0]!;
    return {
      applicability: 'potentially_applicable_requires_origin_proof',
      duty: measure.duty,
      geographic_area_id: measure.geographic_area_id,
      // Even a measure published FOR India is conditional on the goods actually originating in
      // India under that agreement's rules of origin, which is a shipment fact, not a schedule
      // fact. Nothing in a published tariff can establish it.
      basis: 'A preferential measure is published for India-origin goods; applying it requires rules-of-origin qualification and documentary proof for the shipment.',
    };
  }
  const quotaDirect = direct.filter((measure) => measure.is_quota);
  if (quotaDirect.length) {
    const measure = quotaDirect[0]!;
    return {
      applicability: 'potentially_applicable_requires_origin_proof',
      duty: measure.duty,
      geographic_area_id: measure.geographic_area_id,
      basis: 'The only India-specific measure is a tariff quota. A quota rate is a volume entitlement, not an unconditional applied rate, and requires quota availability at the time of import.',
    };
  }
  const group = input.proven_group_measures;
  if (group.length) {
    const measure = group[0]!;
    return {
      applicability: 'potentially_applicable_requires_origin_proof',
      duty: measure.duty,
      geographic_area_id: measure.geographic_area_id,
      basis: `A preferential measure covers group ${measure.geographic_area_id}, which the source proves includes India; rules-of-origin qualification is still required.`,
    };
  }
  if (input.unresolved_program_symbols.length) {
    return {
      applicability: 'unknown',
      duty: null,
      geographic_area_id: null,
      basis: `The source expresses preference eligibility through programme symbols (${sortedUnique(input.unresolved_program_symbols).join(', ')}) whose beneficiary lists are published separately and have not been ingested; India's eligibility cannot be read from the schedule alone.`,
    };
  }
  if (input.beneficiary_enumeration_is_complete) {
    return {
      applicability: 'not_applicable',
      duty: null,
      geographic_area_id: null,
      basis: 'The source enumerates every preferential beneficiary for this line and India is not among them.',
    };
  }
  return {
    applicability: 'unknown',
    duty: null,
    geographic_area_id: null,
    basis: 'No India-origin preferential measure was found, and the source does not prove its beneficiary list is complete, so absence is not evidence of non-applicability.',
  };
}
