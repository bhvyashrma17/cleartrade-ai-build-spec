/**
 * `/app/billing` — kept as a permanent redirect target, not a page.
 *
 * This URL was the paid-tier CTA destination for the whole product before `/app/plans`
 * existed, so it is in the wild: bookmarks, emails, and any link written before the
 * membership work. Deleting the route would turn all of those into 404s, and a dead link
 * to the billing page is the worst possible one to break — it reads as "you cannot give us
 * money" (docs/03 §1: navigation must not point at pages that do not exist).
 *
 * Everything it used to render now lives on `/app/plans`, including the commitment-fee
 * card, so nothing is lost by forwarding. `CommitmentFeeCard.tsx` remains beside this file
 * because the self-report path it drives is still the only way to reach paid tier in a
 * local environment with no gateway configured.
 */

import { redirect } from 'next/navigation';

export default function BillingPage() {
  redirect('/app/plans');
}
