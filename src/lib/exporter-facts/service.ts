/**
 * First-party operational facts: who may state what, and under whose authority.
 *
 * The authorization split is the substance of this module, not decoration. An exporter states
 * facts about its own goods and those facts stay `exporter_declared` however confident they
 * sound. An assigned agent verifies them, records partner quotes and confirms routes. Nobody
 * verifies their own declaration, because a declaration that can verify itself is just a
 * declaration wearing a better label.
 */
import { CertificationStatus, EvidenceAssertionClass, EvidenceOrigin, LogisticsTransportMode, Prisma, UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertCan, assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { EXPORT_COST_COMPONENTS, type ExportCostComponentCode } from '@/lib/country-truth/phase-1h-calculations';
import type { OperationalQuoteType, OperationalRateBasis } from '@/lib/country-truth/operational-evidence';
import {
  COMMERCIAL_QUANTITY_UNITS,
  LENGTH_UNITS,
  MASS_UNITS,
  TRANSPORT_MODES,
  VOLUME_UNITS,
  canonicalProductUnit,
  unitIsOneOf,
} from '@/lib/product-profile';
import type { Principal } from '@/types';

const AGENT_ROLES: readonly UserRole[] = [UserRole.agent, UserRole.ops_supervisor, UserRole.admin];
const EXPORTER_ROLES: readonly UserRole[] = [UserRole.exporter_owner, UserRole.exporter_member];

const RATE_BASES: readonly OperationalRateBasis[] = ['per_unit', 'per_shipment', 'per_container', 'percent_of_value'];
const QUOTE_TYPES: readonly OperationalQuoteType[] = ['cha', 'inland_transport', 'cargo_insurance', 'financing', 'destination_handling', 'packaging', 'international_freight', 'cleartrade_fee'];

async function productForTenant(actor: Principal, exporterOrgId: string, productId: string) {
  await assertOrgAccess(actor, exporterOrgId);
  const product = await prisma.product.findFirst({ where: { id: productId, exporter_org_id: exporterOrgId } });
  if (!product) throw notFound('That product is not available for this exporter.');
  return product;
}

export interface ProductOperationalFactsInput {
  price_target_amount?: string | null;
  price_target_currency?: string | null;
  price_target_quantity_unit?: string | null;
  price_target_incoterm?: string | null;
  commercial_quantity_unit?: string | null;
  piece_unit_name?: string | null;
  capacity_value?: string | null;
  capacity_unit?: string | null;
  available_capacity_value?: string | null;
  available_capacity_unit?: string | null;
  capacity_period?: string | null;
  moq_value?: string | null;
  moq_unit?: string | null;
  desired_order_size_amount?: string | null;
  desired_order_size_currency?: string | null;
  desired_order_quantity_value?: string | null;
  desired_order_quantity_unit?: string | null;
  lead_time_days?: number | null;
  delivery_commitment_days?: number | null;
  customization_available?: boolean | null;
  private_label_available?: boolean | null;
  packaging_customization_available?: boolean | null;
  customization_capability?: string | null;
  packaging_capability?: string | null;
  packaging?: string | null;
  packaging_format?: string | null;
  pack_size_value?: string | null;
  pack_size_unit?: string | null;
  units_per_package?: number | null;
  package_weight_value?: string | null;
  package_weight_unit?: string | null;
  package_volume_value?: string | null;
  package_volume_unit?: string | null;
  units_per_carton?: number | null;
  cartons_per_pallet?: number | null;
  palletized?: boolean | null;
  carton_configuration?: string | null;
  pallet_configuration?: string | null;
  container_compatibility?: string[];
  transport_mode_compatibility?: string[];
  special_handling_codes?: string[];
  fragile?: boolean | null;
  perishable?: boolean | null;
  hazardous?: boolean | null;
  dangerous_goods_un_number?: string | null;
  dangerous_goods_hazard_class?: string | null;
  temperature_controlled?: boolean | null;
  temperature_min_celsius?: string | null;
  temperature_max_celsius?: string | null;
  unit_net_weight_value?: string | null;
  unit_net_weight_unit?: string | null;
  unit_gross_weight_value?: string | null;
  unit_gross_weight_unit?: string | null;
  unit_length_value?: string | null;
  unit_width_value?: string | null;
  unit_height_value?: string | null;
  unit_dimension_unit?: string | null;
  unit_volume_value?: string | null;
  unit_volume_unit?: string | null;
  shipment_quantity_value?: string | null;
  shipment_quantity_unit?: string | null;
  shipment_container_count?: number | null;
  shipment_container_type?: string | null;
  origin_city?: string | null;
  origin_state?: string | null;
  origin_country?: string | null;
  origin_postal_code?: string | null;
  origin_location_code?: string | null;
  origin_gateway_code?: string | null;
}

const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CPT', 'CIF', 'CIP', 'DAP', 'DPU', 'DDP'];

type ProductFactValidationError = { field: string; code: string; message: string };

/** Pure validation used by the service and the product-generality suite. */
export function validateProductOperationalFacts(
  facts: ProductOperationalFactsInput,
  current?: { hazardous?: boolean | null; dangerous_goods_un_number?: string | null; dangerous_goods_hazard_class?: string | null },
): ProductFactValidationError[] {
  const fields: ProductFactValidationError[] = [];
  const touched = (key: keyof ProductOperationalFactsInput) => facts[key] !== undefined;
  const pair = (valueKey: keyof ProductOperationalFactsInput, unitKey: keyof ProductOperationalFactsInput, label: string) => {
    if (!touched(valueKey) && !touched(unitKey)) return;
    if (!touched(valueKey) || !touched(unitKey) || (facts[valueKey] == null) !== (facts[unitKey] == null)) {
      fields.push({ field: String(valueKey), code: 'incomplete', message: `${label} needs both a quantity and its unit; changing either requires sending both.` });
    }
  };

  if (facts.price_target_incoterm && !INCOTERMS.includes(facts.price_target_incoterm.toUpperCase())) fields.push({ field: 'price_target_incoterm', code: 'invalid', message: `Incoterm must be one of ${INCOTERMS.join(', ')}.` });
  const priceKeys: Array<keyof ProductOperationalFactsInput> = ['price_target_amount', 'price_target_currency', 'price_target_quantity_unit', 'price_target_incoterm'];
  if (priceKeys.some(touched)) {
    const present = priceKeys.map((key) => facts[key] != null);
    if (present.some(Boolean) && !present.every(Boolean)) fields.push({ field: 'price_target_amount', code: 'incomplete', message: 'A price needs its amount, currency, quantity unit and Incoterm together.' });
  }
  pair('capacity_value', 'capacity_unit', 'Production capacity');
  pair('available_capacity_value', 'available_capacity_unit', 'Available capacity');
  pair('moq_value', 'moq_unit', 'Minimum order quantity');
  pair('desired_order_size_amount', 'desired_order_size_currency', 'Preferred order value');
  pair('desired_order_quantity_value', 'desired_order_quantity_unit', 'Preferred order quantity');
  pair('pack_size_value', 'pack_size_unit', 'Pack size');
  pair('package_weight_value', 'package_weight_unit', 'Package weight');
  pair('package_volume_value', 'package_volume_unit', 'Package volume');
  pair('unit_net_weight_value', 'unit_net_weight_unit', 'Net weight');
  pair('unit_gross_weight_value', 'unit_gross_weight_unit', 'Gross weight');
  pair('unit_volume_value', 'unit_volume_unit', 'Unit volume');
  pair('shipment_quantity_value', 'shipment_quantity_unit', 'Standard shipment');

  const positiveDecimals: Array<keyof ProductOperationalFactsInput> = [
    'price_target_amount', 'capacity_value', 'available_capacity_value', 'moq_value',
    'desired_order_size_amount', 'desired_order_quantity_value', 'pack_size_value',
    'package_weight_value', 'package_volume_value', 'unit_net_weight_value',
    'unit_gross_weight_value', 'unit_length_value', 'unit_width_value', 'unit_height_value',
    'unit_volume_value', 'shipment_quantity_value',
  ];
  for (const field of positiveDecimals) {
    const value = facts[field];
    if (value != null && !(Number(value) > 0)) fields.push({ field: String(field), code: 'invalid', message: 'Quantities and prices must be positive.' });
  }

  const commercialUnits: Array<keyof ProductOperationalFactsInput> = [
    'commercial_quantity_unit', 'price_target_quantity_unit', 'capacity_unit', 'available_capacity_unit',
    'moq_unit', 'desired_order_quantity_unit', 'shipment_quantity_unit', 'pack_size_unit',
  ];
  for (const field of commercialUnits) {
    const value = facts[field];
    if (typeof value === 'string' && !unitIsOneOf(value, COMMERCIAL_QUANTITY_UNITS)) fields.push({ field: String(field), code: 'invalid_unit', message: `Use a supported commercial unit: ${COMMERCIAL_QUANTITY_UNITS.join(', ')}.` });
  }
  for (const field of ['package_weight_unit', 'unit_net_weight_unit', 'unit_gross_weight_unit'] as const) {
    if (facts[field] && !unitIsOneOf(facts[field], MASS_UNITS)) fields.push({ field, code: 'invalid_dimension', message: 'A weight must use a mass unit.' });
  }
  for (const field of ['package_volume_unit', 'unit_volume_unit'] as const) {
    if (facts[field] && !unitIsOneOf(facts[field], VOLUME_UNITS)) fields.push({ field, code: 'invalid_dimension', message: 'A volume must use a volume unit.' });
  }
  const dimensionsTouched = ['unit_length_value', 'unit_width_value', 'unit_height_value'].some((key) => facts[key as keyof ProductOperationalFactsInput] != null);
  if (dimensionsTouched && !facts.unit_dimension_unit) fields.push({ field: 'unit_dimension_unit', code: 'required', message: 'Physical dimensions need a length unit.' });
  if (facts.unit_dimension_unit && !unitIsOneOf(facts.unit_dimension_unit, LENGTH_UNITS)) fields.push({ field: 'unit_dimension_unit', code: 'invalid_dimension', message: 'Physical dimensions must use a length unit.' });

  if (facts.origin_country && !/^[A-Z]{2}$/.test(facts.origin_country.toUpperCase())) fields.push({ field: 'origin_country', code: 'invalid', message: 'Origin country must be an ISO alpha-2 code.' });
  for (const mode of facts.transport_mode_compatibility ?? []) if (!TRANSPORT_MODES.includes(mode.trim().toLowerCase() as (typeof TRANSPORT_MODES)[number])) fields.push({ field: 'transport_mode_compatibility', code: 'invalid', message: `Transport modes must be one of ${TRANSPORT_MODES.join(', ')}.` });

  const nextHazardous = facts.hazardous !== undefined ? facts.hazardous : current?.hazardous;
  const nextUnNumber = facts.dangerous_goods_un_number !== undefined ? facts.dangerous_goods_un_number : current?.dangerous_goods_un_number;
  const nextHazardClass = facts.dangerous_goods_hazard_class !== undefined ? facts.dangerous_goods_hazard_class : current?.dangerous_goods_hazard_class;
  if (nextHazardous === true && !nextUnNumber && !nextHazardClass && !(facts.special_handling_codes ?? []).some((code) => /HAZ|DANGEROUS/i.test(code))) {
    fields.push({ field: 'hazardous', code: 'handling_required', message: 'Hazardous goods need a UN number, hazard class, or dangerous-goods handling code.' });
  }
  if (nextHazardous === false && (nextUnNumber || nextHazardClass)) fields.push({ field: 'hazardous', code: 'conflict', message: 'A product with dangerous-goods classification cannot be declared non-hazardous.' });
  if (facts.temperature_controlled === false && (facts.temperature_min_celsius != null || facts.temperature_max_celsius != null)) fields.push({ field: 'temperature_controlled', code: 'conflict', message: 'A temperature band cannot be supplied when temperature control is declared unnecessary.' });

  const netUnit = canonicalProductUnit(facts.unit_net_weight_unit);
  const grossUnit = canonicalProductUnit(facts.unit_gross_weight_unit);
  if (facts.unit_net_weight_value != null && facts.unit_gross_weight_value != null) {
    if (netUnit !== grossUnit) fields.push({ field: 'unit_gross_weight_unit', code: 'incompatible_unit', message: 'Net and gross weight must use the same unit; ClearTrade does not convert them automatically.' });
    else if (Number(facts.unit_gross_weight_value) < Number(facts.unit_net_weight_value)) fields.push({ field: 'unit_gross_weight_value', code: 'invalid', message: 'Gross weight cannot be less than net weight.' });
  }
  return fields;
}

/**
 * An exporter declares its own product's operational facts.
 *
 * Provenance is decided here, not by the caller: whatever an exporter says about its own goods
 * is `exporter_declared`, and stating a fact never marks it verified.
 */
export async function declareProductOperationalFacts(args: {
  actor: Principal;
  exporter_org_id: string;
  product_id: string;
  facts: ProductOperationalFactsInput;
  correlation_id: string;
}) {
  if (!EXPORTER_ROLES.includes(args.actor.role) && !AGENT_ROLES.includes(args.actor.role)) throw forbidden('Only the exporter or its assigned agent may record product facts.');
  assertCan(args.actor, 'exporter_master_data.edit');
  const product = await productForTenant(args.actor, args.exporter_org_id, args.product_id);
  const facts = args.facts;
  const fields = validateProductOperationalFacts(facts, product);
  if (fields.length) throw validationError(fields);

  const decimal = (value: string | null | undefined) => (value == null ? null : new Prisma.Decimal(value));
  const unit = (value: string | null | undefined) => canonicalProductUnit(value);
  const touchesOrigin = facts.origin_city !== undefined || facts.origin_location_code !== undefined;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: product.id },
      data: {
      ...(facts.price_target_amount !== undefined ? { price_target_amount: decimal(facts.price_target_amount), price_target_currency: facts.price_target_currency?.toUpperCase() ?? null, price_target_quantity_unit: unit(facts.price_target_quantity_unit), price_target_incoterm: facts.price_target_incoterm?.toUpperCase() ?? null } : {}),
      ...(facts.commercial_quantity_unit !== undefined ? { commercial_quantity_unit: unit(facts.commercial_quantity_unit), piece_unit_name: facts.piece_unit_name ?? null } : {}),
      ...(facts.capacity_value !== undefined ? { capacity_value: decimal(facts.capacity_value), capacity_unit: unit(facts.capacity_unit) } : {}),
      ...(facts.available_capacity_value !== undefined ? { available_capacity_value: decimal(facts.available_capacity_value), available_capacity_unit: unit(facts.available_capacity_unit), capacity_period: facts.capacity_period ?? null } : {}),
      ...(facts.moq_value !== undefined ? { moq_value: decimal(facts.moq_value), moq_unit: unit(facts.moq_unit) } : {}),
      ...(facts.desired_order_size_amount !== undefined ? { desired_order_size_amount: decimal(facts.desired_order_size_amount), desired_order_size_currency: facts.desired_order_size_currency?.toUpperCase() ?? null } : {}),
      ...(facts.desired_order_quantity_value !== undefined ? { desired_order_quantity_value: decimal(facts.desired_order_quantity_value), desired_order_quantity_unit: unit(facts.desired_order_quantity_unit) } : {}),
      ...(facts.lead_time_days !== undefined ? { lead_time_days: facts.lead_time_days } : {}),
      ...(facts.delivery_commitment_days !== undefined ? { delivery_commitment_days: facts.delivery_commitment_days } : {}),
      ...(facts.customization_available !== undefined ? { customization_available: facts.customization_available } : {}),
      ...(facts.private_label_available !== undefined ? { private_label_available: facts.private_label_available } : {}),
      ...(facts.packaging_customization_available !== undefined ? { packaging_customization_available: facts.packaging_customization_available } : {}),
      ...(facts.customization_capability !== undefined ? { customization_capability: facts.customization_capability } : {}),
      ...(facts.packaging_capability !== undefined ? { packaging_capability: facts.packaging_capability } : {}),
      ...(facts.packaging !== undefined ? { packaging: facts.packaging } : {}),
      ...(facts.packaging_format !== undefined ? { packaging_format: facts.packaging_format?.toUpperCase() ?? null } : {}),
      ...(facts.pack_size_value !== undefined ? { pack_size_value: decimal(facts.pack_size_value), pack_size_unit: unit(facts.pack_size_unit) } : {}),
      ...(facts.units_per_package !== undefined ? { units_per_package: facts.units_per_package } : {}),
      ...(facts.package_weight_value !== undefined ? { package_weight_value: decimal(facts.package_weight_value), package_weight_unit: unit(facts.package_weight_unit) } : {}),
      ...(facts.package_volume_value !== undefined ? { package_volume_value: decimal(facts.package_volume_value), package_volume_unit: unit(facts.package_volume_unit) } : {}),
      ...(facts.units_per_carton !== undefined ? { units_per_carton: facts.units_per_carton } : {}),
      ...(facts.cartons_per_pallet !== undefined ? { cartons_per_pallet: facts.cartons_per_pallet } : {}),
      ...(facts.palletized !== undefined ? { palletized: facts.palletized } : {}),
      ...(facts.carton_configuration !== undefined ? { carton_configuration: facts.carton_configuration } : {}),
      ...(facts.pallet_configuration !== undefined ? { pallet_configuration: facts.pallet_configuration } : {}),
      ...(facts.container_compatibility !== undefined ? { container_compatibility: facts.container_compatibility.map((code) => code.trim().toUpperCase()).filter(Boolean) } : {}),
      ...(facts.transport_mode_compatibility !== undefined ? { transport_mode_compatibility: facts.transport_mode_compatibility.map((mode) => mode.trim().toLowerCase()).filter(Boolean) } : {}),
      ...(facts.special_handling_codes !== undefined ? { special_handling_codes: facts.special_handling_codes.map((code) => code.trim().toUpperCase()).filter(Boolean) } : {}),
      ...(facts.fragile !== undefined ? { fragile: facts.fragile } : {}),
      ...(facts.perishable !== undefined ? { perishable: facts.perishable } : {}),
      ...(facts.hazardous !== undefined ? { hazardous: facts.hazardous } : {}),
      ...(facts.dangerous_goods_un_number !== undefined ? { dangerous_goods_un_number: facts.dangerous_goods_un_number?.toUpperCase() ?? null } : {}),
      ...(facts.dangerous_goods_hazard_class !== undefined ? { dangerous_goods_hazard_class: facts.dangerous_goods_hazard_class ?? null } : {}),
      ...(facts.temperature_controlled !== undefined ? { temperature_controlled: facts.temperature_controlled, temperature_min_celsius: decimal(facts.temperature_min_celsius), temperature_max_celsius: decimal(facts.temperature_max_celsius) } : {}),
      ...(facts.unit_net_weight_value !== undefined ? { unit_net_weight_value: decimal(facts.unit_net_weight_value), unit_net_weight_unit: unit(facts.unit_net_weight_unit) } : {}),
      ...(facts.unit_gross_weight_value !== undefined ? { unit_gross_weight_value: decimal(facts.unit_gross_weight_value), unit_gross_weight_unit: unit(facts.unit_gross_weight_unit) } : {}),
      ...(['unit_length_value', 'unit_width_value', 'unit_height_value', 'unit_dimension_unit'].some((field) => facts[field as keyof ProductOperationalFactsInput] !== undefined) ? { unit_length_value: decimal(facts.unit_length_value), unit_width_value: decimal(facts.unit_width_value), unit_height_value: decimal(facts.unit_height_value), unit_dimension_unit: unit(facts.unit_dimension_unit) } : {}),
      ...(facts.unit_volume_value !== undefined ? { unit_volume_value: decimal(facts.unit_volume_value), unit_volume_unit: unit(facts.unit_volume_unit) } : {}),
      ...(facts.shipment_quantity_value !== undefined ? { shipment_quantity_value: decimal(facts.shipment_quantity_value), shipment_quantity_unit: unit(facts.shipment_quantity_unit) } : {}),
      ...(facts.shipment_container_count !== undefined ? { shipment_container_count: facts.shipment_container_count, shipment_container_type: facts.shipment_container_type ?? null } : {}),
      ...(facts.origin_city !== undefined ? { origin_city: facts.origin_city, origin_state: facts.origin_state ?? null, origin_country: facts.origin_country?.toUpperCase() ?? null, origin_postal_code: facts.origin_postal_code ?? null } : {}),
      ...(facts.origin_location_code !== undefined ? { origin_location_code: facts.origin_location_code, origin_gateway_code: facts.origin_gateway_code ?? null } : {}),
      // Whoever recorded it, this is a declaration about the exporter's own goods. An agent
      // recording it on the exporter's behalf does not make it verified.
      ...(touchesOrigin ? { origin_provenance: 'exporter_declared' } : {}),
      },
    });
    await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.update, object_type: 'product_operational_facts', object_id: product.id, exporter_org_id: args.exporter_org_id, after_summary: { fields: Object.keys(facts), provenance: 'exporter_declared' }, correlation_id: args.correlation_id, db: tx });
    return updated;
  });
}

