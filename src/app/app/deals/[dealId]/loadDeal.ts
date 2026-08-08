/**
 * Shared tenant-scoped deal loader for the whole Deal Workspace (EXP-09). Every tab
 * route calls this rather than re-deriving its own where-clause — AC01 requires every
 * tab to render "the same deal ID and role-scoped shared objects," and the one way to
 * guarantee that is one query shape, not eight independent ones that could drift.
 *
 * Tenancy is baked into the WHERE clause, not checked after the fact: an out-of-tenant
 * id renders `notFound()` rather than a 403, same reasoning as Market Detail — a guessed
 * id must not be able to confirm another tenant's deal exists (docs/09 §4).
 */

import { notFound } from 'next/navigation';
import { requireExporterPrincipal } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';

export async function loadDealForWorkspace(dealId: string) {
  const principal = await requireExporterPrincipal();
  if (!can(principal, 'deal.view')) {
    return { principal, deal: null as null, tierBlocked: true as const };
  }

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, exporter_org_id: principal.exporter_org_id },
    include: {
      buyer: { select: { display_name: true, country_code: true, verification_status: true } },
      product: { select: { name: true } },
      owner_agent: { select: { name: true } },
      snapshots: { orderBy: { version: 'desc' }, take: 1, select: { version: true, created_at: true } },
    },
  });
  if (!deal) notFound();

  return { principal, deal, tierBlocked: false as const };
}

export type WorkspaceDeal = NonNullable<Awaited<ReturnType<typeof loadDealForWorkspace>>['deal']>;
