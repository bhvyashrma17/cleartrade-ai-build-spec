/**
 * GET /api/v1/messages — cross-deal message index (docs/13 A1). `Message` is
 * structurally exporter-visible only (internal negotiation lives in `InternalNote`, a
 * separate table — see prisma/schema.prisma), so there is no visibility filter to get
 * wrong here the way there is for tasks.
 *
 * Deep links to the originating thread would land in the Deal Workspace or a buyer-lead
 * detail page, neither of which exists yet — rows are read-only until one does.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { resolvePagination } from '@/lib/config';
import { errorResponse, list, newCorrelationId, pageMeta } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'message.view');

    const params = request.nextUrl.searchParams;
    const { page, per_page, skip, take } = await resolvePagination({
      page: params.get('page'),
      per_page: params.get('per_page'),
    });

    const where = { exporter_org_id: principal.exporter_org_id };

    const [rows, total] = await Promise.all([
      prisma.message.findMany({
        where,
        include: {
          author: { select: { name: true, role: true } },
          deal: { select: { id: true, buyer: { select: { display_name: true } } } },
          buyer_lead: { select: { id: true, buyer: { select: { display_name: true } } } },
        },
        orderBy: { created_at: 'desc' },
        skip,
        take,
      }),
      prisma.message.count({ where }),
    ]);

    const data = rows.map((message) => ({
      id: message.id,
      body: message.body,
      created_at: message.created_at,
      read_at: message.read_at,
      author_name: message.author.name,
      thread_label: message.deal
        ? `Deal ${message.deal.id.slice(-6)} · ${message.deal.buyer.display_name}`
        : message.buyer_lead
          ? `Lead · ${message.buyer_lead.buyer.display_name}`
          : 'Conversation',
    }));

    return NextResponse.json(list(data, { ...pageMeta({ page, per_page, total }) }), {
      headers: { 'x-correlation-id': correlationId },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