export interface ProductCertificationDeclarationInput {
  code: string;
  name: string;
  declaration_state: 'declared_held' | 'declared_absent';
  status?: CertificationStatus;
  issuer?: string | null;
  certificate_reference?: string | null;
  issue_date?: Date | null;
  valid_until?: Date | null;
  evidence_ref?: string | null;
  document_id?: string | null;
}

/** Record what the exporter says about a certification; verification is deliberately separate. */
export async function declareProductCertification(args: {
  actor: Principal;
  exporter_org_id: string;
  product_id: string;
  certification: ProductCertificationDeclarationInput;
  correlation_id: string;
}) {
  if (!EXPORTER_ROLES.includes(args.actor.role) && !AGENT_ROLES.includes(args.actor.role)) throw forbidden('Only the exporter or its assigned agent may record certification information.');
  assertCan(args.actor, 'exporter_master_data.edit');
  await productForTenant(args.actor, args.exporter_org_id, args.product_id);
  const input = args.certification;
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const fields: ProductFactValidationError[] = [];
  if (!code) fields.push({ field: 'code', code: 'required', message: 'Certification type is required.' });
  if (!name) fields.push({ field: 'name', code: 'required', message: 'Certification name is required.' });
  if (input.issue_date && input.valid_until && input.valid_until <= input.issue_date) fields.push({ field: 'valid_until', code: 'invalid', message: 'Expiry must be after the issue date.' });
  if (input.declaration_state === 'declared_absent' && (input.certificate_reference || input.issue_date || input.valid_until || input.document_id || input.evidence_ref)) fields.push({ field: 'declaration_state', code: 'conflict', message: 'An explicitly absent certification cannot carry certificate evidence.' });
  if (fields.length) throw validationError(fields);
  const expired = input.valid_until != null && input.valid_until.getTime() <= Date.now();
  const status = input.declaration_state === 'declared_absent'
    ? CertificationStatus.not_started
    : expired
      ? CertificationStatus.expired
      : input.status ?? CertificationStatus.held;

  return prisma.$transaction(async (tx) => {
    const certification = await tx.productCertification.upsert({
      where: { product_id_code: { product_id: args.product_id, code } },
      create: {
        product_id: args.product_id, code, name, status,
        issuer: input.issuer ?? null, certificate_reference: input.certificate_reference ?? null,
        issue_date: input.issue_date ?? null, valid_until: input.valid_until ?? null,
        evidence_ref: input.evidence_ref ?? null, document_id: input.document_id ?? null,
        declaration_state: input.declaration_state,
        declared_absent: input.declaration_state === 'declared_absent',
        verification_state: 'unverified',
      },
      update: {
        name, status,
        issuer: input.issuer ?? null, certificate_reference: input.certificate_reference ?? null,
        issue_date: input.issue_date ?? null, valid_until: input.valid_until ?? null,
        evidence_ref: input.evidence_ref ?? null, document_id: input.document_id ?? null,
        declaration_state: input.declaration_state,
        declared_absent: input.declaration_state === 'declared_absent',
        // A changed declaration is new evidence. A prior verification never transfers silently.
        verification_state: 'unverified', verified_by_id: null, verified_at: null,
      },
    });
    await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.update, object_type: 'product_certification_declaration', object_id: certification.id, exporter_org_id: args.exporter_org_id, after_summary: { code, declaration_state: input.declaration_state, lifecycle_status: status, provenance: 'exporter_declared' }, correlation_id: args.correlation_id, db: tx });
    return certification;
  });
}

