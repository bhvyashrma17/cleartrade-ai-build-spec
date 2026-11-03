/**
 * "Why this market?", derived deterministically from frozen metrics.
 *
 * No LLM. Every statement below is a template filled from a structured metric that was already
 * computed and frozen, so the same assessment always produces the same words, and a statement
 * can never assert something the evidence does not contain.
 *
 * This file is also where the product-semantics adversarial pass lives, because a misleading
 * sentence is the cheapest way to undo months of careful fail-closed engineering. The rules it
 * enforces, each of which is a claim the naive phrasing WOULD have made:
 *
 *  1. **CAGR is history, never a forecast.** "Imports grew 10.7% a year over 2021–2025" is a
 *     record. "Imports will grow 10.7%" is a prediction ClearTrade has no basis for. Every
 *     growth sentence is past-tense and names its window.
 *
 *  2. **A high Indian share is ambiguous, not good.** It proves Indian goods clear this market
 *     (a real positive) AND that the lane is already well served (a real caution). Presenting
 *     only the first is how an exporter walks into a saturated market believing it was
 *     recommended. Both readings are emitted, as a signal and a caution.
 *
 *  3. **Unit value is a trade statistic, not a price you can get.** It is customs value over
 *     net weight across all suppliers. Quoting it as an achievable selling price is the single
 *     most dangerous number on the page, so it is never stated as one.
 *
 *  4. **Missing evidence is a gap, never a negative.** No sentence may imply that an
 *     unestablished pillar is a weakness. "Logistics not yet assessed" is not "poor logistics".
 *
 *  5. **Confidence is coverage, not probability.** No sentence converts an evidence-confidence
 *     figure into a likelihood of commercial success.
 *
 *  6. **A discovery-grade tariff is not the duty you will pay.** Until the declarable line is
 *     confirmed, no duty statement is made at all.
 */
import type { MarketDetailView } from './market-view';

export type ExplanationKind = 'signal' | 'caution' | 'gap';

export interface Explanation {
  kind: ExplanationKind;
  /** Stable identifier, so tests and analytics do not depend on the prose. */
  code: string;
  headline: string;
  detail: string;
}

/** Bands are declared once so the prose and the thresholds cannot drift apart. */
const STRONG_GROWTH = 5;
const CONTRACTION = 0;
const CROWDED_INDIA_SHARE = 40;
const THIN_INDIA_SHARE = 2;
const LARGE_MARKET_USD = 100_000_000;

