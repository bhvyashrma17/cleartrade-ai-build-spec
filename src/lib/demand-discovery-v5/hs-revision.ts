/**
 * Does a confirmed HS 2022 code mean the same thing in BACI's HS 2017 file? (docs/36 §3.4)
 *
 * The HS17 file reaches back to 2017; the HS22 file starts in 2022. Where the code's world trade
 * agrees across both files in every overlapping year, the longer HS17 history is the same product
 * and supplies the whole window. Where it does not — the code was created, split or merged in
 * 2022 — only the HS22 years are the product, and growth metrics carry `short_history`.
 */
import type { TradeFlowInput } from './series';

export type HsRevisionVerdict = 'consistent' | 'absent_in_older_revision' | 'totals_diverge' | 'no_overlap_trade';

export interface HsRevisionYear {
  year: number;
  older_usd: number;
  newer_usd: number;
  /** |older − newer| / newer; 1 when only one side has trade; null when neither has. */
  divergence: number | null;
}

export interface HsRevisionTest {
  hs6: string;
  verdict: HsRevisionVerdict;
  /** True only for `consistent`: the older revision may supply the whole window. */
  use_older_revision: boolean;
  years: HsRevisionYear[];
  max_divergence: number;
}

/** World trade of the product per year: the sum of every bilateral flow. */
export function worldTotals(flows: readonly Pick<TradeFlowInput, 'year' | 'value_usd'>[]): Map<number, number> {
  const totals = new Map<number, number>();
  for (const flow of flows) totals.set(flow.year, (totals.get(flow.year) ?? 0) + flow.value_usd);
  return totals;
}

export function testHsRevision(args: {
  hs6: string;
  older: ReadonlyMap<number, number>;
  newer: ReadonlyMap<number, number>;
  overlap_years: readonly number[];
  max_divergence: number;
}): HsRevisionTest {
  const years: HsRevisionYear[] = args.overlap_years.map((year) => {
    const older = args.older.get(year) ?? 0;
    const newer = args.newer.get(year) ?? 0;
    const divergence = older === 0 && newer === 0 ? null : older === 0 || newer === 0 ? 1 : Math.abs(older - newer) / newer;
    return { year, older_usd: older, newer_usd: newer, divergence };
  });
  const result = (verdict: HsRevisionVerdict): HsRevisionTest => ({ hs6: args.hs6, verdict, use_older_revision: verdict === 'consistent', years, max_divergence: args.max_divergence });
  const compared = years.filter((year) => year.divergence != null);
  if (!compared.length) return result('no_overlap_trade');
  if (years.every((year) => year.older_usd === 0)) return result('absent_in_older_revision');
  return compared.every((year) => year.divergence! <= args.max_divergence) ? result('consistent') : result('totals_diverge');
}
