/**
 * EXP-06 Buyer Discovery — Search & Shortlist. `/app/buyers` · Exporter (all tiers) · P0.
 *
 * Open to anonymous visitors and guests, so this uses `getPrincipal()` rather than
 * `requireExporterPrincipal()` — no session is a supported state here, not an error.
 * The exporter layout enforces the role boundary; the tier boundary is enforced per
 * capability in /api/v1/buyers (contacts) and /api/v1/buyer-leads (saving a lead).
 *
 * Guests have no Product rows by design (no placeholder products are ever created for
 * them), so they get the same ad-hoc context they used for discovery instead of a
 * product selector.
 *
 * `?country=` / `?product_id=` prefill from EXP-05's "Find buyers in this market" —
 * docs/04 EXP-05-AC03 requires that link to always carry a valid product/country
 * context, and this is where it lands.
 */

import { OrgTier } from '@prisma/client';
import { getPrincipal } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BuyersExplorer } from './BuyersExplorer';

export default async function BuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; product_id?: string }>;
}) {
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;
  const params = await searchParams;

  const products =
    principal?.exporter_org_id && tier !== OrgTier.guest
      ? await prisma.product.findMany({
          where: { exporter_org_id: principal.exporter_org_id },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : [];

  // A product id in the URL must belong to this tenant before it prefills anything —
  // never trust a query param as an access grant on its own.
  const initialProductId =
    params.product_id && products.some((p) => p.id === params.product_id) ? params.product_id : null;

  // What a guest searched for most recently, so the buyer list has context to sit under
  // without inventing a Product row for them. Only consulted when the URL didn't already
  // name a market — a Market Detail link is more specific than "whatever they last typed".
  const lastAdHoc =
    !params.country && principal?.exporter_org_id && tier === OrgTier.guest
      ? await prisma.discoveryRun.findFirst({
          where: { exporter_org_id: principal.exporter_org_id, product_id: null },
          orderBy: { created_at: 'desc' },
          select: { input_snapshot: true },
        })
      : null;

  const snapshot = lastAdHoc?.input_snapshot as { description?: string | null } | null;

  return (
    <BuyersExplorer
      products={products}
      tier={tier}
      adHocContext={snapshot?.description ?? null}
      initialCountry={params.country?.toUpperCase() ?? ''}
      initialProductId={initialProductId ?? ''}
    />
  );
}
