/**
 * POST /api/v1/deals/:dealId/exchange-rates — record an exchange rate with its provenance.
 *
 * Append-only: a wrong rate is superseded by recording a new one, never edited. A document
 * already issued against the old rate has to stay explainable, and the builder picks the most
 * recent quote whose `rate_date` is on or before the document's date, so a correction applies
 * going forward without rewriting history.
 *
 * The rate is tenant-scoped rather than global because ClearTrade has no rate feed. What is
 * recorded is what THIS exporter's bank quoted or what an operator read off a notification —
 * an assertion by a named person, stored with `recorded_by_id`, not a system fact.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { recordExchangeRateSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'payment.update');

    const body = await request.json().catch(() => null);
    const parsed = recordExchangeRateSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const quote = await prisma.$transaction(async (tx) => {
      const row = await tx.exchangeRateQuote.create({
        data: {
          exporter_org_id: deal.exporter_org_id,
          base_currency: input.base_currency,
          quote_currency: input.quote_currency,
          rate: new Prisma.Decimal(input.rate),
          source: input.source,
          source_reference: input.source_reference ?? null,
          rate_date: new Date(input.rate_date),
          recorded_by_id: principal.id,
          correlation_id: correlationId,
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'exchange_rate_quote',
        object_id: row.id,
        exporter_org_id: deal.exporter_org_id,
        // The full rate IS the auditable fact — its whole purpose is to be checkable later.
        after_summary: {
          pair: `${row.base_currency}/${row.quote_currency}`,
          rate: row.rate.toString(),
          source: row.source,
          source_reference: row.source_reference,
          rate_date: row.rate_date.toISOString(),
        },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(quote), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
