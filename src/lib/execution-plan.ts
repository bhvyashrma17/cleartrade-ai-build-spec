/**
 * AGT-06 dependency checklist — the server-side prerequisite engine.
 *
 * docs/05 AGT-06 specifies the execution chain as
 *
 *   terms locked → required inputs → docs → CHA/file → pickup → customs → shipment → payment
 *
 * and AC01 as "downstream actions respect prerequisite state", with the required UI state
 * "Prerequisite blocked → disable downstream action WITH REASON AND LINK".
 *
 * This module is what makes that true rather than conventional. It is pure — it reads no
 * database and writes nothing — and it takes a server-loaded `ExecutionContext` of facts,
 * exactly like `collectDealLockBlockers()` in state-machines/deal.ts takes a
 * `DealLockContext`. The page renders what comes out of here; the client never recomputes
 * a gate, never decides "this button looks like it should be enabled", and has no copy of
 * the rules to drift from. A client that wanted to re-derive `blocked` would have to
 * re-implement every branch below against data it is not given.
 *
 * Each gate carries its own `blockers: Blocker[]` in the same shape the API error envelope
 * uses (docs/09 §2), so a blocked gate renders identically whether it was discovered by
 * this function at page load or thrown by a route handler mid-action.
 */

import {
  ApprovalStatus,
  DealStage,
  DocType,
  ExceptionState,
  FilingStatus,
  GenerationStatus,
  MilestoneState,
  PaymentStatus,
  ShipmentStatus,
} from '@prisma/client';
import { prerequisitesNotMet } from '@/lib/errors';
import { LOCKED_STAGES } from '@/lib/state-machines/deal';
import type { Blocker } from '@/types';

/**
 * The eight gates, in dependency order. The order is the contract: a gate is only
 * reachable when every gate before it is satisfied, which is what "downstream" means in
 * AC01. Adding a gate in the middle automatically pushes everything after it downstream.
 */
export const GATE_IDS = [
  'terms_locked',
  'required_inputs',
  'documents',
  'cha_filing',
  'pickup',
  'customs',
  'shipment',
  'payment',
] as const;

export type GateId = (typeof GATE_IDS)[number];

export const GATE_LABELS: Record<GateId, string> = {
  terms_locked: 'Terms locked',
  required_inputs: 'Required inputs',
  documents: 'Documents',
  cha_filing: 'CHA & filing',
  pickup: 'Pickup',
  customs: 'Customs',
  shipment: 'Shipment',
  payment: 'Payment',
};

/**
 * `done`     — the gate's own work is finished.
 * `ready`    — everything upstream is done and this gate is the live one to work.
 * `blocked`  — this gate's own prerequisites are unmet; `blockers` says why, with links.
 * `waiting`  — upstream is incomplete, so this gate is not actionable yet. Distinct from
 *              `blocked` on purpose: nothing is wrong here, it simply isn't this gate's
 *              turn, and the UI must not present it as a problem to fix.
 */
export type GateState = 'done' | 'ready' | 'blocked' | 'waiting';

export interface ExecutionGate {
  id: GateId;
  label: string;
  state: GateState;
  /** Non-empty only when `state === 'blocked'`. Every entry carries a deep link. */
  blockers: Blocker[];
  /** One-line summary of what this gate currently shows, for the checklist row. */
  detail: string;
  /**
   * Action keys this gate governs. An action is permitted only when its gate is `ready`
   * or `done` — see `isActionAllowed()`. The page passes the result to the component that
   * owns the button; the button never decides for itself.
   */
  actions: readonly ExecutionActionKey[];
}

/**
 * Every mutating affordance on the execution workspace, keyed. Anything an agent can
 * click that changes state must appear here and be gated, or it is outside AC01.
 */
export const EXECUTION_ACTIONS = [
  'document.generate',
  'document.approve',
  'document.file',
  'partner.assign',
  'pickup.confirm',
  'customs.record',
  'shipment.milestone',
  'payment.record',
] as const;

