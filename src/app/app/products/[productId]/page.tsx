/**
 * `/app/products/:productId` — product readiness and the primary "find markets" action.
 *
 * The readiness panel exists to answer one question honestly: can ClearTrade help with this
 * product right now? Missing commercial detail is shown but never used to block discovery —
 * demand, growth and competition are answerable from the HS code alone, and refusing to answer
 * them until a form is filled in would be both false and the fastest way to lose the exporter.
 */
import { notFound } from 'next/navigation';
import { requireDiscoveryPrincipal } from '@/lib/country-discovery/page-auth';
import { productDiscoveryState } from '@/lib/country-discovery/service';
import { isNotFound } from '@/lib/errors';
import { PageHeader } from '@/components/ui';
import { ProductDiscovery } from './ProductDiscovery';

export const dynamic = 'force-dynamic';

export default async function ProductPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const principal = await requireDiscoveryPrincipal();
  const state = await productDiscoveryState(principal, principal.exporter_org_id, productId).catch((error) => {
    // The service already refuses cross-tenant reads with NOT_FOUND; render Next's 404 for it
    // rather than a 500, and let anything else surface as the real error it is.
    if (isNotFound(error)) notFound();
    throw error;
  });

  return (
    <>
      <PageHeader
        eyebrow="Product"
        title={state.product.name}
        description={state.product.hs6 ? `Customs code ${state.product.hs6}` : 'Customs classification pending'}
      />
      <ProductDiscovery exporterOrgId={principal.exporter_org_id} initial={state} />
    </>
  );
}
