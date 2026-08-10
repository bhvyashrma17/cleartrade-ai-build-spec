/**
 * PATCH /api/v1/exporter-org — EXP-17 "Organization profile" edit.
 *
 * Deliberately limited to display/contact fields (`legal_name`, `state`, `city`).
 * `gstin`/`iec`/`iec_number` are NOT editable here — they are status-aware fields owned
 * by the readiness verification flow (docs/02: "a number entered on its own is not
 * verification"), and letting this form silently overwrite them would let an exporter
 * flip their own verification state by editing a text box.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateExporterOrgSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'exporter_master_data.edit');
    // `requireExporterPrincipal()` already pins this to the caller's own tenant — there
    // is no route param here to smuggle a different org id through.
    const orgId = principal.exporter_org_id as string;

    const body = await request.json().catch(() => null);
    const parsed = updateExporterOrgSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    if (Object.keys(input).length === 0) {
      throw validationError([{ field: 'legal_name', code: 'required', message: 'Nothing to update.' }]);
    }

    const before = await prisma.exporterOrg.findUniqueOrThrow({
      where: { id: orgId },
      select: { legal_name: true, state: true, city: true },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.exporterOrg.update({
        where: { id: orgId },
        data: {
          ...(input.legal_name !== undefined ? { legal_name: input.legal_name } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'exporter_org',
        object_id: orgId,
        exporter_org_id: orgId,
        before_summary: before,
        after_summary: { legal_name: row.legal_name, state: row.state, city: row.city },
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
