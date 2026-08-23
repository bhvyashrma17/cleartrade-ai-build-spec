/**
 * `/app/messages` — cross-deal message index (docs/13 A1). Read-only until a thread
 * detail page (Deal Workspace or buyer-lead detail) exists to open into.
 */

import { requireExporterPrincipal } from '@/lib/auth';
import { can } from '@/lib/permissions';
import { UpgradeNotice } from '@/components/ui';
import { MessagesList } from './MessagesList';

export default async function MessagesPage() {
  const principal = await requireExporterPrincipal();

  if (!can(principal, 'message.view')) {
    return (
      <div className="mx-auto max-w-3xl py-4 md:py-6">
        <UpgradeNotice
          title="Messaging is on the agent-assisted plan"
          requiredTier="paid"
          description="Once your account is upgraded, conversations with your agent and buyers across every deal show up here."
        />
      </div>
    );
  }

  return <MessagesList />;
}