export type ExecutionActionKey = (typeof EXECUTION_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Context — every fact the gates are evaluated against, all loaded server-side
// ---------------------------------------------------------------------------

export interface ExecutionDocumentState {
  id: string;
  doc_type: DocType;
  label: string;
  version: number;
  generation_status: GenerationStatus;
  approval_status: ApprovalStatus;
  filing_status: FilingStatus;
  filing_reference: string | null;
  filed_at: Date | null;
  filed_by_name: string | null;
}

export interface ExecutionTaskState {
  id: string;
  title: string;
  task_type: string | null;
  state: string;
  owner_role: string;
  /** `internal` tasks are agent/ops-only; see the visibility discussion in the page. */
  visibility: string;
  due_at: Date | null;
}

export interface ExecutionShipmentState {
  id: string;
  status: ShipmentStatus;
  exception_state: ExceptionState;
  exception_reason: string | null;
  cha_partner_id: string | null;
  cha_partner_name: string | null;
  freight_partner_id: string | null;
  freight_partner_name: string | null;
  booking_ref: string | null;
  customs_ref: string | null;
  shipping_bill_no: string | null;
  milestones: { code: string; state: MilestoneState; eta_at: Date | null; actual_at: Date | null }[];
}

export interface ExecutionPaymentState {
  id: string;
  label: string | null;
  status: PaymentStatus;
  brc_status: string;
}

export interface ExecutionContext {
  deal_id: string;
  stage: DealStage;
  locked_at: Date | null;
  snapshot_version: number | null;
  documents: ExecutionDocumentState[];
  tasks: ExecutionTaskState[];
  shipment: ExecutionShipmentState | null;
  payments: ExecutionPaymentState[];
  /** Present only when the exporter org's IEC is verified — an export gate, not a doc gate. */
  exporter_iec_verified: boolean;
}

// ---------------------------------------------------------------------------
// Gate evaluation
// ---------------------------------------------------------------------------

/**
 * Deep links point at the AGENT workspace, not the exporter one. `dealDeepLink()` in
 * state-machines/deal.ts builds `/app/deals/…` for exporter-facing blockers; an agent
 * following a blocker from their own screen must land somewhere they can actually act.
 * Same deal id, same objects — a different portal rendering them (docs/12 §B).
 */
export const agentDeepLink = (dealId: string, ...segments: string[]): string =>
  ['/agent/deals', dealId, ...segments].join('/');

/** Documents that must be filed with an authority for the export to proceed. */
const FILING_DOC_TYPES: DocType[] = [DocType.shipping_bill_draft];

/** Milestone codes that represent physical progress, in pipeline order. */
const PICKUP_MILESTONE = 'pickup';
const CUSTOMS_MILESTONE = 'customs';

function milestoneDone(ctx: ExecutionContext, code: string): boolean {
  const m = ctx.shipment?.milestones.find((x) => x.code === code);
  return m?.state === MilestoneState.complete;
}

/**
 * Build the full checklist.
 *
 * The cascade is explicit: each gate computes its OWN blockers, then `waiting` is applied
 * to everything downstream of the first gate that isn't `done`. That separation is what
 * lets the UI say "Customs is waiting on Pickup" instead of inventing a customs problem
 * that doesn't exist.
 */
export function buildExecutionChecklist(ctx: ExecutionContext): ExecutionGate[] {
  const link = (...segments: string[]) => agentDeepLink(ctx.deal_id, ...segments);

  // --- Gate 1: terms locked ---
  const isLocked = LOCKED_STAGES.includes(ctx.stage) || Boolean(ctx.locked_at);
  const termsBlockers: Blocker[] = [];
  if (!isLocked) {
    termsBlockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: `Commercial terms are not locked yet — this deal is at "${ctx.stage.replace(/_/g, ' ')}". Execution cannot start until the snapshot is frozen.`,
      deep_link: link('commercial'),
    });
  }

  // --- Gate 2: required inputs (exporter-owned prerequisites the agent cannot do for them) ---
  const inputBlockers: Blocker[] = [];
  if (!ctx.snapshot_version) {
    inputBlockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: 'No deal snapshot is frozen, so documents have nothing to generate from.',
      deep_link: link('commercial'),
    });
  }
  if (!ctx.exporter_iec_verified) {
    inputBlockers.push({
      object_type: 'exporter_org',
      object_id: ctx.deal_id,
      reason: 'The exporter’s IEC is not verified, so this shipment cannot be filed.',
      deep_link: '/ops/compliance',
    });
  }
  // Open exporter-owned input requests block downstream work by design: the agent is
  // waiting on the exporter, and pretending otherwise hides the real reason for delay.
  const openExporterInputs = ctx.tasks.filter(
    (t) =>
      t.owner_role.startsWith('exporter') &&
      t.visibility === 'exporter_visible' &&
      (t.state === 'not_started' || t.state === 'in_progress' || t.state === 'waiting') &&
      t.task_type === 'exporter_confirm_ship_window',
  );
  for (const task of openExporterInputs) {
    inputBlockers.push({
      object_type: 'task',
      object_id: task.id,
      reason: `Waiting on the exporter: “${task.title}”.`,
      deep_link: link('#tasks'),
    });
  }

  // --- Gate 3: documents ---
  const docBlockers: Blocker[] = [];
  const requiredDocs = ctx.documents.filter((d) => d.doc_type !== DocType.insurance_declaration);
  for (const doc of requiredDocs) {
    if (doc.generation_status === GenerationStatus.failed) {
      docBlockers.push({
        object_type: 'document',
        object_id: doc.id,
        reason: `${doc.label} failed to generate and needs a retry.`,
        deep_link: link('#documents'),
      });
    } else if (doc.generation_status !== GenerationStatus.generated) {
      docBlockers.push({
        object_type: 'document',
        object_id: doc.id,
        reason: `${doc.label} has not been generated yet.`,
        deep_link: link('#documents'),
      });
    } else if (doc.approval_status === ApprovalStatus.rejected) {
      docBlockers.push({
        object_type: 'document',
        object_id: doc.id,
        reason: `${doc.label} was rejected by the exporter and needs revision.`,
        deep_link: link('#documents'),
      });
    } else if (doc.approval_status === ApprovalStatus.pending) {
      docBlockers.push({
        object_type: 'document',
        object_id: doc.id,
        reason: `${doc.label} is awaiting exporter approval.`,
        deep_link: link('#documents'),
      });
    }
  }

  // --- Gate 4: CHA assignment + filing ---
  const chaBlockers: Blocker[] = [];
  if (!ctx.shipment) {
    chaBlockers.push({
      object_type: 'shipment',
      object_id: ctx.deal_id,
      reason: 'No shipment record exists yet, so a CHA cannot be assigned.',
      deep_link: link('#shipment'),
    });
  } else {
    if (!ctx.shipment.cha_partner_id) {
      chaBlockers.push({
        object_type: 'shipment',
        object_id: ctx.shipment.id,
        reason: 'No CHA partner is assigned to this shipment.',
        deep_link: link('#cha'),
      });
    }
    if (!ctx.shipment.freight_partner_id) {
      chaBlockers.push({
        object_type: 'shipment',
        object_id: ctx.shipment.id,
        reason: 'No freight partner is assigned to this shipment.',
        deep_link: link('#cha'),
      });
    }
    for (const docType of FILING_DOC_TYPES) {
      const doc = ctx.documents.find((d) => d.doc_type === docType);
      if (!doc) continue;
      if (doc.filing_status === FilingStatus.rejected) {
        chaBlockers.push({
          object_type: 'document',
          object_id: doc.id,
          reason: `${doc.label} was rejected by the filing authority and must be corrected and re-filed.`,
          deep_link: link('#documents'),
        });
      } else if (doc.filing_status !== FilingStatus.filed && doc.filing_status !== FilingStatus.accepted) {
        chaBlockers.push({
          object_type: 'document',
          object_id: doc.id,
          reason: `${doc.label} has not been filed with customs yet.`,
          deep_link: link('#documents'),
        });
      }
    }
  }

  // --- Gate 5: pickup ---
  const pickupBlockers: Blocker[] = [];
  if (ctx.shipment && !milestoneDone(ctx, PICKUP_MILESTONE)) {
    pickupBlockers.push({
      object_type: 'shipment',
      object_id: ctx.shipment.id,
      reason: 'Pickup has not been confirmed against the shipment yet.',
      deep_link: link('#shipment'),
    });
  }

  // --- Gate 6: customs ---
  const customsBlockers: Blocker[] = [];
  if (ctx.shipment && !milestoneDone(ctx, CUSTOMS_MILESTONE)) {
    customsBlockers.push({
      object_type: 'shipment',
      object_id: ctx.shipment.id,
      reason: 'Customs clearance is not recorded as complete.',
      deep_link: link('#shipment'),
    });
  }

  // --- Gate 7: shipment in motion / delivered ---
  const shipmentBlockers: Blocker[] = [];
  if (!ctx.shipment) {
    shipmentBlockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: 'No shipment has been created for this deal.',
      deep_link: link('#shipment'),
    });
  } else if (ctx.shipment.exception_state !== ExceptionState.none) {
    shipmentBlockers.push({
      object_type: 'shipment',
      object_id: ctx.shipment.id,
      reason: ctx.shipment.exception_reason ?? 'The shipment has an open exception.',
      deep_link: link('#shipment'),
    });
  }

  // --- Gate 8: payment ---
  const paymentBlockers: Blocker[] = [];
  const unrealized = ctx.payments.filter((p) => p.status !== PaymentStatus.realized);
  for (const p of unrealized) {
    const name = p.label ?? 'Payment';
    if (p.status === PaymentStatus.disputed) {
      paymentBlockers.push({
        object_type: 'payment',
        object_id: p.id,
        reason: `${name} is disputed.`,
        deep_link: link('#payment'),
      });
    } else if (p.status === PaymentStatus.overdue) {
      paymentBlockers.push({
        object_type: 'payment',
        object_id: p.id,
        reason: `${name} is overdue from the buyer.`,
        deep_link: link('#payment'),
      });
    } else {
      paymentBlockers.push({
        object_type: 'payment',
        object_id: p.id,
        reason: `${name} is not realized yet (currently ${p.status.replace(/_/g, ' ')}).`,
        deep_link: link('#payment'),
      });
    }
  }

  const shipmentStatus = ctx.shipment?.status ?? null;

  const raw: {
    id: GateId;
    blockers: Blocker[];
    done: boolean;
    detail: string;
    actions: readonly ExecutionActionKey[];
  }[] = [
    {
      id: 'terms_locked',
      blockers: termsBlockers,
      done: isLocked,
      detail: isLocked ? 'Terms are frozen by the deal snapshot.' : 'Terms are still negotiable.',
      actions: [],
    },
    {
      id: 'required_inputs',
      blockers: inputBlockers,
      done: inputBlockers.length === 0,
      detail: inputBlockers.length === 0 ? 'All required inputs are in place.' : `${inputBlockers.length} input(s) outstanding.`,
      actions: [],
    },
    {
      id: 'documents',
      blockers: docBlockers,
      done: docBlockers.length === 0,
      detail:
        docBlockers.length === 0
          ? 'Every required document is generated and approved.'
          : `${docBlockers.length} document(s) need work.`,
      actions: ['document.generate', 'document.approve'],
    },
    {
      id: 'cha_filing',
      blockers: chaBlockers,
      done: chaBlockers.length === 0,
      detail: ctx.shipment?.cha_partner_name
        ? `CHA: ${ctx.shipment.cha_partner_name}${ctx.shipment.shipping_bill_no ? ` · SB ${ctx.shipment.shipping_bill_no}` : ''}`
        : 'No CHA assigned.',
      actions: ['partner.assign', 'document.file'],
    },
    {
      id: 'pickup',
      blockers: pickupBlockers,
      done: milestoneDone(ctx, PICKUP_MILESTONE),
      detail: milestoneDone(ctx, PICKUP_MILESTONE) ? 'Goods picked up.' : 'Pickup not confirmed.',
      actions: ['pickup.confirm'],
    },
    {
      id: 'customs',
      blockers: customsBlockers,
      done: milestoneDone(ctx, CUSTOMS_MILESTONE),
      detail: milestoneDone(ctx, CUSTOMS_MILESTONE)
        ? `Cleared${ctx.shipment?.customs_ref ? ` · ref ${ctx.shipment.customs_ref}` : ''}`
        : 'Not cleared.',
      actions: ['customs.record'],
    },
    {
      id: 'shipment',
      blockers: shipmentBlockers,
      done: shipmentStatus === ShipmentStatus.delivered,
      detail: shipmentStatus ? `Shipment is ${shipmentStatus.replace(/_/g, ' ')}.` : 'No shipment yet.',
      actions: ['shipment.milestone'],
    },
    {
      id: 'payment',
      blockers: paymentBlockers,
      done: ctx.payments.length > 0 && paymentBlockers.length === 0,
      detail:
        ctx.payments.length === 0
          ? 'No payment milestones recorded.'
          : `${ctx.payments.length - unrealized.length} of ${ctx.payments.length} realized.`,
      actions: ['payment.record'],
    },
  ];

  // Cascade: the first gate that is not `done` is the live one; everything after it is
  // `waiting` unless it has a real problem of its own worth surfacing early.
  let upstreamSatisfied = true;
  return raw.map((g) => {
    let state: GateState;
    if (g.blockers.length > 0) {
      // A gate with its own blockers reports `blocked` only when it is actually this
      // gate's turn. Downstream gates keep their blockers for context but read as
      // `waiting` — a customs blocker while pickup is still open is not actionable.
      state = upstreamSatisfied ? 'blocked' : 'waiting';
    } else if (g.done) {
      state = 'done';
    } else {
      state = upstreamSatisfied ? 'ready' : 'waiting';
    }
    if (!g.done) upstreamSatisfied = false;

    return {
      id: g.id,
      label: GATE_LABELS[g.id],
      state,
      blockers: state === 'blocked' ? g.blockers : [],
      detail: g.detail,
      actions: g.actions,
    };
  });
}

