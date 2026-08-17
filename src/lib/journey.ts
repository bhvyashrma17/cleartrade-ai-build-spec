/**
 * Journey stage derivation (docs/02, docs/13 A4, EXP-01-AC01).
 *
 * `ExporterOrg.journey_stage` is a stored column, but nothing in this codebase writes to
 * it outside the seed script — there is no readiness-submission route, no deal-lock
 * route, no shipment/payment route yet that would keep it current. Trusting the stored
 * value would mean rendering a stale or fabricated stage.
 *
 * EXP-01-AC01 is explicit: "Journey stage is computed from backend status and is not
 * manually set by the frontend." The honest way to satisfy that today, given the stored
 * column isn't maintained, is to compute it fresh from real signals on every read — on
 * the server, in this one place — rather than trust a column no mutation updates, and
 * rather than ship stage-inference logic to the client. Once readiness/deal/shipment/
 * payment routes exist, they can call this same function to keep the stored column in
 * sync as a cache; until then, deriving on read is the correct source of truth.
 *
 * The 8 canonical states (docs/13 A4): onboarding, ready, market_selected, buyer_engaged,
 * deal_locked, docs_cleared, shipped, payment_realized — checked here in *reverse* order,
 * most-advanced signal wins, since a later stage implies every earlier one happened.
 */

import { BuyerLeadStage, DealStage, JourneyStage, PaymentStatus, ShipmentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins,isRealWorkflowEnvironment,nonRealEvidenceOrigins } from '@/lib/evidence-environment';

/** BuyerLead stages that represent real engagement, not just a saved shortlist. */
const ENGAGED_LEAD_STAGES: BuyerLeadStage[] = [
  BuyerLeadStage.contacted,
  BuyerLeadStage.replied,
  BuyerLeadStage.interested,
  BuyerLeadStage.negotiation,
  BuyerLeadStage.converted,
];

const SHIPPED_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.loaded,
  ShipmentStatus.in_transit,
  ShipmentStatus.arrived,
  ShipmentStatus.delivered,
];

export async function deriveJourneyStage(exporterOrgId: string): Promise<JourneyStage> {
  const [org, hasRealizedPayment, hasShippedSignal, dealStageCounts, engagedLeadCount, hasSelectedMarket] =
    await Promise.all([
      prisma.exporterOrg.findUnique({ where: { id: exporterOrgId }, select: { readiness_status: true } }),
      prisma.payment.count({
        where: { status: PaymentStatus.realized, deal: { exporter_org_id: exporterOrgId } },
      }),
      prisma.shipment.count({
        where: { status: { in: SHIPPED_STATUSES }, deal: { exporter_org_id: exporterOrgId } },
      }),
      prisma.deal.groupBy({
        by: ['stage'],
        where: { exporter_org_id: exporterOrgId },
        _count: true,
      }),
      prisma.buyerLead.count({
        where: { exporter_org_id: exporterOrgId, stage: { in: ENGAGED_LEAD_STAGES } },
      }),
      prisma.marketAssessment.count({
        where: { is_selected: true, run: { exporter_org_id: exporterOrgId },...(isRealWorkflowEnvironment()?{evidence_origins:{hasSome:allowedEvidenceOrigins()},NOT:{evidence_origins:{hasSome:nonRealEvidenceOrigins()}}}:{}) },
      }),
    ]);

  const dealStages = new Set(dealStageCounts.map((r) => r.stage));
  const hasAnyDeal = dealStageCounts.length > 0;

  if (hasRealizedPayment > 0) return JourneyStage.payment_realized;
  if (hasShippedSignal > 0 || dealStages.has(DealStage.shipped)) return JourneyStage.shipped;
  if (dealStages.has(DealStage.executing)) return JourneyStage.docs_cleared;
  if (dealStages.has(DealStage.deal_locked)) return JourneyStage.deal_locked;
  if (engagedLeadCount > 0 || hasAnyDeal) return JourneyStage.buyer_engaged;
  if (hasSelectedMarket > 0) return JourneyStage.market_selected;
  if (org?.readiness_status === 'ready') return JourneyStage.ready;
  return JourneyStage.onboarding;
}
