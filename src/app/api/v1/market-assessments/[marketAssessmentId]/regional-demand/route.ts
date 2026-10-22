/**
 * GET  /api/v1/market-assessments/:id/regional-demand — the market's regional view (D-033, docs/38).
 * POST /api/v1/market-assessments/:id/regional-demand — start reading it (202, async job).
 *
 * Tenancy is reached through the parent DiscoveryRun, as for every MarketAssessment route. POST takes
 * no body: the market, its HS6 and its official source are all fixed by the assessment itself.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { errorResponse, newCorrelationId, notFound, single } from '@/lib/errors';
import { allowedEvidenceOrigins, isRealWorkflowEnvironment, nonRealEvidenceOrigins } from '@/lib/evidence-environment';
import { tenantScopeVia } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { regionalDemandView, requestRegionalDemand } from '@/lib/regional-demand/service';

type Context = { params: Promise<{ marketAssessmentId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { marketAssessmentId } = await context.params;
    const scope = await tenantScopeVia(principal, 'run');
    const assessment = await prisma.marketAssessment.findFirst({
      where: { id: marketAssessmentId, ...scope, ...(isRealWorkflowEnvironment() ? { evidence_origins: { hasSome: allowedEvidenceOrigins() }, NOT: { evidence_origins: { hasSome: nonRealEvidenceOrigins() } } } : {}) },
      select: { id: true, country_code: true },
    });
    if (!assessment) throw notFound('That market is not available.');
    return NextResponse.json(single(await regionalDemandView(assessment.id, assessment.country_code)), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function POST(_request: NextRequest, context: Context) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { marketAssessmentId } = await context.params;
    const { run, created } = await requestRegionalDemand({ market_assessment_id: marketAssessmentId, actor: principal, trigger: 'requested', correlation_id: correlationId });
    return NextResponse.json(
      single({ run_id: run.id, job_id: run.job_id, status: run.status, already_running: !created }),
      { status: 202, headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
