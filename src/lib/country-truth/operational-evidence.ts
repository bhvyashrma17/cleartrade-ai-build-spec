/**
 * Operational cost evidence: recording it, normalizing it, and deriving the ClearTrade fee.
 *
 * The Export Economics calculator takes cost components expressed PER UNIT. Almost nothing is
 * quoted that way in practice — a CHA quote is per shipment, freight is per container, insurance
 * is a percentage of value — so the conversion is the interesting part, and it is the one place
 * a plausible-looking wrong number could enter a landed cost.
 *
 * Two rules govern it. Every conversion needs an explicit basis, supplied by the caller from
 * frozen facts; nothing is assumed about shipment size, container count or cargo value. And a
 * cost that cannot be converted becomes MISSING, never zero: the calculator already refuses to
 * publish a landed cost with a missing required component, and that refusal is the point.
 */
import { EvidenceAssertionClass, EvidenceOrigin, Prisma } from '@prisma/client';
import { calculateSuccessFee, getFeePolicy } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { EXPORT_COST_COMPONENTS, type ExportCostComponentCode } from './phase-1h-calculations';
import type { ExportCostComponentRow } from './fact-selection';

export const OPERATIONAL_COST_NORMALIZATION_VERSION = 'operational-cost-normalization-v1' as const;

/** How an operational quote states its amount. Never inferred from the number alone. */
export type OperationalRateBasis =
  | 'per_unit'
  | 'per_shipment'
  | 'per_container'
  | 'percent_of_value';

export type OperationalQuoteType =
  | 'cha'
  | 'inland_transport'
  | 'cargo_insurance'
  | 'financing'
  | 'destination_handling'
  | 'packaging'
  | 'international_freight'
  | 'cleartrade_fee';

/** Which Incoterm party bears the cost. A buyer-paid cost never enters exporter economics. */
export type CostOwner = 'exporter' | 'buyer';

export interface OperationalCostRow {
  id: string;
  exporter_org_id: string;
  product_id: string | null;
  destination_country: string | null;
  hs6_code: string | null;
  hs_revision: string | null;
  component: string;
  quote_type: string;
  amount: Prisma.Decimal | string | number;
  currency: string;
  rate_basis: string;
  quantity_unit: string | null;
  percent_of_value: Prisma.Decimal | string | number | null;
  percent_basis: string | null;
  cost_owner: string;
  route_evidence_id: string | null;
  transport_mode: string | null;
  equipment_code: string | null;
  observed_at: Date;
  effective_from: Date;
  valid_until: Date | null;
  assertion_class: string;
  evidence_origin: string;
  source: string;
  source_reference: string;
  confidence: Prisma.Decimal | string | number;
  status: string;
  superseded_at: Date | null;
}

/**
 * Everything a per-unit conversion needs, taken from frozen facts rather than from the quote.
 *
 * A field left null does not disable the conversion generally — it disables exactly the rate
 * bases that need it, which is why they are separate.
 */
export interface CostNormalizationBasis {
  /** Units in one shipment, in `quantity_unit`. Required to divide a per-shipment amount. */
  shipment_quantity: number | null;
  quantity_unit: string | null;
  /** Containers in one shipment. Required to convert a per-container amount. */
  containers_per_shipment: number | null;
  /** Goods value per unit, for a percentage-of-value quote, with its currency. */
  goods_value_per_unit: number | null;
  goods_value_currency: string | null;
  /** Which value a percentage may be taken against, as the quote declares it. */
  supported_percent_bases: readonly string[];
}

export type NormalizedCost =
  | { status: 'normalized'; amount_per_unit: number; currency: string; quantity_unit: string; derivation: string }
  | { status: 'not_normalizable'; reason: string };

const decimal = (value: Prisma.Decimal | string | number | null | undefined) =>
  value == null ? null : Number(value.toString());

/**
 * Convert one quoted amount into a per-unit amount.
 *
 * Deliberately strict about units: a per-unit quote in CTN cannot serve a price quoted per KG,
 * because the two count different things and nothing here knows how many kilograms are in a
 * carton unless somebody said so.
 */
