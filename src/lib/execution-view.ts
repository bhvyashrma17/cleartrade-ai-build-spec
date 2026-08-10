/**
 * AGT-06 execution view loader.
 *
 * THE SHARED-OBJECT RULE (AGENTS.md, docs/12 §B) lives or dies here. Every model this
 * file reads is the same canonical record the exporter portal reads:
 *
 *   Document           — the same rows /app/deals/:id/documents renders
 *   Task               — the same rows /app/tasks and the deal Overview render
 *   Shipment + ShipmentMilestone — the same rows /app/deals/:id/shipment renders
 *   Payment            — the same rows /app/deals/:id/payment renders
 *   InsuranceCase, Dispute, Partner — likewise
 *
 * There is deliberately no `AgentDocument`, no `agent_*` table, no denormalized copy and
 * no "agent view" materialization. The agent portal differs from the exporter portal by
 * WHICH FIELDS IT SELECTS and WHAT IT MAY DO, never by which table it reads. If a future
 * change makes the agent screen disagree with the exporter screen about a document's
 * status, that is a bug in one of the two renderers, not two records drifting apart —
 * which is precisely the property scripts/verify-agent-execution.ts asserts by id.
 *
 * The one thing this loader adds that the exporter portal must never receive is the
 * internal layer: `InternalNote` rows and `visibility: internal` tasks. Those are loaded
 * separately and returned under a distinct key (`internal`) rather than merged into the
 * shared collections, so a careless spread of the shared data can't leak them.
 */

import { IecStatus, Prisma, TaskState, Visibility } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  buildExecutionChecklist,
  type ExecutionContext,
  type ExecutionGate,
} from '@/lib/execution-plan';
import type { Principal } from '@/types';
import { canViewInternalNote } from '@/lib/permissions';

export interface ExecutionView {
  checklist: ExecutionGate[];
  documents: Awaited<ReturnType<typeof loadDocuments>>;
  shipment: Awaited<ReturnType<typeof loadShipment>>;
  payments: Awaited<ReturnType<typeof loadPayments>>;
  insuranceCase: Awaited<ReturnType<typeof loadInsurance>>;
  disputes: Awaited<ReturnType<typeof loadDisputes>>;
  partners: Awaited<ReturnType<typeof loadPartners>>;
  /** Exporter-visible tasks — the same rows the exporter sees, grouped by owner. */
  tasks: {
    agent: SharedTask[];
    exporter: SharedTask[];
    ops: SharedTask[];
  };
  /**
   * The internal layer. Separate key, loaded only when the principal actually holds
   * `internal_note.view` — an exporter principal reaching this loader (they cannot; the
   * page is under /agent) would still get empty arrays rather than filtered-late data.
   */
  internal: {
    notes: InternalNoteRow[];
    tasks: SharedTask[];
  };
}

export interface SharedTask {
  id: string;
  title: string;
  description: string | null;
  state: TaskState;
  priority: string;
  owner_role: string;
  owner_name: string | null;
  due_at: Date | null;
  sla_state: string;
  blocked_reason: string | null;
  waiting_on: string | null;
  visibility: Visibility;
  task_type: string | null;
}

export interface InternalNoteRow {
  id: string;
  body: string;
  created_at: Date;
  author_name: string;
}

const TASK_SELECT = {
  id: true,
  title: true,
  description: true,
  state: true,
  priority: true,
  owner_role: true,
  due_at: true,
  sla_state: true,
  blocked_reason: true,
  waiting_on: true,
  visibility: true,
  task_type: true,
  owner: { select: { name: true } },
} satisfies Prisma.TaskSelect;

function toSharedTask(row: Prisma.TaskGetPayload<{ select: typeof TASK_SELECT }>): SharedTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    state: row.state,
    priority: row.priority,
    owner_role: row.owner_role,
    owner_name: row.owner?.name ?? null,
    due_at: row.due_at,
    sla_state: row.sla_state,
    blocked_reason: row.blocked_reason,
    waiting_on: row.waiting_on,
    visibility: row.visibility,
    task_type: row.task_type,
  };
}

// --- Individual loaders, each over the canonical shared model -------------------

function loadDocuments(dealId: string) {
  return prisma.document.findMany({
    where: { deal_id: dealId, is_current_version: true },
    orderBy: { doc_type: 'asc' },
    include: { filed_by: { select: { name: true } } },
  });
}

