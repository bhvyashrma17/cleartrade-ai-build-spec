/**
 * GET /api/v1/deals/:dealId/document-readiness — can each document be generated yet?
 *
 * A pure read. It builds the canonical context, evaluates every supported document type, and
 * returns machine-readable issues; it writes nothing, and — importantly — it does not allocate
 * an invoice number. Asking "is the commercial invoice ready?" must never have the side effect
 * of consuming an official number, which is why readiness reports a missing invoice number as
 * a gap instead of quietly filling it.
 */

import { NextResponse } from 'next/server';
import { DocType } from '@prisma/client';
import { requirePrincipal } from '@/lib/auth';
import { allDocumentReadiness, buildDocumentContext } from '@/lib/document-data';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single } from '@/lib/errors';
import { previewNextInvoiceNumber } from '@/lib/invoice-numbering';

export async function GET(_request: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);

    const context = await buildDocumentContext(principal, dealId, DocType.CI);
    const readiness = allDocumentReadiness(context);
    // Labelled `is_allocated: false` by its own type — a display value, never a document fact.
    const nextNumber = await previewNextInvoiceNumber(principal, deal.exporter_org_id);

    return NextResponse.json(
      single({
        deal_id: dealId,
        readiness,
        invoice_number: {
          issued: context.references.invoice_number,
          next_preview: nextNumber.preview_number,
          series_key: nextNumber.series_key,
        },
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
