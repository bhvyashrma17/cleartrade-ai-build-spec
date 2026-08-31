import { describe, expect, test } from 'vitest';
import {
  normalizeOperationalCost,
  selectOperationalCostRows,
  type CostNormalizationBasis,
  type OperationalCostRow,
} from '../src/lib/country-truth/operational-evidence';

/**
 * Adversarial pass A. Every attack here is a way a plausible-looking number could enter a landed
 * cost. The consistent answer is that an unconvertible quote leaves its component MISSING, which
 * keeps Export Economics unavailable — never a zero, and never a guess at the missing dimension.
 */

const AS_OF = new Date('2026-08-31T00:00:00Z');

const basis: CostNormalizationBasis = {
  shipment_quantity: 20_000,
  quantity_unit: 'kg',
  containers_per_shipment: 1,
  goods_value_per_unit: 1.2,
  goods_value_currency: 'USD',
  supported_percent_bases: ['invoice_value', 'exporter_price'],
};

const row = (over: Partial<OperationalCostRow> & { component: string }): OperationalCostRow => ({
  id: `row-${over.component}-${over.rate_basis ?? 'per_unit'}`,
  exporter_org_id: 'org-1',
  product_id: 'product-1',
  destination_country: 'DE',
  hs6_code: '100630',
  hs_revision: 'HS2022',
  quote_type: 'cha',
  amount: 100,
  currency: 'USD',
  rate_basis: 'per_shipment',
  quantity_unit: 'kg',
  percent_of_value: null,
  percent_basis: null,
  cost_owner: 'exporter',
  route_evidence_id: null,
  transport_mode: null,
  equipment_code: null,
  observed_at: new Date('2026-08-20T00:00:00Z'),
  effective_from: new Date('2026-08-20T00:00:00Z'),
  valid_until: new Date('2026-09-30T00:00:00Z'),
  assertion_class: 'partner_quote',
  evidence_origin: 'manually_entered_real',
  source: 'Partner CHA',
  source_reference: 'QUOTE-1',
  confidence: 1,
  status: 'verified',
  superseded_at: null,
  ...over,
});

const scope = { exporter_org_id: 'org-1', destination_country: 'DE', hs6: '100630', hs_revision: 'HS2022', as_of: AS_OF };

describe('operational cost normalization', () => {
  test('divides a per-shipment quote by the declared shipment quantity', () => {
    const result = normalizeOperationalCost(row({ component: 'origin_charges', amount: 400, rate_basis: 'per_shipment' }), basis);
    expect(result).toMatchObject({ status: 'normalized', amount_per_unit: 0.02, currency: 'USD', quantity_unit: 'kg' });
  });

  test('a per-container quote needs both the container count and the shipment quantity', () => {
    const quote = row({ component: 'international_freight', amount: 1800, rate_basis: 'per_container', quote_type: 'international_freight' });
    expect(normalizeOperationalCost(quote, { ...basis, containers_per_shipment: 2 })).toMatchObject({ status: 'normalized', amount_per_unit: (1800 * 2) / 20_000 });
    // Without a declared container count there is no honest divisor, so the cost is missing.
    expect(normalizeOperationalCost(quote, { ...basis, containers_per_shipment: null })).toMatchObject({ status: 'not_normalizable', reason: 'per_container_quote_needs_a_declared_container_count' });
    expect(normalizeOperationalCost(quote, { ...basis, shipment_quantity: null })).toMatchObject({ status: 'not_normalizable' });
  });

  test('a percentage quote needs a stated basis, a supported basis and a known value', () => {
    const quote = row({ component: 'insurance', rate_basis: 'percent_of_value', percent_of_value: 0.5, percent_basis: 'invoice_value', quote_type: 'cargo_insurance' });
    expect(normalizeOperationalCost(quote, basis)).toMatchObject({ status: 'normalized', amount_per_unit: 0.006 });
    expect(normalizeOperationalCost(row({ ...quote, percent_basis: null }), basis)).toMatchObject({ status: 'not_normalizable', reason: 'percentage_quote_does_not_state_what_it_is_a_percentage_of' });
    // A percentage of the CIF value cannot be taken before freight and insurance are settled.
    expect(normalizeOperationalCost(row({ ...quote, percent_basis: 'cif_value' }), basis)).toMatchObject({ status: 'not_normalizable' });
    expect(normalizeOperationalCost(quote, { ...basis, goods_value_per_unit: null })).toMatchObject({ status: 'not_normalizable', reason: 'percentage_quote_needs_a_known_goods_value' });
  });

  test('a percentage in a different currency from the value it applies to is refused', () => {
    const quote = row({ component: 'insurance', currency: 'EUR', rate_basis: 'percent_of_value', percent_of_value: 0.5, percent_basis: 'invoice_value' });
    expect(normalizeOperationalCost(quote, basis)).toMatchObject({ status: 'not_normalizable' });
  });

  test('a per-unit quote counting a different unit is never silently accepted', () => {
    const quote = row({ component: 'packaging', rate_basis: 'per_unit', quantity_unit: 'CTN', amount: 3 });
    expect(normalizeOperationalCost(quote, basis)).toMatchObject({ status: 'not_normalizable', reason: 'per_unit_quote_is_in_CTN_but_economics_is_in_kg' });
    expect(normalizeOperationalCost(row({ ...quote, quantity_unit: 'kg' }), basis)).toMatchObject({ status: 'normalized', amount_per_unit: 3 });
  });

  test('a negative or non-finite amount is refused rather than clamped', () => {
    expect(normalizeOperationalCost(row({ component: 'financing', amount: -5 }), basis)).toMatchObject({ status: 'not_normalizable' });
    expect(normalizeOperationalCost(row({ component: 'financing', amount: Number.NaN }), basis)).toMatchObject({ status: 'not_normalizable' });
  });
});

