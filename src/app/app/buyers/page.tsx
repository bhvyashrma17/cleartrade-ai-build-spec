/**
 * EXP-06 Buyers. `/app/buyers` · Exporter (all tiers) · P0.
 *
 * Renders for a visitor with no session, so this uses `getPrincipal()` rather than
 * `requireExporterPrincipal()` — no session is a supported state here, not an error.
 *
 * Below paid (docs/14 §3c, D-039, E-052): the members-only notice and the static sample; nothing
 * is read from the database. Members: buyer discovery is agent-curated (docs/11 §7) — the API
 * refuses buyer search to exporter roles — so the page shows, per product, the markets its latest
 * Demand Discovery run handed on and the official importer counts there (E-055). It used to render
 * a search screen that every member call was refused by.
 */

import { JobStatus, OrgTier } from '@prisma/client';
import { importerListSourceFor } from '@/lib/buyer-discovery/importer-lists';
import { BUYER_DISCOVERY_MODEL } from '@/lib/buyer-discovery/service';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { PageHeader, UpgradeNotice, upgradeTierFor } from '@/components/ui';
import { getPrincipal } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { AgentCuratedBuyers, type CuratedProduct } from './AgentCuratedBuyers';
import { AgentWorkflowSample } from './AgentWorkflowSample';

export default async function BuyersPage() {
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
              ? 'Take a membership and your ClearTrade agent finds and vets importers for your own products. The sample below shows what a run finds.'
              : 'Create an account, then take a membership: your ClearTrade agent finds and vets importers for your own products. The sample below shows what a run finds.'
          }
        />
        <div className="mt-10">
          <AgentWorkflowSample />
        </div>
      </>
    );
  }

  // Members: buyer discovery is agent-curated (docs/11 §7, E-055). Show each product's latest run,
  // the markets it handed on, and the official importer counts — never the list itself.
  const orgId = principal?.exporter_org_id;
  const products = orgId
    ? await prisma.product.findMany({
        where: { exporter_org_id: orgId },
        select: { id: true, name: true, hs_code: true },
        orderBy: { created_at: 'desc' },
      })
    : [];
  const runs = products.length
    ? await prisma.discoveryRun.findMany({
        where: { exporter_org_id: orgId!, product_id: { in: products.map((p) => p.id) }, model_version: DEMAND_DISCOVERY_V5_MODEL, status: { in: [JobStatus.completed, JobStatus.partial] } },
        orderBy: { completed_at: 'desc' },
        select: { id: true, product_id: true, completed_at: true },
      })
    : [];
  const latestRun = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (run.product_id && !latestRun.has(run.product_id)) latestRun.set(run.product_id, run);
  const handed = latestRun.size
    ? await prisma.marketAssessment.findMany({
        where: { run_id: { in: [...latestRun.values()].map((run) => run.id) }, handed_off: true },
        orderBy: { rank: 'asc' },
        select: { id: true, run_id: true, country_code: true, rank: true, overall_score: true },
      })
    : [];

  const curated: CuratedProduct[] = await Promise.all(
    products.map(async (product) => {
      const run = latestRun.get(product.id);
      const markets = await Promise.all(
        handed
          .filter((market) => market.run_id === run?.id)
          .map(async (market) => {
            const source = importerListSourceFor(market.country_code);
            return {
              assessment_id: market.id,
              country_code: market.country_code,
              rank: market.rank,
              score: market.overall_score,
              importers: source
                ? {
                    source: source.label,
                    count: await prisma.buyerFitAssessment.count({
                      where: { exporter_org_id: orgId!, product_id: product.id, model_version: BUYER_DISCOVERY_MODEL, buyer: { country_code: market.country_code } },
                    }),
                  }
                : null,
            };
          }),
      );
      return { id: product.id, name: product.name, hs_code: product.hs_code, run_completed_at: run?.completed_at?.toISOString() ?? null, markets };
    }),
  );

  return <AgentCuratedBuyers products={curated} />;
}
