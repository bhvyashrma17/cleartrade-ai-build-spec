/**
 * AGT-03 Outreach CRM / Buyer Pipeline. `/agent/outreach` · Agent · P0.
 *
 * Server component: just the portal guard. All data comes from GET /api/v1/leads,
 * which is where the actual "assigned exporters only" scoping lives (tenantScope()).
 *
 * See src/app/app/buyers/page.tsx for why the guard's errors are handled here rather
 * than left to bubble into a generic 500 — there's no root error boundary yet.
 */

import { redirect } from 'next/navigation';
import { requirePortalAccess } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { PortalAccessError } from '@/components/portal-access-error';
import { OutreachPipeline } from './OutreachPipeline';

export default async function OutreachPage() {
  try {
    await requirePortalAccess('/agent');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError) return <PortalAccessError message={error.message} />;
    throw error;
  }
  return <OutreachPipeline />;
}
