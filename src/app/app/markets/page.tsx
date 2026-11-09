/**
 * EXP-04 Demand Discovery. `/app/markets` · Exporter (all tiers, including no session) · P0.
 *
 * This page renders with **no session at all**, so it must not call a guard that throws:
 * `getPrincipal()` (not `requireExporterPrincipal()`) is deliberate — null here means
 * "visitor", which is a supported state, not an error.
 *
 * Tier branch (docs/14 §3c, owner decision 9 Nov 2026, ledger E-052): Demand Discovery runs
 * for paid members only. A visitor, a guest or a free account gets the members-only notice
 * and the static sample — no estimate, no code finder, no warehouse read, nothing minted.
 */

import { OrgTier } from '@prisma/client';
import { PageHeader, UpgradeNotice, upgradeTierFor } from '@/components/ui';
import { getPrincipal } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { todayInrPerUsd } from '@/lib/fx/display-rate';
import { RupeeRateProvider } from '@/components/fx/RupeeRate';
import { DemandDiscovery } from './DemandDiscovery';
import { RankedMarketsSample } from './RankedMarketsSample';

export default async function MarketsPage() {
  const principal = await getPrincipal();
  const tier = principal?.tier ?? OrgTier.guest;

  if (tier !== OrgTier.paid) {
    // Nothing on this branch reads the database or calls a provider: the notice is static
    // and the sample is a constant (`src/lib/billing/preview.ts`).
    return (
      <>
        <PageHeader
          title="Find your best export markets"
          description="Demand Discovery scores and ranks every market for your own product, with the reasons behind each rank."
        />
        <UpgradeNotice
          requiredTier={upgradeTierFor(tier)}
          title="Demand Discovery runs for members"
          description={
            tier === OrgTier.free
              ? 'Take a membership to run it on your own products. The sample below shows what a run gives you.'
              : 'Create an account, then take a membership to run it on your own products. The sample below shows what a run gives you.'
          }
        />
        <div className="mt-10">
          <RankedMarketsSample />
        </div>
      </>
    );
  }

  const policy = await getConfig('guest.policy');

  // Saved products only exist for a tenant that has them; a guest supplies context ad hoc.
  const products =
    principal?.exporter_org_id
      ? await prisma.product.findMany({
          where: { exporter_org_id: principal.exporter_org_id },
          select: { id: true, name: true, hs_code: true,hs_classification_status:true },
          orderBy: { name: 'asc' },
        })
      : [];

  // Guests get no history surface at all — that is what "nothing saved" means for them.
  // The runs are still persisted (docs/09 §3 requires durable job state) and are retained
  // until the purge window lapses; they become visible history on registration.
  const recentRuns =
    principal?.exporter_org_id
      ? await prisma.discoveryRun.findMany({
          where: { exporter_org_id: principal.exporter_org_id },
          select: { id: true, status: true, created_at: true, input_snapshot: true },
          orderBy: { created_at: 'desc' },
          take: 10,
        })
      : [];

  // The most recent run, for EVERY tier including guest.
  //
  // This is resumption, not history: docs/09 §3 requires a user to be able to leave the
  // page while a job runs and come back to it. Without it a guest spends one of their two
  // searches, navigates away, and the result is simply gone — the job state survives on
  // the server but nothing on screen can reach it. "No saved history" means no list of
  // past searches; it does not mean losing the run currently in front of you.
  const latestRun = principal?.exporter_org_id
    ? await prisma.discoveryRun.findFirst({
        where: { exporter_org_id: principal.exporter_org_id },
        select: { id: true, job_id: true, status: true },
        orderBy: { created_at: 'desc' },
      })
    : null;

  // D-023: rupee figures beside dollars follow today's ECB rate; a missing rate shows dollars alone.
  const rupeeRate = await todayInrPerUsd();

  return (
    <RupeeRateProvider rate={rupeeRate}>
      <DemandDiscovery
        tier={tier}
        products={products}
        recentRuns={recentRuns.map((r) => ({
          id: r.id,
          status: r.status,
          created_at: r.created_at.toISOString(),
          label: describeRun(r.input_snapshot),
        }))}
        guestRunLimit={policy.discovery_runs_per_ip}
        latestRun={latestRun && latestRun.job_id ? { runId: latestRun.id, jobId: latestRun.job_id } : null}
      />
    </RupeeRateProvider>
  );
}

/** Human label for a run, from whichever context it was executed with. */
function describeRun(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object') return 'Discovery run';
  const s = snapshot as Record<string, unknown>;
  const name = typeof s.name === 'string' ? s.name : null;
  const description = typeof s.description === 'string' ? s.description : null;
  const hs = typeof s.hs_code === 'string' ? s.hs_code : null;
  const base = name ?? description ?? 'Discovery run';
  return hs ? `${base} · HS ${hs}` : base;
}
