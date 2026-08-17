/**
 * Notification category registry — EXP-17.
 *
 * `Notification.type` is free text (dozens of distinct values already written across the
 * codebase: `deal_message`, `dispute_opened`, `commercial_terms_proposed`, and so on).
 * This file is the ONE place that groups those types into the user-facing categories the
 * preferences panel toggles, and the one place that decides which categories are
 * "critical legal/security" and therefore non-disableable (docs/04 EXP-17).
 *
 * Enforcement is structural, not a UI convention: `NotificationPreference` rows are only
 * ever written for a `disableable: true` category (see the preferences route) — there is
 * no row to represent "critical, but the user turned it off" for a non-disableable
 * category, so a bug that forgot to check the flag on read would still fail safe.
 */

export type NotificationCategory =
  | 'deal_activity'
  | 'commercial'
  | 'documents'
  | 'disputes'
  | 'shipment_payment'
  | 'account_security';

interface CategoryDef {
  label: string;
  description: string;
  /** `false` means this category can never be turned off, in either channel. */
  disableable: boolean;
  /** Every `Notification.type` value that falls under this category. */
  types: readonly string[];
}

export const NOTIFICATION_CATEGORIES: Record<NotificationCategory, CategoryDef> = {
  deal_activity: {
    label: 'Deal activity',
    description: 'Messages and general updates on your deals.',
    disableable: true,
    types: ['deal_message', 'agent_created','agent_assigned','buyer_review_ready','task_due','readiness_action_required'],
  },
  commercial: {
    label: 'Commercial terms',
    description: 'Proposals, approvals and change requests on commercial terms.',
    disableable: true,
    types: [
      'commercial_terms_proposed',
      'commercial_terms_approved',
      'commercial_changes_requested',
      'agent_revise_commercial_terms',
      'exporter_approve_commercial_terms',
    ],
  },
  documents: {
    label: 'Documents',
    description: 'Generation, review and filing updates on deal documents.',
    disableable: true,
    types: ['document_generation', 'document_changes_requested','document_approval_needed','compliance_blocker'],
  },
  disputes: {
    label: 'Cases & disputes',
    description: 'Case opened, resolution proposed, and case closed.',
    disableable: true,
    types: ['dispute_opened', 'dispute_resolution_proposed', 'dispute_owner_response','dispute_update'],
  },
  shipment_payment: {
    label: 'Shipment & payment',
    description: 'Shipment exceptions, milestones, and payment/insurance updates.',
    disableable: true,
    types: [
      'shipment_exception_remediation',
      'shipment_milestone',
      'payment',
      'insurance_case',
      'request_insurance_quote',
      'partner_handoff',
      'payment_evidence_required',
    ],
  },
  // Never disableable — the account's own security and legal-standing events. Nothing
  // currently writes a notification of this type; the category exists so the
  // preferences UI can show a real, permanently-on row rather than only describing the
  // rule in prose (docs/04: "Critical legal/security notifications may be
  // non-disableable" is a UI requirement, not just a backend one).
  account_security: {
    label: 'Account & security',
    description: 'Sign-in alerts, role changes and legal notices. Cannot be turned off.',
    disableable: false,
    types: ['account_security', 'role_changed', 'org_verification'],
  },
};

const TYPE_TO_CATEGORY: Map<string, NotificationCategory> = new Map(
  Object.entries(NOTIFICATION_CATEGORIES).flatMap(([category, def]) =>
    def.types.map((type) => [type, category as NotificationCategory]),
  ),
);

/** Unrecognized types fall into `deal_activity` — the broadest, disableable bucket — rather
 * than silently becoming un-categorizable or (worse) accidentally non-disableable. */
export function categoryForType(type: string): NotificationCategory {
  return TYPE_TO_CATEGORY.get(type) ?? 'deal_activity';
}

export function isDisableableCategory(category: NotificationCategory): boolean {
  return NOTIFICATION_CATEGORIES[category].disableable;
}

export const DISABLEABLE_CATEGORIES = (Object.keys(NOTIFICATION_CATEGORIES) as NotificationCategory[]).filter(
  (c) => NOTIFICATION_CATEGORIES[c].disableable,
);

export function typesForCategory(category:NotificationCategory):readonly string[]{return NOTIFICATION_CATEGORIES[category].types;}
