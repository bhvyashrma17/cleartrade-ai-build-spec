/**
 * The official duty on Indian goods for one market, from Customs Atlas evidence (docs/36 §4
 * metric 7, D-017). Pure: admitted tariff facts and their evidence rows in, one resolution out.
 *
 * Which rate: the market's ordinary (third-country, MFN) duty on the product's exact HS6 line —
 * what Indian goods pay without claiming a preference. D-026 (policy v6): where the tariff
 * publishes a preference for India that is not a tariff quota, that preferential rate is scored
 * instead and the ordinary rate is kept beside it. Claiming it needs proof of Indian origin (rules
 * of origin are shipment facts, `tariff-semantics.ts`), which the explanation says. A quota rate is
 * a volume entitlement that may be exhausted, so it is shown, never scored; a preference above the
 * ordinary rate is never scored either.
 *
 * How it becomes a percentage: an ad-valorem duty is one. A specific duty per unit of mass is
 * converted to USD per kg here (frozen exchange rate) and to a percentage in the score, against the
 * market's own unit value. Anything else — compound, mixed, per litre or per item, a currency with
 * no published rate — is official but not reducible to one rate, and says why.
 */
import type { ScopedFact, TariffFactValue } from '@/lib/country-truth/phase-1h-calculations';
import { parseDutyExpression, type ParsedDuty } from '@/lib/market-access/tariff-semantics';

/** The evidence-row fields the resolution reads, keyed by row id. */
export interface OfficialTariffRow {
  id: string;
  snapshot_id: string;
  rule_type: string;
  duty_expression: string | null;
  duty_kind: string | null;
  national_tariff_code: string | null;
  source_authority: string;
  preference_applicability: string | null;
  /** What the preference determination rests on (`tariff-semantics.ts`); a quota says so. */
  preference_basis?: string | null;
  /** The determination as stored; `is_quota` where the pack recorded it. */
  raw_evidence?: unknown;
}

export interface OfficialPreferenceNote {
  /** The provider's determination, verbatim (e.g. `potentially_applicable_requires_origin_proof`). */
  applicability: string;
  duty_expression: string | null;
  /** The preferential rate when it is ad valorem. */
  percent: number | null;
  /** D-026: the preference is a tariff quota — a volume entitlement, shown and never scored. */
  quota?: boolean;
}

/** D-026: which rate a usable resolution carries — India's published preference, or the ordinary rate. */
export type OfficialRateBasis = 'india_preference' | 'standard';

interface Resolved {
  source: string;
  /** D-024: the line was read from the official tariff by a ClearTrade agent (authoritative-manual evidence). */
  recorded_by_agent?: boolean;
  /** D-028: the line is a customs union's common external tariff, read for a member; national exceptions are not modelled. */
  common_tariff?: { union: string; label: string };
  national_line: string | null;
  preference: OfficialPreferenceNote | null;
  /** Absent on resolutions made before D-026: the ordinary rate. */
  basis?: OfficialRateBasis;
  /** When the preference is scored: the ordinary rate it stands in for, as published. */
  standard?: { duty_percent: number | null; expression: string | null };
  fact_ids: string[];
  snapshot_ids: string[];
}

export type OfficialDutyResolution =
  | ({ status: 'percent'; duty_percent: number } & Resolved)
  | ({ status: 'specific'; usd_per_kg: number; expression: string; fx: { currency: string; usd_per_unit: number } } & Resolved)
  | ({ status: 'unusable'; reason: string; expression: string | null } & Resolved)
  | { status: 'none'; reason: string };

/** Mass units a specific duty may be stated per, in kilograms. Anything else is not converted. */
const KG_PER_UNIT: Readonly<Record<string, number>> = {
  kg: 1, kgs: 1, kilo: 1, kilos: 1, kilogram: 1, kilograms: 1,
  t: 1000, tonne: 1000, tonnes: 1000, 'metric ton': 1000, 'metric tons': 1000, mt: 1000,
};

