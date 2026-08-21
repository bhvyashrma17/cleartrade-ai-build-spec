/**
 * Deal state machine — docs/07 §7.2.
 *
 * `deal_locked` is the most consequential transition in the product, so it is the
 * one transition this module refuses to take on trust. `assertDealTransition` will
 * not move a deal to `deal_locked` from a boolean the caller passed in — it demands
 * the server-loaded `DealLockContext` and re-checks every prerequisite itself
 * (docs/07 §7.2: "never trust the client", AGT-05-AC03).
 *
 * Like the other machines here this module is pure: it reads no database and writes
 * nothing. It validates, and it returns the side effects the caller must perform in
 * the same transaction — for a lock, the full `DealLockPlan`.
 */

import { ApprovalStatus, DealStage, DocType, IecStatus, TaskPriority, UserRole, Visibility } from '@prisma/client';
import {
  ApiError,
  ERROR_CODES,
  InvalidTransitionError,
  dealLockPrerequisitesNotMet,
  prerequisitesNotMet,
  validationError,
} from '@/lib/errors';
import type { DocTypeRegistryEntry, FeePolicySnapshot } from '@/lib/config';
import { resolvedDocumentLifecyclePolicy } from '@/lib/document-lifecycle-policy';
import type { Blocker, Money } from '@/types';

type Stage = DealStage;

/** Allowed target stages per current stage. */
const TRANSITIONS: Record<Stage, Stage[]> = {
  qualifying: [DealStage.negotiating, DealStage.closed_lost, DealStage.cancelled],
  negotiating: [DealStage.terms_agreed, DealStage.closed_lost, DealStage.cancelled],
  // No direct cancel from terms_agreed: docs/07 §7.2 routes a withdrawal after approvals
  // back through `negotiating` first, so the accepted proposal version is superseded on
  // the record rather than abandoned (AGT-05-AC04).
  terms_agreed: [DealStage.deal_locked, DealStage.negotiating],
  // Cancelling a locked or executing deal is the "controlled path" — reasoned, and
  // authorized by Ops rather than by whoever happens to hold the deal.
  deal_locked: [DealStage.executing, DealStage.cancelled],
  executing: [DealStage.shipped, DealStage.cancelled],
  shipped: [DealStage.closed_won],
  closed_won: [],
  // Reopen is restricted and reasoned, and it lands on the stage whose work must be
  // redone — not on the stage the deal died in.
  closed_lost: [DealStage.negotiating],
  cancelled: [DealStage.qualifying],
};

export const ACTIVE_DEAL_STAGES: Stage[] = [
  DealStage.qualifying,
  DealStage.negotiating,
  DealStage.terms_agreed,
  DealStage.deal_locked,
  DealStage.executing,
  DealStage.shipped,
];

/** Past this line the Deal Snapshot governs, and commercial terms need an amendment. */
export const LOCKED_STAGES: Stage[] = [
  DealStage.deal_locked,
  DealStage.executing,
  DealStage.shipped,
  DealStage.closed_won,
];

/** Stages a deal can only leave through a reasoned, Ops-authorized cancellation. */
const CONTROLLED_CANCEL_FROM: Stage[] = [DealStage.deal_locked, DealStage.executing];

const REOPEN_TARGETS: Stage[] = [DealStage.closed_lost, DealStage.cancelled];

/**
 * Canonical deal deep link. docs/09 §2 writes blocker links as `/app/deals/…`; the agent
 * portal resolves the same deal under `/agent/deals/:dealId` (AGT-06). One helper so the
 * blockers below never hand-roll a path.
 */
export const dealDeepLink = (dealId: string, ...segments: string[]): string =>
  ['/app/deals', dealId, ...segments].join('/');

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export interface DealTransitionInput {
  /** Required for `closed_lost` and every `cancelled` transition (docs/07 §7.2). */
  closed_reason?: string | null;
  /**
   * Cancelling from `deal_locked` / `executing` is the controlled path: pass the result of
   * the Ops authorization check, never a client-supplied flag. The snapshot, documents and
   * audit trail survive the cancellation — cancelling never deletes execution history.
   */
  controlled_cancel_authorized?: boolean;
  /** Reopening a closed/cancelled deal is restricted; pass the Ops/admin check result. */
  reopen_authorized?: boolean;
  /** Set on the Deal at lock time. A deal that ever locked cannot be reopened. */
  locked_at?: Date | null;
  /**
   * Required to reach `deal_locked`. Loaded server-side from the deal, its documents, its
   * exporter org and the fee policy in force — there is deliberately no way to reach
   * `deal_locked` by asserting that the prerequisites were already checked elsewhere.
   */
  lock?: DealLockContext;
  /** Document registry (config, not constants — docs/01 §2) used to build the checklist. */
  document_registry?: DocTypeRegistryEntry[];
}

