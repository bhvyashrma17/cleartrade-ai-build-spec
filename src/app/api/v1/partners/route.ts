/**
 * POST /api/v1/partners — the approved partner directory, managed as part of the
 * OPS-07 config registry (docs/06 "implement the partner directory as part of the
 * OPS-07 config registry … not a new object"). Admin-only, per the same "config
 * registry is Admin-only write" rule as `/api/v1/config`.
 *
 * Onboarding here is what makes `AssignPartnerForm` (AGT-06) and OPS-04's assignment
 * flow able to see the partner at all — `assignPartnerSchema`'s route validates against
 * exactly this table.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { createPartnerSchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'partner.manage');

    const body = await request.json().catch(() => null);
    const parsed = createPartnerSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const created = await prisma.$transaction(async (tx) => {
      const partner = await tx.partner.create({
        data: {
          type: input.type,
          legal_name: input.legal_name,
          display_name: input.display_name,
          country_code: input.country_code.toUpperCase(),
          contact_email: input.contact_email ?? null,
          contact_phone: input.contact_phone ?? null,
        },
      });
      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'partner',
        object_id: partner.id,
        after_summary: { type: partner.type, display_name: partner.display_name },
        correlation_id: correlationId,
      });
      return partner;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
