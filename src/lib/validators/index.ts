/**
 * Zod schemas mirroring API request payloads (AGENTS.md folder contract). Route
 * handlers parse with these and turn a failed parse into the docs/09 §2
 * VALIDATION_ERROR shape via `zodFieldErrors()` — never a bare 400.
 */

import type { ZodError } from 'zod';
import { z } from 'zod';
import type { FieldError } from '@/types';

/** Flatten a ZodError into the `fields[]` shape `validationError()` expects. */
export function zodFieldErrors(error: ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    code: issue.code,
    message: issue.message,
  }));
}

export const createBuyerLeadSchema = z.object({
  product_id: z.string().min(1, 'A product is required.'),
  buyer_id: z.string().min(1, 'A buyer is required.'),
  /** Required only when the caller isn't a tenant-scoped exporter (route enforces this). */
  exporter_org_id: z.string().min(1).optional(),
});

export type CreateBuyerLeadInput = z.infer<typeof createBuyerLeadSchema>;

/**
 * Demand Discovery input.
 *
 * Product context arrives one of two ways and exactly one must be present:
 *   - `product_id` — a saved Product (free/paid tiers)
 *   - ad-hoc description + HS code — typed straight into the search (guest tier)
 *
 * Guests deliberately do NOT get a placeholder Product row created for them. The ad-hoc
 * text is snapshotted onto the DiscoveryRun instead, and only becomes a real Product if
 * they choose to save it at registration.
 */
export const createDiscoveryRunSchema = z
  .object({
    product_id: z.string().min(1).optional(),
    product_description: z.string().trim().min(3, 'Describe your product in a few words.').max(500).optional(),
    hs_code: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'An HS code is 4 to 8 digits.')
      .optional(),
    target_countries: z.array(z.string().length(2)).max(20).optional(),
  })
  .refine((v) => Boolean(v.product_id) || Boolean(v.product_description), {
    message: 'Tell us what you export, or choose a saved product.',
    path: ['product_description'],
  })
  .refine((v) => !(v.product_id && v.product_description), {
    message: 'Choose a saved product or describe one — not both.',
    path: ['product_id'],
  });

export type CreateDiscoveryRunInput = z.infer<typeof createDiscoveryRunSchema>;

/** EXP-02 snapshots answers as data; question-level validation remains server-side. */
export const readinessAnswersSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  action: z.enum(['save', 'submit']),
});
export type ReadinessAnswersInput = z.infer<typeof readinessAnswersSchema>;

/** Registration — upgrades a guest tenant in place, or creates a fresh free one. */
export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Enter your name.').max(120),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
  organization_name: z.string().trim().min(1, 'Enter your company name.').max(200),
  /** Opt-in, never automatic: turn the guest's ad-hoc search input into a real Product. */
  save_discovery_input_as_product: z.boolean().optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Commercial proposal terms (AGT-05 offer builder / EXP-10).
 *
 * Every money field carries its currency explicitly — docs/02 "money = amount + currency,
 * never a bare number" — and quantity carries its unit, so a proposal can never encode a
 * price whose denomination is implied.
 */
export const proposalTermsSchema = z.object({
  quantity: z.coerce.number().positive('Quantity must be greater than zero.').nullish(),
  unit: z.string().trim().min(1).nullish(),
  unit_price_amount: z.coerce.number().positive('Unit price must be greater than zero.').nullish(),
  unit_price_currency: z.string().trim().length(3, 'Use a 3-letter currency code.').nullish(),
  total_amount: z.coerce.number().positive('Total must be greater than zero.').nullish(),
  total_currency: z.string().trim().length(3, 'Use a 3-letter currency code.').nullish(),
  incoterm: z.string().trim().min(1).nullish(),
  incoterm_place: z.string().trim().min(1).nullish(),
  payment_terms: z
    .object({
      type: z.string().trim().min(1, 'Choose a payment type.'),
      description: z.string().trim().min(1, 'Describe the payment terms.'),
    })
    .nullish(),
  ship_window_start: z.string().trim().min(1).nullish(),
  ship_window_end: z.string().trim().min(1).nullish(),
  special_conditions: z.string().trim().nullish(),
  agent_note: z.string().trim().nullish(),
  buyer_status: z.string().trim().nullish(),
  buyer_status_note: z.string().trim().nullish(),
});

export type ProposalTermsInput = z.infer<typeof proposalTermsSchema>;

/**
 * Approving a proposal. `version` is the immutable proposal version the exporter is
 * approving (EXP-10-AC01) and `deal_version` is the Deal row's optimistic-concurrency
 * token — both are required so a stale approval 409s instead of silently overwriting
 * (docs/09 §2 VERSION_CONFLICT).
 */
