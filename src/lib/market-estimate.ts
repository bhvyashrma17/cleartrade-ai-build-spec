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
 * Data (E-041): CEPII BACI, which covers every HS6 product, from the newest ready release (HS 2022
 * first, else HS 2017), over its latest three years. The Comtrade warehouse, which holds only the
 * products someone has ingested, is the fallback where no BACI release is loaded or it cannot be read.
 *
 * Note: THIS module has nothing to do with minting a guest tenant — that happens in the
 * route (`src/app/api/v1/market-estimates/route.ts`), not here. This function is a pure
 * read of the warehouse; it neither knows nor cares whether the caller has a session.
 */

import { Prisma, TradeDataSource, TradeFlowDirection } from '@prisma/client';
import { appEnvironment,tradeFlowEvidenceWhere } from '@/lib/evidence-environment';
import { toIso2, WORLD_PARTNER } from '@/lib/comtrade/areas';
import type { MarketEstimatePolicy } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { baciFlowsToTradeFlows } from '@/lib/demand-discovery-v5/baci-flows';
import type { TradeFlowInput } from '@/lib/demand-discovery-v5/series';
import { BACI_PROVIDER } from '@/lib/trade-datasets/baci';
import { latestReadyTradeDatasetRelease, readProductFlows } from '@/lib/trade-datasets/service';

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
  /** Prices per kg from BACI (by supplier, weighted by value), per unit from the warehouse. */
  unit_price_band: { min: number; max: number; currency: 'USD'; per: 'kg' | 'unit' } | null;
  /** The required literal framing: "buyers in these markets imported X at Y–Z per unit." */
  headline: string;
}

export interface MarketEstimateResult {
  hs_scope: string;
  hs_scope_requested: string;
  hs_scope_widened: boolean;
  markets: EstimateMarket[];
  disclaimer: string;
  /** Where the figures come from (E-041): CEPII BACI for any product, else the Comtrade warehouse. */
  source: 'cepii_baci' | 'comtrade_warehouse' | 'none';
  /** The release and years, e.g. "CEPII BACI 202501 (HS22), 2022–2024"; null without data. */
  source_label: string | null;
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
  return `${appEnvironment()}:${hsCode}:${band}`;
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

// ---------------------------------------------------------------------------
// CEPII BACI: every product (E-041)
// ---------------------------------------------------------------------------

export interface BaciEstimateRead { flows: TradeFlowInput[]; label: string }
type BaciEstimateReader = (hs6: string) => Promise<BaciEstimateRead | null>;
let baciReaderOverride: BaciEstimateReader | null = null;

/** Test seam: BACI flows from memory instead of a release in storage. */
export function setBaciEstimateReaderForTesting(reader: BaciEstimateReader | null): void {
  baciReaderOverride = reader;
}

const BACI_ESTIMATE_YEARS = 3;

/** The newest ready BACI release holding the product (HS 2022 first, else HS 2017), over its latest three years. */
async function readBaciEstimate(hs6: string): Promise<BaciEstimateRead | null> {
  for (const revision of ['HS22', 'HS17'] as const) {
    const release = await latestReadyTradeDatasetRelease(BACI_PROVIDER, revision);
    if (!release) continue;
    const years: number[] = [];
    for (let year = Math.max(release.first_year, release.last_year - BACI_ESTIMATE_YEARS + 1); year <= release.last_year; year += 1) years.push(year);
    const [read, countries] = await Promise.all([
      readProductFlows({ release_id: release.id, hs6, years }),
      prisma.tradeDatasetCountry.findMany({ where: { release_id: release.id }, select: { provider_code: true, iso2: true } }),
    ]);
    const flows = baciFlowsToTradeFlows(read.flows, countries).flows;
    if (flows.length) return { flows, label: `CEPII BACI ${release.dataset_version} (${revision}), ${years[0]}–${years[years.length - 1]}` };
  }
  return null;
}

/** The price at a share of the traded value, over prices sorted ascending. */
function weightedPercentile(prices: readonly { price: number; value: number }[], share: number): number {
  const total = prices.reduce((sum, item) => sum + item.value, 0);
  let seen = 0;
  for (const item of prices) {
    seen += item.value;
    if (seen >= total * share) return item.price;
  }
  return prices[prices.length - 1]!.price;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * The estimate from BACI flows. Pure. Each importer's imports from every supplier by year, ordered
 * by its latest year, with its suppliers' prices per kg in that year (10th to 90th percentile by
 * value). India itself, provider aggregates (not a market) and markets under the volume floor are
 * left out. Observed history only, as the module comment requires.
 */
export function estimateFromBaciFlows(flows: readonly TradeFlowInput[], hs6: string, policy: MarketEstimatePolicy, sourceLabel: string): MarketEstimateResult {
  const byImporter = new Map<string, TradeFlowInput[]>();
  for (const flow of flows) {
    if (!/^[A-Z]{2}$/.test(flow.importer) || flow.importer === 'IN') continue;
    const list = byImporter.get(flow.importer);
    if (list) list.push(flow);
    else byImporter.set(flow.importer, [flow]);
  }
  const markets: (EstimateMarket & { _latestValue: number })[] = [];
  for (const [importer, rows] of byImporter) {
    const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);
    const latestYear = years[years.length - 1]!;
    const latest = rows.filter((row) => row.year === latestYear);
    const latestValue = latest.reduce((sum, row) => sum + row.value_usd, 0);
    if (latestValue < policy.volume_floor_usd) continue;
    const prices = latest
      .filter((row) => row.quantity_kg != null && row.quantity_kg > 0 && row.value_usd > 0)
      .map((row) => ({ price: row.value_usd / row.quantity_kg!, value: row.value_usd }))
      .sort((a, b) => a.price - b.price);
    const band = prices.length ? { min: round2(weightedPercentile(prices, 0.1)), max: round2(weightedPercentile(prices, 0.9)), currency: 'USD' as const, per: 'kg' as const } : null;
    markets.push({
      country_code: importer,
      observed_import_value_usd: Math.round(rows.reduce((sum, row) => sum + row.value_usd, 0)),
      data_years: years,
      unit_price_band: band,
      headline: buildHeadline(importer, hs6, latestValue, latestYear, band),
      _latestValue: latestValue,
    });
  }
  markets.sort((a, b) => b._latestValue - a._latestValue || a.country_code.localeCompare(b.country_code));
  return {
    hs_scope: hs6,
    hs_scope_requested: hs6,
    hs_scope_widened: false,
    markets: markets.slice(0, policy.top_n_markets).map(({ _latestValue: _drop, ...market }) => market),
    disclaimer: DISCLAIMER,
    source: 'cepii_baci',
    source_label: sourceLabel,
    data_years_covered: [...new Set(flows.map((flow) => flow.year))].sort((a, b) => a - b),
  };
}

