/**
 * EXP-05 Market Detail. `/app/markets/:marketAssessmentId` · Exporter (all tiers) · P0.
 *
 * Same anonymous-visitor contract as `/app/markets`: no session is a supported state
 * (`getPrincipal()`, not a throwing guard), because a guest can view results without
 * ever registering. Save/select are tier-gated in the page, not by hiding the route.
 *
 * A MarketAssessment has no `exporter_org_id` of its own — tenancy is reached through
 * its parent DiscoveryRun. An out-of-tenant id renders Next's `notFound()` rather than a
 * 403, so a guessed id can't be used to confirm another tenant's search exists.
 */

import { notFound } from 'next/navigation';
import { OrgTier } from '@prisma/client';
import { getPrincipal } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { tenantScopeVia } from '@/lib/permissions';
import { MarketDetail } from './MarketDetail';
import { isV5Assessment, v5Detail, type V5Detail } from '@/lib/demand-discovery-v5/detail';
import { allowedEvidenceOrigins, isRealWorkflowEnvironment, nonRealEvidenceOrigins, unsafeEvidenceOrigins } from '@/lib/evidence-environment';

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ marketAssessmentId: string }>;
}) {
  const { marketAssessmentId } = await params;
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;

  // Reaching this page requires having already run a search, which requires a session —
  // a guest is minted on first search, never on a page view (that rule holds here too).
  // A bookmarked/shared link visited with no session at all has no tenant to scope by,
  // so it 404s rather than silently minting a fresh, empty guest.
  if (!principal) notFound();
  const scope = await tenantScopeVia(principal, 'run');

  const assessment = await prisma.marketAssessment.findFirst({
    where: { id: marketAssessmentId, ...scope,...(isRealWorkflowEnvironment()?{evidence_origins:{hasSome:allowedEvidenceOrigins()},NOT:{evidence_origins:{hasSome:nonRealEvidenceOrigins()}}}:{}) },
    include: {
      run: { select: { id: true, status: true, product_id: true, input_snapshot: true } },
      product: { select: { id: true, name: true } },
    },
  });
  if (!assessment) notFound();

  // Rank among this run's other results — EXP-05's decision header names it explicitly.
  const siblings = await prisma.marketAssessment.findMany({
    where: { run_id: assessment.run_id,...(isRealWorkflowEnvironment()?{evidence_origins:{hasSome:allowedEvidenceOrigins()},NOT:{evidence_origins:{hasSome:nonRealEvidenceOrigins()}}}:{}) },
    select: { id: true, overall_score: true },
    orderBy: { overall_score: 'desc' },
  });
  const rank = siblings.findIndex((s) => s.id === assessment.id) + 1;

  // Demand Discovery v5 rows carry their own rank, status and five-part breakdown (docs/36).
  const v5: V5Detail | null = isV5Assessment(assessment)
    ? v5Detail(assessment, await prisma.marketAssessment.count({ where: { run_id: assessment.run_id, market_status: 'ranked' } }))
    : null;

  const snapshot = assessment.run.input_snapshot as { description?: string | null } | null;

  return (
    <MarketDetail
      tier={tier}
      assessment={{
        id: assessment.id,
        country_code: assessment.country_code,
        overall_score: assessment.overall_score,
        demand_score: assessment.demand_score,
        growth_score: assessment.growth_score,
        competition_score: assessment.competition_score,
        india_share: assessment.india_share?.toString() ?? null,
        tariff_summary: assessment.tariff_summary as Record<string, unknown> | null,
        certification_requirements: assessment.certification_requirements as unknown[],
        logistics_summary: assessment.logistics_summary as Record<string, unknown> | null,
        price_band: assessment.price_band_min
          ? {
              min: assessment.price_band_min.toString(),
              max: assessment.price_band_max?.toString() ?? null,
              currency: assessment.price_band_currency,
            }
          : null,
        rationale: assessment.rationale,
        agent_note: assessment.agent_note,
        generated_at: assessment.generated_at.toISOString(),
        is_selected: assessment.is_selected,
        is_saved: assessment.saved_at !== null,
        rank: v5 ? v5.rank : rank,
        total_ranked: v5 ? v5.total_ranked : siblings.length,
        evidence_warning:!isRealWorkflowEnvironment()&&unsafeEvidenceOrigins(assessment.evidence_origins).length?`Non-real evidence: ${unsafeEvidenceOrigins(assessment.evidence_origins).join(', ')}`:null,
      }}
      buyerDiscoveryHref={{
        productId: assessment.product?.id ?? null,
        countryCode: assessment.country_code,
      }}
      productDescription={snapshot?.description ?? assessment.product?.name ?? null}
      v5={v5}
    />
  );
}
