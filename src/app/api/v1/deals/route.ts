/**
 * GET /api/v1/deals — EXP-08 Deals List. Every deal in the exporter's own tenant, with
 * the filters, next-action and portfolio aggregates the screen needs. Rows deep-link
 * into the Deal Workspace at `/app/deals/:dealId` (EXP-09).
 */

import { DealStage, RiskState, TaskState } from '@prisma/client';
import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { ACTIVE_DEAL_STAGES } from '@/lib/state-machines/deal';

const OPEN_TASK_STATES: TaskState[] = [TaskState.not_started, TaskState.in_progress, TaskState.waiting];

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'deal.view');

    const params = request.nextUrl.searchParams;
    const stage = params.get('stage');
    const risk = params.get('risk');
    const country = params.get('country')?.trim().toUpperCase() || null;
    const buyerSearch = params.get('buyer')?.trim() || null;
    const updatedAfterRaw = params.get('updated_after');

    if (stage && !Object.values(DealStage).includes(stage as DealStage)) {
      throw validationError([{ field: 'stage', code: 'invalid', message: `Must be one of: ${Object.values(DealStage).join(', ')}.` }]);
    }
    if (risk && !Object.values(RiskState).includes(risk as RiskState)) {
      throw validationError([{ field: 'risk', code: 'invalid', message: `Must be one of: ${Object.values(RiskState).join(', ')}.` }]);
    }
    let updatedAfter: Date | null = null;
    if (updatedAfterRaw) {
      updatedAfter = new Date(updatedAfterRaw);
      if (Number.isNaN(updatedAfter.getTime())) {
        throw validationError([{ field: 'updated_after', code: 'invalid', message: 'Must be a valid date (YYYY-MM-DD).' }]);
      }
    }

    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const where = {
      exporter_org_id: principal.exporter_org_id,
      ...(stage ? { stage: stage as DealStage } : {}),
      ...(risk ? { risk_state: risk as RiskState } : {}),
      ...(country ? { buyer: { country_code: country } } : {}),
      ...(buyerSearch ? { buyer: { display_name: { contains: buyerSearch, mode: 'insensitive' as const } } } : {}),
      ...(updatedAfter ? { updated_at: { gte: updatedAfter } } : {}),
    };

    const [rows, total, summaryRows] = await Promise.all([
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
      // Portfolio aggregate — unfiltered by the row filters above, same as a dashboard
      // KPI: it answers "how is the whole pipeline doing", not "how do these filtered
      // rows sum". Grouped by currency rather than summed across currencies, which
      // would silently add USD to INR — the same "never fabricate a value" rule EXP-04
      // states explicitly for market data applies here too.
      prisma.deal.groupBy({
        by: ['stage', 'value_currency'],
        where: { exporter_org_id: principal.exporter_org_id },
        _sum: { value_amount: true },
        _count: true,
      }),
    ]);

    const dealIds = rows.map((d) => d.id);
    const nextActions = dealIds.length
      ? await prisma.task.findMany({
          where: {
            deal_id: { in: dealIds },
            visibility: 'exporter_visible',
            state: { in: OPEN_TASK_STATES },
          },
          orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
          select: { deal_id: true, title: true, due_at: true, sla_state: true },
        })
      : [];
    // First (highest-priority) open task per deal — the query is already sorted, so the
    // first occurrence per deal_id in iteration order is the one to surface.
    const nextActionByDeal = new Map<string, (typeof nextActions)[number]>();
    for (const task of nextActions) {
      if (task.deal_id && !nextActionByDeal.has(task.deal_id)) nextActionByDeal.set(task.deal_id, task);
    }

    const data = rows.map((deal) => {
      const nextAction = nextActionByDeal.get(deal.id) ?? null;
      return {
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
        next_action: nextAction
          ? { title: nextAction.title, due_at: nextAction.due_at, sla_state: nextAction.sla_state }
          : null,
      };
    });

    // Open value grouped by currency; negotiating/executing counts across the WHOLE
    // tenant (docs/04 EXP-08 "Summary … Server aggregate").
    const openValueByCurrency = new Map<string, number>();
    let negotiatingCount = 0;
    let executingCount = 0;
    for (const row of summaryRows) {
      if ((ACTIVE_DEAL_STAGES as string[]).includes(row.stage) && row.value_currency && row._sum.value_amount) {
        openValueByCurrency.set(
          row.value_currency,
          (openValueByCurrency.get(row.value_currency) ?? 0) + Number(row._sum.value_amount),
        );
      }
      if (row.stage === DealStage.negotiating) negotiatingCount += row._count;
      if (row.stage === DealStage.executing) executingCount += row._count;
    }

    return NextResponse.json(
      list(data, {
        ...pageMeta({ page, per_page, total }),
        summary: {
          open_value: [...openValueByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
          negotiating_count: negotiatingCount,
          executing_count: executingCount,
        },
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
