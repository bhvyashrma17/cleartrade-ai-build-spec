/**
 * Evidence for one shipment milestone (EXP-14 "Upload requested evidence"). Reuses the
 * same local-disk storage seam EXP-12's document uploads use
 * (`src/lib/document-storage.ts`) — a milestone's evidence file is exactly the same kind
 * of object as an uploaded document, just attached to a different parent.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { readStoredFile, saveUploadedFile } from '@/lib/document-storage';
import { loadDealScoped } from '@/lib/documents';
import { errorResponse, forbidden, newCorrelationId, notFound, single, validationError } from '@/lib/errors';
import { assertCan, canDownloadDocument } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

async function loadMilestoneScoped(dealId: string, milestoneId: string) {
  const milestone = await prisma.shipmentMilestone.findUnique({
    where: { id: milestoneId },
    include: { shipment: { select: { id: true, deal_id: true } } },
  });
  if (!milestone || milestone.shipment.deal_id !== dealId) throw notFound('That milestone is not available.');
  return milestone;
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ dealId: string; milestoneId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, milestoneId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    assertCan(principal, 'shipment.update');
    const milestone = await loadMilestoneScoped(dealId, milestoneId);

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!file || !(file instanceof File)) {
      throw validationError([{ field: 'file', code: 'required', message: 'Choose a file to upload.' }]);
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const stored = await saveUploadedFile(bytes, file.name,file.type);

    const updated = await prisma.shipmentMilestone.update({
      where: { id: milestone.id },
      data: { evidence_ref: stored.file_ref },
    });

    await writeAuditEvent({
      actor: principal,
      action: AUDIT_ACTIONS.update,
      object_type: 'shipment_milestone',
      object_id: milestone.id,
      exporter_org_id: deal.exporter_org_id,
      after_summary: { deal_id: dealId, milestone_code: milestone.code, file_name: file.name },
      correlation_id: correlationId,
    });

    return NextResponse.json(single(updated), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}

export async function GET(_request: NextRequest, ctx: { params: Promise<{ dealId: string; milestoneId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { dealId, milestoneId } = await ctx.params;
    const deal = await loadDealScoped(principal, dealId);
    if (!(await canDownloadDocument(principal, { deal }))) throw forbidden('You do not have access to this file.');

    const milestone = await loadMilestoneScoped(dealId, milestoneId);
    if (!milestone.evidence_ref) throw validationError([{ field: 'evidence', code: 'not_found', message: 'No evidence has been uploaded for this milestone.' }]);

    const bytes = await readStoredFile(milestone.evidence_ref);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${milestone.code}-evidence"`,
        'x-correlation-id': correlationId,
      },
    });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
