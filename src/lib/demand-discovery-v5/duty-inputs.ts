/**
 * The duty input per market (docs/36 §4 #7, §4.7, D-017).
 *
 * Official Customs Atlas evidence for Indian origin wins wherever a market has it
 * (`official-duty.ts`). Elsewhere the metric uses a labelled estimate: the market's average applied
 * tariff for the product's sector (World Bank WDI — primary products for HS chapters 01–27,
 * manufactured goods otherwise) times a factor for India's trade agreement with the market, if one
 * covering goods is in force on the run's date. No sector average means no estimate: the metric is
 * unavailable, never zero. An official duty that cannot be reduced to one rate falls back to the
 * estimate and says why; an official specific duty carries the estimate as its fallback for a
 * market whose unit value turns out to be unknown.
 *
 * Policy v5: where a market has no tariff line for the product, a published rule (`rule_rates`) —
 * a free port's zero, or one rate for all goods — gives the duty before any estimate does.
 *
 * Policy v6 (D-026): an official duty may be India's published preference rather than the ordinary
 * rate (`official-duty.ts`); the input says which, and keeps the ordinary rate beside it.
 */
import type { IndiaTradeAgreementRow } from '@/lib/reference-datasets/parsers';
import type { DemandDiscoveryV5Policy } from './policy';
import type { DutyInput, EstimatedDuty } from './metrics';
import type { OfficialDutyResolution } from './official-duty';
import { tooOldReason } from './world-bank';

/**
 * One agreement for one partner (`data/reference/india-trade-agreements-v1.json`). `comprehensive`:
 * an FTA/CEPA/CECA covering most goods; `partial`: preferences on listed lines only.
 */
export type IndiaTradeAgreement = Pick<IndiaTradeAgreementRow, 'agreement' | 'partner_iso2' | 'scope' | 'in_force_from' | 'in_force_until' | 'source_url'>;

export interface SectorTariff {
  /** Simple mean applied tariff, percent. */
  value: number;
  year: number;
}


export function tariffSector(hs6: string, policy: DemandDiscoveryV5Policy): 'primary' | 'manufactured' {
  if (!/^\d{6}$/.test(hs6)) throw new Error(`A six-digit HS code is required, got ${hs6}.`);
  return Number(hs6.slice(0, 2)) <= policy.duty.primary_hs_chapters_through ? 'primary' : 'manufactured';
}

/** The strongest agreement in force for `market` on `asOf`: comprehensive before partial, then by name. */
export function agreementInForce(agreements: readonly IndiaTradeAgreement[], market: string, asOf: Date): IndiaTradeAgreement | null {
  const day = asOf.toISOString().slice(0, 10);
  const candidates = agreements.filter((agreement) => agreement.partner_iso2 === market && agreement.in_force_from <= day && (agreement.in_force_until == null || day < agreement.in_force_until));
  candidates.sort((a, b) => (a.scope === b.scope ? a.agreement.localeCompare(b.agreement) : a.scope === 'comprehensive' ? -1 : 1));
  return candidates[0] ?? null;
}

export function dutyInputs(args: {
  markets: readonly string[];
  hs6: string;
  as_of: Date;
  official: ReadonlyMap<string, OfficialDutyResolution>;
  primary_tariffs: ReadonlyMap<string, SectorTariff>;
  manufactured_tariffs: ReadonlyMap<string, SectorTariff>;
  /** Markets whose latest sector average is older than the World Bank age limit (D-021), with its year. */
  primary_too_old?: ReadonlyMap<string, number>;
  manufactured_too_old?: ReadonlyMap<string, number>;
  agreements: readonly IndiaTradeAgreement[];
  policy: DemandDiscoveryV5Policy;
}): Map<string, Exclude<DutyInput, null>> {
  const sector = tariffSector(args.hs6, args.policy);
  const averages = sector === 'primary' ? args.primary_tariffs : args.manufactured_tariffs;
  const tooOld = (sector === 'primary' ? args.primary_too_old : args.manufactured_too_old) ?? new Map<string, number>();
  const result = new Map<string, Exclude<DutyInput, null>>();
  const chapter = Number(args.hs6.slice(0, 2));
  /** The market's own average, else (v4) its customs union's common external tariff where the union covers this chapter. */
  const averageFor = (market: string): { value: number; union: string | null } | null => {
    const own = averages.get(market);
    if (own && own.value >= 0) return { value: own.value, union: null };
    const union = args.policy.customs_unions?.[market];
    if (!union || (union.hs_chapters && (chapter < union.hs_chapters[0] || chapter > union.hs_chapters[1]))) return null;
    const reference = averages.get(union.reference_market);
    return reference && reference.value >= 0 ? { value: reference.value, union: union.union } : null;
  };
  const day = args.as_of.toISOString().slice(0, 10);
  /** v5: a published rule that covers this product on the run's date (not past its review date). */
  const ruleFor = (market: string): Extract<DutyInput, { kind: 'rule' }> | null => {
    const entry = args.policy.rule_rates?.[market];
    if (!entry || day > entry.review_by || entry.except_hs.some((prefix) => args.hs6.startsWith(prefix))) return null;
    return { kind: 'rule', duty_percent: entry.duty_percent, rule: entry.rule, basis: entry.basis, source_url: entry.source_url };
  };
  const estimateFor = (market: string, officialNote: string | null): EstimatedDuty | null => {
    const average = averageFor(market);
    if (!average) return null;
    const agreement = agreementInForce(args.agreements, market, args.as_of);
    return {
      kind: 'estimate', sector_average_percent: average.value, agreement_scope: agreement?.scope ?? 'none', agreement_name: agreement?.agreement ?? null,
      ...(average.union ? { customs_union: average.union } : {}), ...(officialNote ? { official_note: officialNote } : {}),
    };
  };
  for (const market of args.markets) {
    const official = args.official.get(market);
    // D-026: which rate the official duty carries, and the ordinary rate a scored preference replaced.
    const rate = official && official.status !== 'none' && official.basis === 'india_preference'
      ? { rate_basis: 'india_preference' as const, standard: official.standard ?? null }
      : {};
    // D-028: a customs union's common external tariff keeps its label.
    const union = official && official.status !== 'none' && official.common_tariff ? { common_tariff: official.common_tariff } : {};
    if (official?.status === 'percent') {
      result.set(market, { kind: 'official', duty_percent: official.duty_percent, source: official.source, preference: official.preference, ...rate, ...union, ...(official.recorded_by_agent ? { recorded_by_agent: true } : {}) });
      continue;
    }
    if (official?.status === 'specific') {
      result.set(market, { kind: 'official_specific', usd_per_kg: official.usd_per_kg, expression: official.expression, source: official.source, preference: official.preference, estimate: estimateFor(market, null), ...rate, ...union, ...(official.recorded_by_agent ? { recorded_by_agent: true } : {}) });
      continue;
    }
    // A rule (v5) stands in for a missing tariff line, never for official evidence that exists but yields no rate.
    const rule = official?.status === 'unusable' ? null : ruleFor(market);
    if (rule) {
      result.set(market, rule);
      continue;
    }
    const note = official?.status === 'unusable' ? official.reason : null;
    const estimate = estimateFor(market, note);
    const staleYear = tooOld.get(market);
    const stale = staleYear != null ? tooOldReason('tariff average', staleYear, args.policy) : null;
    if (estimate) result.set(market, estimate);
    else if (note || stale) result.set(market, { kind: 'unusable', reason: [note, stale].filter(Boolean).join(' ') });
  }
  return result;
}