async function computeFresh(requestedHs: string, policy: MarketEstimatePolicy): Promise<MarketEstimateResult> {
  if (/^\d{6}$/.test(requestedHs)) {
    try {
      const read = await (baciReaderOverride ?? readBaciEstimate)(requestedHs);
      if (read) return estimateFromBaciFlows(read.flows, requestedHs, policy, read.label);
    } catch (error) {
      // The warehouse still answers when BACI cannot be read (storage down, a partition missing).
      console.error('[market-estimate] BACI read failed; answering from the warehouse:', error instanceof Error ? error.message : error);
    }
  }
  return fromWarehouse(requestedHs, policy);
}

// ---------------------------------------------------------------------------
// The Comtrade warehouse: the fallback (products someone has ingested)
// ---------------------------------------------------------------------------

async function fromWarehouse(requestedHs: string, policy: MarketEstimatePolicy): Promise<MarketEstimateResult> {
  if (!requestedHs) {
    return {
      hs_scope: '',
      hs_scope_requested: '',
      hs_scope_widened: false,
      markets: [],
      disclaimer: DISCLAIMER,
      source: 'none',
      source_label: null,
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
        ...tradeFlowEvidenceWhere(),
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
      source: 'none',
      source_label: null,
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
          per: 'unit' as const,
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
    source: 'comtrade_warehouse',
    source_label: `UN Comtrade, ClearTrade warehouse, ${[...new Set(rows.map((r) => r.year))].sort().join(', ')}`,
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
  priceBand: { min: number; max: number; currency: string; per?: 'kg' | 'unit' } | null,
): string {
  const valueText = latestValue.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  const base = `Buyers in ${countryCode} imported HS ${hsScope} worth ${valueText} USD in ${latestYear}`;
  if (!priceBand) return `${base}.`;
  return `${base}, at ${priceBand.min.toFixed(2)}–${priceBand.max.toFixed(2)} ${priceBand.currency} per ${priceBand.per ?? 'unit'}.`;
}
