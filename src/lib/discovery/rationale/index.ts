/**
 * Rationale composition — where prose and numbers meet, and the only place they do.
 *
 * `composeRationale()` is the choke point the no-fabricated-numbers guarantee rests on:
 *
 *   1. Derive QUALITATIVE facts from the computed scores (bands, not magnitudes).
 *   2. Ask a writer for prose about those bands. Reject it if it contains any digit.
 *   3. Append the figures ourselves, formatted from the same `ScoredMarket` the arithmetic
 *      produced.
 *
 * Step 3 is why step 2 can afford to be strict. Every numeral an exporter reads in a
 * rationale is written by this function out of a computed field — so "no number appears
 * that is absent from TradeFlow" is a property of the code path, not a hope about the
 * model. `scripts/verify-warehouse-discovery.ts` asserts it from the outside by extracting
 * every numeric token from every stored rationale and matching it against the recomputed
 * facts.
 */

import type { ScoredMarket } from '../scoring';
import { ClaudeRationaleWriter } from './claude-writer';
import { TemplateRationaleWriter } from './template-writer';
import { assertNoDigits, type RationaleFacts, type RationaleWriter } from './writer';

export type { RationaleFacts, RationaleWriter } from './writer';
export { assertNoDigits, containsDigits } from './writer';
export { TemplateRationaleWriter } from './template-writer';

let cached: RationaleWriter | null = null;

/**
 * Writer selection — one factory, one case per implementation, mirroring
 * `getDiscoveryEngine()`. Defaults to the deterministic writer: rationale generation must
 * never be the reason a discovery run cannot complete, and a run that silently required an
 * API key to produce output would be a worse default than one that always works.
 */
export function getRationaleWriter(): RationaleWriter {
  if (cached) return cached;

  switch (process.env.RATIONALE_WRITER ?? 'template') {
    case 'claude':
      cached = new ClaudeRationaleWriter(process.env.ANTHROPIC_API_KEY);
      return cached;
    case 'template':
    default:
      cached = new TemplateRationaleWriter();
      return cached;
  }
}

/** Test seam — inject a fake writer without going through the environment. */
export function setRationaleWriter(writer: RationaleWriter | null) {
  cached = writer;
}

// ---------------------------------------------------------------------------
// Facts: computed numbers → qualitative bands
// ---------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  demand: 'import demand',
  growth: 'demand trend',
  competition: 'supplier concentration',
  exporter_fit: 'exporter-market fit',
  market_access: 'market access',
  export_economics: 'export economics',
  logistics: 'logistics feasibility',
  risk: 'risk and resilience',
};

/**
 * Reduce a scored market to the bands a writer is allowed to see.
 *
 * This is the information barrier: after this function there is no magnitude left in the
 * data the model receives. The band thresholds are the engine's own interpretation of its
 * scores and are deliberately coarse — a model asked to distinguish sixty-one from
 * sixty-three would be inventing precision the underlying data does not support.
 */
export function deriveFacts(market: ScoredMarket, productContext: string): RationaleFacts {
  const band = <T>(score: number | null, high: T, mid: T, low: T, unknown: T): T =>
    score == null ? unknown : score >= 66 ? high : score >= 40 ? mid : low;

  const unavailable = Object.entries({
    demand: market.demand,
    growth: market.growth,
    competition: market.competition,
    exporter_fit: market.exporter_market_fit,
    market_access: market.market_access,
    export_economics: market.export_economics,
    logistics: market.logistics_feasibility,
    risk: market.risk_resilience,
  })
    .filter(([, sub]) => sub.score == null)
    .map(([name]) => LABELS[name] ?? name);

  return {
    country_code: market.country_code,
    standing: market.overall_score >= 75 ? 'top' : market.overall_score >= 60 ? 'strong' : market.overall_score >= 40 ? 'moderate' : 'weak',
    demand: band(market.demand.score, 'large', 'moderate', 'small', 'unknown'),
    growth: band(market.growth.score, 'growing quickly', 'growing', 'shrinking', 'unknown'),
    // Competition scores `1 - HHI`, so a HIGH score is a FRAGMENTED supplier base — see the
    // sign note on `scoreCompetition`. Getting this mapping backwards would tell an exporter
    // a locked-up market is wide open.
    supplier_base: band(market.competition.score, 'fragmented', 'mixed', 'concentrated', 'unknown'),
    india_presence: band(market.india_share_pct == null ? null : Math.min(99, market.india_share_pct / 15 * 100), 'established', 'emerging', 'minimal', 'unknown'),
    unavailable_criteria: unavailable,
    product_context: productContext,
  };
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Every numeral in the finished rationale is formatted here, from a computed field. */
function factSentence(market: ScoredMarket): string {
  const parts: string[] = [];

  parts.push(
    `Recorded imports of ${market.latest_total_value.toLocaleString('en-IN', { maximumFractionDigits: 0 })} USD in ${market.latest_year}`,
  );

  if (market.india_share_pct != null) {
    parts.push(`India-origin share ${market.india_share_pct.toFixed(2)}%`);
  }
  return `${parts.join('; ')}.`;
}

export interface ComposedRationale {
  text: string;
  /** Which writer produced the prose half — recorded so a stored rationale says what wrote it. */
  writer: string;
  /** True when a model's output was rejected and the deterministic writer stood in. */
  fell_back: boolean;
  fallback_reason?: string;
}

/**
 * Produce the finished rationale for one market.
 *
 * `useModel` is false for markets outside the configured top N: an LLM call per market
 * would be a per-run cost multiplier for text nobody reads on rank forty, and the
 * deterministic writer is genuinely adequate there.
 */
export async function composeRationale(
  market: ScoredMarket,
  productContext: string,
  useModel: boolean,
): Promise<ComposedRationale> {
  const facts = deriveFacts(market, productContext);
  const fallbackWriter = new TemplateRationaleWriter();
  const writer = useModel ? getRationaleWriter() : fallbackWriter;

  let prose: string;
  let usedWriter = writer.name;
  let fellBack = false;
  let fallbackReason: string | undefined;

  try {
    prose = await writer.write(facts);
    // The guard. Any digit means the writer stated a figure it was never given, so the
    // output is discarded rather than shown — see the contract on `assertNoDigits`.
    assertNoDigits(prose, writer.name);
  } catch (error) {
    // Never fail a discovery run over prose. The scores are the product; the rationale is
    // the explanation of them, and a deterministic explanation beats no result.
    fallbackReason = error instanceof Error ? error.message : String(error);
    prose = await fallbackWriter.write(facts);
    usedWriter = fallbackWriter.name;
    fellBack = writer.name !== fallbackWriter.name;
  }

  return {
    text: `${prose} ${factSentence(market)}`,
    writer: usedWriter,
    fell_back: fellBack,
    ...(fallbackReason && fellBack ? { fallback_reason: fallbackReason } : {}),
  };
}
