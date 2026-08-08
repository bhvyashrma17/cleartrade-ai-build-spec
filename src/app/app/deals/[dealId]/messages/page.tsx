import { NotBuiltYet } from '@/components/ui';
import { loadDealForWorkspace } from '../loadDeal';

export default async function DealMessagesPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;
  return <NotBuiltYet tabLabel="Messages" backHref={`/app/deals/${deal.id}`} />;
}
