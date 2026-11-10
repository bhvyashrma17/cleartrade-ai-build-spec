/**
 * `/app/products/:productId/markets/:country` — the core explanation surface.
 *
 * Every score on this page is explainable: each pillar states either its number or the specific
 * reason it has none, and no pillar is ever shown as zero because it is unknown.
 */
import { notFound, redirect } from 'next/navigation';
import { requireDiscoveryPrincipal } from '@/lib/country-discovery/page-auth';
import { countryDetail, v5Market } from '@/lib/country-discovery/service';
import { isNotFound } from '@/lib/errors';
import { PageHeader } from '@/components/ui';
import { CountryTruth } from './CountryTruth';

export const dynamic = 'force-dynamic';

export default async function CountryPage({ params }: { params: Promise<{ productId: string; country: string }> }) {
  const { productId, country } = await params;
  const principal = await requireDiscoveryPrincipal();
  const notFoundOr = (error: unknown): never => {
    if (isNotFound(error)) notFound();
    throw error;
  };
  // E-061: a v5 run's market has its own page, with the engine's rank and reasons.
  const v5 = await v5Market(principal, principal.exporter_org_id, productId, country).catch(notFoundOr);
  if (v5) redirect(`/app/markets/${v5.assessment_id}`);
  const detail = await countryDetail(principal, principal.exporter_org_id, productId, country).catch(notFoundOr);

  return (
    <>
      <PageHeader
        eyebrow={detail.product.name}
        title={detail.market.country}
        description={`Rank #${detail.market.rank} of your analysed markets`}
      />
      <CountryTruth productId={productId} exporterOrgId={principal.exporter_org_id} detail={detail} />
    </>
  );
}
