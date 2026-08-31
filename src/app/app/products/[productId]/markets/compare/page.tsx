/**
 * `/app/products/:productId/markets/compare?countries=DE,US,GB`
 *
 * Missing evidence is shown as missing. No value is zeroed to make a row line up.
 */
import { notFound } from 'next/navigation';
import { requireExporterPrincipal } from '@/lib/auth';
import { compareMarkets } from '@/lib/country-discovery/service';
import { countryName } from '@/lib/country-discovery/country-names';
import { isNotFound } from '@/lib/errors';
import { EmptyState, PageHeader } from '@/components/ui';
import { MarketComparison } from './MarketComparison';

export const dynamic = 'force-dynamic';

export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ countries?: string }>;
}) {
  const { productId } = await params;
  const { countries } = await searchParams;
  const principal = await requireExporterPrincipal();
  const requested = (countries ?? '').split(',').map((code) => code.trim()).filter(Boolean);

  if (!requested.length) {
    return (
      <>
        <PageHeader title="Compare markets" />
        <EmptyState title="No markets chosen" description="Pick up to three markets from your results to compare them side by side." />
      </>
    );
  }

  const comparison = await compareMarkets(principal, principal.exporter_org_id, productId, requested).catch((error) => {
    if (isNotFound(error)) notFound();
    throw error;
  });

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
      <MarketComparison markets={comparison.markets} productId={productId} />
    </>
  );
}
