/**
 * GET /api/v1/discovery-runs/:id/market-assessments — the ranked result of a run.
 *
 * Split from the job poll endpoint on purpose. The job resource answers *"is it done?"*
 * and stays small enough to poll every second or two; this answers *"what did it find?"*
 * and is fetched once, when the job reaches a terminal state. Returning the full ranking
 * on every poll would send the whole payload repeatedly for no reason.
 *
 * Scope comes from `tenantScope()` like every other org-owned read — a run id in the URL
 * is never trusted on its own.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, list, newCorrelationId, notFound, pageMeta } from '@/lib/errors';
import { assertCan, tenantScope } from '@/lib/permissions';
import { exporterFitView } from '@/lib/demand-discovery-v5/exporter-inputs';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins, appEnvironment, isRealWorkflowEnvironment, nonRealEvidenceOrigins, unsafeEvidenceOrigins } from '@/lib/evidence-environment';

export async function GET(_request: NextRequest, context: { params: Promise<{ runId: string }> }) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requirePrincipal();
    const { runId } = await context.params;

    assertCan(principal, 'demand_discovery.run');
    const scope = await tenantScope(principal);

    const run = await prisma.discoveryRun.findFirst({
      where: { id: runId, ...scope },
      select: { id: true, status: true, input_snapshot: true, completed_at: true, job_id: true, model_version: true, summary: true, product_id: true, frozen_inputs: true, scoring_policy_snapshot: true },
    });
    // Out-of-tenant reads look identical to missing ones (docs/09 §4).
    if (!run) throw notFound('That search is not available.');

    const assessments = await prisma.marketAssessment.findMany({
      where: { run_id: runId,...(isRealWorkflowEnvironment()?{evidence_origins:{hasSome:allowedEvidenceOrigins()},NOT:{evidence_origins:{hasSome:nonRealEvidenceOrigins()}}}:{}) },
      // v5 rows carry a rank; earlier rows order by score as before.
      orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }, { overall_score: { sort: 'desc', nulls: 'last' } }, { country_code: 'asc' }],
    });

    return NextResponse.json(
      list(
        assessments.map((a) => ({
          id: a.id,
          country_code: a.country_code,
          overall_score: a.overall_score,
          demand_score: a.demand_score,
          growth_score: a.growth_score,
          competition_score: a.competition_score,
          // Decimal must not reach the client as a Prisma object; docs/09 §1 forbids
          // leaning on JS float behaviour, so these cross the wire as strings.
          india_share: a.india_share?.toString() ?? null,
          tariff_summary: a.tariff_summary,
          certification_requirements: a.certification_requirements,
          logistics_summary: a.logistics_summary,
          price_band: a.price_band_min
            ? {
                min: a.price_band_min.toString(),
                max: a.price_band_max?.toString() ?? null,
                currency: a.price_band_currency,
              }
            : null,
          rationale: a.rationale,
          model_version: a.model_version,
          confidence_score: a.confidence_score,
          // docs/36 v5 fields; null/empty on earlier runs.
          market_status: a.market_status,
          rank: a.rank,
          live_points: a.live_points,
          data_year: a.data_year,
          parts: (a.score_breakdown as { parts?: unknown } | null)?.parts ?? null,
          labels: a.labels,
          reasons: a.reasons,
          flag_reasons: a.flag_reasons,
          handed_off: a.handed_off,
          is_selected: a.is_selected,
          generated_at: a.generated_at.toISOString(),
          ...(!isRealWorkflowEnvironment()&&unsafeEvidenceOrigins(a.evidence_origins).length?{evidence_warning:`Non-real evidence: ${unsafeEvidenceOrigins(a.evidence_origins).join(', ')}`}:{})
        })),
        {
          // A run yields a bounded ranking (one row per candidate market), so it is
          // always a single page — but the envelope stays consistent with every other
          // list endpoint rather than inventing a special shape (docs/09 §2).
          ...pageMeta({ page: 1, per_page: assessments.length || 1, total: assessments.length }),
          run_id: run.id,
          run_status: run.status,
          completed_at: run.completed_at?.toISOString() ?? null,
          job_id: run.job_id,
          model_version: run.model_version,
          summary: run.summary,
          // Stage 1, item 7: the exporter's own figures as the run used them, so the page can ask for missing ones.
          product_id: run.product_id,
          exporter_figures: exporterFitView(run.frozen_inputs, run.scoring_policy_snapshot),
          evidence_environment:appEnvironment(),
        },
      ),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
