/**
 * `/app/tasks` — cross-deal task index (docs/13 A1, P0). All exporter-owned tasks
 * across deals plus enablement tasks, in one place — the mobile nav's primary "what do
 * I need to do next?" destination.
 */

import { requireExporterPrincipal } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { UpgradeNotice } from '@/components/ui';
import { TasksList } from './TasksList';

export default async function TasksPage() {
  const principal = await requireExporterPrincipal();

  if (!can(principal, 'task.view')) {
    return (
      <div className="mx-auto max-w-3xl py-4 md:py-6">
        <UpgradeNotice
          title="Cross-deal task tracking is on the agent-assisted plan"
          requiredTier="paid"
          description="Once your account is upgraded, every task your agent and team owe you — across every deal — shows up here in one queue."
        />
      </div>
    );
  }

  return <TasksList />;
}
