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
import { CertificationFactsForm } from '@/app/app/products/[productId]/facts/CertificationFactsForm';

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
          exporterOrgId={exporterOrgId}
          productId={product.id}
          initial={product.certifications.map((item) => ({ ...item, issue_date: item.issue_date?.toISOString() ?? null, valid_until: item.valid_until?.toISOString() ?? null }))}
        />
      </div>
    </>
  );
}
