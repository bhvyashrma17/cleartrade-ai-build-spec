/**
 * Missing-input checks for document generation (EXP-12-AC05: "Missing-input error
 * deep-links to the exact data requirement where possible").
 *
 * This runs SYNCHRONOUSLY in the route, before a generation job is ever enqueued — the
 * same shape as `collectDealLockBlockers()` in the deal state machine: a pure function
 * over already-loaded data that returns every reason generation cannot proceed, each
 * with a deep link to where it is actually fixed. Doing this before enqueueing means a
 * missing field is an immediate, actionable 422 rather than something the user has to
 * poll a failed job to discover.
 */

import type { Blocker } from '@/types';
import { dealDeepLink } from '@/lib/state-machines/deal';
import type { DocumentGenerationInput } from './engine';

type Snapshot = DocumentGenerationInput['snapshot'];

/**
 * Fields each document type needs from the snapshot. Every one of these lives on the
 * commercial terms (EXP-10), which is where the deep link sends the user to fix it —
 * documents generate from the snapshot, never from live Deal columns, so there is no
 * other place these values could come from.
 */
const REQUIRED_FIELDS: Record<string, { field: keyof Snapshot; label: string }[]> = {
  PI: [
    { field: 'quantity', label: 'Quantity' },
    { field: 'unit', label: 'Unit' },
    { field: 'unit_price_amount', label: 'Unit price' },
    { field: 'incoterm', label: 'Incoterm' },
    { field: 'payment_terms', label: 'Payment terms' },
  ],
  CI: [
    { field: 'quantity', label: 'Quantity' },
    { field: 'unit', label: 'Unit' },
    { field: 'unit_price_amount', label: 'Unit price' },
    { field: 'total_amount', label: 'Total value' },
    { field: 'incoterm', label: 'Incoterm' },
  ],
  packing_list: [
    { field: 'quantity', label: 'Quantity' },
    { field: 'unit', label: 'Unit' },
  ],
  shipping_bill_draft: [
    { field: 'incoterm', label: 'Incoterm' },
    { field: 'incoterm_place', label: 'Incoterm place' },
    { field: 'quantity', label: 'Quantity' },
  ],
  COO_draft: [{ field: 'quantity', label: 'Quantity' }],
  declaration: [
    { field: 'total_amount', label: 'Total value' },
    { field: 'incoterm', label: 'Incoterm' },
  ],
  insurance_declaration: [{ field: 'total_amount', label: 'Total value' }],
};

/**
 * Every reason this document cannot generate yet, as an actionable list with deep links
 * — never just the first one, so the UI can show "here is exactly what to fix" (same
 * reasoning as `collectDealLockBlockers`, AGT-06-AC01).
 */
export function collectMissingSnapshotFields(dealId: string, docType: string, snapshot: Snapshot): Blocker[] {
  const required = REQUIRED_FIELDS[docType] ?? [];
  const blockers: Blocker[] = [];

  if (!snapshot.buyer_legal_name) {
    blockers.push({
      object_type: 'deal',
      object_id: dealId,
      reason: 'Buyer is not set on the deal snapshot.',
      deep_link: dealDeepLink(dealId, 'commercial'),
    });
  }

  for (const { field, label } of required) {
    const value = snapshot[field];
    const missing =
      value === null ||
      value === undefined ||
      (typeof value === 'string' && value.trim().length === 0);
    if (missing) {
      blockers.push({
        object_type: 'deal',
        object_id: dealId,
        reason: `${label} is not set on the agreed commercial terms.`,
        deep_link: dealDeepLink(dealId, 'commercial'),
      });
    }
  }

  return blockers;
}
