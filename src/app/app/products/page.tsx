/**
 * `/app/products` — the root of the country-discovery journey.
 *
 * The old journey started at a country search box, which asked the exporter to already know
 * which markets to look at. This one starts where their business actually starts: a product.
 * Markets are the answer, not the question.
 */
import Link from 'next/link';
import { requireDiscoveryPrincipal } from '@/lib/country-discovery/page-auth';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState, PageHeader, StatusChip } from '@/components/ui';
import { assessProductReadiness } from '@/lib/country-discovery/readiness';

export const dynamic = 'force-dynamic';

export default async function ProductsPage() {
  const principal = await requireDiscoveryPrincipal();
  const products = await prisma.product.findMany({
    where: { exporter_org_id: principal.exporter_org_id },
    include: { classification_history: { where: { status: 'confirmed' }, orderBy: { revision: 'desc' }, take: 1 } },
    orderBy: { name: 'asc' },
  });

  return (
    <>
      <PageHeader
        title="Your products"
        description="Choose a product to find the export markets that suit it best."
      />
      {products.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="ClearTrade compares markets for one product at a time. Add a product and its HS classification to begin."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {products.map((product) => {
            const classification = product.classification_history[0] ?? null;
            const readiness = assessProductReadiness(product, classification);
            return (
              <li key={product.id}>
                <Card as="article" className="h-full">
                  <Link href={`/app/products/${product.id}`} className="block focus-visible:outline-none">
                    <h2 className="text-base font-medium text-bone">{product.name}</h2>
                    <p className="mt-1 text-sm text-slate">
                      {readiness.hs6 ? `Customs code ${readiness.hs6}` : 'Customs code not confirmed yet'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {readiness.can_discover ? (
                        <StatusChip label="Ready to find markets" tone="positive" icon="check" size="sm" />
                      ) : (
                        <StatusChip label="Classification pending" tone="warning" icon="clock" size="sm" />
                      )}
                      {readiness.missing_now > 0 ? (
                        <StatusChip
                          label={`${readiness.missing_now} ${readiness.missing_now === 1 ? 'detail' : 'details'} would improve analysis`}
                          tone="neutral"
                          icon="dot"
                          size="sm"
                        />
                      ) : null}
                    </div>
                  </Link>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
