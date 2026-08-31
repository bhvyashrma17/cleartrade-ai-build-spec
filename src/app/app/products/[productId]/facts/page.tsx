/**
 * `/app/products/:productId/facts` — the exporter's own operational facts.
 *
 * Grouped and progressively disclosed rather than presented as one long form: an SME
 * manufacturer asked for thirty fields at once fills in none of them.
 */
import { notFound } from 'next/navigation';
import { requireDiscoveryPrincipal } from '@/lib/country-discovery/page-auth';
import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/ui';
import { ProductFactsForm } from './ProductFactsForm';

export const dynamic = 'force-dynamic';

export default async function ProductFactsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const principal = await requireDiscoveryPrincipal();
  const product = await prisma.product.findFirst({
    where: { id: productId, exporter_org_id: principal.exporter_org_id },
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
  if (!product) notFound();

  return (
    <>
      <PageHeader
        eyebrow={product.name}
        title="Product details"
        description="These are used to work out what you would actually earn in each market, and whether you can serve it."
      />
      <ProductFactsForm
        exporterOrgId={principal.exporter_org_id}
        productId={product.id}
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
