/**
 * POST /api/v1/buyer-leads — EXP-06 "Create lead" / AGT-04 conversion-adjacent creation.
 *
 * Duplicate prevention is two-layered on purpose: a pre-check gives the friendly
 * DUPLICATE_LEAD response with a link to the existing record in the common case,
 * and the DB's `@@unique([exporter_org_id, product_id, buyer_id])` (docs/07 §7.1
 * EXP-07-AC02) is what actually prevents it under a race — caught below and turned
 * into the same response rather than a raw 500. The request body is a stream that
 * can only be read once, so the fields the race-recovery path needs are captured in
 * an outer variable rather than re-read from `request` in the catch block.
 */

import { Prisma } from '@prisma/client';
import { OrgTier } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, summarize, writeAuditEvent } from '@/lib/audit';
import { duplicateLead, errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, assertPermitted, canCreateBuyerLead, isAgent, isExporter } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { allowedEvidenceOrigins,isRealWorkflowEnvironment,nonRealEvidenceOrigins,outcomeOriginForRuntime } from '@/lib/evidence-environment';
import { createBuyerLeadSchema, zodFieldErrors } from '@/lib/validators';
import { createBuyerOutcomeForLead } from '@/lib/buyer-outcomes';
import type { Principal } from '@/types';

/** Where a duplicate on this buyer sends the caller (docs/12 route registry). */
function existingLeadDeepLink(args: { isAgentCaller: boolean; leadId: string; buyerId: string }): string {
  return args.isAgentCaller ? `/agent/leads/${args.leadId}` : `/app/buyers/${args.buyerId}`;
}

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();

  // Populated inside the try so the P2002 race-recovery path below can reuse them
  // without touching the (already-consumed) request body again.
  let principal: Principal | null = null;
  let exporterOrgId: string | null = null;
  let productId: string | null = null;
  let buyerId: string | null = null;

  try {
    principal = await requirePrincipal();

    const json = await request.json().catch(() => null);
    const parsed = createBuyerLeadSchema.safeParse(json);
    if (!parsed.success) {
      throw validationError(zodFieldErrors(parsed.error));
    }
    productId = parsed.data.product_id;
    buyerId = parsed.data.buyer_id;

    // Never trust a client-supplied org id for an exporter principal.
    exporterOrgId = isExporter(principal) ? (principal.exporter_org_id as string) : (parsed.data.exporter_org_id ?? null);
    if (!exporterOrgId) {
      throw validationError([
        { field: 'exporter_org_id', code: 'required', message: 'exporter_org_id is required.' },
      ]);
    }

    // Two checks, in this order, because they fail differently:
    //   assertCan  -> capability + tier. Throws FORBIDDEN for a role denial and
    //                 UPGRADE_REQUIRED (with required_tier) for a tier denial, which is
    //                 what lets the client render an upsell instead of a dead end.
    //   predicate  -> tenant scope only. A boolean can't carry the reason, so calling it
    //                 alone would collapse "wrong plan" into a bare FORBIDDEN.
    assertCan(principal, 'buyer_lead.create');
    await assertPermitted(canCreateBuyerLead(principal, { exporter_org_id: exporterOrgId }));

    const [product, buyer, existing,safeFit] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId }, include: { certifications: true } }),
      prisma.buyer.findUnique({ where: { id: buyerId }, include: { source_evidence: true, feature_snapshot: true } }),
      prisma.buyerLead.findUnique({
        where: {
          exporter_org_id_product_id_buyer_id: { exporter_org_id: exporterOrgId, product_id: productId, buyer_id: buyerId },
        },
      }),
      prisma.buyerFitAssessment.findFirst({where:{buyer_id:buyerId,product_id:productId,exporter_org_id:exporterOrgId,...(isRealWorkflowEnvironment()?{score:{not:null},evidence_origins:{hasSome:allowedEvidenceOrigins()},NOT:{evidence_origins:{hasSome:nonRealEvidenceOrigins()}}}:{})},orderBy:{computed_at:'desc'}}),
    ]);

    // A product from another org is treated the same as a missing one — do not
    // confirm cross-tenant records exist (docs/09 §4).
    if (!product || product.exporter_org_id !== exporterOrgId) throw notFound('That product is not available.');
    if (!buyer) throw notFound('That buyer is not available.');
    if (!safeFit) throw notFound('That buyer is not available from verified evidence.');

    const [marketAssessment, sanctionsCase] = await Promise.all([
      prisma.marketAssessment.findFirst({
        where: { product_id: productId, country_code: buyer.country_code },
        orderBy: { generated_at: 'desc' },
      }),
      prisma.sanctionsScreeningCase.findFirst({ where: { buyer_id: buyerId }, orderBy: { created_at: 'desc' } }),
    ]);

    if (existing) {
      throw duplicateLead(
        existing.id,
        existingLeadDeepLink({ isAgentCaller: isAgent(principal), leadId: existing.id, buyerId }),
      );
    }

    // The org's currently assigned agent, if any (docs EXP-06: "If no agent assigned,
    // route to assignment queue or explain pending assignment" — the UI does that when
    // assigned_agent_id comes back null).
    //
    // Agent assignment is a PAID capability. A free tenant owns its own pipeline but has
    // no agent, so the lead is created unassigned rather than silently consuming agent
    // capacity the tenant hasn't paid for. `agent.assign` is the capability that says so,
    // and reading it here keeps the rule in the matrix rather than in this handler.
    const agentAssignmentAllowed = principal.tier === OrgTier.paid;
    const activeAssignment =
      isAgent(principal) || !agentAssignmentAllowed
        ? null
        : await prisma.agentAssignment.findFirst({
            where: { exporter_org_id: exporterOrgId, status: 'active' },
            orderBy: { started_at: 'desc' },
          });

    const lead = await prisma.$transaction(async (tx) => {
      const created = await tx.buyerLead.create({
        data: {
          exporter_org_id: exporterOrgId as string,
          product_id: productId as string,
          buyer_id: buyerId as string,
          assigned_agent_id: isAgent(principal!) ? principal!.id : (activeAssignment?.agent_user_id ?? null),
          created_by_id: principal!.id,
        },
      });
      await tx.buyerLeadSnapshot.create({
        data: {
          buyer_lead_id: created.id,
          exporter_org_id: created.exporter_org_id,
          product_id: created.product_id,
          buyer_id: created.buyer_id,
          destination_country: buyer.country_code,
          buyer_fit_assessment_id: safeFit.id,
          fit_model_version: safeFit.model_version,
          fit_score: safeFit.score,
          fit_confidence: safeFit.confidence_score,
          fit_components: safeFit.components === null ? undefined : safeFit.components as Prisma.InputJsonValue,
          fit_input_snapshot: safeFit.input_snapshot === null ? undefined : safeFit.input_snapshot as Prisma.InputJsonValue,
          buyer_rank: parsed.data.buyer_rank ?? null,
          market_assessment_id: marketAssessment?.id ?? null,
          market_context: marketAssessment ? { model_version: marketAssessment.model_version, weight_profile_version: marketAssessment.weight_profile_version, overall_score: marketAssessment.overall_score, confidence_score: marketAssessment.confidence_score, field_provenance: marketAssessment.field_provenance, generated_at: marketAssessment.generated_at.toISOString() } : undefined,
          sanctions_screening_case_id: sanctionsCase?.id ?? null,
          sanctions_result: sanctionsCase?.result_state ?? null,
          sanctions_algorithm_version: sanctionsCase?.algorithm_version ?? null,
          buyer_evidence_coverage: { source_evidence_count: buyer.source_evidence.length, has_feature_snapshot: Boolean(buyer.feature_snapshot), evidence: buyer.source_evidence.map((e) => ({ source_type: e.source_type, source_ref: e.source_ref, observed_at: e.observed_at.toISOString() })) },
          offered_price_amount: parsed.data.offered_price_amount ?? product.price_target_amount,
          offered_price_currency: parsed.data.offered_price_currency ?? product.price_target_currency,
          incoterm: parsed.data.incoterm ?? null,
          commercial_basis: parsed.data.commercial_basis ?? null,
          moq_value: product.moq_value,
          moq_unit: product.moq_unit,
          offered_order_size: parsed.data.offered_order_size ?? product.desired_order_size_amount,
          offered_order_size_unit: parsed.data.offered_order_size_unit ?? product.desired_order_size_currency,
          production_lead_time_days: product.lead_time_days,
          customization_claim: product.customization_capability,
          certification_claims: product.certifications.map((c) => ({ code: c.code, name: c.name, status: c.status, evidence_ref: c.evidence_ref, valid_until: c.valid_until?.toISOString() ?? null })),
        },
      });
      await tx.buyerLeadTransition.create({ data: { buyer_lead_id: created.id, from_stage: null, to_stage: created.stage, actor_user_id: principal!.id } });
      await createBuyerOutcomeForLead(tx,created,outcomeOriginForRuntime());

      await writeAuditEvent({
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'buyer_lead',
        object_id: created.id,
        exporter_org_id: exporterOrgId as string,
        after_summary: summarize(created, ['id', 'stage', 'product_id', 'buyer_id', 'assigned_agent_id']),
        correlation_id: correlationId,
        db: tx,
      });

      return created;
    });

    return NextResponse.json(single(lead), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    // The race-condition path: two concurrent requests both pass the pre-check and
    // both try to create the same (exporter_org_id, product_id, buyer_id) row. The
    // DB unique constraint rejects the second with P2002 — recover it into the same
    // DUPLICATE_LEAD response rather than a raw 500.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      principal &&
      exporterOrgId &&
      productId &&
      buyerId
    ) {
      const existing = await prisma.buyerLead.findUnique({
        where: {
          exporter_org_id_product_id_buyer_id: { exporter_org_id: exporterOrgId, product_id: productId, buyer_id: buyerId },
        },
      });
      if (existing) {
        return errorResponse(
          duplicateLead(
            existing.id,
            existingLeadDeepLink({ isAgentCaller: isAgent(principal), leadId: existing.id, buyerId }),
          ),
          correlationId,
        );
      }
    }
    return errorResponse(error, correlationId);
  }
}