/** Side effects the caller must perform inside the same transaction. */
export interface DealTransitionEffects {
  /** docs/07 §7.2 step 2 — freeze the Deal Snapshot all documents generate from. */
  freeze_snapshot: boolean;
  /** Step 3 — the fee policy in force at this moment, onto `Deal.quoted_fee_policy`. */
  snapshot_fee_policy: boolean;
  /** Step 4. */
  create_execution_tasks: boolean;
  create_document_checklist: boolean;
  /** Step 5 — commercial terms become read-only except via the amendment workflow. */
  lock_commercial_terms: boolean;
  set_locked_at: boolean;
  /** Cross-machine dependency (docs/07 §Cross-machine): Shipment becomes available. */
  enable_shipment_creation: boolean;
  /** AGT-05-AC04 — a revision never mutates an accepted historical version. */
  preserve_proposal_history: boolean;
  /** Losing or cancelling closes the open sales-side tasks; it does not delete them. */
  close_open_sales_tasks: boolean;
  require_reason: boolean;
  /** The lock plan, present only on the transition to `deal_locked`. */
  lock_plan: DealLockPlan | null;
  /** Every material transition is audited (docs/07 universal rules). */
  audit: true;
}

export function canTransitionDeal(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedDealTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

/**
 * Validate a deal stage transition and return the side effects it obliges.
 * Throws InvalidTransitionError, VALIDATION_ERROR or DEAL_LOCK_PREREQUISITES_NOT_MET —
 * never returns a "false" the caller can forget to check.
 */
export function assertDealTransition(
  from: Stage,
  to: Stage,
  input: DealTransitionInput = {},
): DealTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('deal', from, to, 'The deal is already at this stage.');
  }
  if (!canTransitionDeal(from, to)) {
    throw new InvalidTransitionError('deal', from, to);
  }

  const isReopen = REOPEN_TARGETS.includes(from);
  const isClosing = to === DealStage.closed_lost || to === DealStage.cancelled;

  if (isClosing && !input.closed_reason) {
    throw validationError(
      [
        {
          field: 'closed_reason',
          code: 'required',
          message:
            to === DealStage.closed_lost
              ? 'Say why this opportunity was lost.'
              : 'Say why this deal is being stopped.',
        },
      ],
      'Closing or cancelling a deal requires a reason.',
    );
  }

  if (to === DealStage.cancelled && CONTROLLED_CANCEL_FROM.includes(from)) {
    if (!input.controlled_cancel_authorized) {
      throw prerequisitesNotMet(
        [
          {
            object_type: 'deal',
            object_id: input.lock?.deal_id ?? '',
            reason:
              'A locked deal can only be cancelled through the controlled path, authorized by Ops.',
            deep_link: '/ops/exceptions',
          },
        ],
        'This deal has been locked. Ops must authorize the cancellation.',
      );
    }
  }

  if (isReopen) {
    if (!input.reopen_authorized) {
      throw prerequisitesNotMet(
        [
          {
            object_type: 'deal',
            object_id: input.lock?.deal_id ?? '',
            reason: 'Reopening a closed or cancelled deal is restricted to Ops.',
            deep_link: '/ops/exceptions',
          },
        ],
        'Reopening this deal needs Ops authorization.',
      );
    }
    // A deal that reached lock froze a snapshot and produced execution artefacts. Rewinding
    // it to a sales stage would leave those pointing at terms nobody agreed to; the correct
    // path is a new deal (or an amendment, if it is still live).
    if (input.locked_at) {
      throw prerequisitesNotMet(
        [
          {
            object_type: 'deal',
            object_id: input.lock?.deal_id ?? '',
            reason:
              'This deal was locked, so its terms and documents are frozen. Start a new deal instead.',
            deep_link: '/app/deals/new',
          },
        ],
        'A deal that was locked cannot be reopened.',
      );
    }
  }

  let lockPlan: DealLockPlan | null = null;
  if (to === DealStage.deal_locked) {
    if (!input.lock) {
      // A server bug, not a user error: the route handler reached the lock without loading
      // the facts the lock is supposed to be verified against.
      throw new ApiError(ERROR_CODES.INTERNAL_ERROR, {
        cause:
          'assertDealTransition(→ deal_locked) requires a server-loaded DealLockContext. ' +
          'Load the deal, its documents, its exporter org and the active fee policy, then retry.',
      });
    }
    lockPlan = planDealLock(input.lock, input.document_registry ?? []);
  }

  return {
    freeze_snapshot: to === DealStage.deal_locked,
    snapshot_fee_policy: to === DealStage.deal_locked,
    create_execution_tasks: to === DealStage.deal_locked,
    create_document_checklist: to === DealStage.deal_locked,
    lock_commercial_terms: to === DealStage.deal_locked,
    set_locked_at: to === DealStage.deal_locked,
    enable_shipment_creation: to === DealStage.deal_locked,
    preserve_proposal_history: from === DealStage.terms_agreed && to === DealStage.negotiating,
    close_open_sales_tasks: isClosing,
    require_reason: isClosing,
    lock_plan: lockPlan,
    audit: true,
  };
}

