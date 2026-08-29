import { describe, expect, test } from 'vitest';
import { CONFIG_DEFAULTS } from '@/lib/config';
import {
  calculateExporterMarketFitV3,
  calculateExportEconomicsV3,
  calculateLogisticsV3,
  calculateMarketAccessV2,
  selectApplicableIndiaTariff,
  type AssertionClass,
  type ExactFactScope,
  type ExportCostComponentValue,
  type ExporterCertificationValue,
  type ExporterFitBenchmarkValue,
  type ExporterPriceValue,
  type FxRateValue,
  type ImportBenchmarkValue,
  type LogisticsFreightQuoteValue,
  type LogisticsRouteValue,
  type MarketAccessRequirementValue,
  type PresentScopedFact,
  type RegulatoryCoverageValue,
  type ScopedFact,
  type TariffFactValue,
} from '@/lib/country-truth/phase-1h-calculations';

const AS_OF = '2026-08-29T00:00:00.000Z';
const RETRIEVED = '2026-08-20T00:00:00.000Z';

const POLICY = CONFIG_DEFAULTS['country_truth.phase_1h'];

const scope: ExactFactScope = {
  exporter_org_id: 'org-1',
  country_code: 'GB',
  hs6: '090111',
  hs_revision: 'HS2022',
  as_of_date: AS_OF,
};

function fact<T>(
  id: string,
  value: T,
  options: {
    assertion_class?: AssertionClass;
    confidence?: number;
    retrieved_at?: string;
    scope?: ExactFactScope;
  } = {},
): PresentScopedFact<T> {
  return {
    id,
    state: 'present',
    value,
    scope: options.scope ?? scope,
    confidence: options.confidence ?? 100,
    provenance: {
      assertion_class: options.assertion_class ?? 'authoritative_public',
      source: 'test-authority',
      source_reference: `https://example.test/${id}`,
      retrieved_at: options.retrieved_at ?? RETRIEVED,
    },
  };
}

function absent<T>(id: string, state: 'missing' | 'unknown' | 'confirmed_absent', subjectKey?: string): ScopedFact<T> {
  return {
    id,
    state,
    reason: 'test',
    scope,
    confidence: 0,
    ...(subjectKey ? { subject_key: subjectKey } : {}),
    provenance: {
      assertion_class: 'exporter_declared',
      source: 'exporter',
      source_reference: id,
      retrieved_at: RETRIEVED,
    },
  };
}

const ordinaryTariff = (rate: number, id = 'tariff-ordinary') =>
  fact<TariffFactValue>(id, {
    tariff_type: 'ordinary',
    origin_country: 'IN',
    rate_percent: rate,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
  });

