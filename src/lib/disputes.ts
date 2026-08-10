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
export const OPEN_DISPUTE_STATUSES: DisputeStatus[] = [
  DisputeStatus.open,
  DisputeStatus.investigating,
  DisputeStatus.waiting_external,
  DisputeStatus.proposed_resolution,
];

/**
 * Who may accept a proposed resolution on their own org's behalf — same shape as
 * `DOCUMENT_APPROVAL_POLICY` in documents.ts, and the same reasoning: whether a member
 * (not just the owner) can bind the org is a policy toggle, not a hardcoded role check.
 */
export const DISPUTE_ACCEPTANCE_POLICY = {
  member_can_accept: false,
  ops_override_allowed: false,
} as const;

export interface FindOrCreateDisputeArgs {
  principal: Principal;
  exporterOrgId: string;
  dealId: string;
  /**
   * `deal` scope is the AGT-06 blocker escalation: the case is about the deal's execution
   * as a whole, not one shipment or payment. Its dedup key is therefore the deal itself —
   * one open Ops escalation per deal, however many gates are stuck.
   */
  scopeType: typeof ScopeType.shipment | typeof ScopeType.payment | typeof ScopeType.deal;
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

  // Each scope dedupes on its own key. A deal-scoped escalation must NOT match an open
  // shipment or payment case on the same deal — those are different problems with
  // different owners — so it filters on scope_type instead of a null child id, which
  // would otherwise match any case whose shipment_id happens to be null.
  //
  // `type` is part of every key, not just the deal-scope one. EXP-16 lets an exporter
  // open ANY dispute type against the same shipment or deal — a "quality" complaint and a
  // "logistics" complaint about the same shipment are not the same case just because they
  // share a shipment_id. Every existing caller (EXP-14's shipment issue, EXP-15's payment
  // dispute, AGT-06's blocker escalation) passes exactly one fixed type per call site, so
  // adding `type` to the key is a no-op for them and a correctness fix for the general
  // case this file did not originally have to handle.
  const scopeWhere =
    args.scopeType === ScopeType.shipment
      ? { shipment_id: args.shipmentId, type: args.type }
      : args.scopeType === ScopeType.payment
        ? { payment_id: args.paymentId, type: args.type }
        : { scope_type: ScopeType.deal, type: args.type };

  const existing = await db.dispute.findFirst({
    where: {
      deal_id: args.dealId,
      status: { in: OPEN_DISPUTE_STATUSES },
      ...scopeWhere,
    },
    orderBy: { created_at: 'desc' },
  });

  if (existing) {
    return { dispute: existing, created: false };
  }

  const created = await db.dispute.create({
    data: {
      scope_type: args.scopeType,
      scope_id:
        args.scopeType === ScopeType.shipment
          ? args.shipmentId!
          : args.scopeType === ScopeType.payment
            ? args.paymentId!
            : args.dealId,
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
