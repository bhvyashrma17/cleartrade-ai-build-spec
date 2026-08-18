/**
 * Invoice numbering — ClearTrade-owned, tenant-scoped, concurrency-safe.
 *
 * The legacy implementation (`lib/invoiceSequence.ts`) had the right RULES and the wrong
 * MECHANISM. It read `InvoiceSequence.nextNumber`, then wrote `nextNumber + 1` in a separate
 * statement with no transaction and no row lock, so two concurrent requests could both read
 * 41 and both issue `INV-000041`. The unique constraint that would have caught it did not
 * exist either. It also allocated a number when the invoice record was created, which meant
 * an abandoned draft burned an official number and left a gap that its own audit report then
 * flagged as a violation.
 *
 * What is kept: per-exporter series, configurable prefix/pad/suffix, financial-year series,
 * cancelled numbers never reused, and a durable record of every number handed out.
 *
 * What is replaced:
 *
 *   - allocation is a single atomic `UPDATE ... RETURNING` inside a transaction, so the
 *     database serialises concurrent issuance and each caller gets a distinct number;
 *   - two unique constraints make duplication impossible even if this file is wrong;
 *   - nothing on the preview / readiness / context-building path can reach this module, so
 *     rendering never consumes a number and a failed render costs nothing;
 *   - cancellation voids the row instead of deleting the invoice, and a trigger refuses to
 *     rewrite or un-void it.
 */

import { Prisma, type IssuedInvoiceNumber } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/**
 * Indian financial year, which is how exporters actually restart their numbering: 1 April to
 * 31 March, labelled by both years ("2026-27").
 */