const preferenceTariff = (
  rate: number | null,
  applicability: TariffFactValue['preference_applicability'],
  overrides: Partial<TariffFactValue> = {},
  id = 'tariff-preference',
) =>
  fact<TariffFactValue>(id, {
    tariff_type: 'india_preference',
    origin_country: 'IN',
    rate_percent: rate,
    preference_applicability: applicability,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Applicable India tariff
// ---------------------------------------------------------------------------

describe('applicable India tariff selection', () => {
  test('a valid India preference is used instead of the ordinary rate', () => {
    const result = selectApplicableIndiaTariff(
      scope,
      [ordinaryTariff(12), preferenceTariff(0, 'applicable')],
      POLICY.market_access.tariff_policy,
    );
    expect(result).toMatchObject({ status: 'available', rate_percent: 0, tariff_basis: 'india_preference' });
  });

  test('an explicitly non-applicable preference falls back to the ordinary rate and says so', () => {
    const result = selectApplicableIndiaTariff(
      scope,
      [ordinaryTariff(12), preferenceTariff(null, 'not_applicable')],
      POLICY.market_access.tariff_policy,
    );
    expect(result).toMatchObject({
      status: 'available',
      rate_percent: 12,
      tariff_basis: 'ordinary_after_explicit_non_applicability',
    });
  });

  test('unresolved preference applicability never silently becomes the ordinary rate', () => {
    const result = selectApplicableIndiaTariff(
      scope,
      [ordinaryTariff(12), preferenceTariff(null, 'unknown')],
      POLICY.market_access.tariff_policy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.rate_percent).toBeNull();
    expect(result.reasons[0]).toMatch(/unknown/i);
  });

  test('a preference whose agreement is not yet in force is excluded rather than applied early', () => {
    const result = selectApplicableIndiaTariff(
      scope,
      [
        ordinaryTariff(12),
        preferenceTariff(0, 'applicable', { effective_from: '2027-01-01T00:00:00.000Z' }),
      ],
      POLICY.market_access.tariff_policy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.provenance.excluded_facts).toContainEqual({
      fact_id: 'tariff-preference',
      reason: 'tariff_not_current_at_assessment_clock',
    });
  });

  test('a tariff whose validity ended before the assessment clock is stale and excluded', () => {
    const result = selectApplicableIndiaTariff(
      scope,
      [preferenceTariff(0, 'applicable', { effective_to: '2026-06-01T00:00:00.000Z' })],
      POLICY.market_access.tariff_policy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.provenance.excluded_facts.map((item) => item.reason)).toContain(
      'tariff_not_current_at_assessment_clock',
    );
  });

  test('evidence retrieved after the frozen clock is never admitted', () => {
    const result = selectApplicableIndiaTariff(
      scope,
      [preferenceTariff(0, 'applicable', {}, 'tariff-future')],
      POLICY.market_access.tariff_policy,
    );
    const future = selectApplicableIndiaTariff(
      scope,
      [
        {
          ...preferenceTariff(0, 'applicable', {}, 'tariff-future'),
          provenance: {
            assertion_class: 'authoritative_public',
            source: 'test-authority',
            source_reference: 'https://example.test/x',
            retrieved_at: '2026-09-30T00:00:00.000Z',
          },
        },
      ],
      POLICY.market_access.tariff_policy,
    );
    expect(result.status).toBe('available');
    expect(future.status).toBe('unavailable');
    expect(future.provenance.excluded_facts).toContainEqual({
      fact_id: 'tariff-future',
      reason: 'evidence_retrieved_after_assessment_clock',
    });
  });

  test('a tariff carrying another exporter tenant is rejected as out of scope', () => {
    const leaked = {
      ...preferenceTariff(0, 'applicable'),
      scope: { ...scope, exporter_org_id: 'org-2' },
    };
    const result = selectApplicableIndiaTariff(scope, [leaked], POLICY.market_access.tariff_policy);
    expect(result.status).toBe('unavailable');
    expect(result.provenance.excluded_facts).toContainEqual({ fact_id: 'tariff-preference', reason: 'scope_mismatch' });
  });
});

// ---------------------------------------------------------------------------
// Market Access
// ---------------------------------------------------------------------------

const coverage = (overrides: Partial<RegulatoryCoverageValue> = {}) =>
  fact<RegulatoryCoverageValue>('coverage-1', {
    tariff_coverage: true,
    regulatory_coverage: true,
    completeness: 'COMPLETE',
    observed_at: RETRIEVED,
    effective_from: RETRIEVED,
    effective_to: null,
    ...overrides,
  });

const requirement = (
  id: string,
  value: Partial<MarketAccessRequirementValue> & Pick<MarketAccessRequirementValue, 'requirement_type'>,
) =>
  fact<MarketAccessRequirementValue>(id, {
    requirement_code: 'REQ',
    description: 'test requirement',
    obtainable: 'yes',
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    observed_at: RETRIEVED,
    ...value,
  });

describe('market access v2', () => {
  test('an explicit import prohibition blocks the market and publishes no score', () => {
    const result = calculateMarketAccessV2(
      {
        scope,
        tariffs: [preferenceTariff(0, 'applicable')],
        requirements: [requirement('req-prohibition', { requirement_type: 'prohibition', requirement_code: 'BAN' })],
        regulatory_coverage: coverage(),
      },
      POLICY.market_access,
    );
    expect(result.status).toBe('blocked');
    expect(result.score).toBeNull();
    // A zero-duty preference must not be able to average a legal prohibition away.
    expect(result.soft_score).toBeGreaterThan(0);
    expect(result.blockers).toEqual([
      { code: 'destination_import_prohibition', requirement_type: 'prohibition', requirement_code: 'BAN', fact_id: 'req-prohibition' },
    ]);
  });

  test('an explicitly unobtainable mandatory requirement blocks the market', () => {
    const result = calculateMarketAccessV2(
      {
        scope,
        tariffs: [preferenceTariff(0, 'applicable')],
        requirements: [
          requirement('req-cert', { requirement_type: 'mandatory_certification', requirement_code: 'ORG', obtainable: 'no' }),
        ],
        regulatory_coverage: coverage(),
      },
      POLICY.market_access,
    );
    expect(result.status).toBe('blocked');
    expect(result.blockers[0].code).toBe('mandatory_requirement_explicitly_unobtainable');
  });

  test('unresolved obtainability is penalized and reported, never treated as unobtainable', () => {
    const result = calculateMarketAccessV2(
      {
        scope,
        tariffs: [preferenceTariff(0, 'applicable')],
        requirements: [
          requirement('req-cert', { requirement_type: 'mandatory_certification', requirement_code: 'ORG', obtainable: 'unknown' }),
        ],
        regulatory_coverage: coverage(),
      },
      POLICY.market_access,
    );
    expect(result.status).toBe('available');
    expect(result.blockers).toEqual([]);
    expect(result.sub_signals.regulatory.reasons.join(' ')).toMatch(/obtainability is unresolved/);
  });

  test('without COMPLETE regulatory coverage, an empty requirement list stays unknown', () => {
    const withoutCoverage = calculateMarketAccessV2(
      { scope, tariffs: [preferenceTariff(0, 'applicable')], requirements: [] },
      POLICY.market_access,
    );
    const partialCoverage = calculateMarketAccessV2(
      {
        scope,
        tariffs: [preferenceTariff(0, 'applicable')],
        requirements: [],
        regulatory_coverage: coverage({ completeness: 'PARTIAL' }),
      },
      POLICY.market_access,
    );
    const withCoverage = calculateMarketAccessV2(
      { scope, tariffs: [preferenceTariff(0, 'applicable')], requirements: [], regulatory_coverage: coverage() },
      POLICY.market_access,
    );
    expect(withoutCoverage.sub_signals.regulatory.status).toBe('unavailable');
    expect(withoutCoverage.status).toBe('partial');
    expect(partialCoverage.sub_signals.regulatory.status).toBe('unavailable');
    expect(withCoverage.sub_signals.regulatory.score).toBe(100);
    expect(withCoverage.status).toBe('available');
  });

  test('a prohibition still blocks even when the wider regulatory corpus is incomplete', () => {
    const result = calculateMarketAccessV2(
      {
        scope,
        tariffs: [preferenceTariff(0, 'applicable')],
        requirements: [requirement('req-prohibition', { requirement_type: 'prohibition' })],
        regulatory_coverage: coverage({ completeness: 'PARTIAL' }),
      },
      POLICY.market_access,
    );
    expect(result.status).toBe('blocked');
  });

  test('a repealed requirement is not in force and is excluded', () => {
    const result = calculateMarketAccessV2(
      {
        scope,
        tariffs: [preferenceTariff(0, 'applicable')],
        requirements: [
          requirement('req-old', { requirement_type: 'prohibition', effective_to: '2026-02-01T00:00:00.000Z' }),
        ],
        regulatory_coverage: coverage(),
      },
      POLICY.market_access,
    );
    expect(result.status).toBe('available');
    expect(result.blockers).toEqual([]);
    expect(result.provenance.excluded_facts).toContainEqual({
      fact_id: 'req-old',
      reason: 'requirement_not_in_force_at_assessment_clock',
    });
  });

  test('an unavailable tariff lowers neither the regulatory score nor the market to zero', () => {
    const result = calculateMarketAccessV2(
      { scope, tariffs: [], requirements: [], regulatory_coverage: coverage() },
      POLICY.market_access,
    );
    expect(result.sub_signals.tariff.score).toBeNull();
    expect(result.score).toBe(100);
    expect(result.status).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// Export Economics
// ---------------------------------------------------------------------------

const benchmark = (value = 15, overrides: Partial<ImportBenchmarkValue> = {}) =>
  fact<ImportBenchmarkValue>('benchmark-1', {
    value_per_unit: value,
    currency: 'USD',
    quantity_unit: 'kg',
    valuation_basis: 'CIF',
    observed_at: RETRIEVED,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    ...overrides,
  });

const price = (incoterm: string, amount = 10, currency = 'USD') =>
  fact<ExporterPriceValue>(
    'price-1',
    { amount_per_unit: amount, currency, quantity_unit: 'kg', incoterm, declared_at: RETRIEVED },
    { assertion_class: 'exporter_declared' },
  );

const cost = (
  component: ExportCostComponentValue['component'],
  amount: number,
  overrides: Partial<ExportCostComponentValue> = {},
) =>
  fact<ExportCostComponentValue>(
    `cost-${component}`,
    {
      component,
      amount_per_unit: amount,
      currency: 'USD',
      quantity_unit: 'kg',
      observed_at: RETRIEVED,
      valid_until: null,
      ...overrides,
    },
    { assertion_class: 'partner_quote' },
  );

const CIF_STACK = [
  cost('packaging', 0.5),
  cost('inland_transport', 0.3),
  cost('origin_charges', 0.2),
  cost('international_freight', 1),
  cost('insurance', 0.1),
];

/** Costs that fall outside every customs base but are still borne on the shipment. */
const POST_CUSTOMS_STACK = [cost('destination_charges', 0.4), cost('financing', 0.2), cost('cleartrade_fee', 0.3)];

const FULL_STACK = [...CIF_STACK, ...POST_CUSTOMS_STACK];

const economicsPolicy = {
  ...POLICY.export_economics,
  customs_valuation_basis_by_country: { GB: 'CIF' as const },
};

describe('export economics v3', () => {
  test('an EXW price builds the full customs value and takes duty on the CIF base', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(result.status).toBe('available');
    expect(result.cost_stack_incomplete).toBe(false);
    expect(result.amounts).toMatchObject({
      customs_valuation_basis: 'CIF',
      exporter_price: 10,
      customs_value: 12.1,
      duty_amount: 1.21,
      cif_equivalent_cost: 12.1,
      total_landed_cost: 14.21,
    });
    expect(result.provenance.details.duty_base).toBe('cif_customs_value');
  });

  test('a CIF price never has its bundled freight and insurance added a second time', () => {
    const withoutQuotes = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('CIF', 12.1),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: POST_CUSTOMS_STACK,
        fx_rates: [],
      },
      economicsPolicy,
    );
    const withQuotes = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('CIF', 12.1),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(withoutQuotes.amounts?.total_landed_cost).toBe(14.21);
    expect(withQuotes.amounts?.total_landed_cost).toBe(14.21);
    expect(withQuotes.components.find((item) => item.component === 'international_freight')).toMatchObject({
      treatment: 'bundled_in_price',
      amount: null,
    });
    expect(withQuotes.provenance.excluded_facts).toContainEqual({
      fact_id: 'cost-international_freight',
      reason: 'included_in_incoterm_price',
    });
  });

  test('an FOB customs base keeps freight and insurance out of duty but inside landed cost', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      { ...economicsPolicy, customs_valuation_basis_by_country: { GB: 'FOB' } },
    );
    expect(result.amounts).toMatchObject({
      customs_valuation_basis: 'FOB',
      customs_value: 11,
      duty_amount: 1.1,
      cif_equivalent_cost: 12.1,
      total_landed_cost: 14.1,
    });
  });

  test('a missing required cost component is unavailable, never priced at zero', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK.filter((item) => item.value.component !== 'insurance'),
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.score).toBeNull();
    expect(result.reasons.join(' ')).toMatch(/insurance/);
    expect(result.components.find((item) => item.component === 'insurance')?.treatment).toBe('missing');
  });

  test('a cost the exporter bears but we have not recorded is never summed as zero', () => {
    const withFee = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      economicsPolicy,
    );
    const withoutFee = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK.filter((item) => item.value.component !== 'cleartrade_fee'),
        fx_rates: [],
      },
      economicsPolicy,
    );
    // Omitting a real cost would make the market look CHEAPER, so an unknown component has to
    // stop the calculation rather than quietly improve the score.
    expect(withFee.status).toBe('available');
    expect(withoutFee.status).toBe('unavailable');
    expect(withoutFee.score).toBeNull();
    expect(withoutFee.reasons.join(' ')).toMatch(/cleartrade_fee/);
  });

  test('an unknown destination customs base refuses to guess a duty base', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      { ...POLICY.export_economics, customs_valuation_basis_by_country: {} },
    );
    expect(result.status).toBe('unavailable');
    expect(result.reasons.join(' ')).toMatch(/customs valuation base is unknown/i);
  });

  test('a delivered Incoterm that bundles post-customs cost is refused rather than split by guess', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('DDP', 14),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: [],
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.reasons.join(' ')).toMatch(/destination_charges beyond the CIF customs base/);
  });

  test('a cross-currency price requires an exactly matching, dated FX fact', () => {
    const inrPrice = price('EXW', 800, 'INR');
    const wrongPair = fact<FxRateValue>('fx-wrong', {
      base_currency: 'EUR',
      quote_currency: 'USD',
      direction: 'quote_per_base',
      rate: 1.1,
      rate_date: '2026-08-27T00:00:00.000Z',
    });
    const stale = fact<FxRateValue>('fx-stale', {
      base_currency: 'INR',
      quote_currency: 'USD',
      direction: 'quote_per_base',
      rate: 0.0125,
      rate_date: '2026-01-01T00:00:00.000Z',
    });
    const good = fact<FxRateValue>('fx-good', {
      base_currency: 'INR',
      quote_currency: 'USD',
      direction: 'quote_per_base',
      rate: 0.0125,
      rate_date: '2026-08-27T00:00:00.000Z',
    });
    const base = { scope, benchmark: benchmark(), tariffs: [preferenceTariff(10, 'applicable')], cost_components: FULL_STACK };
    expect(calculateExportEconomicsV3({ ...base, exporter_price: inrPrice, fx_rates: [wrongPair] }, economicsPolicy).status).toBe('unavailable');
    expect(calculateExportEconomicsV3({ ...base, exporter_price: inrPrice, fx_rates: [stale] }, economicsPolicy).status).toBe('unavailable');
    const converted = calculateExportEconomicsV3({ ...base, exporter_price: inrPrice, fx_rates: [good] }, economicsPolicy);
    expect(converted.status).toBe('available');
    expect(converted.amounts?.exporter_price).toBe(10);
  });

  test('an expired cost component is not reused as if it were current', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: [
          ...FULL_STACK.filter((item) => item.value.component !== 'international_freight'),
          cost('international_freight', 1, { valid_until: '2026-08-01T00:00:00.000Z' }),
        ],
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.provenance.excluded_facts).toContainEqual({
      fact_id: 'cost-international_freight',
      reason: 'cost_component_expired_or_stale',
    });
  });

  test('a benchmark that is not explicitly CIF valued is not comparable', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: fact<ImportBenchmarkValue>('benchmark-1', {
          value_per_unit: 15,
          currency: 'USD',
          quantity_unit: 'kg',
          valuation_basis: 'FOB' as unknown as 'CIF',
          observed_at: RETRIEVED,
          effective_from: '2026-01-01T00:00:00.000Z',
          effective_to: null,
        }),
        tariffs: [preferenceTariff(10, 'applicable')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.reasons.join(' ')).toMatch(/explicitly CIF-valued/);
  });

  test('an unresolved India preference stops economics rather than defaulting to ordinary duty', () => {
    const result = calculateExportEconomicsV3(
      {
        scope,
        exporter_price: price('EXW'),
        benchmark: benchmark(),
        tariffs: [ordinaryTariff(12), preferenceTariff(null, 'unknown')],
        cost_components: FULL_STACK,
        fx_rates: [],
      },
      economicsPolicy,
    );
    expect(result.status).toBe('unavailable');
    expect(result.reasons.join(' ')).toMatch(/applicable to Indian origin/);
  });
});

