/**
 * GET /api/v1/deals — cross-deal index view (docs/13 A1). Every deal in the exporter's
 * own tenant; rows deep-link into the Deal Workspace, which does not exist yet, so the
 * client renders each row read-only rather than linking to a 404.
 */

import { DealStage } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'deal.view');

    const params = request.nextUrl.searchParams;
    const stage = params.get('stage');
    if (stage && !Object.values(DealStage).includes(stage as DealStage)) {
      throw validationError([{ field: 'stage', code: 'invalid', message: `Must be one of: ${Object.values(DealStage).join(', ')}.` }]);
    }

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const where = {
      exporter_org_id: principal.exporter_org_id,
      ...(stage ? { stage: stage as DealStage } : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.deal.findMany({
        where,
        include: {
          buyer: { select: { display_name: true, country_code: true } },
          product: { select: { name: true } },
          owner_agent: { select: { name: true } },
        },
        orderBy: { updated_at: 'desc' },
        skip,
        take,
      }),
      prisma.deal.count({ where }),
    ]);

    const data = rows.map((deal) => ({
      id: deal.id,
      stage: deal.stage,
      risk_state: deal.risk_state,
      risk_reason: deal.risk_reason,
      value_amount: deal.value_amount,
      value_currency: deal.value_currency,
      buyer_name: deal.buyer.display_name,
      buyer_country: deal.buyer.country_code,
      product_name: deal.product?.name ?? null,
      owner_agent_name: deal.owner_agent?.name ?? null,
      updated_at: deal.updated_at,
    }));

    return NextResponse.json(list(data, { ...pageMeta({ page, per_page, total }) }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
