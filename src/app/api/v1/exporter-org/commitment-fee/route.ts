/**
 * PATCH /api/v1/exporter-org/commitment-fee — pay the commitment fee (docs/01 §2).
 *
 * Paying is what flips `ExporterOrg.tier` from `free` to `paid`, which is what unlocks
 * full Demand Discovery and everything else gated at `paid` tier (docs/14 §3). This
 * platform does not run a payment gateway — the same "milestone/visibility surface, not
 * settlement infrastructure" posture `Payment.source` already applies to buyer payments
 * applies here too: the caller states a `source` for the confirmation (self-reported or
 * Ops-confirmed), exactly the vocabulary `PaymentSource` already defines.
 *
 * Scoped to the caller's OWN org via `requireExporterPrincipal()` for the exporter path.
 * `ops_finance` (grant 'all' in the matrix) reconciling on a DIFFERENT org isn't wired
 * into this route yet — it would need an org id in the path, which this self-scoped
 * route deliberately doesn't take (mirrors `PATCH /api/v1/exporter-org`'s own scoping
 * note). Flagged here rather than silently half-built.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { OrgTier } from '@prisma/client';
import { requireExporterPrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getFeePolicy } from '@/lib/config';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { assertCommitmentFeeTransition } from '@/lib/state-machines/commitment-fee';
import { payCommitmentFeeSchema, zodFieldErrors } from '@/lib/validators';

export async function PATCH(request: NextRequest) {
  const correlationId = newCorrelationId();

  try {
    const principal = await requireExporterPrincipal();
    assertCan(principal, 'commitment_fee.pay');
    const orgId = principal.exporter_org_id as string;

    const body = await request.json().catch(() => null);
    const parsed = payCommitmentFeeSchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const org = await prisma.exporterOrg.findUniqueOrThrow({
      where: { id: orgId },
      select: { commitment_fee_status: true, tier: true },
    });

    // `assertCommitmentFeeTransition` is the single source of truth for what's legal —
    // this route only supports the 'pay' action, so `to` is always `paid`, but the
    // machine still enforces the FROM side (a `not_due` org, e.g. still tier=guest,
    // cannot pay a fee that was never invoiced).
    const effects = assertCommitmentFeeTransition(org.commitment_fee_status, 'paid', {
      source: input.source,
    });

    const policy = await getFeePolicy();

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.exporterOrg.update({
        where: { id: orgId },
        data: {
          commitment_fee_status: 'paid',
          commitment_fee_source: input.source,
          commitment_fee_paid_at: new Date(),
          // The fee amount/currency/version were already snapshotted when the fee became
          // due (registration) — never re-read here. Paying confirms what was owed, it
          // does not re-price it against whatever FeePolicy version happens to be active
          // today (same "rule of record" as a deal's quoted terms).
          ...(effects.unlocks_paid_tier ? { tier: OrgTier.paid } : {}),
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.update,
        object_type: 'exporter_org',
        object_id: orgId,
        exporter_org_id: orgId,
        before_summary: { commitment_fee_status: org.commitment_fee_status, tier: org.tier },
        after_summary: {
          commitment_fee_status: row.commitment_fee_status,
          tier: row.tier,
          source: input.source,
          reference: input.reference ?? null,
        },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(
      single({
        commitment_fee_status: updated.commitment_fee_status,
        tier: updated.tier,
        amount: updated.commitment_fee_amount?.toString() ?? policy.commitment_fee.amount,
        currency: updated.commitment_fee_currency ?? policy.commitment_fee.currency,
      }),
      { headers: { 'x-correlation-id': correlationId } },
    );
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
