/**
 * BuyerLead state machine — docs/07 §7.1.
 *
 * An invalid transition throws. It never silently no-ops, and it never returns a
 * boolean the caller can forget to check.
 */

import { BuyerLeadStage } from '@prisma/client';
import { InvalidTransitionError, validationError } from '@/lib/errors';

type Stage = BuyerLeadStage;

/** Allowed target stages per current stage. */
const TRANSITIONS: Record<Stage, Stage[]> = {
  new: [BuyerLeadStage.shortlisted, BuyerLeadStage.disqualified],
  shortlisted: [BuyerLeadStage.contacted, BuyerLeadStage.disqualified],
  contacted: [BuyerLeadStage.replied, BuyerLeadStage.disqualified],
  replied: [BuyerLeadStage.interested, BuyerLeadStage.disqualified],
  interested: [BuyerLeadStage.negotiation, BuyerLeadStage.disqualified],
  negotiation: [BuyerLeadStage.converted, BuyerLeadStage.disqualified],
  // Reopen is restricted and reasoned; it returns to shortlisted, not to the prior stage.
  disqualified: [BuyerLeadStage.shortlisted],
  // Terminal. A converted lead's outcome now lives on its Deal (docs/13 A2).
  converted: [],
};

export const ACTIVE_STAGES: Stage[] = [
  BuyerLeadStage.new,
  BuyerLeadStage.shortlisted,
  BuyerLeadStage.contacted,
  BuyerLeadStage.replied,
  BuyerLeadStage.interested,
  BuyerLeadStage.negotiation,
];

/** Stages where an explicit next action or waiting state is mandatory (AGT-03-AC01). */
const REQUIRES_NEXT_ACTION: Stage[] = [
  BuyerLeadStage.contacted,
  BuyerLeadStage.replied,
  BuyerLeadStage.interested,
];

export interface LeadTransitionInput {
  /** Required when moving to `disqualified` (docs/07 §7.1). */
  disqualification_reason?: string | null;
  disqualification_reason_text?: string | null;
  /** Required when entering a stage that mandates a next action. */
  next_action?: string | null;
  next_action_at?: Date | null;
  last_contact_at?: Date | null;
  interest_level?: string | null;
  /** Set when converting — the canonical Deal must already exist. */
  deal_id?: string | null;
}

/** Side effects the caller must perform inside the same transaction. */
export interface LeadTransitionEffects {
  set_last_contact_at: boolean;
  require_next_action: boolean;
  /** Disqualifying closes open outreach tasks (docs/07 §7.1). */
  close_open_outreach_tasks: boolean;
  /** Converting requires exactly one canonical Deal and no duplicate. */
  require_canonical_deal: boolean;
  /** Every material transition is audited (AGT-03-AC02). */
  audit: true;
}

export function canTransitionLead(from: Stage, to: Stage): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedLeadTransitions(from: Stage): Stage[] {
  return [...TRANSITIONS[from]];
}

/**
 * Validate a lead stage transition and return the side effects it obliges.
 * Throws InvalidTransitionError or VALIDATION_ERROR — never returns a "false".
 */
export function assertLeadTransition(
  from: Stage,
  to: Stage,
  input: LeadTransitionInput = {},
): LeadTransitionEffects {
  if (from === to) {
    throw new InvalidTransitionError('buyer lead', from, to, 'The lead is already at this stage.');
  }
  if (!canTransitionLead(from, to)) {
    throw new InvalidTransitionError('buyer lead', from, to);
  }

  if (to === BuyerLeadStage.disqualified && !input.disqualification_reason) {
    throw validationError(
      [
        {
          field: 'disqualification_reason',
          code: 'required',
          message: 'A reason is required to disqualify a lead.',
        },
      ],
      'Tell us why this lead is being disqualified.',
    );
  }

  if (to === BuyerLeadStage.converted && !input.deal_id) {
    throw validationError(
      [{ field: 'deal_id', code: 'required', message: 'A canonical deal must exist first.' }],
      'A lead can only be marked converted once its deal exists.',
    );
  }

  if (REQUIRES_NEXT_ACTION.includes(to) && !input.next_action_at) {
    throw validationError(
      [
        {
          field: 'next_action_at',
          code: 'required',
          message: 'Set the next action date for an actively worked lead.',
        },
      ],
      'Every actively worked lead needs a next action or an explicit waiting state.',
    );
  }

  return {
    set_last_contact_at: to === BuyerLeadStage.contacted,
    require_next_action: REQUIRES_NEXT_ACTION.includes(to),
    close_open_outreach_tasks: to === BuyerLeadStage.disqualified,
    require_canonical_deal: to === BuyerLeadStage.converted,
    audit: true,
  };
}

/**
 * Display labels. The Blueprint's CRM columns rename `interested` to "Qualified"
 * (docs/13 A2) — allowed as a display string only, never as a stored value.
 */
export const LEAD_STAGE_LABELS: Record<Stage, string> = {
  new: 'New',
  shortlisted: 'Shortlisted',
  contacted: 'Contacted',
  replied: 'Replied',
  interested: 'Qualified',
  negotiation: 'In negotiation',
  disqualified: 'Disqualified',
  converted: 'Converted to deal',
};
