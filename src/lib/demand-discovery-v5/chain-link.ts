/**
 * Newest year by chain-linking (docs/36 §5.3, D-011).
 *
 * BACI ends a year before UN Comtrade does. Where a market reported both BACI's last year `L` and
 * `L+1` to Comtrade itself, the series extends one year: BACI keeps the level and Comtrade supplies
 * the change, `M(L+1) = M_BACI(L) × M_CT(L+1) / M_CT(L)`. Comtrade import values are CIF and BACI's
 * are FOB; the ratio cancels that margin, which a direct splice would not.
 *
 * Two series are linked: the market's total imports (size, growth, stability) and its imports from
 * India (India's foothold). Supplier mix, unit values and quantities stay on BACI's year `L`: they
 * move slowly, BACI's are reconciled and FOB, and Comtrade's newest quantities are often estimated.
 * A link that cannot be made, or whose change is implausible for provisional data, leaves the
 * market on its BACI window — with lag 1 — and says why.
 */
import type { DemandDiscoveryV5Policy } from './policy';
import type { MarketYear } from './series';

/** What a market reported to Comtrade for `L` and `L+1`, in USD. */
export interface ComtradeNewestYearInput {
  market: string;
  base_year: number;
  /**
   * Imports of the product from all partners (partner World). `null` when the market did not
   * report that year at all; 0 when it reported the year and recorded no imports of the product.
   */
  world_base_usd: number | null;
  world_newest_usd: number | null;
  /** Imports from India, with the same `null` / 0 distinction. */
  india_base_usd: number | null;
  india_newest_usd: number | null;
}

export type ChainLinkRefusal =
  | 'not_reported'
  | 'no_baci_base'
  | 'no_comtrade_base'
  | 'implausible_change';

export type IndiaLinkRefusal =
  | 'not_reported'
  | 'sources_disagree'
  | 'india_entered'
  | 'implausible_change'
  | 'exceeds_market';

export interface LinkedNewestYear {
  market: string;
  year: number;
  total_usd: number;
  /** India's linked imports, or `null` with `india_refusal` saying why. */
  india_usd: number | null;
  india_refusal: IndiaLinkRefusal | null;
  /** Every linked value records both sources (docs/36 §5.3). */
  provenance: {
    baci_base_usd: number;
    comtrade_base_usd: number;
    comtrade_newest_usd: number;
    change_ratio: number;
    baci_india_base_usd: number;
    comtrade_india_base_usd: number | null;
    comtrade_india_newest_usd: number | null;
    india_change_ratio: number | null;
  };
}

export type ChainLinkResult =
  | { linked: LinkedNewestYear; refusal: null }
  | { linked: null; refusal: ChainLinkRefusal };

function plausible(ratio: number, policy: DemandDiscoveryV5Policy) {
  const limit = policy.chain_link.max_change_ratio;
  return ratio >= 1 / limit && ratio <= limit;
}

/** Links one market's newest year onto its BACI year `L`. Pure. */
export function chainLinkNewestYear(baciLatest: MarketYear | undefined, input: ComtradeNewestYearInput, policy: DemandDiscoveryV5Policy): ChainLinkResult {
  if (input.world_base_usd == null || input.world_newest_usd == null) return { linked: null, refusal: 'not_reported' };
  if (!baciLatest || baciLatest.year !== input.base_year || !(baciLatest.total_usd > 0)) return { linked: null, refusal: 'no_baci_base' };
  if (!(input.world_base_usd > 0)) return { linked: null, refusal: 'no_comtrade_base' };
  const ratio = input.world_newest_usd / input.world_base_usd;
  if (!plausible(ratio, policy)) return { linked: null, refusal: 'implausible_change' };
  const total = baciLatest.total_usd * ratio;

  let india: number | null = null;
  let indiaRatio: number | null = null;
  let indiaRefusal: IndiaLinkRefusal | null = null;
  if (input.india_base_usd == null || input.india_newest_usd == null) {
    indiaRefusal = 'not_reported';
  } else if (input.india_base_usd > 0) {
    indiaRatio = input.india_newest_usd / input.india_base_usd;
    if (!(baciLatest.india_usd > 0)) indiaRefusal = 'sources_disagree';
    else if (!plausible(indiaRatio, policy)) indiaRefusal = 'implausible_change';
    else india = baciLatest.india_usd * indiaRatio;
  } else if (input.india_newest_usd > 0) {
    indiaRefusal = 'india_entered';
  } else if (baciLatest.india_usd > 0) {
    // The market's own records show no imports from India in either year; BACI's India flow comes
    // from India's export declarations alone. Neither side says how it changed.
    indiaRefusal = 'sources_disagree';
  } else {
    india = 0;
  }
  if (india != null && india > total) {
    india = null;
    indiaRefusal = 'exceeds_market';
  }

  return {
    refusal: null,
    linked: {
      market: input.market,
      year: input.base_year + 1,
      total_usd: total,
      india_usd: india,
      india_refusal: india == null ? indiaRefusal : null,
      provenance: {
        baci_base_usd: baciLatest.total_usd,
        comtrade_base_usd: input.world_base_usd,
        comtrade_newest_usd: input.world_newest_usd,
        change_ratio: ratio,
        baci_india_base_usd: baciLatest.india_usd,
        comtrade_india_base_usd: input.india_base_usd,
        comtrade_india_newest_usd: input.india_newest_usd,
        india_change_ratio: indiaRatio,
      },
    },
  };
}

/**
 * The window after a link: one year longer, then trimmed from the front to `windowYears`. A full
 * 2019–2024 window becomes 2020–2025; a short 2022–2024 history becomes 2022–2025.
 */
export function extendWindow(window: readonly number[], newestYear: number, windowYears: number): number[] {
  if (window.length && newestYear !== window[window.length - 1] + 1) throw new Error(`Newest year ${newestYear} does not follow the window ending ${window[window.length - 1]}.`);
  return [...window, newestYear].slice(-windowYears);
}
