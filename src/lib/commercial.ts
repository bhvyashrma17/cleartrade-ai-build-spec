/**
 * Server-side commercial-negotiation domain logic shared by the exporter (EXP-10) and
 * agent (AGT-05) routes.
 *
 * This module's job is to be the ONE place that translates database rows into the
 * `DealLockContext` that `src/lib/state-machines/deal.ts` demands. That machine is pure —
 * it reads nothing and writes nothing — so every prerequisite it checks is only as good
 * as the context assembled here. Building that context in each route handler instead
 * would be the obvious way to end up with a lock that passes in one place and fails in
 * another.
 */

import { ApprovalStatus, DealStage, Prisma, type PrismaClient } from '@prisma/client';
import { getConfig, getFeePolicy, type FeePolicySnapshot } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { canApproveCommercialTerms } from '@/lib/permissions';
import type { DealCommercialTerms, DealLockContext } from '@/lib/state-machines/deal';
import type { Principal } from '@/types';

/**
 * Whether an exporter member (not owner) may approve commercial terms, and whether Ops
 * may override. docs/11 §7 lists this as an open product decision defaulting to
 * owner-only, and `canApproveCommercialTerms()` takes it as a parameter rather than
 * hardcoding it. Kept here as the single default until it becomes a real config key.
 */
export const COMMERCIAL_APPROVAL_POLICY = {
  member_can_approve: false,
  ops_override_allowed: false,
} as const;

/** The commercial fields a proposal carries — the diff and the snapshot both use this. */
export const PROPOSAL_TERM_FIELDS = [
  'quantity',
  'unit',
  'unit_price_amount',
  'unit_price_currency',
  'total_amount',
  'total_currency',
  'incoterm',
  'incoterm_place',
  'payment_terms',
  'ship_window_start',
  'ship_window_end',
  'special_conditions',
] as const;

export type ProposalTermField = (typeof PROPOSAL_TERM_FIELDS)[number];

type ProposalRow = Prisma.DealProposalGetPayload<object>;

/** Human labels for the diff view, so the UI never renders a raw column name. */
export const PROPOSAL_FIELD_LABELS: Record<ProposalTermField, string> = {
  quantity: 'Quantity',
  unit: 'Unit',
  unit_price_amount: 'Unit price',
  unit_price_currency: 'Unit price currency',
  total_amount: 'Total value',
  total_currency: 'Total currency',
  incoterm: 'Incoterm',
  incoterm_place: 'Incoterm place',
  payment_terms: 'Payment terms',
  ship_window_start: 'Ship window start',
  ship_window_end: 'Ship window end',
  special_conditions: 'Special conditions',
};

/** Normalise a proposal field to a comparable/renderable string. */
export function proposalFieldValue(row: ProposalRow, field: ProposalTermField): string | null {
  const value = row[field];
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value instanceof Prisma.Decimal) return value.toString();
  if (typeof value === 'object') {
    const terms = value as { type?: string; description?: string };
    // payment_terms is structured JSON; render the parts a human negotiates over.
    return [terms.type, terms.description].filter(Boolean).join(' — ') || JSON.stringify(value);
  }
  return String(value);
}

export interface ProposalFieldDiff {
  field: ProposalTermField;
  label: string;
  previous: string | null;
  current: string | null;
  changed: boolean;
}

/**
 * Field-level diff of one proposal version against the one before it (EXP-10-AC02 /
 * AGT-05 "Version compare — changed fields highlighted").
 *
 * With no previous version every field reads as unchanged rather than as "all new":
 * highlighting all twelve fields on v1 would make the highlight meaningless exactly when
 * there is nothing to compare against.
 */
export function diffProposals(current: ProposalRow, previous: ProposalRow | null): ProposalFieldDiff[] {
  return PROPOSAL_TERM_FIELDS.map((field) => {
    const currentValue = proposalFieldValue(current, field);
    const previousValue = previous ? proposalFieldValue(previous, field) : null;
    return {
      field,
      label: PROPOSAL_FIELD_LABELS[field],
      previous: previousValue,
      current: currentValue,
      changed: previous !== null && currentValue !== previousValue,
    };
  });
}

/** Terms shaped for the state machine, sourced from the APPROVED proposal. */
function termsFromProposal(row: ProposalRow): DealCommercialTerms {
  return {
    quantity: row.quantity?.toString() ?? null,
    unit: row.unit,
    unit_price:
      row.unit_price_amount && row.unit_price_currency
        ? { amount: row.unit_price_amount.toString(), currency: row.unit_price_currency }
        : null,
    total:
      row.total_amount && row.total_currency
        ? { amount: row.total_amount.toString(), currency: row.total_currency }
        : null,
    incoterm: row.incoterm,
    incoterm_place: row.incoterm_place,
    payment_terms: row.payment_terms ?? null,
    ship_window:
      row.ship_window_start || row.ship_window_end
        ? { start: row.ship_window_start, end: row.ship_window_end }
        : null,
    special_conditions: row.special_conditions,
  };
}

/**
 * Assemble the full `DealLockContext` from the database.
 *
 * Everything here is server-loaded on purpose — `assertDealTransition(→ deal_locked)`
 * throws INTERNAL_ERROR rather than trusting a caller that says "the prerequisites were
 * checked already", and this is the function that earns that trust.
 */
