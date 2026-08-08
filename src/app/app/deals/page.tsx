/**
 * `/app/deals` — cross-deal index view (docs/13 A1). Deep-links into the Deal
 * Workspace, which doesn't exist yet — rows render read-only rather than 404ing.
 */

import { requireExporterPrincipal } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { UpgradeNotice } from '@/components/ui';
import { DealsList } from './DealsList';

export default async function DealsPage() {
  const principal = await requireExporterPrincipal();

  if (!can(principal, 'deal.view')) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <UpgradeNotice
          title="Deal tracking is on the agent-assisted plan"
          requiredTier="paid"
          description="Once your account is upgraded, every deal your agent is working — value, stage and risk — shows up here."
        />
      </div>
    );
  }

  return <DealsList />;
}
