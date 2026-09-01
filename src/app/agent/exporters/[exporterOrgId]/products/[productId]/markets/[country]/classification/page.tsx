/**
 * `/agent/exporters/:exporterOrgId/products/:productId/markets/:country/classification`
 *
 * Agent-side classification questions — the same product questions the exporter answers
 * directly, available here for an agent relaying them on a call or filling in what the exporter
 * has already confirmed. Never a tariff code, on either surface.
 */
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { classificationQuestions } from '@/lib/country-discovery/service';
import { countryName } from '@/lib/country-discovery/country-names';
import { PageHeader } from '@/components/ui';
import { ClassificationQuestions } from '@/app/app/products/[productId]/markets/[country]/classification/ClassificationQuestions';

export const dynamic = 'force-dynamic';

export default async function AgentClassificationPage({ params }: { params: Promise<{ exporterOrgId: string; productId: string; country: string }> }) {
  const { exporterOrgId, productId, country } = await params;
  const principal = await requireAgentDiscoveryPrincipal();
  const view = await loadOrNotFound(() => classificationQuestions(principal, exporterOrgId, productId, country));

  return (
    <>
      <PageHeader
        eyebrow={countryName(country)}
        title="Product classification"
        description="These questions decide which import duty applies. Answer only what the exporter has confirmed."
      />
      <ClassificationQuestions
        exporterOrgId={exporterOrgId}
        productId={productId}
        countryCode={country.toUpperCase()}
        initial={view}
        basePath={`/agent/exporters/${exporterOrgId}/products`}
      />
    </>
  );
}
