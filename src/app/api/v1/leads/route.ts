/**
 * GET /api/v1/leads — AGT-03 Outreach CRM pipeline listing.
 *
 * Agent-only: this is the CRM view of "my assigned exporters' leads", not a general
 * lead-search endpoint. Scoping comes from `tenantScope()` — the single source of
 * truth for "which orgs can this principal see" — never from a client-supplied
 * exporter_org_id (docs/09 §5, AGENTS.md "search endpoints... most commonly missed").
 */

import { BuyerLeadStage } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requirePortalAccess } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { tenantScope } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePortalAccess('/agent');
    const params = request.nextUrl.searchParams;

    const stage = params.get('stage');
    if (stage && !Object.values(BuyerLeadStage).includes(stage as BuyerLeadStage)) {
      throw validationError([
        { field: 'stage', code: 'invalid', message: `Must be one of: ${Object.values(BuyerLeadStage).join(', ')}.` },
      ]);
    }
    // AGT-02 "buyer pipeline opens Outreach CRM filtered to this exporter" — intersected
    // with tenantScope() below, never used on its own, so a client-supplied id outside
    // the agent's assigned orgs simply matches nothing rather than widening access.
    const exporterOrgId = params.get('exporter');

    const scope = await tenantScope(principal);
    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    // `scope` and the `exporter` filter both key on `exporter_org_id` — spreading them
    // into one object would let the second silently clobber the first (whichever key
    // is written last wins), which is exactly how a client-supplied id could widen
    // access instead of narrowing it. `AND` keeps both constraints independently
    // enforced: the row must satisfy the agent's tenant scope AND the requested filter.
    const where = {
      AND: [scope, ...(stage ? [{ stage: stage as BuyerLeadStage }] : []), ...(exporterOrgId ? [{ exporter_org_id: exporterOrgId }] : [])],
    };

    const [rows, total] = await Promise.all([
      prisma.buyerLead.findMany({
        where,
        include: {
          buyer: {
            select: {
              id: true,
              display_name: true,
              country_code: true,
              verification_status: true,
              risk_flags: true,
            },
          },
          product: { select: { id: true, name: true } },
          exporter_org: { select: { id: true, display_name: true } },
        },
        // Overdue/soonest next action first; leads with no next action sort last.
        orderBy: [{ next_action_at: { sort: 'asc', nulls: 'last' } }, { updated_at: 'desc' }],
        skip,
        take,
      }),
      prisma.buyerLead.count({ where }),
    ]);

    return NextResponse.json(list(rows, { ...pageMeta({ page, per_page, total }) }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
