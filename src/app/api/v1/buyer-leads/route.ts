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
import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, summarize, writeAuditEvent } from '@/lib/audit';
import { duplicateLead, errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertPermitted, canCreateBuyerLead, isAgent, isExporter } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createBuyerLeadSchema, zodFieldErrors } from '@/lib/validators';
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

    await assertPermitted(canCreateBuyerLead(principal, { exporter_org_id: exporterOrgId }));

    const [product, buyer, existing] = await Promise.all([
      prisma.product.findUnique({ where: { id: productId } }),
      prisma.buyer.findUnique({ where: { id: buyerId } }),
      prisma.buyerLead.findUnique({
        where: {
          exporter_org_id_product_id_buyer_id: { exporter_org_id: exporterOrgId, product_id: productId, buyer_id: buyerId },
        },
      }),
    ]);

    // A product from another org is treated the same as a missing one — do not
    // confirm cross-tenant records exist (docs/09 §4).
    if (!product || product.exporter_org_id !== exporterOrgId) throw notFound('That product is not available.');
    if (!buyer) throw notFound('That buyer is not available.');

    if (existing) {
      throw duplicateLead(
        existing.id,
        existingLeadDeepLink({ isAgentCaller: isAgent(principal), leadId: existing.id, buyerId }),
      );
    }

    // The org's currently assigned agent, if any (docs EXP-06: "If no agent assigned,
    // route to assignment queue or explain pending assignment" — the UI does that when
    // assigned_agent_id comes back null).
    const activeAssignment = isAgent(principal)
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
