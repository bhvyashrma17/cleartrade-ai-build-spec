/**
 * AGT-03 Outreach CRM / Buyer Pipeline. `/agent/outreach` · Agent · P0.
 *
 * Server component: just the portal guard. All data comes from GET /api/v1/leads,
 * which is where the actual "assigned exporters only" scoping lives (tenantScope()).
 *
 * Portal authorization is enforced by the agent layout (src/app/agent/layout.tsx),
 * which catches FORBIDDEN/UNAUTHENTICATED from the guard and renders `AccessDenied` or
 * redirects to /login. The call here is redundant with the layout's by construction —
 * kept as defense-in-depth; it would only fire in a race between the two renders, and
 * that generic case is what src/app/error.tsx's 5xx surface is for.
 */

import { requirePortalAccess } from '@/lib/auth';
import { OutreachPipeline } from './OutreachPipeline';

export default async function OutreachPage() {
  await requirePortalAccess('/agent');
  return <OutreachPipeline />;
}
