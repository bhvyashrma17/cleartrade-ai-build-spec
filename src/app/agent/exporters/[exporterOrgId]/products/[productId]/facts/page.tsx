/**
 * `/agent/exporters/:exporterOrgId/products/:productId/facts` — an assigned agent recording the
 * exporter's own operational facts on their behalf.
 *
 * Reuses `declareProductOperationalFacts` exactly as the exporter's own facts page does — same
 * endpoint, same service call, same server-side provenance decision. Whoever submits this form,
 * the server hardcodes `origin_provenance: 'exporter_declared'`; there is no field in the request
 * body through which a caller could ask for `agent_verified` instead. This page exists only to
 * give an assigned agent a place to use that endpoint when the exporter has relayed the numbers
 * by phone or email — it changes who may reach the form, never what recording a value means.
 */
import { notFound } from 'next/navigation';
import { requireAgentDiscoveryPrincipal, loadOrNotFound } from '@/lib/country-discovery/agent-page-auth';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { PageHeader, StatusChip } from '@/components/ui';
import { ProductFactsForm } from '@/app/app/products/[productId]/facts/ProductFactsForm';

export const dynamic = 'force-dynamic';

export default async function AgentProductFactsPage({ params }: { params: Promise<{ exporterOrgId: string; productId: string }> }) {
  const { exporterOrgId, productId } = await params;
  const principal = await requireAgentDiscoveryPrincipal();

  const { product, lastRecorded } = await loadOrNotFound(async () => {
    await assertOrgAccess(principal, exporterOrgId);
    const found = await prisma.product.findFirst({
      where: { id: productId, exporter_org_id: exporterOrgId },
      select: {
        id: true, name: true,
        price_target_amount: true, price_target_currency: true, price_target_quantity_unit: true, price_target_incoterm: true,
        capacity_value: true, capacity_unit: true, available_capacity_value: true, capacity_period: true,
        moq_value: true, moq_unit: true, lead_time_days: true, delivery_commitment_days: true,
        packaging_format: true, pack_size_value: true, pack_size_unit: true,
        shipment_quantity_value: true, shipment_quantity_unit: true, shipment_container_type: true,
        origin_city: true, origin_state: true, origin_country: true, origin_gateway_code: true,
      },
    });
    if (!found) notFound();
    // Who last recorded these facts, and when — read from the audit trail rather than a new
    // column, since `declareProductOperationalFacts` already writes one event per save.
    const event = await prisma.auditEvent.findFirst({
      where: { object_type: 'product_operational_facts', object_id: productId },
      orderBy: { timestamp: 'desc' },
      include: { actor: { select: { name: true, email: true } } },
    });
    return { product: found, lastRecorded: event };
  });

  return (
    <>
      <PageHeader
        eyebrow={product.name}
        title="Exporter information"
        description="Recorded on the exporter's behalf. These are declarations about their own goods, not ClearTrade-verified facts, however they reached you."
      />
      <ProductFactsForm
        exporterOrgId={exporterOrgId}
        productId={product.id}
        basePath={`/agent/exporters/${exporterOrgId}/products`}
        provenanceNote={
          lastRecorded ? (
            <div className="rounded-md border border-line bg-surface-2 px-3 py-2 text-xs text-slate">
              <StatusChip label="Exporter declared" tone="neutral" icon="dot" size="sm" />
              <span className="ml-2">
                Last recorded by {lastRecorded.actor?.name || lastRecorded.actor?.email || 'ClearTrade'} on{' '}
                {new Date(lastRecorded.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            </div>
          ) : null
        }
        initial={{
          price_target_amount: product.price_target_amount?.toString() ?? '',
          price_target_currency: product.price_target_currency ?? '',
          price_target_quantity_unit: product.price_target_quantity_unit ?? '',
          price_target_incoterm: product.price_target_incoterm ?? '',
          capacity_value: product.capacity_value?.toString() ?? '',
          capacity_unit: product.capacity_unit ?? '',
          available_capacity_value: product.available_capacity_value?.toString() ?? '',
          capacity_period: product.capacity_period ?? '',
          moq_value: product.moq_value?.toString() ?? '',
          moq_unit: product.moq_unit ?? '',
          lead_time_days: product.lead_time_days?.toString() ?? '',
          delivery_commitment_days: product.delivery_commitment_days?.toString() ?? '',
          packaging_format: product.packaging_format ?? '',
          pack_size_value: product.pack_size_value?.toString() ?? '',
          pack_size_unit: product.pack_size_unit ?? '',
          shipment_quantity_value: product.shipment_quantity_value?.toString() ?? '',
          shipment_quantity_unit: product.shipment_quantity_unit ?? '',
          shipment_container_type: product.shipment_container_type ?? '',
          origin_city: product.origin_city ?? '',
          origin_state: product.origin_state ?? '',
          origin_country: product.origin_country ?? '',
          origin_gateway_code: product.origin_gateway_code ?? '',
        }}
      />
    </>
  );
}