export function financialYearKey(on: Date): string {
  const year = on.getUTCFullYear();
  const startYear = on.getUTCMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(
  series: { prefix: string; suffix: string; pad_length: number },
  sequenceNumber: number,
): string {
  return `${series.prefix}${String(sequenceNumber).padStart(series.pad_length, '0')}${series.suffix}`;
}

/**
 * Create the series if it does not exist, and take the next number from it — in ONE statement.
 *
 * The two halves cannot be separated. Prisma's `upsert` is a SELECT followed by an INSERT at
 * READ COMMITTED, so ten concurrent first-ever issuances all miss the SELECT and all attempt
 * the INSERT; nine fail on the unique constraint. `ON CONFLICT DO UPDATE` makes the insert and
 * the increment the same atomic operation, so the conflicting callers fall through to the
 * update and take 2, 3, 4 … instead of erroring.
 *
 * `RETURNING "next_number" - 1` hands back the value this caller just claimed, not the value
 * the next caller will get.
 */
async function claimNextSequence(
  db: Prisma.TransactionClient,
  exporterOrgId: string,
  seriesKey: string,
): Promise<{ id: string; sequence_number: number; prefix: string; suffix: string; pad_length: number }> {
  const rows = await db.$queryRaw<
    { id: string; next_number: number; prefix: string; suffix: string; pad_length: number }[]
  >`
    INSERT INTO "InvoiceSeries" ("id", "exporter_org_id", "series_key", "suffix", "next_number", "created_at", "updated_at")
    VALUES (gen_random_uuid()::text, ${exporterOrgId}, ${seriesKey}, ${`/${seriesKey}`}, 2, NOW(), NOW())
    ON CONFLICT ("exporter_org_id", "series_key")
    DO UPDATE SET "next_number" = "InvoiceSeries"."next_number" + 1, "updated_at" = NOW()
    RETURNING "id", "next_number" - 1 AS "next_number", "prefix", "suffix", "pad_length"
  `;
  const row = rows[0];
  if (!row) throw new Error('Invoice series could not be advanced.');
  return {
    id: row.id,
    // On a fresh insert the row starts at 2 and `next_number - 1` is 1 — the first number.
    sequence_number: row.next_number,
    prefix: row.prefix, suffix: row.suffix, pad_length: row.pad_length,
  };
}

/**
 * What the next number WOULD be, without consuming it.
 *
 * Safe to call from a UI, a readiness check or a preview: it takes no lock, advances nothing,
 * and is explicitly labelled as an estimate because a concurrent issuance can take it first.
 * This is the "draft document reference" the phase spec asks to distinguish from a formally
 * issued number — it is a display value and never appears in a document snapshot.
 */
export async function previewNextInvoiceNumber(
  principal: Principal,
  exporterOrgId: string,
  on: Date = new Date(),
): Promise<{ series_key: string; preview_number: string; is_allocated: false }> {
  await assertOrgAccess(principal, exporterOrgId);
  const seriesKey = financialYearKey(on);
  const series = await prisma.invoiceSeries.findUnique({
    where: { exporter_org_id_series_key: { exporter_org_id: exporterOrgId, series_key: seriesKey } },
  });
  const shape = series ?? { prefix: '', suffix: `/${seriesKey}`, pad_length: 5, next_number: 1 };
  return {
    series_key: seriesKey,
    preview_number: formatInvoiceNumber(shape, shape.next_number),
    is_allocated: false,
  };
}

/** The live official number for a deal, or null if none has been issued. */
export async function issuedInvoiceNumberForDeal(dealId: string): Promise<IssuedInvoiceNumber | null> {
  return prisma.issuedInvoiceNumber.findFirst({ where: { deal_id: dealId, voided_at: null } });
}

/**
 * Formally issue an invoice number for a deal.
 *
 * Deliberately explicit — there is no "issue if absent" convenience path, because a number
 * that can be allocated as a side effect is a number that will be allocated by accident.
 *
 * Concurrency: the `UPDATE ... RETURNING` below is one statement, so Postgres takes the row
 * lock itself and serialises concurrent callers. Two simultaneous requests get 41 and 42, not
 * 41 twice. The `@@unique([series_id, sequence_number])` index is the backstop if that ever
 * stops being true.
 */
export async function issueInvoiceNumber(input: {
  actor: Principal;
  dealId: string;
  correlationId: string;
  on?: Date;
}): Promise<IssuedInvoiceNumber> {
  const on = input.on ?? new Date();
  const deal = await prisma.deal.findUnique({
    where: { id: input.dealId },
    select: { id: true, exporter_org_id: true },
  });
  if (!deal) throw notFound('Deal not found.');
  await assertOrgAccess(input.actor, deal.exporter_org_id);

  // Ops and agents act for an exporter; a guest tenant has no invoicing at all.
  if (input.actor.role === 'exporter_member') {
    throw forbidden('Only the account owner, an assigned agent or Ops can issue an invoice number.');
  }

  const existing = await issuedInvoiceNumberForDeal(input.dealId);
  if (existing) {
    throw validationError(
      [{ field: 'deal_id', code: 'already_issued', message: `This deal already has invoice number ${existing.formatted_number}.` }],
      'An invoice number has already been issued for this deal.',
    );
  }

  const seriesKey = financialYearKey(on);

  return prisma.$transaction(async (tx) => {
    // Creating the series and taking a number are one atomic statement. Splitting them — or
    // splitting the read from the increment — is exactly the race the legacy implementation
    // shipped, and the one this returns 10 distinct numbers for under 10 concurrent callers.
    const series = await claimNextSequence(tx, deal.exporter_org_id, seriesKey);
    const sequenceNumber = series.sequence_number;

    const issued = await tx.issuedInvoiceNumber.create({
      data: {
        exporter_org_id: deal.exporter_org_id,
        series_id: series.id,
        deal_id: deal.id,
        sequence_number: sequenceNumber,
        formatted_number: formatInvoiceNumber(series, sequenceNumber),
        issued_by_id: input.actor.id,
        correlation_id: input.correlationId,
      },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.create,
      object_type: 'issued_invoice_number',
      object_id: issued.id,
      exporter_org_id: deal.exporter_org_id,
      after_summary: {
        deal_id: deal.id,
        formatted_number: issued.formatted_number,
        sequence_number: sequenceNumber,
        series_key: seriesKey,
      },
      correlation_id: input.correlationId,
    });

    return issued;
  });
}

/**
 * Void an issued number.
 *
 * The number is retired permanently: the series never reissues it, and the row stays as the
 * evidence of what was handed out and why it was withdrawn. That is the legacy
 * `CancelledInvoiceNumber` idea kept, minus the part where cancelling deleted the invoice.
 */
export async function voidInvoiceNumber(input: {
  actor: Principal;
  issuedInvoiceNumberId: string;
  reason: string;
  correlationId: string;
}): Promise<IssuedInvoiceNumber> {
  const reason = input.reason?.trim();
  if (!reason) {
    throw validationError([{ field: 'reason', code: 'required', message: 'Say why this number is being voided.' }]);
  }

  const row = await prisma.issuedInvoiceNumber.findUnique({ where: { id: input.issuedInvoiceNumberId } });
  if (!row) throw notFound('Invoice number not found.');
  await assertOrgAccess(input.actor, row.exporter_org_id);
  if (row.voided_at) {
    throw validationError(
      [{ field: 'id', code: 'already_voided', message: 'This number is already void.' }],
      'This invoice number is already void.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const voided = await tx.issuedInvoiceNumber.update({
      where: { id: row.id },
      data: { voided_at: new Date(), void_reason: reason, voided_by_id: input.actor.id },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.cancel,
      object_type: 'issued_invoice_number',
      object_id: row.id,
      exporter_org_id: row.exporter_org_id,
      before_summary: { formatted_number: row.formatted_number, voided: false },
      after_summary: { formatted_number: row.formatted_number, voided: true, reason },
      correlation_id: input.correlationId,
    });

    return voided;
  });
}

/**
 * Gap report for an exporter's series.
 *
 * Kept from the legacy audit report because the question is real — an auditor does ask "are
 * there missing numbers?" — but reduced to data. The legacy version returned a formatted
 * banner with verdict emoji embedded in the business layer; formatting belongs to whatever
 * renders it.
 */
export async function invoiceSequenceReport(principal: Principal, exporterOrgId: string, seriesKey?: string) {
  await assertOrgAccess(principal, exporterOrgId);
  const rows = await prisma.issuedInvoiceNumber.findMany({
    where: { exporter_org_id: exporterOrgId, ...(seriesKey ? { series: { series_key: seriesKey } } : {}) },
    orderBy: { sequence_number: 'asc' },
    select: { sequence_number: true, formatted_number: true, voided_at: true, issued_at: true },
  });

  const gaps: { from: number; to: number }[] = [];
  let expected = rows[0]?.sequence_number ?? 1;
  for (const row of rows) {
    if (row.sequence_number > expected) gaps.push({ from: expected, to: row.sequence_number - 1 });
    expected = row.sequence_number + 1;
  }

  return {
    total_issued: rows.length,
    total_voided: rows.filter((r) => r.voided_at !== null).length,
    // A void is not a gap: the number exists and its withdrawal is recorded. Only an absent
    // sequence position is a gap, and by construction there should never be one.
    gaps,
    rows,
  };
}
