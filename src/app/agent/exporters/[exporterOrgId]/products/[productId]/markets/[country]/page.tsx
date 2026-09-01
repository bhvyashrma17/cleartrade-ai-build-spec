/**
 * `/agent/exporters/:exporterOrgId/products/:productId/markets/:country` — agent country detail.
 * Reuses the exact exporter-facing `CountryTruth` component.
 */
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { countryDetail } from '@/lib/country-discovery/service';
import { PageHeader } from '@/components/ui';
import { CountryTruth } from '@/app/app/products/[productId]/markets/[country]/CountryTruth';

export const dynamic = 'force-dynamic';

export default async function AgentCountryPage({ params }: { params: Promise<{ exporterOrgId: string; productId: string; country: string }> }) {
  const { exporterOrgId, productId, country } = await params;
  const principal = await requireAgentDiscoveryPrincipal();
  const detail = await loadOrNotFound(() => countryDetail(principal, exporterOrgId, productId, country));

  return (
    <>
      <PageHeader
        eyebrow={detail.product.name}
        title={detail.market.country}
        description={`Rank #${detail.market.rank} of the analysed markets`}
      />
      <CountryTruth
        productId={productId}
        exporterOrgId={exporterOrgId}
        detail={detail}
        basePath={`/agent/exporters/${exporterOrgId}/products`}
      />
    </>
  );
}
