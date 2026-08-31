/**
 * Project a frozen MarketAssessment into the exporter-facing market view.
 *
 * This module computes NOTHING. Every number it emits was written by
 * `country-truth-scoring-v4` / `country-trade-metrics-v1` at assessment time and is read back
 * verbatim; this file only selects, names and formats. That constraint is the point: a second
 * place that decides what a market is worth is a second scoring system, and Phase 1I is
 * forbidden from having one.
 *
 * Two representations are kept rigidly apart all the way to the screen:
 *
 *   - **Attractiveness** (`overall_score`) — how good this market looks on the evidence held.
 *   - **Evidence confidence** (`confidence_score`) — how much of the evidence is actually held.
 *
 * They are different questions and are never combined, averaged, or rendered in the same
 * visual vocabulary. A market can be attractive on thin evidence, and that is a true and
 * useful thing to say; collapsing the two would turn "we haven't looked yet" into "this is
 * mediocre".
 *
 * An unavailable pillar is `null`, never `0`. `0` is a real score meaning "we measured this
 * and it is bad"; `null` means "we have not established it". Anything that renders these must
 * preserve the distinction — see `PillarView.state`.
 */
import type { Prisma } from '@prisma/client';
import { countryName } from './country-names';
import { periodRange, sharePercent, signedPercent, usdCompact } from './format';

/** The four Phase 1H pillars plus the four trade pillars, in the order the detail page shows them. */
export const PILLAR_KEYS = [
  'demand_score',
  'growth_score',
  'competition_score',
  'market_access',
  'export_economics',
  'exporter_market_fit',
  'logistics_feasibility',
  'risk_resilience',
] as const;

export type PillarKey = (typeof PILLAR_KEYS)[number];

export const PILLAR_LABELS: Record<PillarKey, string> = {
  demand_score: 'Demand',
  growth_score: 'Growth',
  competition_score: 'Competition',
  market_access: 'Market access',
  export_economics: 'Export economics',
  exporter_market_fit: 'Exporter fit',
  logistics_feasibility: 'Logistics',
  risk_resilience: 'Risk & resilience',
};

/**
 * Why a pillar has no score, in exporter language.
 *
 * The stored `exclusion_reason` strings are engineering vocabulary
 * (`insufficient_exporter_data`, `blocked_by_explicit_hard_gate`). Mapping them is a
 * translation, not a reinterpretation: an unrecognised reason falls through to the raw string
 * rather than to a comfortable generic, so a new backend reason surfaces as itself instead of
 * silently becoming "not enough evidence yet".
 */
const EXCLUSION_PHRASES: Array<{ match: RegExp; phrase: string }> = [
  { match: /insufficient_exporter_data/i, phrase: 'Your product details are needed before this can be assessed.' },
  { match: /blocked_by_explicit_hard_gate/i, phrase: 'A hard requirement for this market is not met.' },
  { match: /India-preference applicability is unavailable|India-preference applicability determination is unavailable/i, phrase: 'The import duty that applies to Indian goods has not been established yet.' },
  { match: /classification|declarable line|national tariff line/i, phrase: 'The exact destination tariff line for this product has not been confirmed yet.' },
  { match: /No sufficient sourced export-economics input/i, phrase: 'Landed-cost inputs (your price, freight and handling quotes) are not on file yet.' },
  { match: /route-availability evidence/i, phrase: 'No shipping route evidence has been recorded for this destination yet.' },
  { match: /no_usable_evidence|no usable evidence/i, phrase: 'No usable evidence has been gathered for this yet.' },
];

function exclusionPhrase(reason: string | null): string | null {
  if (!reason) return null;
  for (const entry of EXCLUSION_PHRASES) if (entry.match.test(reason)) return entry.phrase;
  return reason;
}

export type PillarState = 'available' | 'not_established';

export interface PillarView {
  key: PillarKey;
  label: string;
  /** Null whenever `state` is `not_established`. Never substituted with 0. */
  score: number | null;
  state: PillarState;
  /** 0–100. Meaningful only when `state` is `available`. */
  confidence: number;
  /** Share of the overall score this pillar actually carried, 0 when unavailable. */
  weight_applied: number;
  /** Exporter-readable reason the pillar has no score. Null when available. */
  not_established_because: string | null;
  /** The raw stored reason, for agent/admin provenance surfaces. */
  raw_exclusion_reason: string | null;
}