function loadShipment(dealId: string) {
  return prisma.shipment.findFirst({
    where: { deal_id: dealId },
    include: {
      cha_partner: { select: { id: true, display_name: true, contact_email: true } },
      freight_partner: { select: { id: true, display_name: true, contact_email: true } },
      milestones: { orderBy: { sequence: 'asc' } },
    },
  });
}

function loadPayments(dealId: string) {
  return prisma.payment.findMany({ where: { deal_id: dealId }, orderBy: { sequence: 'asc' } });
}

function loadInsurance(dealId: string) {
  return prisma.insuranceCase.findFirst({ where: { deal_id: dealId }, orderBy: { created_at: 'desc' } });
}

function loadDisputes(dealId: string) {
  return prisma.dispute.findMany({
    where: { deal_id: dealId, status: { notIn: ['resolved', 'closed'] } },
    orderBy: { created_at: 'desc' },
    include: { owner: { select: { name: true } } },
  });
}

/** The approved partner directory — AGT-06 "no free-text phantom partner". */
function loadPartners() {
  return prisma.partner.findMany({
    where: { partner_status: 'active' },
    orderBy: [{ type: 'asc' }, { display_name: 'asc' }],
    select: { id: true, type: true, display_name: true, contact_email: true, country_code: true },
  });
}

// --- The assembled view ---------------------------------------------------------

export async function loadExecutionView(
  principal: Principal,
  deal: { id: string; stage: Prisma.DealGetPayload<object>['stage']; locked_at: Date | null; exporter_org_id: string },
): Promise<ExecutionView> {
  // The same permission gate the exporter portal is denied by, asked here rather than
  // assumed from "this page is under /agent" — an ops_finance principal browsing an
  // agent URL must get the same answer the permission matrix gives everywhere else.
  const maySeeInternal = await canViewInternalNote(principal, {
    deal: { exporter_org_id: deal.exporter_org_id, owner_agent_id: null },
  });

  const [documents, shipment, payments, insuranceCase, disputes, partners, snapshot, org, allTasks, internalNotes] =
    await Promise.all([
      loadDocuments(deal.id),
      loadShipment(deal.id),
      loadPayments(deal.id),
      loadInsurance(deal.id),
      loadDisputes(deal.id),
      loadPartners(),
      prisma.dealSnapshot.findFirst({ where: { deal_id: deal.id }, orderBy: { version: 'desc' }, select: { version: true } }),
      prisma.exporterOrg.findUnique({ where: { id: deal.exporter_org_id }, select: { iec: true } }),
      prisma.task.findMany({
        where: { deal_id: deal.id },
        orderBy: [{ sla_state: 'desc' }, { due_at: { sort: 'asc', nulls: 'last' } }],
        select: TASK_SELECT,
      }),
      maySeeInternal
        ? prisma.internalNote.findMany({
            where: { deal_id: deal.id },
            orderBy: { created_at: 'desc' },
            include: { author: { select: { name: true } } },
          })
        : Promise.resolve([]),
    ]);

  const tasks = allTasks.map(toSharedTask);
  // Split by visibility FIRST, then by owner. Doing it in this order means an internal
  // task can never fall into an exporter-facing bucket through a missed branch.
  const exporterVisible = tasks.filter((t) => t.visibility === Visibility.exporter_visible);
  const internalTasks = maySeeInternal ? tasks.filter((t) => t.visibility === Visibility.internal) : [];

  const ctx: ExecutionContext = {
    deal_id: deal.id,
    stage: deal.stage,
    locked_at: deal.locked_at,
    snapshot_version: snapshot?.version ?? null,
    exporter_iec_verified: org?.iec === IecStatus.verified,
    documents: documents.map((d) => ({
      id: d.id,
      doc_type: d.doc_type,
      label: d.doc_type.replace(/_/g, ' '),
      version: d.version,
      generation_status: d.generation_status,
      approval_status: d.approval_status,
      filing_status: d.filing_status,
      filing_reference: d.filing_reference,
      filed_at: d.filed_at,
      filed_by_name: d.filed_by?.name ?? null,
    })),
    // The checklist sees ALL tasks including internal ones — an internal blocker is still
    // a real blocker for the agent's own gate evaluation. What must never happen is that
    // internal detail reaching an exporter response, which is enforced where the data is
    // returned, not where the gates are computed.
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      task_type: t.task_type,
      state: t.state,
      owner_role: t.owner_role,
      visibility: t.visibility,
      due_at: t.due_at,
    })),
    shipment: shipment
      ? {
          id: shipment.id,
          status: shipment.status,
          exception_state: shipment.exception_state,
          exception_reason: shipment.exception_reason,
          cha_partner_id: shipment.cha_partner_id,
          cha_partner_name: shipment.cha_partner?.display_name ?? null,
          freight_partner_id: shipment.freight_partner_id,
          freight_partner_name: shipment.freight_partner?.display_name ?? null,
          booking_ref: shipment.booking_ref,
          customs_ref: shipment.customs_ref,
          shipping_bill_no: shipment.shipping_bill_no,
          milestones: shipment.milestones.map((m) => ({
            code: m.code,
            state: m.state,
            eta_at: m.eta_at,
            actual_at: m.actual_at,
          })),
        }
      : null,
    payments: payments.map((p) => ({ id: p.id, label: p.label, status: p.status, brc_status: p.brc_status })),
  };

  return {
    checklist: buildExecutionChecklist(ctx),
    documents,
    shipment,
    payments,
    insuranceCase,
    disputes,
    partners,
    tasks: {
      agent: exporterVisible.filter((t) => t.owner_role === 'agent'),
      exporter: exporterVisible.filter((t) => t.owner_role.startsWith('exporter')),
      ops: exporterVisible.filter((t) => t.owner_role.startsWith('ops') || t.owner_role === 'admin'),
    },
    internal: {
      notes: internalNotes.map((n) => ({
        id: n.id,
        body: n.body,
        created_at: n.created_at,
        author_name: n.author.name,
      })),
      tasks: internalTasks,
    },
  };
}

