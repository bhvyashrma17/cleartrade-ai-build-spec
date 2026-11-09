/**
 * EXP-06 Buyer Discovery — Search & Shortlist. `/app/buyers` · Exporter (all tiers) · P0.
 *
 * Renders for a visitor with no session, so this uses `getPrincipal()` rather than
 * `requireExporterPrincipal()` — no session is a supported state here, not an error.
 * The exporter layout enforces the role boundary; the tier boundary is enforced per
 * capability in /api/v1/buyers (search, contacts) and /api/v1/buyer-leads (saving a lead).
 *
 * Buyer search runs for paid members only (docs/14 §3c, owner decision 9 Nov 2026, ledger
 * E-052). A visitor, a guest or a free account gets the members-only notice and the static
 * sample, and this page reads nothing from the database for them.
 *
 * `?country=` / `?product_id=` prefill from EXP-05's "Find buyers in this market" —
 * docs/04 EXP-05-AC03 requires that link to always carry a valid product/country
 * context, and this is where it lands.
 */

import { OrgTier } from '@prisma/client';
import { PageHeader, UpgradeNotice, upgradeTierFor } from '@/components/ui';
import { getPrincipal } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { BuyersExplorer } from './BuyersExplorer';
import { AgentWorkflowSample } from './AgentWorkflowSample';

export default async function BuyersPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; product_id?: string }>;
}) {
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;

  if (tier !== OrgTier.paid) {
    // Static notice + constant sample (`src/lib/billing/preview.ts`): no query, no provider.
    return (
      <>
        <PageHeader
          title="Buyer discovery"
          description="Find importers of your product in a market, see how well each one fits, and reach the people who buy."
        />
        <UpgradeNotice
          requiredTier={upgradeTierFor(tier)}
          title="Buyer discovery runs for members"
          description={
            tier === OrgTier.free
              ? 'Take a membership to search buyers for your own products and see their contacts. The sample below shows what you get.'
              : 'Create an account, then take a membership to search buyers for your own products. The sample below shows what you get.'
          }
        />
        <div className="mt-10">
          <AgentWorkflowSample />
        </div>
      </>
    );
  }

  const params = await searchParams;

  const products =
    principal?.exporter_org_id
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

  return (
    <>
      <BuyersExplorer
        products={products}
        tier={tier}
        adHocContext={null}
        initialCountry={params.country?.toUpperCase() ?? ''}
        initialProductId={initialProductId ?? ''}
      />
    </>
  );
}
