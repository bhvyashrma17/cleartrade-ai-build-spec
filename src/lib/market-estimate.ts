/**
 * Pre-membership market estimate — docs/14 §3 `market_estimate.run`, guest tier.
 *
 * FRAMING IS A REQUIREMENT, not copy preference (product directive, recorded here so the
 * rule travels with the code that must honor it). This module returns OBSERVED HISTORY —
 * import values and unit-price bands the warehouse actually recorded — and nothing that
 * could read as a projection:
 *
 *   - No "you could earn" language, anywhere, ever. `EstimateMarket.headline` is built
 *     entirely from past-tense, sourced facts: "Buyers in {country} imported {value} of
 *     HS {code} in {year}, at {min}–{max} {currency} per unit." The word "estimate" in
 *     this file's name refers to the free tier of Demand Discovery, not a revenue estimate.
 *   - `monthly_quantity` is deliberately NEVER multiplied against a price band anywhere in
 *     this file. Doing so would produce exactly the "projected earnings" figure the
 *     product directive forbids, dressed up as arithmetic instead of a promise. It is
 *     captured on the request, echoed back for the caller's own reference, and used ONLY
 *     to bucket the cache key (`quantityBand()`) — never as an operand.
 *   - Every response carries `disclaimer` verbatim; nothing calling this module may drop it.
 *

 * Unlike `WarehouseDiscoveryEngine`, there is no scoring, no weighting, no rationale
 * writer, no LLM call. Markets are ordered by observed latest-year import value alone —
 * that ordering is itself a fact ("these are the biggest importers"), not a judgement.
 *
 * Cacheable by (hs_code, quantity_band): pure function of warehouse rows plus policy, so
 * identical inputs always produce an identical result. A process-local TTL cache (below)
 * is what "cacheable" buys in practice — this deliberately does NOT bypass the caller's
 * guest quota; the cache saves compute, not eligibility.
 *
 * Note: THIS module has nothing to do with minting a guest tenant — that happens in the
 * route (`src/app/api/v1/market-estimates/route.ts`), not here. This function is a pure
 * read of the warehouse; it neither knows nor cares whether the caller has a session.
 */

import { Prisma, TradeDataSource, TradeFlowDirection } from '@prisma/client';
import { toIso2, WORLD_PARTNER } from '@/lib/comtrade/areas';
import type { MarketEstimatePolicy } from '@/lib/config';
import { prisma } from '@/lib/prisma';

export const DISCLAIMER =
  'These figures are past trade data recorded by customs authorities. They describe what has already happened in these markets — they are not a forecast and do not guarantee any outcome for your business.';

export interface MarketEstimateInput {
  hs_code: string;
  /** Never used in arithmetic — see the module comment. Echoed back, and bucketed for the cache key only. */
  monthly_quantity?: number | null;
  location?: string | null;
}

export interface EstimateMarket {
  country_code: string;
  /** Sum of observed import value across the covered years, in USD. A historical total, not a rate. */
  observed_import_value_usd: number;
  data_years: number[];
  unit_price_band: { min: number; max: number; currency: 'USD' } | null;
  /** The required literal framing: "buyers in these markets imported X at Y–Z per unit." */
  headline: string;
}

export interface MarketEstimateResult {
  hs_scope: string;
  hs_scope_requested: string;
  hs_scope_widened: boolean;
  markets: EstimateMarket[];
  disclaimer: string;
  /** Present only when computed fresh; a cache hit omits it (nothing was queried this call). */
  data_years_covered?: number[];
}

// ---------------------------------------------------------------------------
// Cache — compute cost only, never an eligibility bypass (see module comment)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { result: MarketEstimateResult; expiresAt: number }>();

/**
 * Buckets `monthly_quantity` into a coarse band for the cache key. This is the ONLY use
 * `monthly_quantity` has anywhere in this module — never an operand in a calculation.
 */
export function quantityBand(quantity: number | null | undefined, breakpoints: number[]): string {
  if (quantity == null || !Number.isFinite(quantity) || quantity <= 0) return 'unspecified';
  const sorted = [...breakpoints].sort((a, b) => a - b);
  let band = 0;
  while (band < sorted.length && quantity >= sorted[band]) band++;
  return `band${band}`;
}

function cacheKey(hsCode: string, band: string): string {
  return `${hsCode}:${band}`;
}

// ---------------------------------------------------------------------------
// Computation
// ---------------------------------------------------------------------------

export async function computeMarketEstimate(
  input: MarketEstimateInput,
  policy: MarketEstimatePolicy,
): Promise<MarketEstimateResult> {
  const requestedHs = (input.hs_code ?? '').replace(/\D/g, '').slice(0, 6);
  const band = quantityBand(input.monthly_quantity, policy.quantity_band_breakpoints);
  const key = cacheKey(requestedHs, band);

  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    // A cache hit means nothing was queried THIS call — data_years_covered would be
    // misleading (it belongs to whenever the cached value was computed, not now).
    const { data_years_covered: _omit, ...rest } = cached.result;
    return rest;
  }

  const result = await computeFresh(requestedHs, policy);
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Test/ops seam — clears the process-local cache without restarting the server. */
export function clearMarketEstimateCache(): void {
  cache.clear();
}