describe('operational cost selection', () => {
  test('an expired quote is never current', () => {
    const expired = row({ component: 'origin_charges', valid_until: new Date('2026-08-01T00:00:00Z') });
    const result = selectOperationalCostRows([expired], scope, basis);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ reason: 'quote_expired_before_assessment_clock' });
  });

  test('a buyer-owned cost never enters exporter economics', () => {
    const result = selectOperationalCostRows([row({ component: 'destination_charges', cost_owner: 'buyer' })], scope, basis);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected[0]).toMatchObject({ reason: 'cost_is_owned_by_the_buyer' });
  });

  test('a quote for another destination, HS or exporter is rejected', () => {
    const rows = [
      row({ component: 'origin_charges', id: 'wrong-country', destination_country: 'US' }),
      row({ component: 'inland_transport', id: 'wrong-hs', hs6_code: '100620' }),
      row({ component: 'packaging', id: 'wrong-org', exporter_org_id: 'org-2' }),
    ];
    const result = selectOperationalCostRows(rows, scope, basis);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected.map((entry) => entry.reason).sort()).toEqual(['destination_country_mismatch', 'exporter_org_mismatch', 'hs6_mismatch']);
  });

  test('a destination-independent quote is admitted, a destination-specific mismatch is not', () => {
    const result = selectOperationalCostRows([row({ component: 'packaging', destination_country: null, hs6_code: null, hs_revision: null, rate_basis: 'per_unit', amount: 0.05 })], scope, basis);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ component: 'packaging', amount_per_unit: 0.05, country_code: 'DE' });
  });

  test('the newest observation of a component supersedes older ones', () => {
    const older = row({ component: 'origin_charges', id: 'old', amount: 400, observed_at: new Date('2026-08-10T00:00:00Z') });
    const newer = row({ component: 'origin_charges', id: 'new', amount: 600, observed_at: new Date('2026-08-25T00:00:00Z') });
    const result = selectOperationalCostRows([older, newer], scope, basis);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.id).toBe('new');
    expect(result.rejected.find((entry) => entry.id === 'old')).toMatchObject({ reason: 'superseded_by_a_newer_observation_of_the_same_component' });
  });

  test('evidence observed or effective after the assessment clock is not yet knowable', () => {
    const future = row({ component: 'origin_charges', id: 'future', observed_at: new Date('2026-09-05T00:00:00Z') });
    const notYet = row({ component: 'inland_transport', id: 'not-yet', effective_from: new Date('2026-09-05T00:00:00Z') });
    const result = selectOperationalCostRows([future, notYet], scope, basis);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected.map((entry) => entry.reason).sort()).toEqual(['not_yet_effective_at_assessment_clock', 'observed_after_assessment_clock']);
  });

  test('a superseded row and a non-verified row are both excluded', () => {
    const rows = [
      row({ component: 'origin_charges', id: 'superseded', superseded_at: new Date('2026-08-25T00:00:00Z') }),
      row({ component: 'inland_transport', id: 'draft', status: 'draft' }),
    ];
    const result = selectOperationalCostRows(rows, scope, basis);
    expect(result.rows).toHaveLength(0);
    expect(result.rejected.map((entry) => entry.reason).sort()).toEqual(['evidence_status_draft', 'superseded_before_assessment_clock']);
  });

  test('an unconvertible quote leaves its component missing rather than zero', () => {
    const result = selectOperationalCostRows([row({ component: 'international_freight', rate_basis: 'per_container' })], scope, { ...basis, containers_per_shipment: null });
    expect(result.rows).toHaveLength(0);
    // Crucially there is no row with amount_per_unit 0 anywhere in the output.
    expect(result.rows.some((entry) => entry.amount_per_unit === 0)).toBe(false);
  });

  test('an unknown component code is refused', () => {
    const result = selectOperationalCostRows([row({ component: 'bribes' })], scope, basis);
    expect(result.rejected[0]).toMatchObject({ reason: 'unknown_cost_component' });
  });
});
