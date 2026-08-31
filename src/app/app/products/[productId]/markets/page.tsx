/**
 * `/app/products/:productId/markets` — recommended markets.
 *
 * The shortlist is the product, not the 200-country universe behind it. Screening looked at
 * every reporting market; showing all of them as the primary surface would bury the answer in
 * the working. The universe count is stated so the shortlist is understood as a selection
 * rather than as everything that exists.
 */
import { notFound } from 'next/navigation';
import { requireExporterPrincipal } from '@/lib/auth';
import { marketResults, productDiscoveryState } from '@/lib/country-discovery/service';
import { isNotFound } from '@/lib/errors';
import { PageHeader } from '@/components/ui';
import { MarketResults } from './MarketResults';

export const dynamic = 'force-dynamic';

export default async function MarketsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const principal = await requireExporterPrincipal();
  const [results, state] = await Promise.all([
    marketResults(principal, principal.exporter_org_id, productId),
    productDiscoveryState(principal, principal.exporter_org_id, productId),
  ]).catch((error) => {
    if (isNotFound(error)) notFound();
    throw error;
  });

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
