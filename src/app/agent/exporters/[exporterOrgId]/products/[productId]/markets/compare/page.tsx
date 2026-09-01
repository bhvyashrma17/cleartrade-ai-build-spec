/**
 * `/agent/exporters/:exporterOrgId/products/:productId/markets/compare?countries=DE,US,GB`
 */
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { compareMarkets } from '@/lib/country-discovery/service';
import { countryName } from '@/lib/country-discovery/country-names';
import { EmptyState, PageHeader } from '@/components/ui';
import { MarketComparison } from '@/app/app/products/[productId]/markets/compare/MarketComparison';

export const dynamic = 'force-dynamic';

export default async function AgentComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ exporterOrgId: string; productId: string }>;
  searchParams: Promise<{ countries?: string }>;
}) {
  const { exporterOrgId, productId } = await params;
  const { countries } = await searchParams;
  const principal = await requireAgentDiscoveryPrincipal();
  const requested = (countries ?? '').split(',').map((code) => code.trim()).filter(Boolean);

  if (!requested.length) {
    return (
      <>
        <PageHeader title="Compare markets" />
        <EmptyState title="No markets chosen" description="Pick up to three markets from the results to compare them side by side." />
      </>
    );
  }

  const comparison = await loadOrNotFound(() => compareMarkets(principal, exporterOrgId, productId, requested));

  return (
    <>
      <PageHeader
        eyebrow={comparison.product.name}
        title="Compare markets"
        description={comparison.markets.map((market) => market.country).join(' · ')}
      />
      {comparison.unavailable.length ? (
        <p className="mb-4 text-sm text-slate">
          Not part of this analysis: {comparison.unavailable.map(countryName).join(', ')}.
        </p>
      ) : null}
      <MarketComparison markets={comparison.markets} productId={productId} basePath={`/agent/exporters/${exporterOrgId}/products`} />
    </>
  );
}
