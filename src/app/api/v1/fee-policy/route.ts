/**
 * POST /api/v1/fee-policy — OPS-07 config registry, the fee-policy row specifically.
 *
 * `FeePolicy` is its own model (not a `ConfigSetting` JSON blob) because its fields are
 * money/rate values every deal-lock and payout calculation reads by column, not by key
 * lookup. Same versioning discipline as `/api/v1/config` — a new row, the old one
 * deactivated, never an in-place update — because `Deal.quoted_fee_policy` snapshots
 * the active policy at lock time (AC03) and a later change must never reach backward
 * into an already-locked deal.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { requirePrincipal } from '@/lib/auth';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { errorResponse, newCorrelationId, single, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { updateFeePolicySchema, zodFieldErrors } from '@/lib/validators';

export async function POST(request: NextRequest) {
  const correlationId = newCorrelationId();
  try {
    const principal = await requirePrincipal();
    assertCan(principal, 'fee_policy.edit');

    const body = await request.json().catch(() => null);
    const parsed = updateFeePolicySchema.safeParse(body);
    if (!parsed.success) throw validationError(zodFieldErrors(parsed.error));
    const input = parsed.data;

    const created = await prisma.$transaction(async (tx) => {
      const current = await tx.feePolicy.findFirst({ where: { is_active: true }, orderBy: { version: 'desc' } });
      const nextVersion = (current?.version ?? 0) + 1;

      if (current) {
        await tx.feePolicy.update({ where: { id: current.id }, data: { is_active: false } });
      }

      const row = await tx.feePolicy.create({
        data: {
          version: nextVersion,
          commitment_fee_amount: input.commitment_fee_amount,
          commitment_fee_currency: input.commitment_fee_currency,
          success_fee_rate: input.success_fee_rate,
          small_shipment_threshold_amount: input.small_shipment_threshold_amount,
          small_shipment_threshold_currency: input.small_shipment_threshold_currency,
          small_shipment_rate: input.small_shipment_rate,
          small_shipment_flat_amount: input.small_shipment_flat_amount,
          agent_share_rate: input.agent_share_rate,
          minimum_shipment_amount: input.minimum_shipment_amount,
          minimum_shipment_currency: input.minimum_shipment_currency,
          is_active: true,
        },
      });

      await writeAuditEvent({
        db: tx,
        actor: principal,
        action: AUDIT_ACTIONS.config_change,
        object_type: 'fee_policy',
        object_id: row.id,
        before_summary: current ? { version: current.version } : null,
        after_summary: { version: row.version },
        correlation_id: correlationId,
      });

      return row;
    });

    return NextResponse.json(single(created), { status: 201, headers: { 'x-correlation-id': correlationId } });
  } catch (error) {
    return errorResponse(error, correlationId);
  }
}