export const approveProposalSchema = z.object({
  version: z.coerce.number().int().positive(),
  deal_version: z.coerce.number().int().positive(),
});

export const requestChangesSchema = z.object({
  version: z.coerce.number().int().positive(),
  deal_version: z.coerce.number().int().positive(),
  note: z.string().trim().min(1, 'Say what needs to change.'),
});

/**
 * Approving/requesting-changes on a document version (EXP-13). `version` +
 * `checksum` are what "bound to version and checksum" (docs/07 §7.3) actually means at
 * the API boundary — approving without the checksum would let a regenerated document
 * silently inherit an approval that was given to different content.
 */
export const approveDocumentSchema = z.object({
  version: z.coerce.number().int().positive(),
  checksum: z.string().trim().min(1, 'Missing document checksum.'),
});

export const requestDocumentChangesSchema = z.object({
  version: z.coerce.number().int().positive(),
  checksum: z.string().trim().min(1, 'Missing document checksum.'),
  note: z.string().trim().min(1, 'Say what needs to change.'),
});

/** EXP-14 "Confirm pickup details" — whitelisted fields only (never CHA filing refs). */
export const confirmPickupSchema = z.object({
  pickup_window_start: z.string().trim().min(1, 'Pickup window start is required.'),
  pickup_window_end: z.string().trim().min(1, 'Pickup window end is required.'),
  contact_name: z.string().trim().min(1, 'A pickup contact name is required.'),
  contact_phone: z.string().trim().min(1, 'A pickup contact phone is required.'),
  address: z.string().trim().min(1, 'A pickup address is required.'),
});

export const raiseShipmentIssueSchema = z.object({
  reason: z.string().trim().min(1, 'Say what the issue is.'),
  severity: z.enum(['watch', 'blocked']).default('blocked'),
});

export const updatePaymentStatusSchema = z.object({
  action: z.literal('update_status'),
  to: z.enum(['due', 'partially_received', 'received', 'overdue', 'disputed']),
  source: z.enum(['exporter_update', 'AA', 'bank_partner', 'manual_ops']),
  amount_received: z.coerce.number().positive().nullish(),
  note: z.string().trim().nullish(),
  dispute_reason: z.string().trim().nullish(),
});

export const updateBrcStatusSchema = z.object({
  action: z.literal('update_brc'),
  to: z.enum(['pending', 'available', 'verified']),
});

export const requestInsuranceQuoteSchema = z.object({
  notes: z.string().trim().nullish(),
});

export const openPaymentDisputeSchema = z.object({
  payment_id: z.string().trim().min(1),
  reason: z.string().trim().min(1, 'Say what is being disputed.'),
});

// ---------------------------------------------------------------------------
// AGT-06 Agent Execution Workspace
// ---------------------------------------------------------------------------

/**
 * Partner assignment. `partner_id` is a reference into the approved directory — there is
 * deliberately no `partner_name` free-text escape hatch, so AGT-06's "no free-text
 * phantom partner in structured assignment" is a property of the schema rather than a
 * rule the handler has to remember to apply.
 */
export const assignPartnerSchema = z.object({
  partner_id: z.string().trim().min(1, 'Choose a partner from the approved directory.'),
  lane: z.enum(['cha', 'freight', 'insurance', 'inspection']),
  notes: z.string().trim().nullish(),
});

/** Recording what a partner sent back — AC02's "reference/evidence where available". */
export const updateHandoffSchema = z.object({
  handoff_id: z.string().trim().min(1),
  status: z.enum(['sent', 'acknowledged', 'completed', 'rejected']),
  reference: z.string().trim().nullish(),
  notes: z.string().trim().nullish(),
});

/** AGT-06 "hand to CHA" / filing status + reference on the canonical Document row. */
export const fileDocumentSchema = z.object({
  action: z.literal('mark_filed'),
  filing_status: z.enum(['ready', 'filed', 'accepted', 'rejected']),
  filing_reference: z.string().trim().nullish(),
  note: z.string().trim().nullish(),
});

/** Agent-side task transition. Mirrors the task state machine's required reasons. */
export const transitionTaskSchema = z.object({
  to: z.enum(['in_progress', 'waiting', 'done', 'cancelled']),
  blocked_reason: z.string().trim().nullish(),
  waiting_on: z.string().trim().nullish(),
  cancel_reason: z.string().trim().nullish(),
});

/**
 * Creating a task from the agent workspace. `visibility` is REQUIRED and has no default —
 * AGT-06 "Create exporter task | Visibility explicit". A default here (in either
 * direction) is how internal work silently becomes exporter-visible or vice versa.
 */