// ---------------------------------------------------------------------------
// deal_locked — 1. verify every required approval, server-side
// ---------------------------------------------------------------------------

/** The current state of one document, as loaded from the database. */
export interface DealLockDocumentState {
  id: string;
  doc_type: DocType;
  version: number;
  is_current_version: boolean;
  checksum: string | null;
  approval_status: ApprovalStatus;
  /** Approval binds to a version + checksum, not to the document identity (docs/07 §7.3). */
  approved_version: number | null;
  approved_checksum: string | null;
}

/**
 * The accepted commercial proposal. `approver_is_exporter_authorized` is the result of
 * `canApproveCommercialTerms()` in src/lib/permissions.ts evaluated against the approving
 * actor — AGT-05-AC02: the exporter approves commercial terms, never the agent on their
 * behalf. Recomputed here rather than read off the request.
 */
export interface CommercialApprovalState {
  proposal_version: number;
  approved_at: Date;
  approved_by_id: string;
  approver_is_exporter_authorized: boolean;
}

/** The commercial terms as they stand on the live Deal, about to be frozen. */
export interface DealCommercialTerms {
  quantity: string | null;
  unit: string | null;
  unit_price: Money | null;
  total: Money | null;
  incoterm: string | null;
  incoterm_place: string | null;
  payment_terms: unknown | null;
  /** Held in `Deal.delivery_terms` (docs/02 "dates/commitments") until it is snapshotted. */
  ship_window: { start: Date | null; end: Date | null } | null;
  /** Optional by policy — an absent special condition is not a blocker. */
  special_conditions: string | null;
}

/**
 * Everything the lock is verified against. Every field is loaded server-side; nothing here
 * comes from the request body except the terms the exporter already approved.
 */
export interface DealLockContext {
  deal_id: string;
  stage: Stage;
  exporter_org_id: string;
  buyer_id: string | null;
  buyer_legal_name: string | null;
  product_id: string | null;
  product_name: string | null;
  sku: string | null;
  terms: DealCommercialTerms;
  commercial_approval: CommercialApprovalState | null;
  /** Current-version documents on the deal. */
  documents: DealLockDocumentState[];
  /** From the exporter org: an unverified IEC cannot authorize an export. */
  exporter_iec: IecStatus;
  /** From `getFeePolicy()`. Null means no active policy — never fall back to a constant. */
  fee_policy: FeePolicySnapshot | null;
  /** Snapshots already frozen on this deal; the new one takes the next version. */
  existing_snapshot_versions: number[];
  locked_by_id?: string | null;
}

/**
 * Documents that must already be exporter-approved *before* the lock. The rest of the
 * document set is created *by* the lock (see LOCK_DOCUMENT_CHECKLIST below) and cannot be
 * a precondition for it.
 */
const PRE_LOCK_APPROVED_DOC_TYPES: DocType[] = [DocType.PI];

