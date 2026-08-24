/**
 * EXP-01 Dashboard / Overview. `/app/overview` · Exporter (free, paid) · P0.
 *
 * The post-login destination for exporter accounts. A "decision surface, not an
 * analytics dashboard" (docs/04) — every module answers "what do I do next", not just
 * "here is a number."
 *
 * Guests never reach this route: they were minted for Demand Discovery, have no
 * readiness/task/deal data to summarize, and the nav already hides this link at their
 * tier. A guest who navigates here directly is sent to `/app/markets` instead of
 * rendering a dashboard with nothing real to show. The exporter layout already turns
 * away a signed-in non-exporter role before this page runs; the two checks here are
 * "no session" and "session is a guest".
 *
 * AC05 ("loading, empty and failure states exist for each independent module — not one
 * blank page") is implemented with a `<Suspense>` boundary per module: each is its own
 * async server component that catches its own query error internally rather than
 * throwing, so one slow or failed module streams in on its own schedule and never blocks
 * or blanks the rest of the page.
 */

import { Suspense } from 'react';
import { OrgTier } from '@prisma/client';
import { redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { PageHeader, Skeleton } from '@/components/ui';
import { UpgradeBanner } from './UpgradeBanner';
import {
  AssignedAgentModule,
  DealPipelineModule,
  HealthSummaryModule,
  JourneyModule,
  NextActionsModule,
  RiskBannerModule,
} from './modules';

function ModuleSkeleton({ height = 'h-32' }: { height?: string }) {
  return (
    <div className={`rounded-lg border border-line bg-surface p-4 ${height}`}>
      <Skeleton variant="text" lines={3} />
    </div>
  );
}

export default async function OverviewPage() {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  if (principal.tier === OrgTier.guest) redirect('/app/markets');

  const orgId = principal.exporter_org_id!;
  const tier = principal.tier as 'free' | 'paid';

  // Read, never hardcoded — `billing.plans` is the one source for what a membership costs.
  const pricing = tier === 'free' ? await getConfig('billing.plans') : null;
  const fromPrice = pricing
    ? new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: pricing.premium_monthly.currency,
        maximumFractionDigits: 0,
      }).format(Number(pricing.premium_monthly.amount))
    : null;

  return (
    <div className="pb-16">
      <PageHeader
        eyebrow="Your workspace"
        title="Overview"
        description="Where you are, what needs you next, and who to ask for help."
      />

      {/* Renders nothing when nothing is wrong (docs/04, "only material blockers"), so it
          sits outside the grid rather than reserving space it usually will not use. */}
      <Suspense fallback={null}>
        <RiskBannerModule orgId={orgId} />
      </Suspense>

      {/* Below the risk banner, deliberately: a real blocker on your account outranks an
          upsell, and reversing them would put a sales prompt above a warning. */}
      {fromPrice ? <UpgradeBanner priceDisplay={`${fromPrice}/month`} /> : null}

      <div className="mt-6">
        <Suspense fallback={<ModuleSkeleton height="h-24" />}>
          <JourneyModule orgId={orgId} />
        </Suspense>
      </div>

      {/* Work on the left, context on the right.
          The page used to be one narrow column of stacked cards, which gave the thing you
          have to DO the same weight as the thing you might like to know. Next actions now
          take two thirds of the width and lead; health, pipeline and your agent become a
          rail beside them. Below lg it collapses back to one column in the same order, so
          the priority survives on a phone. */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Suspense fallback={<ModuleSkeleton height="h-64" />}>
            <NextActionsModule orgId={orgId} />
          </Suspense>
          <Suspense fallback={<ModuleSkeleton />}>
            <DealPipelineModule orgId={orgId} tier={tier} />
          </Suspense>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-[calc(var(--topbar-height)+24px)]">
          <Suspense fallback={<ModuleSkeleton />}>
            <HealthSummaryModule orgId={orgId} tier={tier} />
          </Suspense>
          <Suspense fallback={<ModuleSkeleton />}>
            <AssignedAgentModule orgId={orgId} tier={tier} />
          </Suspense>
        </aside>
      </div>
    </div>
  );
}