export const createDealTaskSchema = z.object({
  title: z.string().trim().min(1, 'Give the task a title.'),
  description: z.string().trim().nullish(),
  owner_role: z.enum(['exporter_owner', 'agent', 'ops_supervisor']),
  visibility: z.enum(['exporter_visible', 'internal']),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

/** AGT-06 "Escalate blocker → Exception to Ops → Dedup / open case link". */
export const escalateBlockerSchema = z.object({
  reason: z.string().trim().min(1, 'Say what is blocked and why Ops needs to step in.'),
  gate: z.string().trim().min(1),
  severity: z.enum(['medium', 'high', 'critical']).default('high'),
});

/** Internal note — agent/ops only, its own table, never a Message. */
export const createInternalNoteSchema = z.object({
  body: z.string().trim().min(1, 'Write the note.'),
});

// ---------------------------------------------------------------------------
// EXP-16 Messages, Support & Disputes
// ---------------------------------------------------------------------------

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message before sending.').max(4000, 'Keep messages under 4000 characters.'),
});

/**
 * "Open dispute" — prefilled with deal/shipment context per EXP-16, but the shipment/
 * payment ids are still validated server-side against THIS deal (loadDisputeContext),
 * never trusted from the client as a bare foreign key.
 */
export const openDisputeSchema = z.object({
  type: z.enum(['payment', 'quality', 'logistics', 'document', 'LC', 'inspection', 'other']),
  severity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  summary: z.string().trim().min(1, 'Describe the issue.').max(2000),
  shipment_id: z.string().trim().nullish(),
  payment_id: z.string().trim().nullish(),
});

export const assignDisputeSchema = z.object({
  action: z.literal('assign'),
  owner_user_id: z.string().trim().min(1, 'Choose an owner.'),
});

export const waitExternalDisputeSchema = z.object({
  action: z.literal('wait_external'),
  waiting_on: z.string().trim().min(1, 'Say who or what this is waiting on.'),
  follow_up_at: z.string().trim().min(1, 'Set a follow-up date.'),
});

export const proposeResolutionDisputeSchema = z.object({
  action: z.literal('propose_resolution'),
  resolution: z.string().trim().min(1, 'Describe the proposed resolution.').max(4000),
});

/** Ops closing a case on a basis other than exporter acceptance. */
export const closeDisputeSchema = z.object({
  action: z.literal('close'),
  closure_basis: z.string().trim().min(1, 'Record the basis for closing this case.'),
  closure_summary: z.string().trim().min(1, 'Summarize the outcome.'),
});

/** Exporter acceptance — EXP-16 "Mark resolution accepted and close, as policy". */
export const acceptResolutionSchema = z.object({
  action: z.literal('accept'),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirmation is required to accept a resolution.' }) }),
});

export const reopenDisputeSchema = z.object({
  action: z.literal('reopen'),
  reopen_reason: z.string().trim().min(1, 'Say why this case is reopening.'),
});

// ---------------------------------------------------------------------------
// EXP-17 Notifications & Account
// ---------------------------------------------------------------------------

export const updateNotificationPreferenceSchema = z.object({
  category: z.string().trim().min(1),
  channel: z.enum(['email', 'in_app']),
  enabled: z.boolean(),
});

/** Org profile edit — deliberately excludes gstin/iec/iec_number, which are managed
 * through the readiness verification flow, not freely editable here. */
export const updateExporterOrgSchema = z.object({
  legal_name: z.string().trim().min(1, 'Legal name is required.').max(200).optional(),
  state: z.string().trim().max(100).nullish(),
  city: z.string().trim().max(100).nullish(),
});

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  role: z.enum(['exporter_owner', 'exporter_member']),
});

export const invitationActionSchema = z.object({
  action: z.enum(['resend', 'revoke']),
});

// ---------------------------------------------------------------------------
// EXP-03 Enablement Center
// ---------------------------------------------------------------------------

export const reviewTaskEvidenceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('approve') }),
  z.object({
    action: z.literal('reject'),
    review_note: z.string().trim().min(1, 'Say what needs to change before this is re-submitted.'),
  }),
]);

export const askAgentSchema = z.object({
  body: z.string().trim().min(1, 'Write a message before sending.').max(2000),
});

// ---------------------------------------------------------------------------
// EXP-07 Buyer Detail
// ---------------------------------------------------------------------------

export const createBuyerShortlistSchema = z.object({
  buyer_id: z.string().trim().min(1, 'A buyer is required.'),
  product_id: z.string().trim().nullish(),
});
