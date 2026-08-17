/**
 * Canonical BuyerLead creation.
 *
 * Extracted verbatim from `POST /api/v1/buyer-leads` so it has exactly ONE implementation. A
 * lead is not just a row: it carries a `BuyerLeadSnapshot` freezing the BuyerFit provenance,
 * market context, sanctions result and the commercial terms in force at creation, an opening
 * `BuyerLeadTransition`, a `BuyerOutcome` for the learning loop, and an audit event. Anything
 * that created a lead without those would produce a lead the rest of the product cannot reason
 * about — which is why the shortlist command calls this rather than writing its own.
 *
 * Caller supplies the transaction, so creation composes into a larger atomic command.
 */

import { Prisma, type Buyer, type BuyerFitAssessment, type BuyerSourceEvidence, type MarketAssessment, type Product, type ProductCertification, type SanctionsScreeningCase } from '@prisma/client';
import { AUDIT_ACTIONS, summarize, writeAuditEvent } from '@/lib/audit';
import { createBuyerOutcomeForLead } from '@/lib/buyer-outcomes';
import { outcomeOriginForRuntime } from '@/lib/evidence-environment';
import type { Principal } from '@/types';

export interface CreateBuyerLeadInput {
  actor: Principal;
  exporterOrgId: string;
  productId: string;
  buyerId: string;
  /** The verified BuyerFit assessment whose provenance is frozen onto the snapshot. */
  fit: BuyerFitAssessment;
  /** Product with its certifications, for the commercial terms on the snapshot. */
  product: Product & { certifications: ProductCertification[] };
  buyer: Buyer & { source_evidence: BuyerSourceEvidence[]; feature_snapshot: unknown };
  marketAssessment: MarketAssessment | null;
  sanctionsCase: SanctionsScreeningCase | null;
  /** Commercial overrides. Absent when a lead is created as a side effect of shortlisting. */
  commercial: {
    buyer_rank?: number | null;
    offered_price_amount?: Prisma.Decimal | number | null;
    offered_price_currency?: string | null;
    incoterm?: string | null;
    commercial_basis?: string | null;
    offered_order_size?: Prisma.Decimal | number | null;
    offered_order_size_unit?: string | null;
  };
  /** Null for an agent acting directly; otherwise the org's active assignment. */
  assignedAgentId: string | null;
  correlationId: string;
}

export async function createBuyerLeadCanonical(tx: Prisma.TransactionClient, input: CreateBuyerLeadInput) {
  const created = await tx.buyerLead.create({
    data: {
      exporter_org_id: input.exporterOrgId,
      product_id: input.productId,
      buyer_id: input.buyerId,
      assigned_agent_id: input.assignedAgentId,
      created_by_id: input.actor.id,
    },
  });
  await tx.buyerLeadSnapshot.create({
    data: {
      buyer_lead_id: created.id,
      exporter_org_id: created.exporter_org_id,
      product_id: created.product_id,
      buyer_id: created.buyer_id,
      destination_country: input.buyer.country_code,
      buyer_fit_assessment_id: input.fit.id,
      fit_model_version: input.fit.model_version,
      fit_score: input.fit.score,
      fit_confidence: input.fit.confidence_score,
      fit_components: input.fit.components === null ? undefined : input.fit.components as Prisma.InputJsonValue,
      fit_input_snapshot: input.fit.input_snapshot === null ? undefined : input.fit.input_snapshot as Prisma.InputJsonValue,
      buyer_rank: input.commercial.buyer_rank ?? null,
      market_assessment_id: input.marketAssessment?.id ?? null,
      market_context: input.marketAssessment ? { model_version: input.marketAssessment.model_version, weight_profile_version: input.marketAssessment.weight_profile_version, overall_score: input.marketAssessment.overall_score, confidence_score: input.marketAssessment.confidence_score, field_provenance: input.marketAssessment.field_provenance, generated_at: input.marketAssessment.generated_at.toISOString() } : undefined,
      sanctions_screening_case_id: input.sanctionsCase?.id ?? null,
      sanctions_result: input.sanctionsCase?.result_state ?? null,
      sanctions_algorithm_version: input.sanctionsCase?.algorithm_version ?? null,
      buyer_evidence_coverage: { source_evidence_count: input.buyer.source_evidence.length, has_feature_snapshot: Boolean(input.buyer.feature_snapshot), evidence: input.buyer.source_evidence.map((e) => ({ source_type: e.source_type, source_ref: e.source_ref, observed_at: e.observed_at.toISOString() })) },
      offered_price_amount: input.commercial.offered_price_amount ?? input.product.price_target_amount,
      offered_price_currency: input.commercial.offered_price_currency ?? input.product.price_target_currency,
      incoterm: input.commercial.incoterm ?? null,
      commercial_basis: input.commercial.commercial_basis ?? null,
      moq_value: input.product.moq_value,
      moq_unit: input.product.moq_unit,
      offered_order_size: input.commercial.offered_order_size ?? input.product.desired_order_size_amount,
      offered_order_size_unit: input.commercial.offered_order_size_unit ?? input.product.desired_order_size_currency,
      production_lead_time_days: input.product.lead_time_days,
      customization_claim: input.product.customization_capability,
      certification_claims: input.product.certifications.map((c) => ({ code: c.code, name: c.name, status: c.status, evidence_ref: c.evidence_ref, valid_until: c.valid_until?.toISOString() ?? null })),
    },
  });
  await tx.buyerLeadTransition.create({ data: { buyer_lead_id: created.id, from_stage: null, to_stage: created.stage, actor_user_id: input.actor.id } });
  await createBuyerOutcomeForLead(tx,created,outcomeOriginForRuntime());

  await writeAuditEvent({
    actor: input.actor,
    action: AUDIT_ACTIONS.create,
    object_type: 'buyer_lead',
    object_id: created.id,
    exporter_org_id: input.exporterOrgId,
    after_summary: summarize(created, ['id', 'stage', 'product_id', 'buyer_id', 'assigned_agent_id']),
    correlation_id: input.correlationId,
    db: tx,
  });

  return created;
}
