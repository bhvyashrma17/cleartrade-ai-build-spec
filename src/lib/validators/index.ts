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
  buyer_rank: z.number().int().positive().optional(),
  offered_price_amount: z.number().positive().nullish(),
  offered_price_currency: z.string().trim().length(3).nullish(),
  incoterm: z.string().trim().nullish(),
  commercial_basis: z.string().trim().max(250).nullish(),
  offered_order_size: z.number().positive().nullish(),
  offered_order_size_unit: z.string().trim().nullish(),
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
/** Public estimate form: docs/14 §3. HS code and description mirror the discovery form's rules. */
export const marketEstimateSchema = z.object({
  product_description: z.string().trim().min(3, 'Describe your product in a few words.').max(500),
  hs_code: z
    .string()
    .trim()
    .regex(/^\d{4,8}$/, 'An HS code is 4 to 8 digits.'),
  // Never used in arithmetic (src/lib/market-estimate.ts) — bucketed for the cache key only.
  monthly_quantity: z.coerce.number().positive().max(1_000_000_000).optional(),
  location: z.string().trim().max(120).optional(),
});
export type MarketEstimateInputSchema = z.infer<typeof marketEstimateSchema>;

/** `PATCH /api/v1/exporter-org/commitment-fee`. */
export const payCommitmentFeeSchema = z.object({
  action: z.literal('pay'),
  source: z.enum(['exporter_update', 'AA', 'bank_partner', 'manual_ops']),
  reference: z.string().trim().max(200).nullish(),
});
export type PayCommitmentFeeInput = z.infer<typeof payCommitmentFeeSchema>;

