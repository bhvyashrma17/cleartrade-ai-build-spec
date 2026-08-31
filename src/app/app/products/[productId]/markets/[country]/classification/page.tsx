/**
 * `/app/products/:productId/markets/:country/classification`
 *
 * The exporter answers questions about their own goods. They are never shown a list of tariff
 * codes to choose between, and the page never sends one — see `ClassificationQuestions`.
 */
import { notFound } from 'next/navigation';
import { requireExporterPrincipal } from '@/lib/auth';
import { classificationQuestions } from '@/lib/country-discovery/service';
import { countryName } from '@/lib/country-discovery/country-names';
import { isNotFound } from '@/lib/errors';
import { PageHeader } from '@/components/ui';
import { ClassificationQuestions } from './ClassificationQuestions';

export const dynamic = 'force-dynamic';

export default async function ClassificationPage({ params }: { params: Promise<{ productId: string; country: string }> }) {
  const { productId, country } = await params;
  const principal = await requireExporterPrincipal();
  const view = await classificationQuestions(principal, principal.exporter_org_id, productId, country).catch((error) => {
    if (isNotFound(error)) notFound();
    throw error;
  });

  return (
    <>
      <PageHeader
        eyebrow={countryName(country)}
        title="About your product"
        description="These questions decide which import duty applies to your goods. Answer only what you know."
      />
      <ClassificationQuestions
        exporterOrgId={principal.exporter_org_id}
        productId={productId}
        countryCode={country.toUpperCase()}
        initial={view}
      />
    </>
  );
}
