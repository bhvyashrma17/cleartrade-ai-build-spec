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
import { Skeleton } from '@/components/ui';
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
    <div className={`rounded-lg border border-[var(--color-border)] bg-surface p-4 shadow-card ${height}`}>
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

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-serif text-title-page text-primary">Overview</h1>
        <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
          Where you are, what needs you next, and who to ask for help.
        </p>
      </header>

      {/* Risk banner: renders nothing when there's nothing wrong (docs/04 "only
          material blockers"), so it sits outside the module grid rather than reserving
          space it usually won't use. */}
      <Suspense fallback={null}>
        <RiskBannerModule orgId={orgId} />
      </Suspense>

      <Suspense fallback={<ModuleSkeleton height="h-20" />}>
        <JourneyModule orgId={orgId} />
      </Suspense>

      <Suspense fallback={<ModuleSkeleton height="h-48" />}>
        <NextActionsModule orgId={orgId} />
      </Suspense>

      <Suspense fallback={<ModuleSkeleton />}>
        <HealthSummaryModule orgId={orgId} tier={tier} />
      </Suspense>

      <div className="grid gap-6 sm:grid-cols-2">
        <Suspense fallback={<ModuleSkeleton />}>
          <DealPipelineModule orgId={orgId} tier={tier} />
        </Suspense>
        <Suspense fallback={<ModuleSkeleton />}>
          <AssignedAgentModule orgId={orgId} tier={tier} />
        </Suspense>
      </div>
    </div>
  );
}
