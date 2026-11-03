/**
 * `/agent/exporters/:exporterOrgId/products/:productId/markets` — agent view of the ranked
 * markets. Reuses the exact exporter-facing `MarketResults` component with a `basePath` so
 * every link stays inside the agent route tree.
 */
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { marketResults, productDiscoveryState } from '@/lib/country-discovery/service';
import { PageHeader } from '@/components/ui';
import { MarketResults } from '@/app/app/products/[productId]/markets/MarketResults';

export const dynamic = 'force-dynamic';

export default async function AgentMarketsPage({ params }: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const { exporterOrgId, productId } = await params;
  const principal = await requireAgentDiscoveryPrincipal();
  const [results, state] = await loadOrNotFound(() => Promise.all([
    marketResults(principal, exporterOrgId, productId),
    productDiscoveryState(principal, exporterOrgId, productId),
  ]));
  return (
    <>
      <PageHeader
        eyebrow={results.product.name}
        title="Recommended markets"
        description={
          state.screening.universe_size
            ? `Screened ${state.screening.universe_size} reporting markets worldwide and shortlisted the strongest for detailed analysis.`
            : 'Markets shortlisted for this product.'
        }
      />
      <MarketResults
        productId={productId}
        results={results}
        screening={state.screening}
        basePath={`/agent/exporters/${exporterOrgId}/products`}
      />
    </>
  );
}