export function normalizeOperationalCost(row: OperationalCostRow, basis: CostNormalizationBasis): NormalizedCost {
  const amount = decimal(row.amount);
  if (amount == null || !Number.isFinite(amount) || amount < 0) return { status: 'not_normalizable', reason: 'amount_is_not_a_finite_non_negative_number' };
  const unit = basis.quantity_unit;
  if (!unit) return { status: 'not_normalizable', reason: 'no_frozen_quantity_unit_to_normalize_onto' };

  switch (row.rate_basis as OperationalRateBasis) {
    case 'per_unit': {
      if (!row.quantity_unit) return { status: 'not_normalizable', reason: 'per_unit_quote_has_no_quantity_unit' };
      if (row.quantity_unit !== unit) return { status: 'not_normalizable', reason: `per_unit_quote_is_in_${row.quantity_unit}_but_economics_is_in_${unit}` };
      return { status: 'normalized', amount_per_unit: amount, currency: row.currency, quantity_unit: unit, derivation: `stated per ${unit}` };
    }
    case 'per_shipment': {
      if (basis.shipment_quantity == null || !(basis.shipment_quantity > 0)) return { status: 'not_normalizable', reason: 'per_shipment_quote_needs_a_declared_shipment_quantity' };
      if (row.quantity_unit && row.quantity_unit !== unit) return { status: 'not_normalizable', reason: `shipment_quote_counts_${row.quantity_unit}_but_economics_is_in_${unit}` };
      return { status: 'normalized', amount_per_unit: amount / basis.shipment_quantity, currency: row.currency, quantity_unit: unit, derivation: `${amount} per shipment ÷ ${basis.shipment_quantity} ${unit}` };
    }
    case 'per_container': {
      if (basis.containers_per_shipment == null || !(basis.containers_per_shipment > 0)) return { status: 'not_normalizable', reason: 'per_container_quote_needs_a_declared_container_count' };
      if (basis.shipment_quantity == null || !(basis.shipment_quantity > 0)) return { status: 'not_normalizable', reason: 'per_container_quote_needs_a_declared_shipment_quantity' };
      const total = amount * basis.containers_per_shipment;
      return { status: 'normalized', amount_per_unit: total / basis.shipment_quantity, currency: row.currency, quantity_unit: unit, derivation: `${amount} per container × ${basis.containers_per_shipment} ÷ ${basis.shipment_quantity} ${unit}` };
    }
    case 'percent_of_value': {
      const percent = decimal(row.percent_of_value);
      if (percent == null || !Number.isFinite(percent) || percent < 0) return { status: 'not_normalizable', reason: 'percentage_quote_has_no_valid_percentage' };
      if (!row.percent_basis) return { status: 'not_normalizable', reason: 'percentage_quote_does_not_state_what_it_is_a_percentage_of' };
      if (!basis.supported_percent_bases.includes(row.percent_basis)) return { status: 'not_normalizable', reason: `percentage_basis_${row.percent_basis}_is_not_available_at_this_point_in_the_buildup` };
      if (basis.goods_value_per_unit == null || !(basis.goods_value_per_unit > 0)) return { status: 'not_normalizable', reason: 'percentage_quote_needs_a_known_goods_value' };
      if (basis.goods_value_currency && basis.goods_value_currency !== row.currency) return { status: 'not_normalizable', reason: `percentage_quote_is_in_${row.currency}_but_the_value_it_applies_to_is_in_${basis.goods_value_currency}` };
      return { status: 'normalized', amount_per_unit: (basis.goods_value_per_unit * percent) / 100, currency: row.currency, quantity_unit: unit, derivation: `${percent}% of ${row.percent_basis} (${basis.goods_value_per_unit} per ${unit})` };
    }
    default:
      return { status: 'not_normalizable', reason: `unsupported_rate_basis_${row.rate_basis}` };
  }
}

export interface OperationalCostSelectionResult {
  rows: ExportCostComponentRow[];
  rejected: Array<{ id: string; component: string; reason: string }>;
}

