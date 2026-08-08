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
    where: { id: marketAssessmentId, ...scope },
    include: {
      run: { select: { id: true, status: true, product_id: true, input_snapshot: true } },
      product: { select: { id: true, name: true } },
    },
  });
  if (!assessment) notFound();

  // Rank among this run's other results — EXP-05's decision header names it explicitly.
  const siblings = await prisma.marketAssessment.findMany({
    where: { run_id: assessment.run_id },
    select: { id: true, overall_score: true },
    orderBy: { overall_score: 'desc' },
  });
  const rank = siblings.findIndex((s) => s.id === assessment.id) + 1;

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
        rank,
        total_ranked: siblings.length,
      }}
      buyerDiscoveryHref={{
        productId: assessment.product?.id ?? null,
        countryCode: assessment.country_code,
      }}
      productDescription={snapshot?.description ?? assessment.product?.name ?? null}
    />
  );
}