// ---------------------------------------------------------------------------
// Exporter–Market Fit
// ---------------------------------------------------------------------------

const orderQuantityBenchmark = fact<ExporterFitBenchmarkValue>('bm-order', {
  benchmark_type: 'order_quantity',
  minimum_quantity: 500,
  maximum_quantity: 2000,
  quantity_unit: 'kg',
  effective_from: '2026-01-01T00:00:00.000Z',
  effective_to: null,
  observed_at: RETRIEVED,
});

const certificationBenchmark = (
  code: string,
  obtainable: 'yes' | 'no' | 'unknown',
  mandatory = true,
) =>
  fact<ExporterFitBenchmarkValue>(`bm-cert-${code}`, {
    benchmark_type: 'certification_requirement',
    certification_code: code,
    mandatory,
    obtainable,
    effective_from: '2026-01-01T00:00:00.000Z',
    effective_to: null,
    observed_at: RETRIEVED,
  });

const certification = (code: string, status: ExporterCertificationValue['status'], evidence?: string) =>
  fact<ExporterCertificationValue>(
    `cert-${code}`,
    { certification_code: code, status, evidence_reference: evidence ?? null, valid_until: null, declared_at: RETRIEVED },
    { assertion_class: 'exporter_declared' },
  );

describe('exporter–market fit v3', () => {
  test('an exporter we hold no facts about is insufficient data, not a low score', () => {
    const result = calculateExporterMarketFitV3(
      { scope, certifications: [], benchmarks: [orderQuantityBenchmark] },
      POLICY.exporter_market_fit,
    );
    expect(result.status).toBe('insufficient_exporter_data');
    expect(result.score).toBeNull();
    expect(result.soft_score).toBeNull();
  });

  test('a known but poorly matched exporter scores low rather than reporting missing data', () => {
    const result = calculateExporterMarketFitV3(
      {
        scope,
        capacity: fact('capacity', { amount: 50, quantity_unit: 'kg', declared_at: RETRIEVED }, { assertion_class: 'exporter_declared' }),
        certifications: [],
        benchmarks: [orderQuantityBenchmark],
      },
      POLICY.exporter_market_fit,
    );
    expect(result.status).toBe('partial');
    expect(result.score).toBe(10);
  });

  test('an unknown certification state is not read as a confirmed absence', () => {
    const unknown = calculateExporterMarketFitV3(
      {
        scope,
        certifications: [absent<ExporterCertificationValue>('cert-ORG', 'unknown', 'ORG')],
        benchmarks: [certificationBenchmark('ORG', 'yes')],
      },
      POLICY.exporter_market_fit,
    );
    const confirmedAbsent = calculateExporterMarketFitV3(
      {
        scope,
        certifications: [certification('ORG', 'not_started')],
        benchmarks: [certificationBenchmark('ORG', 'yes')],
      },
      POLICY.exporter_market_fit,
    );
    expect(unknown.sub_signals.certification.status).toBe('unavailable');
    expect(unknown.sub_signals.certification.score).toBeNull();
    expect(confirmedAbsent.sub_signals.certification.score).toBe(POLICY.exporter_market_fit.certification_scores.not_started);
  });

  test('a mandatory, unobtainable certification the exporter does not hold blocks the market', () => {
    const result = calculateExporterMarketFitV3(
      {
        scope,
        certifications: [certification('ORG', 'not_started')],
        benchmarks: [certificationBenchmark('ORG', 'no')],
      },
      POLICY.exporter_market_fit,
    );
    expect(result.status).toBe('blocked');
    expect(result.score).toBeNull();
    expect(result.soft_score).not.toBeNull();
    expect(result.hard_blockers[0].certification_code).toBe('ORG');
  });

  test('an unobtainable certification the exporter already holds does not block', () => {
    const result = calculateExporterMarketFitV3(
      {
        scope,
        certifications: [certification('ORG', 'held', 'doc://cert')],
        benchmarks: [certificationBenchmark('ORG', 'no')],
      },
      POLICY.exporter_market_fit,
    );
    expect(result.hard_blockers).toEqual([]);
    expect(result.sub_signals.certification.score).toBe(POLICY.exporter_market_fit.certification_scores.held_documented);
  });

  test('an expired certification is not treated as held', () => {
    const result = calculateExporterMarketFitV3(
      {
        scope,
        certifications: [
          fact<ExporterCertificationValue>(
            'cert-ORG',
            { certification_code: 'ORG', status: 'held', evidence_reference: 'doc://cert', valid_until: '2026-05-01T00:00:00.000Z', declared_at: RETRIEVED },
            { assertion_class: 'exporter_declared' },
          ),
        ],
        benchmarks: [certificationBenchmark('ORG', 'yes')],
      },
      POLICY.exporter_market_fit,
    );
    expect(result.sub_signals.certification.score).toBe(POLICY.exporter_market_fit.certification_scores.expired);
  });

  test('an exporter capability in a different unit is not compared to the benchmark', () => {
    const result = calculateExporterMarketFitV3(
      {
        scope,
        capacity: fact('capacity', { amount: 5, quantity_unit: 'tonne', declared_at: RETRIEVED }, { assertion_class: 'exporter_declared' }),
        certifications: [],
        benchmarks: [orderQuantityBenchmark],
      },
      POLICY.exporter_market_fit,
    );
    expect(result.sub_signals.capacity.status).toBe('unavailable');
  });

  test('evidence authority changes confidence without changing the score', () => {
    const capacityValue = { amount: 1000, quantity_unit: 'kg', declared_at: RETRIEVED };
    const declared = calculateExporterMarketFitV3(
      {
        scope,
        capacity: fact('capacity', capacityValue, { assertion_class: 'exporter_declared' }),
        certifications: [],
        benchmarks: [orderQuantityBenchmark],
      },
      POLICY.exporter_market_fit,
    );
    const verified = calculateExporterMarketFitV3(
      {
        scope,
        capacity: fact('capacity', capacityValue, { assertion_class: 'agent_verified' }),
        certifications: [],
        benchmarks: [orderQuantityBenchmark],
      },
      POLICY.exporter_market_fit,
    );
    expect(declared.score).toBe(verified.score);
    expect(declared.sub_signals.capacity.confidence).toBeLessThan(verified.sub_signals.capacity.confidence);
  });
});