/**
 * Verify a certification an exporter declared.
 *
 * Only an assigned agent may do this, and never for their own declaration: `verified_by_id` is
 * the acting agent, so an exporter principal cannot appear there.
 */
export async function verifyProductCertification(args: {
  actor: Principal;
  exporter_org_id: string;
  product_id: string;
  certification_id: string;
  issuer?: string | null;
  certificate_reference?: string | null;
  issue_date?: Date | null;
  valid_from?: Date | null;
  valid_until?: Date | null;
  correlation_id: string;
}) {
  if (!AGENT_ROLES.includes(args.actor.role)) throw forbidden('Only an assigned agent or operations reviewer may verify a certification.');
  assertCan(args.actor, 'demand_discovery.run');
  await productForTenant(args.actor, args.exporter_org_id, args.product_id);
  const certification = await prisma.productCertification.findFirst({ where: { id: args.certification_id, product_id: args.product_id } });
  if (!certification) throw notFound('That certification does not exist for this product.');
  // A verification without a citable certificate is an opinion.
  const reference = args.certificate_reference ?? certification.certificate_reference;
  if (!reference?.trim()) throw validationError([{ field: 'certificate_reference', code: 'required', message: 'A verified certification must record the certificate reference it was checked against.' }]);
  const validUntil = args.valid_until ?? certification.valid_until;
  if (validUntil && validUntil.getTime() <= Date.now()) throw validationError([{ field: 'valid_until', code: 'expired', message: 'An expired certificate cannot be verified as current.' }]);

  return prisma.$transaction(async (tx) => {
    const updated = await tx.productCertification.update({
      where: { id: certification.id },
      data: {
        verification_state: 'agent_verified', verified_by_id: args.actor.id, verified_at: new Date(),
        issuer: args.issuer ?? certification.issuer,
        certificate_reference: reference,
        issue_date: args.issue_date ?? certification.issue_date,
        valid_from: args.valid_from ?? certification.valid_from,
        valid_until: validUntil,
        declared_absent: false,
        declaration_state: 'declared_held',
      },
    });
    await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.update, object_type: 'product_certification_verification', object_id: certification.id, exporter_org_id: args.exporter_org_id, after_summary: { code: certification.code, verification_state: 'agent_verified', certificate_reference: reference }, correlation_id: args.correlation_id, db: tx });
    return updated;
  });
}