async function computeFresh(requestedHs: string, policy: MarketEstimatePolicy): Promise<MarketEstimateResult> {
  if (!requestedHs) {
    return {
      hs_scope: '',
      hs_scope_requested: '',
      hs_scope_widened: false,
      markets: [],
      disclaimer: DISCLAIMER,
      data_years_covered: [],
    };
  }

  const rowSelect = {
    reporter: true, partner: true, hs_code: true, year: true,
    value: true, quantity: true, unit_value: true,
  } as const;
  type Row = Prisma.TradeFlowGetPayload<{ select: typeof rowSelect }>;

  // Same widen-until-there's-data strategy as WarehouseDiscoveryEngine, for the same
  // reason: real trade statistics are sparse at 6 digits, and an empty result for a
  // well-specified product is a worse answer than a broader one that says so.
  const scopeCandidates = [requestedHs, requestedHs.slice(0, 4), requestedHs.slice(0, 2)].filter(
    (s, i, all) => s.length > 0 && all.indexOf(s) === i,
  );

  let effectiveScope = requestedHs;
  let rows: Row[] = [];
  for (const scope of scopeCandidates) {
    rows = await prisma.tradeFlow.findMany({
      where: {
        hs_code: { startsWith: scope },
        source: TradeDataSource.comtrade,
        flow_direction: TradeFlowDirection.import,
        partner: WORLD_PARTNER,
      },
      select: rowSelect,
    });
    if (rows.length > 0) { effectiveScope = scope; break; }
  }

  if (rows.length === 0) {
    return {
      hs_scope: requestedHs,
      hs_scope_requested: requestedHs,
      hs_scope_widened: false,
      markets: [],
      disclaimer: DISCLAIMER,
      data_years_covered: [],
    };
  }

  const byReporter = new Map<string, Row[]>();
  for (const row of rows) {
    const list = byReporter.get(row.reporter);
    if (list) list.push(row);
    else byReporter.set(row.reporter, [row]);
  }

  const markets: (EstimateMarket & { _latestValue: number })[] = [];

  for (const [reporter, reporterRows] of byReporter) {
    const iso2 = toIso2(reporter);
    if (!iso2) continue; // never guessed — see areas.ts

    const years = [...new Set(reporterRows.map((r) => r.year))].sort((a, b) => a - b);
    const latestYear = years[years.length - 1];
    const latestRows = reporterRows.filter((r) => r.year === latestYear);
    const latestValue = latestRows.reduce((sum, r) => sum + r.value.toNumber(), 0);
    if (latestValue < policy.volume_floor_usd) continue;

    const totalValue = reporterRows.reduce((sum, r) => sum + r.value.toNumber(), 0);

    const unitValues = latestRows
      .map((r) => r.unit_value?.toNumber() ?? null)
      .filter((v): v is number => v != null && v > 0)
      .sort((a, b) => a - b);
    const priceBand = unitValues.length
      ? {
          min: unitValues[Math.floor(unitValues.length * 0.1)],
          max: unitValues[Math.min(unitValues.length - 1, Math.floor(unitValues.length * 0.9))],
          currency: 'USD' as const,
        }
      : null;

    markets.push({
      country_code: iso2,
      observed_import_value_usd: totalValue,
      data_years: years,
      unit_price_band: priceBand,
      headline: buildHeadline(iso2, effectiveScope, latestValue, latestYear, priceBand),
      _latestValue: latestValue,
    });
  }

  markets.sort((a, b) => b._latestValue - a._latestValue);
  const top = markets.slice(0, policy.top_n_markets).map(({ _latestValue: _drop, ...m }) => m);

  return {
    hs_scope: effectiveScope,
    hs_scope_requested: requestedHs,
    hs_scope_widened: effectiveScope !== requestedHs,
    markets: top,
    disclaimer: DISCLAIMER,
    data_years_covered: [...new Set(rows.map((r) => r.year))].sort(),
  };
}

/**
 * The exact required framing pattern: "buyers in these markets imported X at Y-Z per
 * unit." Every number here comes straight from the arguments — nothing computed inline,
 * nothing this function could get subtly wrong by doing its own math.
 */
function buildHeadline(
  countryCode: string,
  hsScope: string,
  latestValue: number,
  latestYear: number,
  priceBand: { min: number; max: number; currency: string } | null,
): string {
  const valueText = latestValue.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const base = `Buyers in ${countryCode} imported HS ${hsScope} worth ${valueText} USD in ${latestYear}`;
  if (!priceBand) return `${base}.`;
  return `${base}, at ${priceBand.min.toFixed(2)}–${priceBand.max.toFixed(2)} ${priceBand.currency} per unit.`;
}
