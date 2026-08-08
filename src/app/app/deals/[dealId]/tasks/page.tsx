import { NotBuiltYet } from '@/components/ui';
import { loadDealForWorkspace } from '../loadDeal';

export default async function DealTasksPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;
  return <NotBuiltYet tabLabel="Tasks" backHref={`/app/deals/${deal.id}`} />;
}