export function kilogramsPerDutyUnit(unit: string | null, quantity: number | null): number | null {
  const factor = unit ? KG_PER_UNIT[unit.trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ')] : undefined;
  if (factor == null) return null;
  const amount = quantity ?? 1;
  return Number.isFinite(amount) && amount > 0 ? factor * amount : null;
}

const rowId = (factId: string) => factId.replace(/^market_access_tariff:/, '');

function current(fact: ScopedFact<TariffFactValue>, asOf: number, minimumConfidence: number): fact is Extract<ScopedFact<TariffFactValue>, { state: 'present' }> {
  if (fact.state !== 'present' || fact.provenance.assertion_class !== 'authoritative_public') return false;
  if (!(fact.confidence >= minimumConfidence)) return false;
  const from = Date.parse(fact.value.effective_from);
  const to = fact.value.effective_to ? Date.parse(fact.value.effective_to) : null;
  return Number.isFinite(from) && from <= asOf && (to == null || to > asOf);
}

const newestFirst = <T extends { id: string; provenance: { retrieved_at: string } }>(facts: T[]) =>
  facts.sort((a, b) => Date.parse(b.provenance.retrieved_at) - Date.parse(a.provenance.retrieved_at) || a.id.localeCompare(b.id));

type RateOutcome =
  | { status: 'percent'; duty_percent: number }
  | { status: 'specific'; usd_per_kg: number; expression: string; fx: { currency: string; usd_per_unit: number } }
  | { status: 'unusable'; reason: string; expression: string | null };

/** The pack's own parsed duty, when the evidence row retained one (`raw_evidence.duty`). */
function storedDuty(row: Pick<OfficialTariffRow, 'raw_evidence'> | undefined): ParsedDuty | null {
  const duty = row?.raw_evidence && typeof row.raw_evidence === 'object' ? (row.raw_evidence as { duty?: unknown }).duty : null;
  if (!duty || typeof duty !== 'object') return null;
  const candidate = duty as ParsedDuty;
  return typeof candidate.kind === 'string' && typeof candidate.expression === 'string' ? candidate : null;
}

/**
 * One published duty reduced to a percentage or USD per kg, or the reason it cannot be. `label`
 * names it in the reason. Without a stored rate, the pack's own parsed duty is read before the
 * shared expression parser.
 */
function rateOf(ratePercent: number | null | undefined, expression: string | null, usdPerUnit: (currency: string) => number | null, label: 'official' | 'preferential', stored: ParsedDuty | null = null): RateOutcome {
  const name = label === 'official' ? 'official duty' : 'preferential duty for India';
  if (ratePercent != null) {
    if (!(Number.isFinite(ratePercent) && ratePercent >= 0)) return { status: 'unusable', reason: `The ${label === 'official' ? 'official rate' : name} is not a valid percentage.`, expression };
    return { status: 'percent', duty_percent: ratePercent };
  }
  const parsed = stored ?? parseDutyExpression(expression);
  if (parsed.kind === 'ad_valorem' && parsed.ad_valorem_rate_percent != null) return { status: 'percent', duty_percent: parsed.ad_valorem_rate_percent };
  if (parsed.kind === 'specific' && parsed.specific_amount != null && parsed.specific_currency) {
    const kilograms = kilogramsPerDutyUnit(parsed.specific_unit, parsed.specific_unit_quantity);
    if (kilograms == null) return { status: 'unusable', reason: `The ${name} (${parsed.expression}) is per ${parsed.specific_unit}, which a price per kilogram cannot convert.`, expression: parsed.expression };
    const rate = usdPerUnit(parsed.specific_currency);
    if (rate == null) return { status: 'unusable', reason: `The ${name} (${parsed.expression}) is in ${parsed.specific_currency}, for which no published exchange rate is held.`, expression: parsed.expression };
    return { status: 'specific', usd_per_kg: (parsed.specific_amount * rate) / kilograms, expression: parsed.expression, fx: { currency: parsed.specific_currency, usd_per_unit: rate } };
  }
  return { status: 'unusable', reason: `The ${name} (${parsed.expression || 'not stated'}) cannot be reduced to one rate: ${parsed.note ?? parsed.kind}`, expression: parsed.expression || null };
}

/** A preference that is a tariff quota, from the stored flag or, for rows stored before it, the determination's own words. */
export function preferenceIsQuota(row: Pick<OfficialTariffRow, 'preference_basis' | 'raw_evidence'> | undefined): boolean {
  if (!row) return false;
  const raw = row.raw_evidence;
  if (raw && typeof raw === 'object' && (raw as { is_quota?: unknown }).is_quota === true) return true;
  return /\btariff[- ](?:rate )?quota\b/i.test(row.preference_basis ?? '');
}

export function resolveOfficialDuty(args: {
  as_of: Date;
  tariffs: readonly ScopedFact<TariffFactValue>[];
  rows: ReadonlyMap<string, OfficialTariffRow>;
  minimum_confidence: number;
  /** USD per one unit of a currency on the run date, or null when no published rate exists. */
  usd_per_unit: (currency: string) => number | null;
  /** D-026 (policy v6): score India's published preference, when it is not a quota, instead of the ordinary rate. */
  score_india_preference?: boolean;
}): OfficialDutyResolution {
  const asOf = args.as_of.getTime();
  const admitted = args.tariffs.filter((fact) => current(fact, asOf, args.minimum_confidence)) as Extract<ScopedFact<TariffFactValue>, { state: 'present' }>[];
  const ordinary = newestFirst(admitted.filter((fact) => fact.value.tariff_type === 'ordinary'))[0];
  if (!ordinary) {
    return { status: 'none', reason: args.tariffs.length ? 'No current official ordinary duty for this exact HS6 line.' : 'No official tariff evidence is stored for this market and product.' };
  }
  const row = args.rows.get(rowId(ordinary.id));
  if (!row) throw new Error(`Tariff fact ${ordinary.id} has no evidence row.`);

  const preferenceFact = newestFirst(admitted.filter((fact) => fact.value.tariff_type === 'india_preference'))[0];
  const preferenceRow = preferenceFact ? args.rows.get(rowId(preferenceFact.id)) : undefined;
  const preferenceParsed = storedDuty(preferenceRow) ?? (preferenceRow?.duty_expression ? parseDutyExpression(preferenceRow.duty_expression) : null);
  const preference: OfficialPreferenceNote | null = preferenceRow && preferenceRow.preference_applicability && preferenceRow.preference_applicability !== 'not_applicable' && preferenceRow.preference_applicability !== 'unknown'
    ? {
        applicability: preferenceRow.preference_applicability,
        duty_expression: preferenceRow.duty_expression,
        percent: preferenceFact!.value.rate_percent ?? (preferenceParsed?.kind === 'ad_valorem' ? preferenceParsed.ad_valorem_rate_percent : null),
        ...(preferenceIsQuota(preferenceRow) ? { quota: true } : {}),
      }
    : null;

  const resolved = {
    source: [row.source_authority, row.national_tariff_code].filter(Boolean).join(' '),
    national_line: row.national_tariff_code,
    preference,
    fact_ids: [ordinary.id, ...(preference ? [preferenceFact!.id] : [])],
    snapshot_ids: [...new Set([row.snapshot_id, ...(preference && preferenceRow ? [preferenceRow.snapshot_id] : [])])].sort(),
  };

  const standard = rateOf(ordinary.value.rate_percent, row.duty_expression, args.usd_per_unit, 'official');
  if (args.score_india_preference && preference && !preference.quota && preferenceRow) {
    const preferred = rateOf(preferenceFact!.value.rate_percent, preferenceRow.duty_expression, args.usd_per_unit, 'preferential', storedDuty(preferenceRow));
    // Never score a preference above the rate it is meant to reduce.
    const higher = preferred.status === 'percent' && standard.status === 'percent' && preferred.duty_percent > standard.duty_percent;
    if (preferred.status !== 'unusable' && !higher) {
      return { ...preferred, ...resolved, basis: 'india_preference', standard: { duty_percent: standard.status === 'percent' ? standard.duty_percent : null, expression: row.duty_expression } };
    }
  }
  return { ...standard, ...resolved, basis: 'standard' };
}
