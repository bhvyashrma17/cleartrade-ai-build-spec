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
 */
import type { IndiaTradeAgreementRow } from '@/lib/reference-datasets/parsers';
import type { DemandDiscoveryV5Policy } from './policy';
import type { DutyInput, EstimatedDuty } from './metrics';
import type { OfficialDutyResolution } from './official-duty';

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
  agreements: readonly IndiaTradeAgreement[];
  policy: DemandDiscoveryV5Policy;
}): Map<string, Exclude<DutyInput, null>> {
  const sector = tariffSector(args.hs6, args.policy);
  const averages = sector === 'primary' ? args.primary_tariffs : args.manufactured_tariffs;
  const result = new Map<string, Exclude<DutyInput, null>>();
  const estimateFor = (market: string, officialNote: string | null): EstimatedDuty | null => {
    const average = averages.get(market);
    if (!average || !(average.value >= 0)) return null;
    const agreement = agreementInForce(args.agreements, market, args.as_of);
    return { kind: 'estimate', sector_average_percent: average.value, agreement_scope: agreement?.scope ?? 'none', agreement_name: agreement?.agreement ?? null, ...(officialNote ? { official_note: officialNote } : {}) };
  };
  for (const market of args.markets) {
    const official = args.official.get(market);
    if (official?.status === 'percent') {
      result.set(market, { kind: 'official', duty_percent: official.duty_percent, source: official.source, preference: official.preference });
      continue;
    }
    if (official?.status === 'specific') {
      result.set(market, { kind: 'official_specific', usd_per_kg: official.usd_per_kg, expression: official.expression, source: official.source, preference: official.preference, estimate: estimateFor(market, null) });
      continue;
    }
    const note = official?.status === 'unusable' ? official.reason : null;
    const estimate = estimateFor(market, note);
    if (estimate) result.set(market, estimate);
    else if (note) result.set(market, { kind: 'unusable', reason: note });
  }
  return result;
}
