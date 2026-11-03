import { Prisma } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { buildConfidenceGapLedger } from '@/lib/country-discovery/confidence-ledger';
import { assessProductReadiness } from '@/lib/country-discovery/readiness';

const readiness = assessProductReadiness({
  price_target_amount: null, price_target_currency: null, price_target_quantity_unit: null, price_target_incoterm: null,
  capacity_value: null, capacity_unit: null, moq_value: null, moq_unit: null, lead_time_days: null,
  packaging_format: null, shipment_quantity_value: null, shipment_quantity_unit: null, origin_gateway_code: null,
}, { hs6_code: '100630', status: 'confirmed' } as never);

function stored48(): Prisma.JsonValue {
  return {
    demand_score: { available: true, confidence: 100, base_weight: 25 },
    growth_score: { available: true, confidence: 100, base_weight: 10 },
    competition_score: { available: true, confidence: 100, base_weight: 10 },
    market_access: { available: false, confidence: 0, base_weight: 10, exclusion_reason: 'tariff: A current authoritative India-preference applicability determination is unavailable.' },
    export_economics: { available: false, confidence: 0, base_weight: 15, exclusion_reason: 'No sufficient sourced export-economics input.' },
    exporter_market_fit: { available: false, confidence: 0, base_weight: 15, exclusion_reason: 'insufficient_exporter_data' },
    logistics_feasibility: { available: false, confidence: 0, base_weight: 10, exclusion_reason: 'No current explicit route-availability evidence exists.' },
    risk_resilience: {
      available: true, confidence: 60, base_weight: 5,
      sub_signals: {
        trade_stability: { available: true },
        macro_resilience: { available: false, exclusion_reason: 'No authoritative macro-risk evidence.' },
        payment_resilience: { available: false, exclusion_reason: 'No authoritative payment-country-risk evidence.' },
      },
    },
    overall_score: { coverage_confidence: 48, evidence_recency_weight: 1, confidence_formula_version: 'weighted_component_evidence_coverage_and_recency_v5' },
    confidence_score: { value: 48, formula_version: 'weighted_component_evidence_coverage_and_recency_v5' },
  } as Prisma.JsonValue;
}

describe('canonical confidence gap ledger', () => {
  test('reproduces the stored 48 exactly without creating a second score', () => {
    const ledger = buildConfidenceGapLedger({ field_provenance: stored48(), stored_confidence: 48, readiness, open_classification_questions: 3 });
    expect(ledger).toMatchObject({ coverage_before_freshness: 48, freshness_multiplier: 1, calculated_confidence: 48, stored_confidence: 48, reconciles: true, rounding_adjustment: 0 });
    expect(Object.fromEntries(ledger.components.map((item) => [item.key, item.effective_contribution]))).toEqual({
      demand_score: 25, growth_score: 10, competition_score: 10, market_access: 0,
      export_economics: 0, exporter_market_fit: 0, logistics_feasibility: 0, risk_resilience: 3,
    });
  });

  test('names owners and presents an upper bound rather than fabricating future values', () => {
    const ledger = buildConfidenceGapLedger({ field_provenance: stored48(), stored_confidence: 48, readiness, open_classification_questions: 3 });
    expect(ledger.exporter_data_ceiling.exact_reachable_confidence).toBeNull();
    expect(ledger.exporter_data_ceiling.potentially_unlocks_up_to_weight).toBe(50);
    expect(ledger.exporter_data_ceiling.conditional_upper_bound).toBe(98);
    expect(ledger.components.find((item) => item.key === 'logistics_feasibility')!.exact_missing_evidence)
      .toEqual(expect.arrayContaining([expect.objectContaining({ owners: expect.arrayContaining(['exporter']) }), expect.objectContaining({ owners: expect.arrayContaining(['freight_logistics_partner']) })]));
  });

  test('applies the frozen freshness multiplier after rounded coverage, exactly like v4', () => {
    const payload = stored48() as Record<string, unknown>;
    (payload.overall_score as Record<string, unknown>).evidence_recency_weight = 0.8;
    const ledger = buildConfidenceGapLedger({ field_provenance: payload as Prisma.JsonValue, stored_confidence: 38, readiness });
    expect(ledger.coverage_before_freshness).toBe(48);
    expect(ledger.calculated_confidence).toBe(38);
    expect(ledger.reconciles).toBe(true);
    expect(ledger.unrounded_component_sum).toBe(38.4);
    expect(ledger.rounding_adjustment).toBe(-0.4);
  });
});