export async function buildDealLockContext(dealId: string): Promise<DealLockContext> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: {
      buyer: { select: { id: true, legal_name: true } },
      // Product has no `sku` column; the snapshot's sku field stays null until the
      // domain model grows one, rather than being faked from the product name.
      product: { select: { id: true, name: true } },
      exporter_org: { select: { id: true, iec: true } },
      documents: {
        where: { is_current_version: true },
        select: {
          id: true,
          doc_type: true,
          version: true,
          is_current_version: true,
          checksum: true,
          approval_status: true,
          approved_version: true,
          approved_checksum: true,
        },
      },
      snapshots: { select: { version: true } },
      proposals: { orderBy: { version: 'desc' } },
    },
  });

  const approvedProposal = deal.proposals.find((p) => p.status === 'approved' && p.approved_at) ?? null;

  // The fee policy is OPTIONAL in the context on purpose: `getFeePolicy()` throws when
  // none is configured, but the lock's contract is to report that as a blocker with a
  // deep link to fix it, not to 500. Catching here is what turns a server crash into the
  // actionable "no active fee policy" blocker the UI can render.
  let feePolicy: FeePolicySnapshot | null = null;
  try {
    feePolicy = await getFeePolicy();
  } catch {
    feePolicy = null;
  }

  // AGT-05-AC02: recompute whether the recorded approver was actually exporter-authorized
  // rather than trusting the stored row. An agent who somehow wrote their own id into
  // approved_by_id must still fail this check.
  let approverIsExporterAuthorized = false;
  if (approvedProposal?.approved_by_id) {
    const approver = await prisma.user.findUnique({
      where: { id: approvedProposal.approved_by_id },
      select: { id: true, email: true, name: true, role: true, exporter_org_id: true, exporter_org: { select: { tier: true } } },
    });
    if (approver) {
      const approverPrincipal: Principal = {
        id: approver.id,
        email: approver.email,
        name: approver.name,
        role: approver.role,
        exporter_org_id: approver.exporter_org_id,
        tier: approver.exporter_org?.tier ?? 'paid',
      };
      approverIsExporterAuthorized = await canApproveCommercialTerms(
        approverPrincipal,
        { exporter_org_id: deal.exporter_org_id },
        COMMERCIAL_APPROVAL_POLICY,
      );
    }
  }
  return {
    deal_id: deal.id,
    stage: deal.stage,
    exporter_org_id: deal.exporter_org_id,
    buyer_id: deal.buyer_id,
    buyer_legal_name: deal.buyer.legal_name,
    product_id: deal.product?.id ?? null,
    product_name: deal.product?.name ?? null,
    sku: null,
    // Terms come from the approved proposal when one exists — that is the version the
    // exporter actually accepted. Falling back to the live Deal columns would let a
    // post-approval edit slip into the snapshot unapproved.
    terms: approvedProposal ? termsFromProposal(approvedProposal) : termsFromLiveDeal(deal),
    commercial_approval:
      approvedProposal && approvedProposal.approved_at && approvedProposal.approved_by_id
        ? {
            proposal_version: approvedProposal.version,
            approved_at: approvedProposal.approved_at,
            approved_by_id: approvedProposal.approved_by_id,
            approver_is_exporter_authorized: approverIsExporterAuthorized,
          }
        : null,
    documents: deal.documents.map((d) => ({
      id: d.id,
      doc_type: d.doc_type,
      version: d.version,
      is_current_version: d.is_current_version,
      checksum: d.checksum,
      approval_status: d.approval_status as ApprovalStatus,
      approved_version: d.approved_version,
      approved_checksum: d.approved_checksum,
    })),
    exporter_iec: deal.exporter_org.iec,
    fee_policy: feePolicy,
    existing_snapshot_versions: deal.snapshots.map((s) => s.version),
    locked_by_id: null,
  };
}

/** Only used when a deal has no approved proposal yet — the lock will block anyway. */
function termsFromLiveDeal(deal: {
  quantity: Prisma.Decimal | null;
  unit: string | null;
  unit_price_amount: Prisma.Decimal | null;
  unit_price_currency: string | null;
  total_amount: Prisma.Decimal | null;
  total_currency: string | null;
  incoterm: string | null;
  incoterm_place: string | null;
  payment_terms: Prisma.JsonValue | null;
  delivery_terms: Prisma.JsonValue | null;
}): DealCommercialTerms {
  const delivery = (deal.delivery_terms ?? null) as { ship_window_start?: string; ship_window_end?: string; notes?: string } | null;
  return {
    quantity: deal.quantity?.toString() ?? null,
    unit: deal.unit,
    unit_price:
      deal.unit_price_amount && deal.unit_price_currency
        ? { amount: deal.unit_price_amount.toString(), currency: deal.unit_price_currency }
        : null,
    total:
      deal.total_amount && deal.total_currency
        ? { amount: deal.total_amount.toString(), currency: deal.total_currency }
        : null,
    incoterm: deal.incoterm,
    incoterm_place: deal.incoterm_place,
    payment_terms: deal.payment_terms ?? null,
    ship_window: delivery?.ship_window_start
      ? { start: new Date(delivery.ship_window_start), end: delivery.ship_window_end ? new Date(delivery.ship_window_end) : null }
      : null,
    special_conditions: delivery?.notes ?? null,
  };
}

/** The document-type registry the lock's checklist is built from (config, not constants). */
export async function documentRegistry() {
  return getConfig('documents.registry');
}

/** Stages at which a new proposal may still be created or sent. */
export const NEGOTIABLE_STAGES: DealStage[] = [
  DealStage.qualifying,
  DealStage.negotiating,
  DealStage.terms_agreed,
];
