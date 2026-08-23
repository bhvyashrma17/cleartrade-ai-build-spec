/**
 * `/app/deals` — EXP-08 Deals List (docs/04, docs/13 A1).
 */

import { requireExporterPrincipal } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { UpgradeNotice } from '@/components/ui';
import { DealsList } from './DealsList';

export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; risk?: string; country?: string; buyer?: string; updated_after?: string; page?: string }>;
}) {
  const principal = await requireExporterPrincipal();

  if (!can(principal, 'deal.view')) {
    return (
      <div className="mx-auto max-w-3xl py-4 md:py-6">
        <UpgradeNotice
          title="Deal tracking is on the agent-assisted plan"
          requiredTier="paid"
          description="Once your account is upgraded, every deal your agent is working — value, stage and risk — shows up here."
        />
      </div>
    );
  }

  const params = await searchParams;
  return <DealsList initialFilters={params} />;
}
