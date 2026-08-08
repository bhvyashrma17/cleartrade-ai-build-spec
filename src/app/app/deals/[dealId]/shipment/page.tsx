import { NotBuiltYet } from '@/components/ui';
import { loadDealForWorkspace } from '../loadDeal';

export default async function DealShipmentPage({ params }: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await params;
  const { deal } = await loadDealForWorkspace(dealId);
  if (!deal) return null;
  return <NotBuiltYet tabLabel="Shipment" backHref={`/app/deals/${deal.id}`} />;
}