export function explainMarket(view: MarketDetailView): Explanation[] {
  const signals: Explanation[] = [];
  const cautions: Explanation[] = [];
  const gaps: Explanation[] = [];
  const window = view.trade_periods ? ` over ${view.trade_periods}` : '';

  // --- Demand ------------------------------------------------------------------
  if (view.market_size.state === 'available' && view.market_size.raw != null) {
    const size = view.market_size.display;
    if (view.market_size.raw >= LARGE_MARKET_USD) {
      signals.push({
        kind: 'signal', code: 'large_import_market',
        headline: `${size} of this product is imported each year`,
        detail: `${view.country} recorded ${size} of imports in this product category in the most recent reported year. This is what the destination buys from the world, not what it would buy from you.`,
      });
    } else {
      cautions.push({
        kind: 'caution', code: 'small_import_market',
        headline: `A smaller import market at ${size}`,
        detail: `${view.country} recorded ${size} of imports in this category. Smaller markets can still be worth entering, but they support fewer suppliers.`,
      });
    }
  }

  // --- Growth: past tense, always windowed --------------------------------------
  if (view.growth.state === 'available' && view.growth.raw != null) {
    const rate = view.growth.display;
    if (view.growth.raw >= STRONG_GROWTH) {
      signals.push({
        kind: 'signal', code: 'imports_grew',
        headline: `Imports grew ${rate} a year${window}`,
        detail: `Recorded imports into ${view.country} grew at ${rate} a year${window}. This describes what has already happened; it is not a forecast of future demand.`,
      });
    } else if (view.growth.raw < CONTRACTION) {
      cautions.push({
        kind: 'caution', code: 'imports_declined',
        headline: `Imports declined ${rate} a year${window}`,
        detail: `Recorded imports into ${view.country} fell at ${rate} a year${window}. Past decline does not guarantee future decline, but it is the trend on record.`,
      });
    } else {
      cautions.push({
        kind: 'caution', code: 'imports_flat',
        headline: `Imports were broadly flat at ${rate} a year${window}`,
        detail: `Recorded imports into ${view.country} changed little${window}. Growth is unlikely to do the work of winning share here.`,
      });
    }
  }

  // --- India's position: deliberately two-sided ---------------------------------
  if (view.india_share.state === 'available' && view.india_share.raw != null) {
    const share = view.india_share.display;
    if (view.india_share.raw >= CROWDED_INDIA_SHARE) {
      signals.push({
        kind: 'signal', code: 'india_proven_access',
        headline: `Indian goods already reach this market (${share} of imports)`,
        detail: `India supplies ${share} of ${view.country}'s imports in this category, so Indian product is established here and the commercial route is proven.`,
      });
      cautions.push({
        kind: 'caution', code: 'india_share_crowded',
        headline: `Indian suppliers already hold ${share} of this market`,
        detail: `A high existing Indian share means you would be competing largely against other Indian exporters, and there may be less room left to take. A high share is not automatically an advantage.`,
      });
    } else if (view.india_share.raw <= THIN_INDIA_SHARE) {
      cautions.push({
        kind: 'caution', code: 'india_share_thin',
        headline: `India supplies only ${share} of this market`,
        detail: `Indian goods have little presence in ${view.country} for this product. That can mean open headroom, or it can mean a barrier that has kept Indian suppliers out — which of the two it is has not been established.`,
      });
    } else {
      signals.push({
        kind: 'signal', code: 'india_headroom',
        headline: `India supplies ${share} of this market`,
        detail: `Indian goods have an established but not dominant position in ${view.country}, so the route is proven and there is still share held by other origins.`,
      });
    }
  }

  // --- Competition -------------------------------------------------------------
  if (view.supplier_concentration.state === 'available' && view.supplier_concentration.raw != null) {
    const hhi = view.supplier_concentration.raw;
    if (hhi < 0.15) {
      signals.push({
        kind: 'signal', code: 'suppliers_diversified',
        headline: 'No single origin dominates supply',
        detail: `${view.country} sources this product from a broad spread of countries, so no incumbent supplier controls the market and buyers are used to switching origin.`,
      });
    } else if (hhi >= 0.25) {
      cautions.push({
        kind: 'caution', code: 'suppliers_concentrated',
        headline: 'Supply is concentrated in a few origins',
        detail: `A small number of supplying countries account for most of ${view.country}'s imports. Established relationships in a concentrated market are harder to displace.`,
      });
    }
  }

  // --- Evidence gaps: stated as gaps, never as weaknesses -----------------------
  for (const pillar of view.pillars) {
    if (pillar.state !== 'not_established') continue;
    gaps.push({
      kind: 'gap', code: `gap_${pillar.key}`,
      headline: `${pillar.label} has not been assessed yet`,
      detail: pillar.not_established_because ?? 'This has not been established yet.',
    });
  }

  return [...signals, ...cautions, ...gaps];
}

/**
 * The one-line "why it stands out" and "analysis can improve" shown on a results card.
 *
 * Both are drawn from `explainMarket`, so a card can never say something the detail page
 * contradicts. `null` where nothing is established, rather than a reassuring placeholder.
 */
export function summariseMarket(view: MarketDetailView): { stands_out: string | null; can_improve: string | null } {
  const explanations = explainMarket(view);
  const signal = explanations.find((entry) => entry.kind === 'signal');
  const caution = explanations.find((entry) => entry.kind === 'caution');
  const gapCount = explanations.filter((entry) => entry.kind === 'gap').length;
  return {
    stands_out: signal?.headline ?? null,
    // A caution outranks a gap: a thing we know and that argues against the market is more
    // useful than a count of things we have not looked at yet.
    can_improve: caution?.headline
      ?? (gapCount ? `${gapCount} ${gapCount === 1 ? 'area needs' : 'areas need'} more evidence before this analysis is complete` : null),
  };
}

/**
 * What the evidence-confidence figure actually means, in one sentence.
 *
 * Rendered next to every confidence number in the product. Its whole job is to stop the figure
 * being read as a probability that exporting to this market will succeed.
 */
export const CONFIDENCE_MEANING =
  'How much of the evidence ClearTrade needs is currently on file. It is not a prediction of commercial success.';

export const ATTRACTIVENESS_MEANING =
  'How this market compares on the evidence gathered so far. It moves as more evidence is added.';
