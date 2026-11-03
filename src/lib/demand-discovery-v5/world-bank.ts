/**
 * The age limit on World Bank values (D-021, R-20; docs/36 §9). Countries report the logistics
 * index and the tariff averages irregularly, so the latest value a country has can be very old —
 * tariff averages from 2002, logistics scores from 2007. A value older than
 * `policy.world_bank.max_age_years` on the run's date counts as missing, and the market says so.
 */
import type { DemandDiscoveryV5Policy } from './policy';

export interface DatedValue {
  value: number;
  year: number;
}

/** Splits one dataset's values into those young enough to use and those too old (market → year). */
export function splitByAge<T extends DatedValue>(values: ReadonlyMap<string, T>, asOf: Date, policy: DemandDiscoveryV5Policy) {
  const limit = asOf.getUTCFullYear() - policy.world_bank.max_age_years;
  const fresh = new Map<string, T>();
  const tooOld = new Map<string, number>();
  for (const [market, item] of values) {
    if (item.year >= limit) fresh.set(market, item);
    else tooOld.set(market, item.year);
  }
  return { fresh, too_old: tooOld };
}

export const tooOldReason = (what: string, year: number, policy: DemandDiscoveryV5Policy) =>
  `The World Bank ${what} for this market is from ${year}, more than ${policy.world_bank.max_age_years} years old, so it is not used.`;
