/**
 * One v5 market assessment as the portals show it (docs/36 §6): status, rank, live points, the five
 * parts and their measures, labels, reasons and flags — read off the stored row, never recomputed —
 * and the data context each measure's source line is written from (item 8, `sources.ts`).
 * The exporter's market page and the agent's control surface both read it from here.
 */
import type { MarketAssessment } from '@prisma/client';
import type { MarketLabel, MarketReason } from './explain';
import type { MetricResult } from './metrics';
import { DEMAND_DISCOVERY_V5_MODEL } from './policy';
import { marketDataContext, type MarketDataContext } from './sources';

export type V5MarketStatus = 'ranked' | 'not_enough_data' | 'no_recorded_demand' | 'excluded';

export interface V5Detail {
  market_status: V5MarketStatus;
  rank: number | null;
  total_ranked: number;
  overall_score: number | null;
  confidence_score: number;
  live_points: number | null;
  data_year: number | null;
  labels: MarketLabel[];
  reasons: MarketReason[];
  flag_reasons: string[];
  handed_off: boolean;
  parts: { part: string; points: number; live_points: number; score: number | null }[];
  metrics: MetricResult[];
  /** Where the market's figures come from and for which years. */
  data_context: MarketDataContext;
}

export type V5AssessmentFields = Pick<MarketAssessment,
  'model_version' | 'market_status' | 'rank' | 'overall_score' | 'confidence_score' | 'live_points' | 'data_year' | 'labels' | 'reasons' | 'flag_reasons' | 'handed_off' | 'score_breakdown' | 'as_of_date'>;

export const isV5Assessment = (assessment: Pick<MarketAssessment, 'model_version' | 'market_status'>) =>
  assessment.model_version === DEMAND_DISCOVERY_V5_MODEL && assessment.market_status != null;

/** The v5 view of a stored assessment, or null for an assessment another engine wrote. */
export function v5Detail(assessment: V5AssessmentFields, totalRanked: number): V5Detail | null {
  if (!isV5Assessment(assessment)) return null;
  const breakdown = assessment.score_breakdown as { parts?: V5Detail['parts']; metrics?: MetricResult[] } | null;
  return {
    market_status: assessment.market_status as V5MarketStatus,
    rank: assessment.rank,
    total_ranked: totalRanked,
    overall_score: assessment.overall_score,
    confidence_score: assessment.confidence_score,
    live_points: assessment.live_points,
    data_year: assessment.data_year,
    labels: (assessment.labels ?? []) as unknown as MarketLabel[],
    reasons: (assessment.reasons ?? []) as unknown as MarketReason[],
    flag_reasons: (assessment.flag_reasons ?? []) as unknown as string[],
    handed_off: assessment.handed_off,
    parts: breakdown?.parts ?? [],
    metrics: breakdown?.metrics ?? [],
    data_context: marketDataContext(assessment.score_breakdown, assessment.as_of_date),
  };
}
