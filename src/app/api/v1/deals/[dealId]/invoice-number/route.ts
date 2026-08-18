/**
 * POST /api/v1/deals/:dealId/invoice-number — formally issue the deal's invoice number.
 * DELETE — void it.
 *
 * Issuance is its own explicit endpoint precisely so that nothing else can trigger it. There
 * is no "issue if absent" convenience inside the generation path: a number that can be
 * allocated as a side effect is a number that will be allocated by accident, which is how the
 * legacy system burned official numbers on abandoned drafts and then flagged the resulting
 * gaps as sequencing violations in its own audit report.
 *
 * Thin. Concurrency safety, the series advance, formatting and audit all live in
 * `src/lib/invoice-numbering.ts`, backed by two unique constraints and an immutability trigger.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { issueInvoiceNumber, issuedInvoiceNumberForDeal, voidInvoiceNumber } from '@/lib/invoice-numbering';
import { assertCan } from '@/lib/permissions';
import { voidInvoiceNumberSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(_request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    await loadDealScoped(principal, dealId);
    assertCan(principal, 'document.generate');

    const issued = await issueInvoiceNumber({ actor: principal, dealId, correlationId });
    return NextResponse.json(single(issued), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function DELETE(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    await loadDealScoped(principal, dealId);
    assertCan(principal, 'document.generate');

    const body = await request.json().catch(() => null);
    const parsed = voidInvoiceNumberSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    const live = await issuedInvoiceNumberForDeal(dealId);
    if (!live) throw notFound('This deal has no live invoice number.');

    const voided = await voidInvoiceNumber({
      actor: principal, issuedInvoiceNumberId: live.id, reason: parsed.data.reason, correlationId,
    });
    return NextResponse.json(single(voided), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
