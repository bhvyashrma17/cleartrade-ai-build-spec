/**
 * `/app/products/:productId/markets` — recommended markets.
 *
 * The shortlist is the product, not the 200-country universe behind it. Screening looked at
 * every reporting market; showing all of them as the primary surface would bury the answer in
 * the working. The universe count is stated so the shortlist is understood as a selection
 * rather than as everything that exists.
 */
import { notFound, redirect } from 'next/navigation';
import { V5_MODEL_VERSION } from '@/lib/country-discovery/market-view';
import { requireDiscoveryPrincipal } from '@/lib/country-discovery/page-auth';
import { marketResults, productDiscoveryState } from '@/lib/country-discovery/service';
import { isNotFound } from '@/lib/errors';
import { PageHeader } from '@/components/ui';
import { MarketResults } from './MarketResults';

export const dynamic = 'force-dynamic';

export default async function MarketsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const principal = await requireDiscoveryPrincipal();
  const [results, state] = await Promise.all([
    marketResults(principal, principal.exporter_org_id, productId),
    productDiscoveryState(principal, principal.exporter_org_id, productId),
  ]).catch((error) => {
    if (isNotFound(error)) notFound();
    throw error;
  });
  // E-061: a v5 run's results live on Markets, in the engine's own order with its reasons.
  if (results.run?.model_version === V5_MODEL_VERSION) redirect('/app/markets');

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
      <MarketResults productId={productId} results={results} screening={state.screening} />
    </>
  );
}
