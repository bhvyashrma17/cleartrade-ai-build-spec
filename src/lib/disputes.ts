/**
 * Shared "raise an issue" dedup logic for EXP-14 (shipment) and EXP-15 (payment).
 *
 * Both screens' AC04 says the same thing in different words: "no duplicate critical
 * issue if an open case exists — link the existing one." This is the one place that
 * rule is enforced, so a shipment exception and a payment dispute can never drift into
 * two different definitions of "already open."
 */

import { DisputeSeverity, DisputeStatus, DisputeType, Prisma, ScopeType } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/** Never closed/resolved — the set an "is there already an open case?" check must exclude. */
const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.open,
  DisputeStatus.investigating,
  DisputeStatus.waiting_external,
  DisputeStatus.proposed_resolution,
];

export interface FindOrCreateDisputeArgs {
  principal: Principal;
  exporterOrgId: string;
  dealId: string;
  scopeType: typeof ScopeType.shipment | typeof ScopeType.payment;
  shipmentId?: string | null;
  paymentId?: string | null;
  type: DisputeType;
  severity: DisputeSeverity;
  summary: string;
  ownerUserId?: string | null;
  correlationId: string;
  db?: Prisma.TransactionClient;
}

export interface FindOrCreateDisputeResult {
  dispute: { id: string; status: DisputeStatus; type: DisputeType; summary: string };
  created: boolean;
}

/**
 * Returns the existing open dispute for this shipment/payment if one exists, otherwise
 * creates a new one. Scoped by (shipment_id | payment_id), not by summary text — two
 * issues raised in different words about the same shipment are still the same case.
 */
export async function findOrCreateDispute(args: FindOrCreateDisputeArgs): Promise<FindOrCreateDisputeResult> {
  const db = args.db ?? prisma;

  const existing = await db.dispute.findFirst({
    where: {
      deal_id: args.dealId,
      status: { in: OPEN_DISPUTE_STATUSES },
      ...(args.scopeType === ScopeType.shipment ? { shipment_id: args.shipmentId } : { payment_id: args.paymentId }),
    },
    orderBy: { created_at: 'desc' },
  });

  if (existing) {
    return { dispute: existing, created: false };
  }

  const created = await db.dispute.create({
    data: {
      scope_type: args.scopeType,
      scope_id: args.scopeType === ScopeType.shipment ? args.shipmentId! : args.paymentId!,
      deal_id: args.dealId,
      shipment_id: args.scopeType === ScopeType.shipment ? args.shipmentId : null,
      payment_id: args.scopeType === ScopeType.payment ? args.paymentId : null,
      type: args.type,
      severity: args.severity,
      status: DisputeStatus.open,
      owner_user_id: args.ownerUserId ?? null,
      summary: args.summary,
    },
  });

  await writeAuditEvent({
    db,
    actor: args.principal,
    action: AUDIT_ACTIONS.create,
    object_type: 'dispute',
    object_id: created.id,
    exporter_org_id: args.exporterOrgId,
    after_summary: { deal_id: args.dealId, scope_type: args.scopeType, type: args.type, severity: args.severity },
    correlation_id: args.correlationId,
  });

  return { dispute: created, created: true };
}