/**
 * Turn stored operational quotes into the per-unit component rows the calculator consumes.
 *
 * Selection is exact about scope on purpose. A quote recorded for another destination, another
 * product, another exporter, an expired validity window or a buyer-owned cost is rejected with a
 * stated reason rather than being quietly stretched to fit.
 */
export function selectOperationalCostRows(
  rows: readonly OperationalCostRow[],
  scope: { exporter_org_id: string; destination_country: string; hs6: string; hs_revision: string; as_of: Date },
  basis: CostNormalizationBasis,
): OperationalCostSelectionResult {
  const selected: ExportCostComponentRow[] = [];
  const rejected: Array<{ id: string; component: string; reason: string }> = [];
  const asOf = scope.as_of.getTime();

  // Newest observation first, so a supersession chain resolves to the current statement.
  const ordered = [...rows].sort((left, right) => right.observed_at.getTime() - left.observed_at.getTime() || left.id.localeCompare(right.id));
  const claimed = new Set<string>();

  for (const row of ordered) {
    const reject = (reason: string) => rejected.push({ id: row.id, component: row.component, reason });
    if (row.exporter_org_id !== scope.exporter_org_id) { reject('exporter_org_mismatch'); continue; }
    if (row.superseded_at != null && row.superseded_at.getTime() <= asOf) { reject('superseded_before_assessment_clock'); continue; }
    if (row.status !== 'verified') { reject(`evidence_status_${row.status}`); continue; }
    if (!EXPORT_COST_COMPONENTS.includes(row.component as ExportCostComponentCode)) { reject('unknown_cost_component'); continue; }
    // A buyer-paid cost belongs to buyer landed-cost economics, never to the exporter's.
    if (row.cost_owner !== 'exporter') { reject('cost_is_owned_by_the_buyer'); continue; }
    if (row.destination_country != null && row.destination_country.toUpperCase() !== scope.destination_country) { reject('destination_country_mismatch'); continue; }
    if (row.hs6_code != null && row.hs6_code !== scope.hs6) { reject('hs6_mismatch'); continue; }
    if (row.hs_revision != null && row.hs_revision !== scope.hs_revision) { reject('hs_revision_mismatch'); continue; }
    if (row.observed_at.getTime() > asOf) { reject('observed_after_assessment_clock'); continue; }
    if (row.effective_from.getTime() > asOf) { reject('not_yet_effective_at_assessment_clock'); continue; }
    // An expired quote is not a current cost. This is the whole reason validity is recorded.
    if (row.valid_until != null && row.valid_until.getTime() < asOf) { reject('quote_expired_before_assessment_clock'); continue; }
    if (claimed.has(row.component)) { reject('superseded_by_a_newer_observation_of_the_same_component'); continue; }

    const normalized = normalizeOperationalCost(row, basis);
    if (normalized.status !== 'normalized') { reject(normalized.reason); continue; }

    claimed.add(row.component);
    selected.push({
      id: row.id,
      exporter_org_id: row.exporter_org_id,
      country_code: scope.destination_country,
      hs_code: scope.hs6,
      hs_revision: scope.hs_revision,
      component: row.component,
      amount_per_unit: normalized.amount_per_unit,
      currency: normalized.currency,
      quantity_unit: normalized.quantity_unit,
      observed_at: row.observed_at,
      valid_until: row.valid_until,
      assertion_class: row.assertion_class as ExportCostComponentRow['assertion_class'],
      source: row.source,
      source_reference: row.source_reference,
      retrieved_at: row.observed_at,
      confidence: row.confidence,
      evidence_origin: row.evidence_origin,
    });
  }
  return { rows: selected, rejected };
}

export interface ClearTradeFeeDerivation {
  row: OperationalCostRow;
  derivation: Record<string, unknown>;
}

/**
 * Derive the ClearTrade fee from the canonical FeePolicy.
 *
 * The exporter is never asked to type our own fee, and the fee is not evidence about the world —
 * it is a consequence of a versioned policy, so it is `system_derived` and carries the policy
 * version it came from. Freezing that version is what stops a later repricing from rewriting a
 * historical assessment's economics.
 */
