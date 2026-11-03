import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '@/lib/config';
import {
  calculateCountryTradeMetrics,
  calculateIndiaOriginUnitValues,
  calculateUnitValues,
  INDIA_ORIGIN_UNIT_VALUE_VERSION,
  type CountryMetricInput,
  type MetricFact,
} from '@/lib/country-trade-metrics/calculator';

/**
 * Phase 1G isolation.
 *
 * Phase 1H needs an India-origin unit value. Putting it inside the shared country-trade-metrics
 * payload changed that payload's checksum, which the persistence guard correctly rejects, which
 * is why it was previously accompanied by a v1 -> v2 policy bump. A bump would make an
 * unfinished Phase 1G run compute replacement metric rows instead of reusing the ones it has
 * already validated, so the statistic is separated instead and this file locks the separation.
 */

const policy = CONFIG_DEFAULTS['country_trade_metrics.policy'];

let seq = 0;
function fact(over: Partial<MetricFact> = {}): MetricFact {
  seq++;
  return {
    purpose: 'WORLD_IMPORT_HISTORY',
    reporter_code: '276',
    partner_code: '0',
    partner_iso2: null,
    partner_is_world: true,
    partner2_code: '0',
    period: 2024,
    hs_code: '090111',
    hs_revision: 'HS2022',
    flow_direction: 'import',
    frequency: 'A',
    trade_value: 100,
    trade_value_status: 'observed',
    quantity: null,
    quantity_status: 'missing',
    quantity_unit: null,
    net_weight: 10,
    source_evidence_id: `ev-${seq}`,
    observation_id: `ob-${seq}`,
    retrieved_at: '2026-08-20T00:00:00.000Z',
    freshness_state: 'fresh',
    evidence_completeness: 'COMPLETE',
    cell_state: 'observed',
    ...over,
  } as MetricFact;
}

/**
 * Fixed input. Both the fixture and the expected hash below were produced by running the
 * calculator committed at HEAD — the code that computed every CountryTradeMetrics row Phase 1G
 * has already validated.
 */
function goldenInput(): CountryMetricInput {
  seq = 0;
  const years = [2020, 2021, 2022, 2023, 2024];
  const world = [100, 220, 360, 520, 700];
  const weights = [10, 20, 30, 40, 50];
  const india = [5, 7.2, 10.08, 13.824, 18.6624];
  return {
    reporter_code: '276',
    hs_code: '090111',
    hs_revision: 'HS2022',
    period_set: years,
    latest_common_year: 2024,
    policy,
    facts: [
      ...years.map((year, i) => fact({ period: year, trade_value: world[i], net_weight: weights[i] })),
      ...years.map((year, i) =>
        fact({ purpose: 'INDIA_IMPORT_HISTORY', partner_code: '699', partner_iso2: 'IN', partner_is_world: false, period: year, trade_value: india[i], net_weight: 2 }),
      ),
      fact({ purpose: 'LATEST_SUPPLIER_DISTRIBUTION', partner_code: '156', partner_iso2: 'CN', partner_is_world: false, trade_value: 600 }),
      fact({ purpose: 'LATEST_SUPPLIER_DISTRIBUTION', partner_code: '699', partner_iso2: 'IN', partner_is_world: false, trade_value: 100 }),
    ],
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

/** Produced by the country-trade-calculator-v1 code committed at HEAD, over `goldenInput()`. */
const V1_GOLDEN_PAYLOAD_HASH = 'f202b94231673432598ee41287af06190d7a922dca71c95084bd0d2b15a28e2d';

describe('Phase 1G country-trade-metrics v1 isolation', () => {
  test('the shipped metric policy still carries the v1 identities Phase 1G validated against', () => {
    expect(policy.policy_version).toBe('country-trade-metrics-v1');
    expect(policy.calculation_version).toBe('country-trade-calculator-v1');
  });

  test('the metrics payload is byte-identical to what country-trade-calculator-v1 produced', () => {
    // A change to this hash means every historical CountryTradeMetrics row has become
    // irreproducible and the persistence guard will refuse to reuse it.
    expect(hash(calculateCountryTradeMetrics(goldenInput()))).toBe(V1_GOLDEN_PAYLOAD_HASH);
  });

  test('the payload exposes exactly the v1 metric set and no supplemental statistic', () => {
    const metrics = calculateCountryTradeMetrics(goldenInput());
    expect(Object.keys(metrics).sort()).toEqual([
      'cagr',
      'india_import_value',
      'india_market_share',
      'india_share_trend',
      'market_size',
      'recent_momentum',
      'supplier_hhi',
      'unit_value',
      'volatility',
    ]);
    expect(metrics).not.toHaveProperty('india_unit_value');
  });

  test('the destination unit value keeps its v1 method label and detail keys', () => {
    const result = calculateUnitValues(goldenInput());
    expect(result.calculation_method).toBe(policy.unit_value_preference);
    expect(Object.keys(result.details ?? {}).sort()).toEqual([
      'benchmark_warning',
      'excluded_observation_ids',
      'outlier_method',
    ]);
    // A scope key here would mean the shared helper had leaked Phase 1H framing into v1 output.
    expect(result.details).not.toHaveProperty('scope');
  });

  test('the India-origin unit value is computable, separately versioned, and separately labelled', () => {
    const result = calculateIndiaOriginUnitValues(goldenInput());
    expect(result.status).toBe('complete');
    expect(result.calculation_method).toBe(`india_origin_${policy.unit_value_preference}`);
    expect(result.details).toMatchObject({
      scope: 'india_origin',
      supplemental_version: INDIA_ORIGIN_UNIT_VALUE_VERSION,
      benchmark_warning: 'Trade-statistical unit value; not a selling-price quote.',
    });
  });

  test('it measures India-origin imports, not the destination world series', () => {
    const world = calculateUnitValues(goldenInput());
    const india = calculateIndiaOriginUnitValues(goldenInput());
    expect(world.value?.median).not.toBe(india.value?.median);
    // World: 700/50 at the latest year; India: 18.6624/2. Two different populations.
    expect(india.value?.median).toBeCloseTo(5.04, 5);
  });

  test('computing the supplemental statistic cannot change the v1 payload', () => {
    const before = hash(calculateCountryTradeMetrics(goldenInput()));
    calculateIndiaOriginUnitValues(goldenInput());
    expect(hash(calculateCountryTradeMetrics(goldenInput()))).toBe(before);
    expect(before).toBe(V1_GOLDEN_PAYLOAD_HASH);
  });

  test('the supplemental version is owned by the Phase 1H policy, not the metric policy', () => {
    expect(CONFIG_DEFAULTS['country_truth.phase_1h'].india_origin_unit_value_version).toBe(
      INDIA_ORIGIN_UNIT_VALUE_VERSION,
    );
    expect(policy).not.toHaveProperty('india_origin_unit_value_version');
  });
});
