import { BuyerLeadStage, type Prisma } from '@prisma/client';

export async function recordBuyerOutcomeTransition(
  tx: Prisma.TransactionClient,
  lead: { id: string; buyer_id: string; exporter_org_id: string },
  stage: BuyerLeadStage,
  at = new Date(),
  rejectionReason?: string | null,
) {
  const data = {
    ...(stage === BuyerLeadStage.contacted ? { contacted_at: at } : {}),
    ...(stage === BuyerLeadStage.replied ? { replied_at: at } : {}),
    ...(stage === BuyerLeadStage.converted ? { converted: true } : {}),
    ...(stage === BuyerLeadStage.disqualified ? { converted: false, rejection_reason: rejectionReason ?? 'unspecified' } : {}),
  };
  return tx.buyerOutcome.upsert({
    where: { buyer_lead_id: lead.id },
    create: { buyer_lead_id: lead.id, buyer_id: lead.buyer_id, exporter_org_id: lead.exporter_org_id, ...data },
    update: data,
  });
}
