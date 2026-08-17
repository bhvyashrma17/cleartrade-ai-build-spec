import { BuyerLeadStage, EvidenceOrigin, type Prisma } from '@prisma/client';
import { outcomeOriginForRuntime } from '@/lib/evidence-environment';

export function createBuyerOutcomeForLead(tx:Prisma.TransactionClient,lead:{id:string;buyer_id:string;exporter_org_id:string},evidenceOrigin:EvidenceOrigin=outcomeOriginForRuntime()){
  return tx.buyerOutcome.create({data:{buyer_lead_id:lead.id,buyer_id:lead.buyer_id,exporter_org_id:lead.exporter_org_id,evidence_origin:evidenceOrigin}});
}

export async function recordBuyerOutcomeTransition(
  tx: Prisma.TransactionClient,
  lead: { id: string; buyer_id: string; exporter_org_id: string; stage?: BuyerLeadStage },
  stage: BuyerLeadStage,
  at = new Date(),
  rejectionReason?: string | null,
  evidenceOrigin:EvidenceOrigin=outcomeOriginForRuntime(),
  actorUserId?: string | null,
  dealId?: string | null,
) {
  const data = {
    ...(stage === BuyerLeadStage.contacted ? { contacted_at: at } : {}),
    ...(stage === BuyerLeadStage.replied ? { replied_at: at } : {}),
    ...(stage === BuyerLeadStage.converted ? { converted: true, deal_id: dealId ?? undefined } : {}),
    ...(stage === BuyerLeadStage.disqualified ? { converted: false, rejection_reason: rejectionReason ?? 'unspecified' } : {}),
  };
  const outcome = await tx.buyerOutcome.upsert({
    where: { buyer_lead_id: lead.id },
    create: { buyer_lead_id: lead.id, buyer_id: lead.buyer_id, exporter_org_id: lead.exporter_org_id,evidence_origin:evidenceOrigin, ...data },
    update: data,
  });
  await tx.buyerLeadTransition.create({ data: { buyer_lead_id: lead.id, from_stage: lead.stage ?? null, to_stage: stage, actor_user_id: actorUserId ?? null, reason: rejectionReason ?? null, occurred_at: at } });
  return outcome;
}

/** Derive payment feedback only from canonical Payment rows; callers cannot supply a reputation label. */
export async function recordBuyerPaymentEvidence(
  tx: Prisma.TransactionClient,
  dealId: string,
  payment: { id: string; status: string; source: string; amount_received: unknown; received_at: Date | null; realized_at: Date | null },
) {
  const outcome = await tx.buyerOutcome.findFirst({ where: { deal_id: dealId } });
  if (!outcome) return null;
  const prior = Array.isArray(outcome.payment_evidence) ? outcome.payment_evidence : [];
  const evidence = { payment_id: payment.id, status: payment.status, source: payment.source, amount_received: payment.amount_received == null ? null : String(payment.amount_received), received_at: payment.received_at?.toISOString() ?? null, realized_at: payment.realized_at?.toISOString() ?? null, observed_at: new Date().toISOString() };
  return tx.buyerOutcome.update({ where: { id: outcome.id }, data: { payment_evidence: [...prior, evidence], payment_behavior: payment.status === 'realized' ? 'payment_realized' : payment.status === 'overdue' ? 'payment_overdue' : null } });
}
