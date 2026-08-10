/**
 * POST /api/v1/buyer-shortlists — EXP-07 "Shortlist". Idempotent per docs/04's own
 * action table: the DB's `@@unique([exporter_org_id, buyer_id, product_id])` means a
 * second shortlist of the same buyer (for the same product context, or none) is a
 * silent no-op via `upsert`, never a duplicate row or an error.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, assertPermitted, canAccessOrg } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createBuyerShortlistSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'buyer_shortlist.create');
    const orgId = principal.exporter_org_id as string;
    await assertPermitted(canAccessOrg(principal, orgId));

    const body = await request.json().catch(() => null);
    const parsed = createBuyerShortlistSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const { buyer_id, product_id } = parsed.data;

    const buyer = await prisma.buyer.findUnique({ where: { id: buyer_id }, select: { id: true } });
    if (!buyer) throw notFound('That buyer is not available.');

    if (product_id) {
      const product = await prisma.product.findFirst({ where: { id: product_id, exporter_org_id: orgId } });
      if (!product) throw notFound('That product is not available.');
    }

    const shortlist = await prisma.$transaction(async (tx) => {
      // Postgres treats NULL as distinct from any other NULL in a unique index, so
      // Prisma's compound-unique lookup can't take a null `product_id` — a
      // find-then-create is the null-safe equivalent of the upsert above.
      const row = product_id
        ? await tx.buyerShortlist.upsert({
            where: { exporter_org_id_buyer_id_product_id: { exporter_org_id: orgId, buyer_id, product_id } },
            update: {},
            create: { exporter_org_id: orgId, buyer_id, product_id, created_by_id: principal.id },
          })
        : ((await tx.buyerShortlist.findFirst({ where: { exporter_org_id: orgId, buyer_id, product_id: null } })) ??
          (await tx.buyerShortlist.create({ data: { exporter_org_id: orgId, buyer_id, product_id: null, created_by_id: principal.id } })));
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'buyer_shortlist',
        object_id: row.id,
        exporter_org_id: orgId,
        after_summary: { buyer_id, product_id: product_id ?? null },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(shortlist), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