export async function deriveClearTradeFeeComponent(args: {
  exporter_org_id: string;
  product_id: string | null;
  destination_country: string;
  hs6: string;
  hs_revision: string;
  /** Shipment value the fee is assessed on, in its own currency. */
  shipment_value: { amount: string; currency: string };
  shipment_quantity: number;
  quantity_unit: string;
  observed_at: Date;
}): Promise<ClearTradeFeeDerivation> {
  const policy = await getFeePolicy();
  const fee = await calculateSuccessFee(args.shipment_value);
  const total = Number(fee.result.amount);
  if (!Number.isFinite(total) || !(args.shipment_quantity > 0)) throw new Error('A ClearTrade fee component requires a positive shipment quantity and a finite fee.');
  const derivation = {
    schema_version: 'cleartrade-fee-derivation-v1',
    fee_policy_version: fee.policy_version,
    fee_policy_effective_from: policy.effective_from,
    rule: fee.rule,
    rate: fee.rate ?? null,
    basis: fee.basis,
    result: fee.result,
    shipment_quantity: args.shipment_quantity,
    quantity_unit: args.quantity_unit,
    amount_per_unit: total / args.shipment_quantity,
    normalization_version: OPERATIONAL_COST_NORMALIZATION_VERSION,
  };
  return {
    derivation,
    row: {
      id: `cleartrade_fee:v${fee.policy_version}:${args.exporter_org_id}:${args.destination_country}`,
      exporter_org_id: args.exporter_org_id,
      product_id: args.product_id,
      destination_country: args.destination_country,
      hs6_code: args.hs6,
      hs_revision: args.hs_revision,
      component: 'cleartrade_fee',
      quote_type: 'cleartrade_fee',
      amount: total,
      currency: fee.result.currency,
      rate_basis: 'per_shipment',
      quantity_unit: args.quantity_unit,
      percent_of_value: null,
      percent_basis: null,
      cost_owner: 'exporter',
      route_evidence_id: null,
      transport_mode: null,
      equipment_code: null,
      observed_at: args.observed_at,
      effective_from: args.observed_at,
      valid_until: null,
      assertion_class: EvidenceAssertionClass.system_derived,
      evidence_origin: EvidenceOrigin.manually_entered_real,
      source: `cleartrade_fee_policy_v${fee.policy_version}`,
      source_reference: `fee_policy:${fee.policy_version}:${fee.rule}`,
      confidence: 1,
      status: 'verified',
      superseded_at: null,
    },
  };
}

/** Load every operational quote that could serve this scope. Filtering happens in selection. */
export async function loadOperationalCostRows(args: { exporter_org_id: string; product_id: string; destination_country: string; as_of: Date; origins: readonly EvidenceOrigin[] }): Promise<OperationalCostRow[]> {
  const rows = await prisma.operationalCostEvidence.findMany({
    where: {
      exporter_org_id: args.exporter_org_id,
      evidence_origin: { in: [...args.origins] },
      observed_at: { lte: args.as_of },
      OR: [{ product_id: args.product_id }, { product_id: null }],
      AND: [{ OR: [{ destination_country: args.destination_country }, { destination_country: null }] }],
    },
    orderBy: { id: 'asc' },
  });
  return rows.map((row) => ({
    id: row.id, exporter_org_id: row.exporter_org_id, product_id: row.product_id,
    destination_country: row.destination_country, hs6_code: row.hs6_code, hs_revision: row.hs_revision,
    component: row.component, quote_type: row.quote_type, amount: row.amount, currency: row.currency,
    rate_basis: row.rate_basis, quantity_unit: row.quantity_unit, percent_of_value: row.percent_of_value,
    percent_basis: row.percent_basis, cost_owner: row.cost_owner, route_evidence_id: row.route_evidence_id,
    transport_mode: row.transport_mode, equipment_code: row.equipment_code,
    observed_at: row.observed_at, effective_from: row.effective_from, valid_until: row.valid_until,
    assertion_class: row.assertion_class, evidence_origin: row.evidence_origin,
    source: row.source, source_reference: row.source_reference, confidence: row.confidence,
    status: row.status, superseded_at: row.superseded_at,
  }));
}
