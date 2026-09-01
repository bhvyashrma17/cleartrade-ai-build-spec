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
import { CertificationFactsForm } from './CertificationFactsForm';

export const dynamic = 'force-dynamic';

export default async function ProductFactsPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const principal = await requireDiscoveryPrincipal();
  const product = await prisma.product.findFirst({
    where: { id: productId, exporter_org_id: principal.exporter_org_id },
    select: {
      id: true, name: true,
      price_target_amount: true, price_target_currency: true, price_target_quantity_unit: true, price_target_incoterm: true,
      commercial_quantity_unit: true, piece_unit_name: true,
      capacity_value: true, capacity_unit: true, available_capacity_value: true, available_capacity_unit: true, capacity_period: true,
      moq_value: true, moq_unit: true, lead_time_days: true, delivery_commitment_days: true,
      desired_order_size_amount: true, desired_order_size_currency: true, desired_order_quantity_value: true, desired_order_quantity_unit: true,
      customization_available: true, private_label_available: true, packaging_customization_available: true, customization_capability: true, packaging_capability: true,
      packaging: true, packaging_format: true, pack_size_value: true, pack_size_unit: true, units_per_package: true,
      package_weight_value: true, package_weight_unit: true, package_volume_value: true, package_volume_unit: true,
      units_per_carton: true, carton_configuration: true, cartons_per_pallet: true, pallet_configuration: true, palletized: true,
      container_compatibility: true, transport_mode_compatibility: true, special_handling_codes: true,
      fragile: true, perishable: true, hazardous: true, dangerous_goods_un_number: true, dangerous_goods_hazard_class: true,
      temperature_controlled: true, temperature_min_celsius: true, temperature_max_celsius: true,
      unit_net_weight_value: true, unit_net_weight_unit: true, unit_gross_weight_value: true, unit_gross_weight_unit: true,
      unit_length_value: true, unit_width_value: true, unit_height_value: true, unit_dimension_unit: true, unit_volume_value: true, unit_volume_unit: true,
      shipment_quantity_value: true, shipment_quantity_unit: true, shipment_container_type: true,
      origin_city: true, origin_state: true, origin_country: true, origin_gateway_code: true,
      certifications: { select: { code: true, name: true, status: true, declaration_state: true, verification_state: true, issuer: true, certificate_reference: true, issue_date: true, valid_until: true }, orderBy: { code: 'asc' } },
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
          commercial_quantity_unit: product.commercial_quantity_unit ?? '',
          piece_unit_name: product.piece_unit_name ?? '',
          capacity_value: product.capacity_value?.toString() ?? '',
          capacity_unit: product.capacity_unit ?? '',
          available_capacity_value: product.available_capacity_value?.toString() ?? '',
          available_capacity_unit: product.available_capacity_unit ?? '',
          capacity_period: product.capacity_period ?? '',
          moq_value: product.moq_value?.toString() ?? '',
          moq_unit: product.moq_unit ?? '',
          desired_order_size_amount: product.desired_order_size_amount?.toString() ?? '',
          desired_order_size_currency: product.desired_order_size_currency ?? '',
          desired_order_quantity_value: product.desired_order_quantity_value?.toString() ?? '',
          desired_order_quantity_unit: product.desired_order_quantity_unit ?? '',
          lead_time_days: product.lead_time_days?.toString() ?? '',
          delivery_commitment_days: product.delivery_commitment_days?.toString() ?? '',
          customization_available: product.customization_available == null ? '' : product.customization_available ? 'yes' : 'no',
          private_label_available: product.private_label_available == null ? '' : product.private_label_available ? 'yes' : 'no',
          packaging_customization_available: product.packaging_customization_available == null ? '' : product.packaging_customization_available ? 'yes' : 'no',
          customization_capability: product.customization_capability ?? '',
          packaging_capability: product.packaging_capability ?? '',
          packaging_format: product.packaging_format ?? '',
          packaging: product.packaging ?? '',
          pack_size_value: product.pack_size_value?.toString() ?? '',
          pack_size_unit: product.pack_size_unit ?? '',
          units_per_package: product.units_per_package?.toString() ?? '',
          package_weight_value: product.package_weight_value?.toString() ?? '',
          package_weight_unit: product.package_weight_unit ?? '',
          package_volume_value: product.package_volume_value?.toString() ?? '',
          package_volume_unit: product.package_volume_unit ?? '',
          units_per_carton: product.units_per_carton?.toString() ?? '',
          carton_configuration: product.carton_configuration ?? '',
          cartons_per_pallet: product.cartons_per_pallet?.toString() ?? '',
          pallet_configuration: product.pallet_configuration ?? '',
          palletized: product.palletized == null ? '' : product.palletized ? 'yes' : 'no',
          container_compatibility: product.container_compatibility.join(', '),
          transport_mode_compatibility: product.transport_mode_compatibility.join(', '),
          special_handling_codes: product.special_handling_codes.join(', '),
          fragile: product.fragile == null ? '' : product.fragile ? 'yes' : 'no',
          perishable: product.perishable == null ? '' : product.perishable ? 'yes' : 'no',
          hazardous: product.hazardous == null ? '' : product.hazardous ? 'yes' : 'no',
          dangerous_goods_un_number: product.dangerous_goods_un_number ?? '',
          dangerous_goods_hazard_class: product.dangerous_goods_hazard_class ?? '',
          temperature_controlled: product.temperature_controlled == null ? '' : product.temperature_controlled ? 'yes' : 'no',
          temperature_min_celsius: product.temperature_min_celsius?.toString() ?? '',
          temperature_max_celsius: product.temperature_max_celsius?.toString() ?? '',
          unit_net_weight_value: product.unit_net_weight_value?.toString() ?? '',
          unit_net_weight_unit: product.unit_net_weight_unit ?? '',
          unit_gross_weight_value: product.unit_gross_weight_value?.toString() ?? '',
          unit_gross_weight_unit: product.unit_gross_weight_unit ?? '',
          unit_length_value: product.unit_length_value?.toString() ?? '',
          unit_width_value: product.unit_width_value?.toString() ?? '',
          unit_height_value: product.unit_height_value?.toString() ?? '',
          unit_dimension_unit: product.unit_dimension_unit ?? '',
          unit_volume_value: product.unit_volume_value?.toString() ?? '',
          unit_volume_unit: product.unit_volume_unit ?? '',
          shipment_quantity_value: product.shipment_quantity_value?.toString() ?? '',
          shipment_quantity_unit: product.shipment_quantity_unit ?? '',
          shipment_container_type: product.shipment_container_type ?? '',
          origin_city: product.origin_city ?? '',
          origin_state: product.origin_state ?? '',
          origin_country: product.origin_country ?? '',
          origin_gateway_code: product.origin_gateway_code ?? '',
        }}
      />
      <div className="mt-4">
        <CertificationFactsForm
          exporterOrgId={principal.exporter_org_id}
          productId={product.id}
          initial={product.certifications.map((item) => ({ ...item, issue_date: item.issue_date?.toISOString() ?? null, valid_until: item.valid_until?.toISOString() ?? null }))}
        />
      </div>
    </>
  );
}