// ---------------------------------------------------------------------------
// Logistics
// ---------------------------------------------------------------------------

const route = (overrides: Partial<LogisticsRouteValue> = {}, id = 'route-1') =>
  fact<LogisticsRouteValue>(id, {
    route_status: 'route_available',
    transport_mode: 'ocean',
    origin_location_code: 'INNSA',
    origin_gateway_code: 'INNSA',
    destination_location_code: 'GBFXT',
    transit_time_min_days: 20,
    transit_time_max_days: 30,
    supported_constraint_codes: null,
    effective_from: '2026-08-01T00:00:00.000Z',
    effective_to: null,
    observed_at: RETRIEVED,
    ...overrides,
  });

const freightQuote = (overrides: Partial<LogisticsFreightQuoteValue> = {}) =>
  fact<LogisticsFreightQuoteValue>(
    'quote-1',
    {
      route_fact_id: 'route-1',
      freight_per_unit: 1,
      currency: 'USD',
      quantity_unit: 'kg',
      assumed_goods_value_per_unit: 20,
      assumed_goods_value_currency: 'USD',
      quoted_at: RETRIEVED,
      valid_until: '2026-09-30T00:00:00.000Z',
      ...overrides,
    },
    { assertion_class: 'partner_quote' },
  );

describe('logistics feasibility v3', () => {
  test('no route evidence is unknown, never an impossible route', () => {
    const result = calculateLogisticsV3({ scope, routes: [], freight_quotes: [] }, POLICY.logistics_feasibility);
    expect(result.route_status).toBe('unknown');
    expect(result.score).toBeNull();
    expect(result.status).toBe('unavailable');
    expect(result.provenance.details.missing_route_evidence_is_not_route_unavailable).toBe(true);
  });

  test('an explicitly unavailable route is a scored fact about the market', () => {
    const result = calculateLogisticsV3(
      { scope, routes: [route({ route_status: 'route_unavailable' })], freight_quotes: [] },
      POLICY.logistics_feasibility,
    );
    expect(result.route_status).toBe('route_unavailable');
    expect(result.score).toBe(POLICY.logistics_feasibility.route_unavailable_score);
  });

  test('an expired freight quote does not expire the route it was quoted against', () => {
    const result = calculateLogisticsV3(
      { scope, routes: [route()], freight_quotes: [freightQuote({ valid_until: '2026-08-01T00:00:00.000Z' })] },
      POLICY.logistics_feasibility,
    );
    expect(result.route_status).toBe('route_available');
    expect(result.sub_signals.route_availability.score).toBe(100);
    expect(result.sub_signals.freight_burden.status).toBe('unavailable');
    expect(result.provenance.excluded_facts).toContainEqual({ fact_id: 'quote-1', reason: 'freight_quote_expired_or_stale' });
  });

  test('a freight quote for a different route is never reused', () => {
    const result = calculateLogisticsV3(
      { scope, routes: [route()], freight_quotes: [freightQuote({ route_fact_id: 'route-other' })] },
      POLICY.logistics_feasibility,
    );
    expect(result.sub_signals.freight_burden.status).toBe('unavailable');
    expect(result.provenance.excluded_facts).toContainEqual({
      fact_id: 'quote-1',
      reason: 'freight_quote_is_not_for_the_selected_route',
    });
  });

  test('a freight quote belonging to another exporter is out of scope', () => {
    const result = calculateLogisticsV3(
      {
        scope,
        routes: [route()],
        freight_quotes: [{ ...freightQuote(), scope: { ...scope, exporter_org_id: 'org-2' } }],
      },
      POLICY.logistics_feasibility,
    );
    expect(result.provenance.excluded_facts).toContainEqual({ fact_id: 'quote-1', reason: 'scope_mismatch' });
  });

  test('unstated handling coverage is unknown, while a stated gap scores low', () => {
    const unknownCoverage = calculateLogisticsV3(
      { scope, routes: [route()], freight_quotes: [], required_constraint_codes: ['COLD_CHAIN'] },
      POLICY.logistics_feasibility,
    );
    const statedGap = calculateLogisticsV3(
      {
        scope,
        routes: [route({ supported_constraint_codes: ['HAZMAT'] })],
        freight_quotes: [],
        required_constraint_codes: ['COLD_CHAIN'],
      },
      POLICY.logistics_feasibility,
    );
    expect(unknownCoverage.sub_signals.handling_compatibility.status).toBe('unavailable');
    expect(statedGap.sub_signals.handling_compatibility.score).toBe(POLICY.logistics_feasibility.handling_scores.unsupported);
    expect(statedGap.route_status).toBe('route_available');
  });

  test('a route from a different declared origin is excluded, but an unknown origin filters nothing', () => {
    const mismatched = calculateLogisticsV3(
      {
        scope,
        routes: [route()],
        freight_quotes: [],
        expected_origin: { location_code: 'INMUN', gateway_code: null },
      },
      POLICY.logistics_feasibility,
    );
    const unknownOrigin = calculateLogisticsV3(
      { scope, routes: [route()], freight_quotes: [], expected_origin: { location_code: null, gateway_code: null } },
      POLICY.logistics_feasibility,
    );
    expect(mismatched.route_status).toBe('unknown');
    expect(mismatched.provenance.excluded_facts).toContainEqual({
      fact_id: 'route-1',
      reason: 'route_origin_location_does_not_match_exporter_declared_origin',
    });
    expect(unknownOrigin.route_status).toBe('route_available');
  });

  test('transit time is scored from the route and renormalized when absent', () => {
    const withTransit = calculateLogisticsV3({ scope, routes: [route()], freight_quotes: [] }, POLICY.logistics_feasibility);
    const withoutTransit = calculateLogisticsV3(
      { scope, routes: [route({ transit_time_min_days: null, transit_time_max_days: null })], freight_quotes: [] },
      POLICY.logistics_feasibility,
    );
    expect(withTransit.sub_signals.transit_time.score).toBe(67);
    expect(withoutTransit.sub_signals.transit_time.status).toBe('unavailable');
    // The absent transit signal is removed from the denominator, not scored as zero.
    expect(withoutTransit.score).toBe(100);
  });
});
