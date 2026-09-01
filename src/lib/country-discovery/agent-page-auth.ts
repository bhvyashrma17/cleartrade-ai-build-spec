/**
 * Auth for the agent-side Demand Discovery drill-downs.
 *
 * `requireDiscoveryPrincipal` (used by the exporter `/app/products/...` tree) redirects any
 * principal with no `exporter_org_id`, which is every agent, ops and admin account. This is the
 * agent-side equivalent: the exporter org comes from the ROUTE, not from the principal, and
 * access to it is exactly what `country-discovery/service.ts` already checks — `assertOrgAccess`
 * inside each service call, which permits an assigned agent or ops/admin. There is no separate
 * authorization decision here; this only turns "not permitted" into the same 404 the exporter
 * routes use, rather than letting a service error render as a raw 500.
 */
import { notFound, redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/auth';
import { isNotFound } from '@/lib/errors';
import type { Principal } from '@/types';

export async function requireAgentDiscoveryPrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  return principal;
}

/** Run a Demand Discovery service call, mapping its NOT_FOUND onto Next's notFound(). */
export async function loadOrNotFound<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isNotFound(error)) notFound();
    throw error;
  }
}
