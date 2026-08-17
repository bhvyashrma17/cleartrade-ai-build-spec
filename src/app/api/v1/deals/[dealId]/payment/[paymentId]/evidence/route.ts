/**
 * EXP-15 "Upload evidence" — bank/payment proof, stored the same way EXP-12's document
 * uploads and EXP-14's milestone evidence are (`src/lib/document-storage.ts`).
 *
 * Each upload appends a `{ ref, name, uploaded_at, uploaded_by }` entry to
 * `Payment.evidence_refs` rather than replacing it — every proof a buyer payment ever
 * had stays visible, the same "preserve history" rule the document checklist follows.
 * `GET ?ref=` only serves a ref that is actually present in that array, so a caller
 * cannot smuggle in an arbitrary stored-file path that happens to belong to a different
 * payment or deal.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { readStoredFile, saveUploadedFile } from '@/lib/document-storage';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, canDownloadDocument } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

interface EvidenceEntry {
  ref: string;
  name: string;
  uploaded_at: string;
  uploaded_by: string;
}

async function loadPaymentScoped(dealId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, deal_id: dealId } });
  if (!payment) throw notFound('That payment is not available.');
  return payment;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; paymentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, paymentId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'payment.update');
    const payment = await loadPaymentScoped(dealId, paymentId);

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || !(file instanceof File)) {
      throw validationError([{ field: 'file', code: 'required', message: 'Choose a file to upload.' }]);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await saveUploadedFile(bytes, file.name,file.type);
    const existing = Array.isArray(payment.evidence_refs) ? (payment.evidence_refs as unknown as EvidenceEntry[]) : [];
    const entry: EvidenceEntry = { ref: stored.file_ref, name: file.name, uploaded_at: new Date().toISOString(), uploaded_by: principal.id };

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.payment.update({
        where: { id: payment.id },
        data: { evidence_refs: [...existing, entry] as never },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'payment',
        object_id: payment.id,
        exporter_org_id: deal.exporter_org_id,
        after_summary: { deal_id: dealId, evidence_file: file.name },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ dealId: string; paymentId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, paymentId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    if (!(await canDownloadDocument(principal, { deal }))) throw forbidden('You do not have access to this file.');
    const payment = await loadPaymentScoped(dealId, paymentId);

    const ref = request.nextUrl.searchParams.get('ref');
    const entries = Array.isArray(payment.evidence_refs) ? (payment.evidence_refs as unknown as EvidenceEntry[]) : [];
    const entry = entries.find((e) => e.ref === ref);
    if (!ref || !entry) throw notFound('That evidence file is not available.');

    const bytes = await readStoredFile(entry.ref);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${entry.name}"`,
        'x-correlation-id': correlationId,
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