/**
 * Rebuild just the checklist for a route handler that needs to enforce a gate before
 * mutating. Route handlers must not trust a checklist computed at page render — the page
 * could be minutes stale — so they re-derive it from live data at the moment of the write.
 */
export async function loadChecklistForEnforcement(dealId: string): Promise<ExecutionGate[]> {
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { id: true, stage: true, locked_at: true, exporter_org_id: true },
  });
  const [documents, shipment, payments, snapshot, org, tasks] = await Promise.all([
    loadDocuments(dealId),
    loadShipment(dealId),
    loadPayments(dealId),
    prisma.dealSnapshot.findFirst({ where: { deal_id: dealId }, orderBy: { version: 'desc' }, select: { version: true } }),
    prisma.exporterOrg.findUnique({ where: { id: deal.exporter_org_id }, select: { iec: true } }),
    prisma.task.findMany({ where: { deal_id: dealId }, select: TASK_SELECT }),
  ]);

  return buildExecutionChecklist({
    deal_id: deal.id,
    stage: deal.stage,
    locked_at: deal.locked_at,
    snapshot_version: snapshot?.version ?? null,
    exporter_iec_verified: org?.iec === IecStatus.verified,
    documents: documents.map((d) => ({
      id: d.id,
      doc_type: d.doc_type,
      label: d.doc_type.replace(/_/g, ' '),
      version: d.version,
      generation_status: d.generation_status,
      approval_status: d.approval_status,
      filing_status: d.filing_status,
      filing_reference: d.filing_reference,
      filed_at: d.filed_at,
      filed_by_name: null,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      task_type: t.task_type,
      state: t.state,
      owner_role: t.owner_role,
      visibility: t.visibility,
      due_at: t.due_at,
    })),
    shipment: shipment
      ? {
          id: shipment.id,
          status: shipment.status,
          exception_state: shipment.exception_state,
          exception_reason: shipment.exception_reason,
          cha_partner_id: shipment.cha_partner_id,
          cha_partner_name: shipment.cha_partner?.display_name ?? null,
          freight_partner_id: shipment.freight_partner_id,
          freight_partner_name: shipment.freight_partner?.display_name ?? null,
          booking_ref: shipment.booking_ref,
          customs_ref: shipment.customs_ref,
          shipping_bill_no: shipment.shipping_bill_no,
          milestones: shipment.milestones.map((m) => ({
            code: m.code,
            state: m.state,
            eta_at: m.eta_at,
            actual_at: m.actual_at,
          })),
        }
      : null,
    payments: payments.map((p) => ({ id: p.id, label: p.label, status: p.status, brc_status: p.brc_status })),
  });
}