/**
 * Every reason this deal cannot be locked, as an actionable list with deep links.
 *
 * Returns all of them rather than the first — docs/09 §2: the blockers[] array is what lets
 * the UI render "here is exactly what to fix" instead of a dead end (AGT-06-AC01).
 */
export function collectDealLockBlockers(ctx: DealLockContext): Blocker[] {
  const blockers: Blocker[] = [];
  const link = (...segments: string[]) => dealDeepLink(ctx.deal_id, ...segments);

  if (ctx.stage !== DealStage.terms_agreed) {
    blockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: `Commercial terms must be agreed before locking. This deal is at "${DEAL_STAGE_LABELS[ctx.stage]}".`,
      deep_link: link('commercial'),
    });
  }

  // --- Core references (docs/07 §7.2 `qualifying` guard) ---
  if (!ctx.buyer_id) {
    blockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: 'This deal has no buyer.',
      deep_link: link('commercial'),
    });
  }
  if (!ctx.product_id) {
    blockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: 'This deal has no product.',
      deep_link: link('commercial'),
    });
  }

  // --- Commercial approval (AGT-05-AC02, AGT-05-AC03) ---
  if (!ctx.commercial_approval) {
    blockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason: 'No accepted commercial proposal version is recorded.',
      deep_link: link('commercial'),
    });
  } else if (!ctx.commercial_approval.approver_is_exporter_authorized) {
    blockers.push({
      object_type: 'deal',
      object_id: ctx.deal_id,
      reason:
        'Commercial terms were not approved by an exporter-authorized user. The exporter must approve their own terms.',
      deep_link: link('commercial'),
    });
  }

  // --- Terms completeness: every field the snapshot freezes ---
  const { terms } = ctx;
  const missing: [boolean, string][] = [
    [!terms.quantity || !terms.unit, 'Quantity and unit are not set.'],
    [!terms.unit_price?.amount || !terms.unit_price.currency, 'Unit price and currency are not set.'],
    [!terms.total?.amount || !terms.total.currency, 'Total value and currency are not set.'],
    [!terms.incoterm, 'Incoterm is not set.'],
    [!terms.payment_terms, 'Payment terms are not set.'],
    [
      !terms.ship_window?.start || !terms.ship_window?.end,
      'The ship window has no start and end date.',
    ],
  ];
  for (const [isMissing, reason] of missing) {
    if (isMissing) {
      blockers.push({
        object_type: 'deal',
        object_id: ctx.deal_id,
        reason,
        deep_link: link('commercial'),
      });
    }
  }

  // --- Required document approvals, bound to version + checksum ---
  for (const docType of PRE_LOCK_APPROVED_DOC_TYPES) {
    const doc = ctx.documents.find((d) => d.doc_type === docType && d.is_current_version);
    const label = DOC_TYPE_FALLBACK_LABELS[docType];
    if (!doc) {
      blockers.push({
        object_type: 'document',
        object_id: '',
        reason: `${label} has not been generated yet.`,
        deep_link: link('documents'),
      });
      continue;
    }
    if (doc.approval_status !== ApprovalStatus.exporter_approved) {
      blockers.push({
        object_type: 'document',
        object_id: doc.id,
        reason:
          doc.approval_status === ApprovalStatus.rejected
            ? `${label} was rejected by the exporter.`
            : `${label} is awaiting exporter approval.`,
        deep_link: link('documents', doc.id),
      });
      continue;
    }
    const versionMatches = doc.approved_version === doc.version;
    const checksumMatches = !doc.checksum || doc.approved_checksum === doc.checksum;
    if (!versionMatches || !checksumMatches) {
      blockers.push({
        object_type: 'document',
        object_id: doc.id,
        reason: `${label} changed after it was approved. The current version needs approval again.`,
        deep_link: link('documents', doc.id),
      });
    }
  }

  // --- Exporter can actually export ---
  if (ctx.exporter_iec !== IecStatus.verified) {
    blockers.push({
      object_type: 'exporter_org',
      object_id: ctx.exporter_org_id,
      reason: 'The exporter’s IEC is not verified yet.',
      deep_link: '/app/readiness',
    });
  }

  // --- Fee policy must exist to be snapshotted (docs/01 §2: never a hardcoded fallback) ---
  if (!ctx.fee_policy) {
    blockers.push({
      object_type: 'fee_policy',
      object_id: '',
      reason: 'No active fee policy is configured, so the deal’s fee terms cannot be frozen.',
      deep_link: '/ops/settings/fees',
    });
  }

  return blockers;
}