export const createDiscoveryRunSchema = z
  .object({
    product_id: z.string().min(1).optional(),
    product_description: z.string().trim().min(3, 'Describe your product in a few words.').max(500).optional(),
    hs_code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Demand Discovery requires an exact six-digit HS code.')
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
  // `realized` was missing here even though it is a real `PaymentStatus` member with
  // its own state-machine edge (`received -> realized`) and its own route effect
  // (`set_realized_at`) — no request could ever reach it, so a payment could only ever
  // be marked realized by writing the row directly (which is exactly what the seed
  // fixtures do, and exactly why this went unnoticed: AGENTS.md "seeded fixtures
  // hand-place END states"). Found by the payout event-driven verification, which
  // drives a payment through the real route rather than seeding the end state.
  to: z.enum(['due', 'partially_received', 'received', 'realized', 'overdue', 'disputed']),
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

/** AGT-07 "Escalate" quick action — create/link an Ops case for one task, not a deal gate. */
export const escalateTaskSchema = z.object({
  reason: z.string().trim().min(1, 'Say why this needs Ops attention.'),
  severity: z.enum(['medium', 'high', 'critical']).default('high'),
});

/** AGT-07 "Reassign request" quick action. */
export const reassignRequestTaskSchema = z.object({
  reason: z.string().trim().min(1, 'Say why this needs to move to someone else.'),
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

// ---------------------------------------------------------------------------
// AGT-02 Exporter 360
// ---------------------------------------------------------------------------

/** Product quick-edit — a deliberate whitelist. HS code and certifications are not here. */
export const quickEditProductSchema = z.object({
  capacity_value: z.number().positive().nullish(),
  capacity_unit: z.string().trim().nullish(),
  moq_value: z.number().positive().nullish(),
  moq_unit: z.string().trim().nullish(),
  price_target_amount: z.number().positive().nullish(),
  price_target_currency: z.string().trim().length(3).nullish(),
  price_target_quantity_unit: z.string().trim().max(32).nullish(),
  price_target_incoterm: z.enum(['EXW','FCA','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP']).nullish(),
  lead_time_days: z.number().int().positive().nullish(),
  delivery_commitment_days: z.number().int().positive().nullish(),
  desired_order_size_amount: z.number().positive().nullish(),
  desired_order_size_currency: z.string().trim().length(3).nullish(),
  customization_capability: z.string().trim().max(1000).nullish(),
  packaging_capability: z.string().trim().max(1000).nullish(),
  packaging: z.string().trim().nullish(),
}).superRefine((value, ctx) => {
  const hasAmount = value.desired_order_size_amount != null;
  const hasCurrency = Boolean(value.desired_order_size_currency);
  if (hasAmount !== hasCurrency) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [hasAmount ? 'desired_order_size_currency' : 'desired_order_size_amount'], message: 'Desired order size requires both amount and currency.' });
  const priceFields=[value.price_target_amount,value.price_target_currency,value.price_target_quantity_unit,value.price_target_incoterm];
  if(priceFields.some(v=>v!=null)&&priceFields.some(v=>v==null))ctx.addIssue({code:z.ZodIssueCode.custom,path:['price_target_amount'],message:'Target price requires amount, currency, per-quantity unit, and Incoterm.'});
  if(value.lead_time_days!=null&&value.delivery_commitment_days!=null&&value.delivery_commitment_days<=value.lead_time_days)ctx.addIssue({code:z.ZodIssueCode.custom,path:['delivery_commitment_days'],message:'Delivery commitment must exceed production lead time.'});
});

// ---------------------------------------------------------------------------
// AGT-04 Lead / Buyer Workspace
// ---------------------------------------------------------------------------

/** "Log outreach/reply" — an activity, plus an optional stage move it justifies. */
export const logOutreachActivitySchema = z.object({
  type: z.enum(['call', 'email', 'message', 'meeting', 'note']),
  summary: z.string().trim().min(1, 'Say what happened.'),
  outcome: z.string().trim().nullish(),
  visibility: z.enum(['exporter_visible', 'internal']).default('internal'),
  to_stage: z.string().trim().nullish(),
  next_action: z.string().trim().nullish(),
  next_action_at: z.string().trim().nullish(),
  interest_level: z.enum(['unknown', 'low', 'medium', 'high']).nullish(),
  template_id: z.string().trim().nullish(),
  template_version: z.string().trim().nullish(),
  automation: z.enum(['manual', 'automated']).default('manual'),
  delivery_status: z.enum(['unknown', 'queued', 'sent', 'delivered', 'bounced', 'failed']).default('unknown'),
  reply_classification: z.enum(['no_response', 'positive_interest', 'not_interested', 'wrong_contact', 'already_sourced', 'price_mismatch', 'moq_mismatch', 'certification_issue', 'lead_time_issue', 'product_mismatch', 'timing_issue', 'other']).nullish(),
  reply_notes: z.string().trim().max(2000).nullish(),
});

export const disqualifyLeadSchema = z.object({
  disqualification_reason: z.enum(['no_response', 'not_importing_category', 'volume_too_small', 'price_mismatch', 'risk_flag', 'duplicate', 'other']),
  disqualification_reason_text: z.string().trim().nullish(),
});

/** AC01: an agent must record verification evidence, not just flip a status. */
export const verifyBuyerContactSchema = z.object({
  verification_status: z.enum(['unverified', 'partially_verified', 'verified']),
  evidence: z.string().trim().min(1, 'Say what evidence supports this verification.'),
});

/** AC03: conversion creates the canonical Deal and links it back to the lead in one step. */
export const convertLeadSchema = z.object({
  quantity: z.number().positive().nullish(),
  unit: z.string().trim().nullish(),
  unit_price_amount: z.number().positive().nullish(),
  unit_price_currency: z.string().trim().length(3).nullish(),
  incoterm: z.string().trim().nullish(),
  incoterm_place: z.string().trim().nullish(),
});

// ---------------------------------------------------------------------------
// OPS-04 CHA, Compliance & Document Oversight
// ---------------------------------------------------------------------------

/**
 * "Override requirement | Restricted Ops | Policy-controlled with reason/audit |
 * High-risk confirm". Bypasses the normal filing state machine on purpose — a reason is
 * the only thing standing between this and an unaccountable bypass, so it is mandatory
 * and long enough to actually explain the call.
 */
export const overrideDocumentRequirementSchema = z.object({
  reason: z.string().trim().min(10, 'Explain why this requirement is being waived — this bypasses the normal filing checks.'),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm the override — this is a high-risk action.' }) }),
});

// ---------------------------------------------------------------------------
// OPS-07 Audit Log & Admin Configuration
// ---------------------------------------------------------------------------

const CONFIG_KEYS = [
  'sla.thresholds',
  'payout.eligibility',
  'documents.registry',
  'uploads.policy',
  'pagination.policy',
  // 'buyers.fit_score_weights' is DEPRECATED and deliberately absent: nothing reads it, so
  // offering it here let an operator "retune BuyerFit" and change nothing. BuyerFit scoring is
  // code-owned (BUYER_FIT_POLICY in src/lib/buyer-intelligence.ts) and surfaced read-only.
  'leads.outreach',
  'guest.policy',
  'jobs.policy',
] as const;

/** New config version. `value` is validated as parseable JSON by the route, not here — the shape differs per key. */
export const updateConfigSchema = z.object({
  key: z.enum(CONFIG_KEYS),
  value: z.unknown(),
  description: z.string().trim().nullish(),
});

export const updateFeePolicySchema = z.object({
  commitment_fee_amount: z.number().nonnegative(),
  commitment_fee_currency: z.string().trim().length(3),
  success_fee_rate: z.number().min(0).max(1),
  small_shipment_threshold_amount: z.number().nonnegative(),
  small_shipment_threshold_currency: z.string().trim().length(3),
  small_shipment_rate: z.number().min(0).max(1),
  small_shipment_flat_amount: z.number().nonnegative(),
  agent_share_rate: z.number().min(0).max(1),
  minimum_shipment_amount: z.number().nonnegative(),
  minimum_shipment_currency: z.string().trim().length(3),
});

export const createPartnerSchema = z.object({
  type: z.enum(['cha', 'freight', 'insurance', 'inspection', 'bank']),
  legal_name: z.string().trim().min(1, 'A legal name is required.'),
  display_name: z.string().trim().min(1, 'A display name is required.'),
  country_code: z.string().trim().length(2, 'Use a 2-letter ISO country code.'),
  contact_email: z.string().trim().email().nullish(),
  contact_phone: z.string().trim().nullish(),
});

export const updatePartnerStatusSchema = z.object({
  partner_status: z.enum(['active', 'suspended', 'offboarded']),
  reason: z.string().trim().min(1, 'Say why this partner’s status is changing.'),
});

// ---------------------------------------------------------------------------
// AGT-08 / OPS-05 payout
// ---------------------------------------------------------------------------

/**
 * Finance-side lifecycle move. Deliberately has NO amount field — the payout figure is
 * a frozen snapshot, and the only way to change what is payable is an additive
 * adjustment (below). A route that accepted an amount here would be the exact
 * destructive rewrite OPS-05-AC03 forbids.
 */
export const transitionPayoutSchema = z.object({
  to: z.enum(['approved', 'paid', 'disputed', 'eligible']),
  payment_reference: z.string().trim().nullish(),
  dispute_reason: z.string().trim().nullish(),
});

/** OPS-05 "Adjust/waive | Reason + adjustment record, never rewrite the original quote". */
export const createPayoutAdjustmentSchema = z.object({
  /** Signed — negative claws back, positive tops up. Zero would be a no-op record. */
  amount: z.number().refine((v) => v !== 0, 'An adjustment of zero has no effect.'),
  reason: z.string().trim().min(5, 'Explain the adjustment — this is a permanent record.'),
  confirm: z.literal(true, { errorMap: () => ({ message: 'Confirm the adjustment — it changes what is payable.' }) }),
});

/** AGT-08 "Raise payout query | Create finance query/case | Track status". */
export const raisePayoutQuerySchema = z.object({
  reason: z.string().trim().min(5, 'Say what looks wrong with this payout.'),
});
