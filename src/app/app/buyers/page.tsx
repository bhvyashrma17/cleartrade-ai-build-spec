/**
 * EXP-06 Buyer Discovery — Search & Shortlist. `/app/buyers` · Exporter · P0.
 *
 * Server component: enforces the portal guard and loads the org's products (the
 * "Context header: Product + ..." zone in docs/04 §EXP-06) directly via Prisma —
 * this is a small, tenant-scoped, server-rendered read, not the paginated/filterable
 * search that belongs behind /api/v1/buyers.
 *
 * There's no root error boundary in this app yet, so a thrown ApiError from the guard
 * would otherwise surface as a bare Next.js 500 instead of docs/03 §7's required 401/403
 * states. UNAUTHENTICATED redirects to sign-in; FORBIDDEN renders in place — the caller
 * is authenticated, just not an exporter, so bouncing them elsewhere isn't obviously right.
 */

import { redirect } from 'next/navigation';
import { requireExporterPrincipal } from '@/lib/auth';
import { ApiError } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { PortalAccessError } from '@/components/portal-access-error';
import { BuyersExplorer } from './BuyersExplorer';

export default async function BuyersPage() {
  let principal;
  try {
    principal = await requireExporterPrincipal();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login');
    if (error instanceof ApiError) return <PortalAccessError message={error.message} />;
    throw error;
  }

  const products = await prisma.product.findMany({
    where: { exporter_org_id: principal.exporter_org_id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return <BuyersExplorer products={products} />;
}
