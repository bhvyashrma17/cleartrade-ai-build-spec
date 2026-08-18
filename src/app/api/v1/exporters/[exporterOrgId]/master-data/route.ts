/**
 * PATCH /api/v1/exporters/:exporterOrgId/master-data — exporter facts documents consume.
 *
 * Separate from `PATCH /api/v1/exporter-org`, which is the exporter's own profile form and is
 * pinned to the caller's tenant. This route is org-addressed so an ASSIGNED AGENT can fix a
 * blocker on behalf of the exporter they support — which is the whole point of Part 13. Access
 * is `assertOrgAccess`, so an unassigned agent gets a 404 rather than a write.
 *
 * Scope is deliberately narrow: address parts and the AD code. `gstin`, `iec` and `iec_number`
 * stay out, exactly as they do on the exporter's own form — they are status-aware fields owned
 * by readiness verification, and a document blocker is not a reason to let a text box flip a
 * verification state.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateExporterMasterDataSchema, zodFieldErrors } from '@/lib/validators';

const TRACKED = {
  address_line1: true, address_line2: true, city: true, state: true,
  postal_code: true, ad_code: true,
} as const;

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ exporterOrgId: string }> }) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    const { exporterOrgId } = await ctx.params;
    await assertOrgAccess(principal, exporterOrgId);
    assertCan(principal, 'exporter_master_data.edit');

    const body = await request.json().catch(() => null);
    const parsed = updateExporterMasterDataSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));

    // Only keys actually present in the request are written. Sending `{city: null}` clears the
    // city; omitting it leaves it alone. Without this an edit to one field would blank the rest.
    const data = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(data).length === 0) {
      throw validationError([{ field: 'ad_code', code: 'required', message: 'Nothing to update.' }]);
    }

    const before = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: exporterOrgId }, select: TRACKED });

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.exporterOrg.update({ where: { id: exporterOrgId }, data, select: { id: true, ...TRACKED } });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'exporter_org',
        object_id: exporterOrgId,
        exporter_org_id: exporterOrgId,
        // Regulatory identifiers are exactly the changes an auditor needs to see, so the
        // before/after is recorded in full. Nothing here is a secret or personal data.
        before_summary: before,
        after_summary: row,
        correlation_id: correlationId,
      });
      return row;
    });

    return NextResponse.json(single(updated), { headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
