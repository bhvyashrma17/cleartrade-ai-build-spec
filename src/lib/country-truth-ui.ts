import type { Prisma } from '@prisma/client';
import { countryName } from '@/lib/country-discovery/country-names';

/**
 * The pilot's hard-coded three-market table (Germany, UAE, USA) was removed in Phase 1I.
 * Country selection is no longer something a caller does: Phase 1F/1G screen every reporting
 * market and freeze a shortlist, and the deep pipeline reads that shortlist rather than a
 * hand-picked list. Nothing may reintroduce a country picker on the product path.
 */

export const COUNTRY_TRUTH_STAGE_LABELS: Record<string, string> = {
  queued: 'Preparing analysis',
  planning: 'Preparing analysis',
  acquiring_evidence: 'Gathering trade data',
  building_manifest: 'Verifying evidence',
  calculating_metrics: 'Calculating market metrics',
  scoring: 'Ranking markets',
  completed: 'Complete',
};

export function countryTruthStage(status: string, progressStage: string | null) {
  if (status === 'completed' || status === 'partial') return 'Complete';
  return COUNTRY_TRUTH_STAGE_LABELS[progressStage ?? status] ?? 'Preparing analysis';
}

type Metric = { value?: unknown; status?: string; unit?: string | null; exclusion_reason?: string | null };
type MetricsPayload = { metrics?: Record<string, Metric> };

export type CountryTruthAssessmentView = {
  country: string;
  country_code: string;
  score: number | null;
  confidence: number;
  status: string;
  market_size: MetricView;
  growth: MetricView;
  india_share: MetricView;
  competition_hhi: MetricView;
  rationale: string;
};

export type MetricView = { value: number | null; status: string; unit: string | null; reason: string | null };

function metric(value: Metric | undefined): MetricView {
  return {
    value: typeof value?.value === 'number' ? value.value : null,
    status: value?.status ?? 'missing',
    unit: value?.unit ?? null,
    reason: value?.exclusion_reason ?? null,
  };
}

/** Dedicated v4 read projection. It intentionally accepts no TradeFlow/warehouse fields. */
export function projectCountryTruthAssessment(row: {
  country_code: string;
  overall_score: number | null;
  confidence_score: number;
  country_truth_assessment_state: string | null;
  rationale: string | null;
  country_trade_metrics: { metrics_payload: Prisma.JsonValue } | null;
}): CountryTruthAssessmentView {
  const payload = (row.country_trade_metrics?.metrics_payload ?? {}) as MetricsPayload;
  const metrics = payload.metrics ?? {};
  return {
    // Named from the checked-in provider reporter registry, so all 200+ screened markets
    // resolve rather than only the three the pilot knew about.
    country: countryName(row.country_code),
    country_code: row.country_code,
    score: row.country_truth_assessment_state === 'not_rankable' ? null : row.overall_score,
    confidence: row.confidence_score,
    status: row.country_truth_assessment_state ?? 'not_rankable',
    market_size: metric(metrics.market_size),
    growth: metric(metrics.cagr),
    india_share: metric(metrics.india_market_share),
    competition_hhi: metric(metrics.supplier_hhi),
    rationale: row.rationale ?? 'The available evidence was insufficient for a detailed rationale.',
  };
}