/**
 * The conventional Herfindahl–Hirschman reading, on the 0–1 scale the calculator publishes.
 * These bands are the standard competition-authority thresholds (1,500 / 2,500 on the 0–10,000
 * scale), not a ClearTrade invention, and they describe the SUPPLIER side of the destination's
 * import market — how many origins compete to sell into it.
 */
export function concentrationLabel(hhi: number): string {
  if (hhi < 0.15) return 'Diversified';
  if (hhi < 0.25) return 'Moderately concentrated';
  return 'Highly concentrated';
}

export interface MarketMetricView {
  /** Formatted for display, or null when the metric was not established. */
  display: string | null;
  /** The stored value, unrounded, for provenance surfaces and comparison ordering. */
  raw: number | null;
  state: PillarState;
}

export interface MarketRowView {
  assessment_id: string;
  country_code: string;
  country: string;
  rank: number;
  /** Null when the assessment is `not_rankable`; never 0. */
  attractiveness: number | null;
  evidence_confidence: number;
  rankable: boolean;
  market_size: MarketMetricView;
  growth: MarketMetricView;
  india_share: MarketMetricView;
  supplier_concentration: MarketMetricView;
  /** Trade-reporting periods the metrics were computed over, e.g. `2021–2025`. */
  trade_periods: string | null;
  /** When this assessment was generated. Distinct from the trade reporting period. */
  generated_at: string;
  is_selected: boolean;
  saved: boolean;
}

export interface MarketDetailView extends MarketRowView {
  pillars: PillarView[];
  /** How many pillars are still unestablished — the headline of "improve this analysis". */
  pillars_not_established: number;
  /** The frozen scoring clock. Distinct from `generated_at` and from the trade period. */
  as_of_date: string | null;
  /** Raw stored rationale. Agent/admin surfaces only; the exporter reads `explanations`. */
  raw_rationale: string | null;
}

// ---------------------------------------------------------------------------
// Reading the frozen JSON. Everything below is defensive: `field_provenance` is nullable for
// assessments written before it existed, and a legacy row must degrade to "not established"
// rather than throw on a product page.
// ---------------------------------------------------------------------------

interface StoredPillar {
  score?: unknown;
  available?: unknown;
  confidence?: unknown;
  effective_weight?: unknown;
  exclusion_reason?: unknown;
  sub_signals?: Record<string, unknown>;
}

function readPillar(provenance: Record<string, unknown> | null, key: PillarKey): StoredPillar | null {
  if (!provenance) return null;
  // Scoring v4 writes `demand_score`/`growth_score`/`competition_score` but bare
  // `market_access`/`export_economics`/`exporter_market_fit`/`logistics_feasibility`/
  // `risk_resilience`. Both spellings are accepted so neither family silently reads as absent.
  const candidates = key.endsWith('_score') ? [key, key.replace(/_score$/, '')] : [key, `${key}_score`];
  for (const name of candidates) {
    const value = provenance[name];
    if (value && typeof value === 'object') return value as StoredPillar;
  }
  return null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function projectPillars(fieldProvenance: Prisma.JsonValue | null): PillarView[] {
  const provenance = fieldProvenance && typeof fieldProvenance === 'object' && !Array.isArray(fieldProvenance)
    ? (fieldProvenance as Record<string, unknown>)
    : null;
  return PILLAR_KEYS.map((key) => {
    const stored = readPillar(provenance, key);
    const score = num(stored?.score);
    // `available` is the authority. A pillar can carry a stale score with `available: false`,
    // and treating the score's presence as availability would resurrect it.
    const available = stored?.available === true && score != null;
    const rawReason = typeof stored?.exclusion_reason === 'string' ? stored.exclusion_reason : null;
    return {
      key,
      label: PILLAR_LABELS[key],
      score: available ? score : null,
      state: available ? ('available' as const) : ('not_established' as const),
      confidence: available ? (num(stored?.confidence) ?? 0) : 0,
      weight_applied: available ? (num(stored?.effective_weight) ?? 0) : 0,
      not_established_because: available
        ? null
        : exclusionPhrase(rawReason) ?? 'This has not been established yet.',
      raw_exclusion_reason: available ? null : rawReason,
    };
  });
}

interface StoredMetric {
  value?: unknown;
  status?: unknown;
  exclusion_reason?: unknown;
}

function readMetrics(payload: Prisma.JsonValue | null | undefined): Record<string, StoredMetric> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const metrics = (payload as { metrics?: unknown }).metrics;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return {};
  return metrics as Record<string, StoredMetric>;
}