export interface OperationalQuoteInput {
  component: ExportCostComponentCode;
  quote_type: OperationalQuoteType;
  amount: string;
  currency: string;
  rate_basis: OperationalRateBasis;
  quantity_unit?: string | null;
  percent_of_value?: string | null;
  percent_basis?: string | null;
  cost_owner?: 'exporter' | 'buyer';
  destination_country?: string | null;
  hs6_code?: string | null;
  hs_revision?: string | null;
  product_id?: string | null;
  route_evidence_id?: string | null;
  transport_mode?: string | null;
  equipment_code?: string | null;
  carrier_name?: string | null;
  partner_name?: string | null;
  quote_reference?: string | null;
  coverage_terms?: string | null;
  coverage_percent?: string | null;
  observed_at: Date;
  effective_from: Date;
  valid_until: Date;
  source: string;
  source_reference: string;
  document_id?: string | null;
}

/**
 * Record a partner or operational quote.
 *
 * Only an agent may file one, because it is an assertion about a third party's terms, and it is
 * always scoped to the exporter it was obtained for — a confidential quote never becomes another
 * tenant's evidence. The ClearTrade fee cannot be filed here at all: it is derived from policy.
 */
export async function recordOperationalQuote(args: { actor: Principal; exporter_org_id: string; quote: OperationalQuoteInput; correlation_id: string }) {
  if (!AGENT_ROLES.includes(args.actor.role)) throw forbidden('Only an assigned agent or operations reviewer may record an operational quote.');
  assertCan(args.actor, 'demand_discovery.run');
  await assertOrgAccess(args.actor, args.exporter_org_id);
  const quote = args.quote;
  const fields: Array<{ field: string; code: string; message: string }> = [];
  if (!EXPORT_COST_COMPONENTS.includes(quote.component)) fields.push({ field: 'component', code: 'invalid', message: `Component must be one of ${EXPORT_COST_COMPONENTS.join(', ')}.` });
  if (quote.component === 'cleartrade_fee') fields.push({ field: 'component', code: 'forbidden', message: 'The ClearTrade fee is derived from the fee policy and is never quoted by hand.' });
  if (!QUOTE_TYPES.includes(quote.quote_type)) fields.push({ field: 'quote_type', code: 'invalid', message: 'Unsupported quote type.' });
  if (!RATE_BASES.includes(quote.rate_basis)) fields.push({ field: 'rate_basis', code: 'invalid', message: 'Unsupported rate basis.' });
  if (!/^[A-Z]{3}$/.test(quote.currency.toUpperCase())) fields.push({ field: 'currency', code: 'invalid', message: 'Currency must be an ISO 4217 code.' });
  if (!(Number(quote.amount) >= 0)) fields.push({ field: 'amount', code: 'invalid', message: 'Amount must be a non-negative number.' });
  if (quote.rate_basis === 'percent_of_value' && (quote.percent_of_value == null || quote.percent_basis == null)) fields.push({ field: 'percent_of_value', code: 'required', message: 'A percentage quote must state both the percentage and what it applies to.' });
  // Validity is what makes a quote current. Without it there is nothing to expire.
  if (!(quote.valid_until instanceof Date) || Number.isNaN(quote.valid_until.getTime())) fields.push({ field: 'valid_until', code: 'required', message: 'An operational quote must state when it expires.' });
  else if (quote.valid_until.getTime() <= quote.effective_from.getTime()) fields.push({ field: 'valid_until', code: 'invalid', message: 'A quote cannot expire before it takes effect.' });
  if (!quote.source_reference.trim()) fields.push({ field: 'source_reference', code: 'required', message: 'A quote must carry its own reference.' });
  if (quote.product_id) {
    const owned = await prisma.product.findFirst({ where: { id: quote.product_id, exporter_org_id: args.exporter_org_id }, select: { id: true } });
    if (!owned) fields.push({ field: 'product_id', code: 'not_found', message: 'That product does not belong to this exporter.' });
  }
  if (quote.route_evidence_id) {
    const route = await prisma.logisticsRouteEvidence.findUnique({ where: { id: quote.route_evidence_id }, select: { id: true, exporter_org_id: true, assertion_class: true, destination_country: true, transport_mode: true, equipment_assumption: true } });
    if (!route) fields.push({ field: 'route_evidence_id', code: 'not_found', message: 'That route evidence does not exist.' });
    else {
      if (route.exporter_org_id !== null && route.exporter_org_id !== args.exporter_org_id) fields.push({ field: 'route_evidence_id', code: 'not_found', message: 'That route evidence is not available for this exporter.' });
      if (route.exporter_org_id === null && route.assertion_class !== EvidenceAssertionClass.authoritative_public) fields.push({ field: 'route_evidence_id', code: 'not_found', message: 'That route evidence is not available for this exporter.' });
      // A freight quote attached to a route must actually describe that route, or it would be
      // reused as if it priced a lane it never priced.
      if (quote.destination_country && route.destination_country.toUpperCase() !== quote.destination_country.toUpperCase()) fields.push({ field: 'route_evidence_id', code: 'mismatch', message: 'The quote destination does not match the route destination.' });
      if (quote.transport_mode && route.transport_mode !== quote.transport_mode) fields.push({ field: 'transport_mode', code: 'mismatch', message: 'The quote transport mode does not match the route.' });
      if (quote.equipment_code && route.equipment_assumption && route.equipment_assumption !== quote.equipment_code) fields.push({ field: 'equipment_code', code: 'mismatch', message: 'The quote equipment does not match the route.' });
    }
  }
  if (fields.length) throw validationError(fields);

  return prisma.$transaction(async (tx) => {
    const created = await tx.operationalCostEvidence.create({
      data: {
      exporter_org_id: args.exporter_org_id, product_id: quote.product_id ?? null,
      destination_country: quote.destination_country?.toUpperCase() ?? null,
      hs6_code: quote.hs6_code ?? null, hs_revision: quote.hs_revision ?? null,
      component: quote.component, quote_type: quote.quote_type,
      amount: new Prisma.Decimal(quote.amount), currency: quote.currency.toUpperCase(),
      rate_basis: quote.rate_basis, quantity_unit: quote.quantity_unit ?? null,
      percent_of_value: quote.percent_of_value == null ? null : new Prisma.Decimal(quote.percent_of_value),
      percent_basis: quote.percent_basis ?? null,
      cost_owner: quote.cost_owner ?? 'exporter',
      route_evidence_id: quote.route_evidence_id ?? null, transport_mode: quote.transport_mode ?? null,
      equipment_code: quote.equipment_code ?? null, carrier_name: quote.carrier_name ?? null,
      partner_name: quote.partner_name ?? null, quote_reference: quote.quote_reference ?? null,
      coverage_terms: quote.coverage_terms ?? null,
      coverage_percent: quote.coverage_percent == null ? null : new Prisma.Decimal(quote.coverage_percent),
      observed_at: quote.observed_at, effective_from: quote.effective_from, valid_until: quote.valid_until,
      assertion_class: EvidenceAssertionClass.partner_quote,
      evidence_origin: EvidenceOrigin.manually_entered_real,
      source: quote.source, source_reference: quote.source_reference, document_id: quote.document_id ?? null,
      entered_by_id: args.actor.id, verified_by_id: args.actor.id, verified_at: new Date(),
      confidence: new Prisma.Decimal(1), status: 'verified',
      },
    });
    // Supersede only a revision of the SAME quoted scope. Different routes, equipment, bases,
    // partners or external quote references are alternatives and must coexist.
    await tx.operationalCostEvidence.updateMany({
      where: {
      exporter_org_id: args.exporter_org_id,
      product_id: created.product_id,
      product_classification_id: created.product_classification_id,
      destination_country: created.destination_country,
      hs6_code: created.hs6_code,
      hs_revision: created.hs_revision,
      component: created.component,
      quote_type: created.quote_type,
      rate_basis: created.rate_basis,
      quantity_unit: created.quantity_unit,
      percent_basis: created.percent_basis,
      cost_owner: created.cost_owner,
      route_evidence_id: created.route_evidence_id,
      transport_mode: created.transport_mode,
      equipment_code: created.equipment_code,
      carrier_name: created.carrier_name,
      partner_name: created.partner_name,
      quote_reference: created.quote_reference,
      source: created.source,
      source_reference: created.source_reference,
      superseded_at: null,
      id: { not: created.id },
      },
      data: { superseded_at: new Date(), superseded_by_id: created.id },
    });
    await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'operational_cost_evidence', object_id: created.id, exporter_org_id: args.exporter_org_id, after_summary: { component: quote.component, quote_type: quote.quote_type, currency: created.currency, rate_basis: created.rate_basis, valid_until: created.valid_until?.toISOString() ?? null, source_reference: created.source_reference }, correlation_id: args.correlation_id, db: tx });
    return created;
  });
}