/** Throws DEAL_LOCK_PREREQUISITES_NOT_MET with the full blockers[] list, or returns. */
export function assertDealLockPrerequisites(ctx: DealLockContext): void {
  const blockers = collectDealLockBlockers(ctx);
  if (blockers.length > 0) throw dealLockPrerequisitesNotMet(blockers);
}

// ---------------------------------------------------------------------------
// deal_locked — 2 & 3. freeze the Deal Snapshot and the fee policy
// ---------------------------------------------------------------------------

/**
 * The frozen record all documents subsequently generate from (docs/07 §7.2 step 2,
 * AGT-05 "Deal lock gate"). Shaped to write straight into `DealSnapshot`.
 */
export interface DealSnapshotDraft {
  deal_id: string;
  version: number;
  buyer_id: string;
  buyer_legal_name: string;
  product_id: string | null;
  product_name: string | null;
  sku: string | null;
  quantity: string | null;
  unit: string | null;
  unit_price_amount: string | null;
  unit_price_currency: string | null;
  total_amount: string | null;
  total_currency: string | null;
  incoterm: string | null;
  incoterm_place: string | null;
  payment_terms: unknown | null;
  ship_window_start: Date | null;
  ship_window_end: Date | null;
  special_conditions: string | null;
  /** Step 3 — the fee policy in force at this moment, not a reference to the live one. */
  fee_policy: FeePolicySnapshot;
  created_by_id: string | null;
}

/** Next snapshot version. v1 at lock; an approved amendment writes v2, v3… */
export function nextSnapshotVersion(existingVersions: number[]): number {
  return existingVersions.length === 0 ? 1 : Math.max(...existingVersions) + 1;
}

/**
 * Build the snapshot. Call only after `assertDealLockPrerequisites` — this copies values,
 * it does not validate them.
 */
export function buildDealSnapshot(ctx: DealLockContext): DealSnapshotDraft {
  const { terms } = ctx;
  return {
    deal_id: ctx.deal_id,
    version: nextSnapshotVersion(ctx.existing_snapshot_versions),
    buyer_id: ctx.buyer_id as string,
    buyer_legal_name: ctx.buyer_legal_name ?? '',
    product_id: ctx.product_id,
    product_name: ctx.product_name,
    sku: ctx.sku,
    quantity: terms.quantity,
    unit: terms.unit,
    unit_price_amount: terms.unit_price?.amount ?? null,
    unit_price_currency: terms.unit_price?.currency ?? null,
    total_amount: terms.total?.amount ?? null,
    total_currency: terms.total?.currency ?? null,
    incoterm: terms.incoterm,
    incoterm_place: terms.incoterm_place,
    payment_terms: terms.payment_terms,
    ship_window_start: terms.ship_window?.start ?? null,
    ship_window_end: terms.ship_window?.end ?? null,
    special_conditions: terms.special_conditions,
    fee_policy: ctx.fee_policy as FeePolicySnapshot,
    created_by_id: ctx.locked_by_id ?? null,
  };
}

// ---------------------------------------------------------------------------
// deal_locked — 4. required execution tasks and document checklist
// ---------------------------------------------------------------------------

interface LockChecklistSpec {
  doc_type: DocType;
  /**
   * False for documents whose applicability is decided first — the checklist entry and its
   * task still exist, but the document may legitimately end up `not_applicable`.
   */
  required: boolean;
  /** Key into `sla.thresholds` config — never a hardcoded duration (docs/01 §2). */
  sla_key: string;
  priority: TaskPriority;
  /** Conditional documents exist as first-class rows but do not create permanent queue noise. */
  create_task?: boolean;
}

/**
 * The document set the lock creates (docs/07 §7.3 "Document types and default owners").
 * The Proforma Invoice is deliberately absent: it is a *precondition* of the lock, already
 * approved by the time we get here.
 */
