/**
 * Universal commercial and logistics vocabulary for physical goods.
 *
 * These are storage/validation identities, not conversion tables. A kilogram and a tonne may
 * describe the same dimension, but this module deliberately contains no conversion factor:
 * comparison code may only compare already-identical canonical units.
 */

export const COMMERCIAL_QUANTITY_UNITS = [
  'piece', 'unit', 'g', 'kg', 'tonne', 'ml', 'litre', 'm2', 'm3', 'metre',
  'bag', 'bale', 'carton', 'crate', 'drum', 'pallet', 'bulk',
] as const;

export const MASS_UNITS = ['g', 'kg', 'tonne', 'lb'] as const;
export const VOLUME_UNITS = ['ml', 'litre', 'm3', 'ft3'] as const;
export const LENGTH_UNITS = ['mm', 'cm', 'metre', 'inch', 'ft'] as const;
export const TRANSPORT_MODES = ['ocean', 'air', 'road', 'rail', 'courier', 'multimodal'] as const;

export type ConfidencePillar =
  | 'Market Access'
  | 'Export Economics'
  | 'Exporter Fit'
  | 'Logistics';

/**
 * The canonical dependency graph behind “What would this input unlock?”. The labels are kept
 * beside the field identities so exporter and staff UIs cannot invent different causal claims.
 */
export const PRODUCT_FACT_DEPENDENCIES: Readonly<Record<string, readonly ConfidencePillar[]>> = {
  price_target_amount: ['Export Economics', 'Exporter Fit'],
  price_target_currency: ['Export Economics', 'Exporter Fit'],
  price_target_quantity_unit: ['Export Economics', 'Exporter Fit'],
  price_target_incoterm: ['Export Economics', 'Exporter Fit'],
  commercial_quantity_unit: ['Export Economics', 'Exporter Fit', 'Logistics'],
  piece_unit_name: ['Exporter Fit', 'Logistics'],
  capacity_value: ['Exporter Fit'],
  capacity_unit: ['Exporter Fit'],
  capacity_period: ['Exporter Fit'],
  available_capacity_value: ['Exporter Fit'],
  available_capacity_unit: ['Exporter Fit'],
  moq_value: ['Exporter Fit'],
  moq_unit: ['Exporter Fit'],
  desired_order_size_amount: ['Exporter Fit'],
  desired_order_size_currency: ['Exporter Fit'],
  desired_order_quantity_value: ['Exporter Fit'],
  desired_order_quantity_unit: ['Exporter Fit'],
  lead_time_days: ['Exporter Fit', 'Logistics'],
  delivery_commitment_days: ['Logistics'],
  packaging_format: ['Market Access', 'Exporter Fit', 'Logistics'],
  packaging: ['Market Access', 'Exporter Fit', 'Logistics'],
  pack_size_value: ['Market Access', 'Exporter Fit', 'Logistics'],
  pack_size_unit: ['Market Access', 'Exporter Fit', 'Logistics'],
  units_per_package: ['Market Access', 'Exporter Fit', 'Logistics'],
  package_weight_value: ['Export Economics', 'Logistics'],
  package_weight_unit: ['Export Economics', 'Logistics'],
  package_volume_value: ['Export Economics', 'Logistics'],
  package_volume_unit: ['Export Economics', 'Logistics'],
  units_per_carton: ['Exporter Fit', 'Logistics'],
  carton_configuration: ['Market Access', 'Exporter Fit', 'Logistics'],
  cartons_per_pallet: ['Logistics'],
  pallet_configuration: ['Logistics'],
  palletized: ['Logistics'],
  container_compatibility: ['Logistics'],
  transport_mode_compatibility: ['Logistics'],
  fragile: ['Logistics'],
  perishable: ['Logistics'],
  temperature_controlled: ['Logistics'],
  temperature_min_celsius: ['Logistics'],
  temperature_max_celsius: ['Logistics'],
  hazardous: ['Market Access', 'Logistics'],
  dangerous_goods_un_number: ['Market Access', 'Logistics'],
  dangerous_goods_hazard_class: ['Market Access', 'Logistics'],
  special_handling_codes: ['Market Access', 'Logistics'],
  unit_net_weight_value: ['Export Economics', 'Logistics'],
  unit_net_weight_unit: ['Export Economics', 'Logistics'],
  unit_gross_weight_value: ['Export Economics', 'Logistics'],
  unit_gross_weight_unit: ['Export Economics', 'Logistics'],
  unit_length_value: ['Logistics'],
  unit_width_value: ['Logistics'],
  unit_height_value: ['Logistics'],
  unit_dimension_unit: ['Logistics'],
  unit_volume_value: ['Export Economics', 'Logistics'],
  unit_volume_unit: ['Export Economics', 'Logistics'],
  shipment_quantity_value: ['Export Economics', 'Logistics'],
  shipment_quantity_unit: ['Export Economics', 'Logistics'],
  shipment_container_type: ['Export Economics', 'Logistics'],
  origin_city: ['Export Economics', 'Logistics'],
  origin_state: ['Export Economics', 'Logistics'],
  origin_country: ['Market Access', 'Export Economics', 'Logistics'],
  origin_gateway_code: ['Export Economics', 'Logistics'],
  customization_available: ['Exporter Fit'],
  private_label_available: ['Exporter Fit'],
  packaging_customization_available: ['Exporter Fit'],
  customization_capability: ['Exporter Fit'],
  packaging_capability: ['Exporter Fit'],
  certifications: ['Market Access', 'Exporter Fit'],
};

const aliases: Readonly<Record<string, string>> = {
  pcs: 'piece', pieces: 'piece', units: 'unit',
  kgs: 'kg', kilogram: 'kg', kilograms: 'kg',
  mt: 'tonne', mts: 'tonne', tonnes: 'tonne',
  l: 'litre', ltr: 'litre', litres: 'litre', liters: 'litre',
  sqm: 'm2', 'm²': 'm2', cbm: 'm3', 'm³': 'm3',
  meter: 'metre', meters: 'metre', metres: 'metre',
};

export function canonicalProductUnit(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? (aliases[normalized] ?? normalized) : null;
}

export function unitIsOneOf(value: string | null | undefined, units: readonly string[]): boolean {
  const canonical = canonicalProductUnit(value);
  return canonical != null && units.includes(canonical);
}

export function dependenciesForProductFact(field: string): readonly ConfidencePillar[] {
  return PRODUCT_FACT_DEPENDENCIES[field] ?? [];
}
