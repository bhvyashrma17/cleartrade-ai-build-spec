/**
 * `/agent/exporters/:exporterOrgId/products/:productId/markets/:country` — agent country detail.
 *
 * For a product whose latest run is Demand Discovery v5 (E-061), the same five-part breakdown the
 * exporter sees (`V5Breakdown`), with the engine's own rank, and the two places the agent acts: the
 * tariff-line questions and the market control table. Otherwise the exporter-facing Country Truth
 * view, as before.
 */
import Link from 'next/link';
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { countryDetail, v5Market } from '@/lib/country-discovery/service';
import { countryName } from '@/lib/country-discovery/country-names';
import { buttonClass, PageHeader } from '@/components/ui';
import { CountryTruth } from '@/app/app/products/[productId]/markets/[country]/CountryTruth';
import { V5Breakdown } from '@/app/app/markets/[marketAssessmentId]/V5Breakdown';
import { RupeeRateProvider } from '@/components/fx/RupeeRate';
import { todayInrPerUsd } from '@/lib/fx/display-rate';

export const dynamic = 'force-dynamic';

export default async function AgentCountryPage({ params }: { params: Promise<{ exporterOrgId: string; productId: string; country: string }> }) {
  const { exporterOrgId, productId, country } = await params;
  const principal = await requireAgentDiscoveryPrincipal();
  const basePath = `/agent/exporters/${exporterOrgId}/products/${productId}/markets`;

  const v5 = await loadOrNotFound(() => v5Market(principal, exporterOrgId, productId, country));
  if (v5) {
    const rupeeRate = await todayInrPerUsd();
    const { detail } = v5;
    const standing = detail.rank != null
      ? `Rank #${detail.rank} of ${detail.total_ranked} ranked markets`
      : detail.market_status === 'excluded' ? 'Excluded from the ranking' : 'Not ranked';
    return (
      <RupeeRateProvider rate={rupeeRate}>
        <PageHeader eyebrow={v5.product.name} title={countryName(v5.country_code)} description={standing} />
        <div className="flex flex-wrap gap-2">
          <Link href={`${basePath}/${v5.country_code}/classification`} className={buttonClass('secondary', 'sm')}>
            Tariff line questions
          </Link>
          <Link href={`${basePath}/manage`} className={buttonClass('ghost', 'sm')}>
            Manage market decisions
          </Link>
        </div>
        <V5Breakdown detail={detail} />
      </RupeeRateProvider>
    );
  }

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