export interface RouteEvidenceInput {
  origin_country: string;
  origin_state?: string | null;
  origin_city?: string | null;
  origin_location_code?: string | null;
  origin_gateway?: string | null;
  destination_country: string;
  destination_port?: string | null;
  transport_mode: LogisticsTransportMode;
  route_available: boolean;
  transit_time_min_days?: number | null;
  transit_time_max_days?: number | null;
  equipment_assumption?: string | null;
  supported_product_constraint_codes?: string[];
  hs_code_scope?: string | null;
  source_reference: string;
  provider: string;
  valid_until?: Date | null;
}

/**
 * Record route evidence.
 *
 * `route_available: false` is a strong claim — it asserts the lane is not servable — so it is
 * only accepted from an agent with a citable source, exactly like any other assertion of
 * absence. Nothing here creates a route by omission: a lane nobody has recorded stays unknown.
 */
export async function recordRouteEvidence(args: { actor: Principal; exporter_org_id: string; route: RouteEvidenceInput; correlation_id: string }) {
  if (!AGENT_ROLES.includes(args.actor.role)) throw forbidden('Only an assigned agent or operations reviewer may record route evidence.');
  assertCan(args.actor, 'demand_discovery.run');
  await assertOrgAccess(args.actor, args.exporter_org_id);
  const route = args.route;
  const fields: Array<{ field: string; code: string; message: string }> = [];
  for (const [field, value] of [['origin_country', route.origin_country], ['destination_country', route.destination_country]] as const) {
    if (!/^[A-Z]{2}$/.test(value.toUpperCase())) fields.push({ field, code: 'invalid', message: 'Country must be an ISO alpha-2 code.' });
  }
  if (!route.source_reference.trim()) fields.push({ field: 'source_reference', code: 'required', message: 'Route evidence must cite its source.' });
  if (route.transit_time_min_days != null && route.transit_time_max_days != null && route.transit_time_min_days > route.transit_time_max_days) fields.push({ field: 'transit_time_min_days', code: 'invalid', message: 'Minimum transit cannot exceed maximum transit.' });
  if (fields.length) throw validationError(fields);

  return prisma.$transaction(async (tx) => {
    const created = await tx.logisticsRouteEvidence.create({
      data: {
      exporter_org_id: args.exporter_org_id,
      origin_country: route.origin_country.toUpperCase(), origin_state: route.origin_state ?? null, origin_city: route.origin_city ?? null,
      origin_location_code: route.origin_location_code ?? null, origin_gateway: route.origin_gateway ?? null,
      destination_country: route.destination_country.toUpperCase(), destination_port: route.destination_port ?? null,
      transport_mode: route.transport_mode, route_available: route.route_available,
      transit_time_min_days: route.transit_time_min_days ?? null, transit_time_max_days: route.transit_time_max_days ?? null,
      provider: route.provider, source_reference: route.source_reference,
      retrieved_at: new Date(), valid_until: route.valid_until ?? null,
      equipment_assumption: route.equipment_assumption ?? null,
      supported_product_constraint_codes: (route.supported_product_constraint_codes ?? []).map((code) => code.trim().toUpperCase()).filter(Boolean),
      hs_code_scope: route.hs_code_scope ?? null,
      confidence: new Prisma.Decimal(1),
      assertion_class: EvidenceAssertionClass.partner_quote,
      evidence_origin: EvidenceOrigin.manually_entered_real,
      },
    });
    await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'logistics_route_evidence', object_id: created.id, exporter_org_id: args.exporter_org_id, after_summary: { origin: created.origin_country, destination: created.destination_country, mode: created.transport_mode, route_available: created.route_available, source_reference: created.source_reference }, correlation_id: args.correlation_id, db: tx });
    return created;
  });
}