function metricView(metric: StoredMetric | undefined, format: (value: number) => string | null): MarketMetricView {
  const raw = num(metric?.value);
  // `status` is the calculator's own verdict. A value present under a non-complete status is
  // partial working, not a result.
  if (raw == null || metric?.status !== 'complete') return { display: null, raw: null, state: 'not_established' };
  return { display: format(raw), raw, state: 'available' };
}

export interface AssessmentRecord {
  id: string;
  country_code: string;
  overall_score: number | null;
  confidence_score: number;
  country_truth_assessment_state: string | null;
  country_truth_period_set: number[];
  country_truth_as_of_date: Date | null;
  generated_at: Date;
  rationale: string | null;
  field_provenance: Prisma.JsonValue | null;
  is_selected: boolean;
  saved_at: Date | null;
  country_trade_metrics: { metrics_payload: Prisma.JsonValue } | null;
}

function baseRow(row: AssessmentRecord, rank: number): MarketRowView {
  const metrics = readMetrics(row.country_trade_metrics?.metrics_payload);
  // `not_rankable` means the scorer refused to produce an overall score. Rendering the stored
  // number anyway would present a score the engine declined to stand behind.
  const rankable = row.country_truth_assessment_state !== 'not_rankable';
  return {
    assessment_id: row.id,
    country_code: row.country_code,
    country: countryName(row.country_code),
    rank,
    attractiveness: rankable ? row.overall_score : null,
    evidence_confidence: row.confidence_score,
    rankable,
    market_size: metricView(metrics.market_size, (value) => usdCompact(value)),
    growth: metricView(metrics.cagr, (value) => signedPercent(value)),
    india_share: metricView(metrics.india_market_share, (value) => sharePercent(value)),
    // HHI is an `index_0_1`, not a percentage. Rendering `0.18` as `18%` would invite it to be
    // read as "18% of the market", which is a different quantity entirely — so the index is
    // named in words and the number travels alongside for anyone who knows the measure.
    supplier_concentration: metricView(metrics.supplier_hhi, (value) => `${concentrationLabel(value)} (HHI ${value.toFixed(2)})`),
    trade_periods: periodRange(row.country_truth_period_set),
    generated_at: row.generated_at.toISOString(),
    is_selected: row.is_selected,
    saved: row.saved_at != null,
  };
}

/** Rank is assigned by the caller's ordering, so the list and the detail page never disagree. */
export function projectMarketRow(row: AssessmentRecord, rank: number): MarketRowView {
  return baseRow(row, rank);
}

export function projectMarketDetail(row: AssessmentRecord, rank: number): MarketDetailView {
  const pillars = projectPillars(row.field_provenance);
  return {
    ...baseRow(row, rank),
    pillars,
    pillars_not_established: pillars.filter((pillar) => pillar.state === 'not_established').length,
    as_of_date: row.country_truth_as_of_date?.toISOString() ?? null,
    raw_rationale: row.rationale,
  };
}

/**
 * Order markets the way the product ranks them: attractiveness first, then confidence as the
 * tie-break, then country code so the order is total and stable across requests.
 *
 * Unrankable markets sort last rather than being dropped — "we could not rank this" is a
 * result the exporter is entitled to see, and hiding it would silently shrink the shortlist.
 */
export function rankMarkets<T extends AssessmentRecord>(rows: readonly T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftRankable = left.country_truth_assessment_state !== 'not_rankable';
    const rightRankable = right.country_truth_assessment_state !== 'not_rankable';
    if (leftRankable !== rightRankable) return leftRankable ? -1 : 1;
    const scoreDiff = (right.overall_score ?? -1) - (left.overall_score ?? -1);
    if (scoreDiff !== 0) return scoreDiff;
    const confidenceDiff = right.confidence_score - left.confidence_score;
    if (confidenceDiff !== 0) return confidenceDiff;
    return left.country_code.localeCompare(right.country_code);
  });
}