/**
 * The single question every action button asks. Returns the governing gate when the
 * action is refused, so the caller renders the reason and link rather than a bare
 * disabled control (docs/05 AGT-06 "Prerequisite blocked → disable downstream action with
 * reason and link").
 */
export function isActionAllowed(
  checklist: ExecutionGate[],
  action: ExecutionActionKey,
): { allowed: true } | { allowed: false; gate: ExecutionGate } {
  const gate = checklist.find((g) => g.actions.includes(action));
  if (!gate) return { allowed: true };
  if (gate.state === 'ready' || gate.state === 'done') return { allowed: true };
  return { allowed: false, gate };
}

/**
 * Server-side enforcement for route handlers. The checklist is not merely a rendering
 * hint: a handler that mutates gated state calls this and throws the same
 * PREREQUISITES_NOT_MET envelope the UI already knows how to render, so hand-crafting the
 * request bypasses nothing (docs/07 "never trust the client").
 */
export function assertActionAllowed(checklist: ExecutionGate[], action: ExecutionActionKey): void {
  const verdict = isActionAllowed(checklist, action);
  if (verdict.allowed) return;
  throw prerequisitesNotMet(
    verdict.gate.blockers.length > 0
      ? verdict.gate.blockers
      : [
          {
            object_type: 'deal',
            object_id: '',
            reason: `“${verdict.gate.label}” is not ready yet, so this action is not available.`,
          },
        ],
    `This action depends on “${verdict.gate.label}”, which is not ready yet.`,
  );
}