const LOCK_DOCUMENT_CHECKLIST: LockChecklistSpec[] = [
  { doc_type: DocType.CI, required: true, sla_key: 'agent_document_review', priority: TaskPriority.high },
  { doc_type: DocType.packing_list, required: true, sla_key: 'agent_document_review', priority: TaskPriority.high },
  {
    doc_type: DocType.shipping_bill_draft,
    required: true,
    sla_key: 'agent_document_review',
    priority: TaskPriority.high,
  },
  { doc_type: DocType.COO_draft, required: true, sla_key: 'agent_document_review', priority: TaskPriority.normal },
  { doc_type: DocType.declaration, required: true, sla_key: 'agent_document_review', priority: TaskPriority.normal },
  {
    doc_type: DocType.insurance_declaration,
    required: false,
    sla_key: 'agent_document_review',
    priority: TaskPriority.normal,
  },
  {
    doc_type: DocType.shipping_instructions,
    required: true,
    sla_key: 'agent_document_review',
    priority: TaskPriority.high,
  },
  {
    doc_type: DocType.vgm_declaration,
    required: false,
    sla_key: 'agent_document_review',
    priority: TaskPriority.high,
    create_task: false,
  },
  {
    doc_type: DocType.bill_of_exchange,
    required: false,
    sla_key: 'agent_document_review',
    priority: TaskPriority.normal,
    create_task: false,
  },
  {
    doc_type: DocType.carrier_instructions,
    required: false,
    sla_key: 'agent_document_review',
    priority: TaskPriority.high,
    create_task: false,
  },
  {
    doc_type: DocType.bank_collection_letter,
    required: false,
    sla_key: 'agent_document_review',
    priority: TaskPriority.normal,
    create_task: false,
  },
];

/**
 * Labels are read from the `documents.registry` config. These fallbacks only cover a
 * registry that has not been seeded yet, and match CONFIG_DEFAULTS.
 */
const DOC_TYPE_FALLBACK_LABELS: Record<DocType, string> = {
  PI: 'Proforma invoice',
  CI: 'Commercial invoice',
  packing_list: 'Packing list',
  shipping_bill_draft: 'Customs shipping bill (draft)',
  COO_draft: 'Certificate of origin (draft)',
  declaration: 'Export declaration',
  insurance_declaration: 'Insurance declaration',
  shipping_instructions: 'Shipping instructions',
  vgm_declaration: 'VGM declaration',
  bill_of_exchange: 'Bill of exchange',
  carrier_instructions: 'Carrier instructions',
  bank_collection_letter: 'Bank document presentation letter',
  other: 'Document',
};

/** One row of the checklist created at lock. */
export interface DocumentChecklistItem {
  deal_id: string;
  doc_type: DocType;
  label: string;
  required: boolean;
  approval_required: boolean;
  filing_applicable: boolean;
  owner_role: UserRole;
  /** Documents generate from the snapshot, never from live deal fields (docs/13 E1). */
  generated_from_snapshot_version: number;
}

/** A task to create at lock. `due_at` is resolved by the caller from the SLA config. */
export interface ExecutionTaskDraft {
  deal_id: string;
  scope_type: 'deal';
  title: string;
  description: string | null;
  owner_role: UserRole;
  priority: TaskPriority;
  visibility: Visibility;
  task_type: string;
  /** Feed to `getConfig('sla.thresholds')` + `scheduleFromThreshold()` in task.ts. */
  sla_key: string;
}

/**
 * Execution work that is not a document. The document tasks are derived from the checklist
 * below so the two can never drift apart.
 */
const NON_DOCUMENT_EXECUTION_TASKS: Omit<ExecutionTaskDraft, 'deal_id' | 'scope_type'>[] = [
  {
    title: 'Confirm ship window and pickup readiness',
    description: 'Confirm the goods will be ready within the locked ship window.',
    owner_role: UserRole.exporter_owner,
    priority: TaskPriority.high,
    visibility: Visibility.exporter_visible,
    task_type: 'exporter_confirm_ship_window',
    sla_key: 'exporter_input_request',
  },
  {
    title: 'Plan the shipment and book the partner',
    description: 'Create the shipment, choose the mode and route, and assign the partner.',
    owner_role: UserRole.agent,
    priority: TaskPriority.high,
    visibility: Visibility.exporter_visible,
    task_type: 'plan_shipment',
    sla_key: 'default',
  },
  {
    title: 'Check insurance applicability',
    description: 'Decide whether an insurance declaration is required for this shipment.',
    owner_role: UserRole.agent,
    priority: TaskPriority.normal,
    visibility: Visibility.internal,
    task_type: 'insurance_applicability_check',
    sla_key: 'default',
  },
];

