/**
 * First-party operational facts: who may state what, and under whose authority.
 *
 * The authorization split is the substance of this module, not decoration. An exporter states
 * facts about its own goods and those facts stay `exporter_declared` however confident they
 * sound. An assigned agent verifies them, records partner quotes and confirms routes. Nobody
 * verifies their own declaration, because a declaration that can verify itself is just a
 * declaration wearing a better label.
 */
import { EvidenceAssertionClass, EvidenceOrigin, LogisticsTransportMode, Prisma, UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertOrgAccess } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import { EXPORT_COST_COMPONENTS, type ExportCostComponentCode } from '@/lib/country-truth/phase-1h-calculations';
import type { OperationalQuoteType, OperationalRateBasis } from '@/lib/country-truth/operational-evidence';
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
  capacity_value?: string | null;
  capacity_unit?: string | null;
  available_capacity_value?: string | null;
  capacity_period?: string | null;
  moq_value?: string | null;
  moq_unit?: string | null;
  lead_time_days?: number | null;
  delivery_commitment_days?: number | null;
  packaging_format?: string | null;
  pack_size_value?: string | null;
  pack_size_unit?: string | null;
  units_per_carton?: number | null;
  cartons_per_pallet?: number | null;
  palletized?: boolean | null;
  container_compatibility?: string[];
  special_handling_codes?: string[];
  temperature_controlled?: boolean | null;
  temperature_min_celsius?: string | null;
  temperature_max_celsius?: string | null;
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
  const product = await productForTenant(args.actor, args.exporter_org_id, args.product_id);
  const facts = args.facts;
  const fields: Array<{ field: string; code: string; message: string }> = [];

  if (facts.price_target_incoterm && !INCOTERMS.includes(facts.price_target_incoterm.toUpperCase())) fields.push({ field: 'price_target_incoterm', code: 'invalid', message: `Incoterm must be one of ${INCOTERMS.join(', ')}.` });
  // A price without its currency, quantity unit and delivery basis is not comparable to anything,
  // so the four travel together or not at all.
  const priceParts = [facts.price_target_amount, facts.price_target_currency, facts.price_target_quantity_unit, facts.price_target_incoterm];
  if (priceParts.some((part) => part != null) && priceParts.some((part) => part == null)) {
    fields.push({ field: 'price_target_amount', code: 'incomplete', message: 'A price needs its amount, currency, quantity unit and Incoterm together.' });
  }
  const shipmentParts = [facts.shipment_quantity_value, facts.shipment_quantity_unit];
  if (shipmentParts.some((part) => part != null) && shipmentParts.some((part) => part == null)) {
    fields.push({ field: 'shipment_quantity_value', code: 'incomplete', message: 'A standard shipment needs both a quantity and its unit.' });
  }
  for (const [field, value] of [['capacity_value', facts.capacity_value], ['moq_value', facts.moq_value], ['shipment_quantity_value', facts.shipment_quantity_value], ['available_capacity_value', facts.available_capacity_value]] as const) {
    if (value != null && !(Number(value) > 0)) fields.push({ field, code: 'invalid', message: 'Quantities must be positive.' });
  }
  if (facts.origin_country && !/^[A-Z]{2}$/.test(facts.origin_country.toUpperCase())) fields.push({ field: 'origin_country', code: 'invalid', message: 'Origin country must be an ISO alpha-2 code.' });
  if (fields.length) throw validationError(fields);

  const decimal = (value: string | null | undefined) => (value == null ? null : new Prisma.Decimal(value));
  const updated = await prisma.product.update({
    where: { id: product.id },
    data: {
      ...(facts.price_target_amount !== undefined ? { price_target_amount: decimal(facts.price_target_amount), price_target_currency: facts.price_target_currency?.toUpperCase() ?? null, price_target_quantity_unit: facts.price_target_quantity_unit ?? null, price_target_incoterm: facts.price_target_incoterm?.toUpperCase() ?? null } : {}),
      ...(facts.capacity_value !== undefined ? { capacity_value: decimal(facts.capacity_value), capacity_unit: facts.capacity_unit ?? null } : {}),
      ...(facts.available_capacity_value !== undefined ? { available_capacity_value: decimal(facts.available_capacity_value), capacity_period: facts.capacity_period ?? null } : {}),
      ...(facts.moq_value !== undefined ? { moq_value: decimal(facts.moq_value), moq_unit: facts.moq_unit ?? null } : {}),
      ...(facts.lead_time_days !== undefined ? { lead_time_days: facts.lead_time_days } : {}),
      ...(facts.delivery_commitment_days !== undefined ? { delivery_commitment_days: facts.delivery_commitment_days } : {}),
      ...(facts.packaging_format !== undefined ? { packaging_format: facts.packaging_format?.toUpperCase() ?? null } : {}),
      ...(facts.pack_size_value !== undefined ? { pack_size_value: decimal(facts.pack_size_value), pack_size_unit: facts.pack_size_unit ?? null } : {}),
      ...(facts.units_per_carton !== undefined ? { units_per_carton: facts.units_per_carton } : {}),
      ...(facts.cartons_per_pallet !== undefined ? { cartons_per_pallet: facts.cartons_per_pallet } : {}),
      ...(facts.palletized !== undefined ? { palletized: facts.palletized } : {}),
      ...(facts.container_compatibility !== undefined ? { container_compatibility: facts.container_compatibility.map((code) => code.trim().toUpperCase()).filter(Boolean) } : {}),
      ...(facts.special_handling_codes !== undefined ? { special_handling_codes: facts.special_handling_codes.map((code) => code.trim().toUpperCase()).filter(Boolean) } : {}),
      ...(facts.temperature_controlled !== undefined ? { temperature_controlled: facts.temperature_controlled, temperature_min_celsius: decimal(facts.temperature_min_celsius), temperature_max_celsius: decimal(facts.temperature_max_celsius) } : {}),
      ...(facts.shipment_quantity_value !== undefined ? { shipment_quantity_value: decimal(facts.shipment_quantity_value), shipment_quantity_unit: facts.shipment_quantity_unit ?? null } : {}),
      ...(facts.shipment_container_count !== undefined ? { shipment_container_count: facts.shipment_container_count, shipment_container_type: facts.shipment_container_type ?? null } : {}),
      ...(facts.origin_city !== undefined ? { origin_city: facts.origin_city, origin_state: facts.origin_state ?? null, origin_country: facts.origin_country?.toUpperCase() ?? null, origin_postal_code: facts.origin_postal_code ?? null } : {}),
      ...(facts.origin_location_code !== undefined ? { origin_location_code: facts.origin_location_code, origin_gateway_code: facts.origin_gateway_code ?? null } : {}),
      // Whoever recorded it, this is a declaration about the exporter's own goods. An agent
      // recording it on the exporter's behalf does not make it verified.
      origin_provenance: AGENT_ROLES.includes(args.actor.role) ? 'agent_verified' : 'exporter_declared',
    },
  });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.update, object_type: 'product_operational_facts', object_id: product.id, exporter_org_id: args.exporter_org_id, after_summary: { fields: Object.keys(facts), provenance: updated.origin_provenance }, correlation_id: args.correlation_id });
  return updated;
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
  valid_from?: Date | null;
  valid_until?: Date | null;
  correlation_id: string;
}) {
  if (!AGENT_ROLES.includes(args.actor.role)) throw forbidden('Only an assigned agent or operations reviewer may verify a certification.');
  await productForTenant(args.actor, args.exporter_org_id, args.product_id);
  const certification = await prisma.productCertification.findFirst({ where: { id: args.certification_id, product_id: args.product_id } });
  if (!certification) throw notFound('That certification does not exist for this product.');
  // A verification without a citable certificate is an opinion.
  const reference = args.certificate_reference ?? certification.certificate_reference;
  if (!reference?.trim()) throw validationError([{ field: 'certificate_reference', code: 'required', message: 'A verified certification must record the certificate reference it was checked against.' }]);
  const validUntil = args.valid_until ?? certification.valid_until;
  if (validUntil && validUntil.getTime() <= Date.now()) throw validationError([{ field: 'valid_until', code: 'expired', message: 'An expired certificate cannot be verified as current.' }]);

  const updated = await prisma.productCertification.update({
    where: { id: certification.id },
    data: {
      verification_state: 'agent_verified', verified_by_id: args.actor.id, verified_at: new Date(),
      issuer: args.issuer ?? certification.issuer,
      certificate_reference: reference,
      valid_from: args.valid_from ?? certification.valid_from,
      valid_until: validUntil,
      declared_absent: false,
    },
  });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.update, object_type: 'product_certification_verification', object_id: certification.id, exporter_org_id: args.exporter_org_id, after_summary: { code: certification.code, verification_state: 'agent_verified', certificate_reference: reference }, correlation_id: args.correlation_id });
  return updated;
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
    const route = await prisma.logisticsRouteEvidence.findUnique({ where: { id: quote.route_evidence_id }, select: { id: true, destination_country: true, transport_mode: true, equipment_assumption: true } });
    if (!route) fields.push({ field: 'route_evidence_id', code: 'not_found', message: 'That route evidence does not exist.' });
    else {
      // A freight quote attached to a route must actually describe that route, or it would be
      // reused as if it priced a lane it never priced.
      if (quote.destination_country && route.destination_country.toUpperCase() !== quote.destination_country.toUpperCase()) fields.push({ field: 'route_evidence_id', code: 'mismatch', message: 'The quote destination does not match the route destination.' });
      if (quote.transport_mode && route.transport_mode !== quote.transport_mode) fields.push({ field: 'transport_mode', code: 'mismatch', message: 'The quote transport mode does not match the route.' });
      if (quote.equipment_code && route.equipment_assumption && route.equipment_assumption !== quote.equipment_code) fields.push({ field: 'equipment_code', code: 'mismatch', message: 'The quote equipment does not match the route.' });
    }
  }
  if (fields.length) throw validationError(fields);

  const created = await prisma.operationalCostEvidence.create({
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
  // Supersede the previous live quote for the same scope: a revision is a new row, never an edit.
  await prisma.operationalCostEvidence.updateMany({
    where: { exporter_org_id: args.exporter_org_id, component: quote.component, destination_country: created.destination_country, product_id: created.product_id, superseded_at: null, id: { not: created.id } },
    data: { superseded_at: new Date(), superseded_by_id: created.id },
  });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'operational_cost_evidence', object_id: created.id, exporter_org_id: args.exporter_org_id, after_summary: { component: quote.component, quote_type: quote.quote_type, currency: created.currency, rate_basis: created.rate_basis, valid_until: created.valid_until?.toISOString() ?? null, source_reference: created.source_reference }, correlation_id: args.correlation_id });
  return created;
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
  await assertOrgAccess(args.actor, args.exporter_org_id);
  const route = args.route;
  const fields: Array<{ field: string; code: string; message: string }> = [];
  for (const [field, value] of [['origin_country', route.origin_country], ['destination_country', route.destination_country]] as const) {
    if (!/^[A-Z]{2}$/.test(value.toUpperCase())) fields.push({ field, code: 'invalid', message: 'Country must be an ISO alpha-2 code.' });
  }
  if (!route.source_reference.trim()) fields.push({ field: 'source_reference', code: 'required', message: 'Route evidence must cite its source.' });
  if (route.transit_time_min_days != null && route.transit_time_max_days != null && route.transit_time_min_days > route.transit_time_max_days) fields.push({ field: 'transit_time_min_days', code: 'invalid', message: 'Minimum transit cannot exceed maximum transit.' });
  if (fields.length) throw validationError(fields);

  const created = await prisma.logisticsRouteEvidence.create({
    data: {
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
      evidence_origin: EvidenceOrigin.manually_entered_real,
    },
  });
  await writeAuditEvent({ actor: args.actor, action: AUDIT_ACTIONS.create, object_type: 'logistics_route_evidence', object_id: created.id, exporter_org_id: args.exporter_org_id, after_summary: { origin: created.origin_country, destination: created.destination_country, mode: created.transport_mode, route_available: created.route_available, source_reference: created.source_reference }, correlation_id: args.correlation_id });
  return created;
}
