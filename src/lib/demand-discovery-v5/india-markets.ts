/**
 * "Where India already sells most" (owner, 31 Oct 2026, E-045): India's own largest destinations for
 * the product, from the run's stored calibration, each with where the run ranked it and, when that is
 * outside the top, the reason it costs the most. The score keeps ranking risky markets lower for a
 * first-time exporter; this list keeps India's real trade in plain sight, with the reason. Pure.
 */
import { MISS_EXPLANATION_TEXT, readRunCalibration, riskExplanation, type MissExplanation } from './calibration';

export interface IndiaMarket {
  country_code: string;
  rank: number | null;
  market_status: string | null;
  /** India's share of the market's imports, as the run measured it. */
  india_share_percent: number | null;
  /** In the run's top (the calibration's top 10). */
  in_top: boolean;
  /** A reason the calibration accepts it outside the top: restricted or no ECGC cover, or a sanctions flag. */
  explained_by: MissExplanation | null;
  explained_text: string | null;
  /** Outside the top: the reason that costs it most, in the run's own words. */
  reason: string | null;
}

interface AssessmentRow {
  country_code: string;
  rank: number | null;
  market_status: string | null;
  score_breakdown: unknown;
  flag_reasons: unknown;
  reasons: unknown;
}

export function indiaMarkets(summary: unknown, assessments: readonly AssessmentRow[]): IndiaMarket[] {
  const calibration = readRunCalibration(summary);
  if (!calibration) return [];
  const byCode = new Map(assessments.map((row) => [row.country_code, row]));
  return calibration.india_top.map((code) => {
    const row = byCode.get(code);
    const metrics = (row?.score_breakdown as { metrics?: { key: string; inputs?: Record<string, unknown> }[] } | null)?.metrics ?? [];
    const share = metrics.find((metric) => metric.key === 'india_foothold')?.inputs?.india_share_percent;
    const inTop = row?.rank != null && row.rank <= calibration.top;
    const explained = row ? riskExplanation({ metrics, flag_reasons: (row.flag_reasons ?? []) as string[] }) : null;
    const reasons = (row?.reasons ?? []) as { effect?: string; text?: string }[];
    const reason = inTop ? null : reasons.find((item) => item.effect === 'costs')?.text ?? reasons.find((item) => item.effect === 'status')?.text ?? null;
    return {
      country_code: code, rank: row?.rank ?? null, market_status: row?.market_status ?? null,
      india_share_percent: typeof share === 'number' ? share : null, in_top: inTop,
      explained_by: explained, explained_text: explained ? MISS_EXPLANATION_TEXT[explained] : null, reason,
    };
  });
}