const roleFromRegistry = (role: string | undefined): UserRole =>
  role && role in UserRole ? (role as UserRole) : UserRole.agent;

/**
 * Build the document checklist and the execution tasks the lock must create.
 *
 * `registry` is the `documents.registry` config value — labels, owners, approval and filing
 * applicability are business settings, not constants (docs/01 §2). Pass `[]` only in tests;
 * the fallbacks then mirror CONFIG_DEFAULTS.
 */
export function buildExecutionPlan(
  dealId: string,
  snapshotVersion: number,
  registry: DocTypeRegistryEntry[],
): { documents: DocumentChecklistItem[]; tasks: ExecutionTaskDraft[] } {
  const documents: DocumentChecklistItem[] = [];
  const documentTasks: ExecutionTaskDraft[] = [];

  for (const spec of LOCK_DOCUMENT_CHECKLIST) {
    const entry = registry.find((r) => r.doc_type === spec.doc_type);
    const lifecycle = resolvedDocumentLifecyclePolicy(spec.doc_type, entry);
    const label = entry?.label ?? DOC_TYPE_FALLBACK_LABELS[spec.doc_type];
    const ownerRole = roleFromRegistry(entry?.default_owner_role);

    documents.push({
      deal_id: dealId,
      doc_type: spec.doc_type,
      label,
      required: spec.required,
      approval_required: lifecycle.exporter_approval_required,
      filing_applicable: lifecycle.filing_applicable,
      owner_role: ownerRole,
      generated_from_snapshot_version: snapshotVersion,
    });

    if (spec.create_task !== false) {
      documentTasks.push({
        deal_id: dealId,
        scope_type: 'deal',
        title: `Prepare ${label.toLowerCase()}`,
        description: `Generate ${label.toLowerCase()} from the locked deal snapshot and review it before it goes to the exporter.`,
        owner_role: ownerRole,
        priority: spec.priority,
        visibility: Visibility.exporter_visible,
        task_type: `prepare_${spec.doc_type}`,
        sla_key: spec.sla_key,
      });
    }
  }

  const tasks: ExecutionTaskDraft[] = [
    ...documentTasks,
    ...NON_DOCUMENT_EXECUTION_TASKS.map((t) => ({ ...t, deal_id: dealId, scope_type: 'deal' as const })),
  ];

  return { documents, tasks };
}

// ---------------------------------------------------------------------------
// deal_locked — the whole plan
// ---------------------------------------------------------------------------

export interface DealLockPlan {
  deal_id: string;
  snapshot: DealSnapshotDraft;
  /** Written to `Deal.quoted_fee_policy`; later config changes never rewrite it. */
  quoted_fee_policy: FeePolicySnapshot;
  documents: DocumentChecklistItem[];
  tasks: ExecutionTaskDraft[];
  /** Step 5 — after this commit the fields below need an amendment to change. */
  locked_fields: readonly string[];
  /** Cross-machine dependency: a Shipment may now be created (docs/07 §Cross-machine). */
  enables_shipment: true;
}

/**
 * Verify the lock and return everything it must write. Every element of docs/07 §7.2 —
 * approvals, snapshot, fee policy, tasks, checklist, read-only terms — comes out of this
 * one call so a caller cannot commit half of a lock.
 *
 * The caller writes the whole plan in a single transaction, with the AuditEvent.
 */
export function planDealLock(
  ctx: DealLockContext,
  registry: DocTypeRegistryEntry[] = [],
): DealLockPlan {
  assertDealLockPrerequisites(ctx);

  const snapshot = buildDealSnapshot(ctx);
  const { documents, tasks } = buildExecutionPlan(ctx.deal_id, snapshot.version, registry);

  return {
    deal_id: ctx.deal_id,
    snapshot,
    quoted_fee_policy: snapshot.fee_policy,
    documents,
    tasks,
    locked_fields: LOCKED_COMMERCIAL_FIELDS,
    enables_shipment: true,
  };
}

// ---------------------------------------------------------------------------
// deal_locked — 5. commercial terms are read-only except via an amendment
// ---------------------------------------------------------------------------

/**
 * The fields the snapshot governs. Editing any of them on a locked deal is refused; the
 * amendment workflow is the only way through, and it writes a new snapshot version rather
 * than mutating the frozen one (docs/05 AGT-05 "Locked: commercial read-only except via
 * explicit amendment workflow").
 */
export const LOCKED_COMMERCIAL_FIELDS = [
  'buyer_id',
  'product_id',
  'quantity',
  'unit',
  'unit_price_amount',
  'unit_price_currency',
  'total_amount',
  'total_currency',
  'value_amount',
  'value_currency',
  'incoterm',
  'incoterm_place',
  'payment_terms',
  'delivery_terms',
] as const;

/**
 * An approved amendment. Like the original lock, the approval must come from an
 * exporter-authorized actor — an agent cannot amend locked terms on the exporter's behalf.
 */
export interface DealAmendment {
  id: string;
  approved_at: Date | null;
  approved_by_id: string | null;
  approver_is_exporter_authorized: boolean;
  /** Exactly the fields this amendment authorizes. Anything else stays frozen. */
  fields: string[];
  reason: string | null;
}

export function isDealLocked(deal: { stage: Stage; locked_at?: Date | null }): boolean {
  return LOCKED_STAGES.includes(deal.stage) || Boolean(deal.locked_at);
}

/**
 * Guard every write to a deal's commercial fields.
 *
 * Throws PREREQUISITES_NOT_MET with a blocker deep-linking to the amendment workflow, so the
 * UI can offer "start an amendment" instead of a dead end.
 */
export function assertCommercialTermsEditable(
  deal: { id: string; stage: Stage; locked_at?: Date | null },
  changedFields: string[],
  amendment?: DealAmendment | null,
): void {
  const locked = changedFields.filter((f) =>
    (LOCKED_COMMERCIAL_FIELDS as readonly string[]).includes(f),
  );
  if (locked.length === 0 || !isDealLocked(deal)) return;

  const amendmentLink = dealDeepLink(deal.id, 'amendments', 'new');

  if (!amendment || !amendment.approved_at) {
    throw prerequisitesNotMet(
      [
        {
          object_type: 'deal',
          object_id: deal.id,
          reason: `These terms are frozen by the deal snapshot: ${locked.join(', ')}. Raise an amendment to change them.`,
          deep_link: amendmentLink,
        },
      ],
      'Commercial terms are locked. Changing them needs an approved amendment.',
    );
  }

  if (!amendment.approver_is_exporter_authorized) {
    throw prerequisitesNotMet(
      [
        {
          object_type: 'deal_amendment',
          object_id: amendment.id,
          reason:
            'This amendment was not approved by an exporter-authorized user. The exporter must approve changes to their own terms.',
          deep_link: dealDeepLink(deal.id, 'amendments', amendment.id),
        },
      ],
      'This amendment still needs exporter approval.',
    );
  }

  const unauthorized = locked.filter((f) => !amendment.fields.includes(f));
  if (unauthorized.length > 0) {
    throw prerequisitesNotMet(
      [
        {
          object_type: 'deal_amendment',
          object_id: amendment.id,
          reason: `The approved amendment does not cover: ${unauthorized.join(', ')}.`,
          deep_link: dealDeepLink(deal.id, 'amendments', amendment.id),
        },
      ],
      'Some of these changes are outside the approved amendment.',
    );
  }
}

/**
 * An approved amendment writes a new snapshot version — it never edits the frozen one.
 * Documents generated before the amendment keep pointing at the version they came from,
 * which is what makes a historical document reproducible.
 */
export function buildAmendedSnapshot(
  ctx: DealLockContext,
  amendment: DealAmendment,
): DealSnapshotDraft {
  const draft = buildDealSnapshot(ctx);
  return { ...draft, created_by_id: amendment.approved_by_id ?? ctx.locked_by_id ?? null };
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export const DEAL_STAGE_LABELS: Record<Stage, string> = {
  qualifying: 'Qualifying',
  negotiating: 'In negotiation',
  terms_agreed: 'Terms agreed',
  deal_locked: 'Locked',
  executing: 'In execution',
  shipped: 'Shipped',
  closed_won: 'Closed — won',
  closed_lost: 'Closed — lost',
  cancelled: 'Cancelled',
};
