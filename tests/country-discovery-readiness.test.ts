import { Prisma } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { assessProductReadiness } from '@/lib/country-discovery/readiness';
import { buildImprovementPlan } from '@/lib/country-discovery/improve';
import { projectPillars } from '@/lib/country-discovery/market-view';

const decimal = (value: number) => new Prisma.Decimal(value);

function product(over: Record<string, unknown> = {}) {
  return {
    price_target_amount: null, price_target_currency: null, price_target_quantity_unit: null, price_target_incoterm: null,
    capacity_value: null, capacity_unit: null, moq_value: null, moq_unit: null, lead_time_days: null,
    packaging_format: null, shipment_quantity_value: null, shipment_quantity_unit: null, origin_gateway_code: null,
    ...over,
  } as Parameters<typeof assessProductReadiness>[0];
}

const confirmed = { hs6_code: '100630', status: 'confirmed' } as Parameters<typeof assessProductReadiness>[1];

describe('product readiness for discovery', () => {
  test('a confirmed classification alone is enough to discover markets', () => {
    // The whole point: demand, growth and competition come from destination trade statistics
    // and the HS6. Gating discovery on commercial facts would refuse to answer a question we
    // can answer, and is the fastest way to lose an SME exporter at the first screen.
    const readiness = assessProductReadiness(product(), confirmed);
    expect(readiness.can_discover).toBe(true);
    expect(readiness.blocked_because).toBeNull();
    expect(readiness.missing_now).toBeGreaterThan(0);
  });

  test('only a missing classification blocks, and it says which of the two problems it is', () => {
    const none = assessProductReadiness(product(), null);
    expect(none.can_discover).toBe(false);
    expect(none.blocked_because).toMatch(/does not have an HS classification/);

    const pending = assessProductReadiness(product(), { hs6_code: '100630', status: 'proposed' } as never);
    expect(pending.can_discover).toBe(false);
    expect(pending.blocked_because).toMatch(/still being confirmed/);
  });

  test('the classification is ClearTrade-owned; the commercial facts are the exporter’s', () => {
    const readiness = assessProductReadiness(product(), confirmed);
    const byCode = Object.fromEntries(readiness.requirements.map((entry) => [entry.code, entry]));
    expect(byCode.hs_classification!.owner).toBe('cleartrade');
    expect(byCode.hs_classification!.level).toBe('blocking');
    for (const code of ['export_price', 'capacity', 'moq', 'packaging', 'lead_time', 'shipment_size', 'origin_gateway']) {
      expect(byCode[code]!.owner).toBe('exporter');
      expect(byCode[code]!.level).not.toBe('blocking');
    }
  });

  test('a price needs all four of its parts before it counts as on file', () => {
    // A currency with no quantity unit prices nothing; treating it as present would let a
    // half-declared offer flow into an economics calculation.
    const partial = assessProductReadiness(
      product({ price_target_amount: decimal(1.2), price_target_currency: 'USD' }),
      confirmed,
    );
    expect(partial.requirements.find((entry) => entry.code === 'export_price')!.satisfied).toBe(false);

    const complete = assessProductReadiness(
      product({ price_target_amount: decimal(1.2), price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB' }),
      confirmed,
    );
    expect(complete.requirements.find((entry) => entry.code === 'export_price')!.satisfied).toBe(true);
  });

  test('every requirement explains itself without jargon', () => {
    for (const requirement of assessProductReadiness(product(), confirmed).requirements) {
      expect(requirement.why.length).toBeGreaterThan(30);
      expect(requirement.why).not.toMatch(/manifest|fact snapshot|policy hash|HHI|CAGR|provenance|assertion class/i);
    }
  });
});

describe('improve this analysis', () => {
  const pillars = projectPillars({
    demand_score: { score: 74, available: true, confidence: 100 },
    market_access: { score: null, available: false, exclusion_reason: 'tariff unavailable' },
    export_economics: { score: null, available: false, exclusion_reason: 'No sufficient sourced export-economics input.' },
    exporter_market_fit: { score: null, available: false, exclusion_reason: 'insufficient_exporter_data' },
    logistics_feasibility: { score: null, available: false, exclusion_reason: 'No current explicit route-availability evidence exists.' },
  });

  const plan = (over: Partial<Parameters<typeof buildImprovementPlan>[2]> = {}) =>
    buildImprovementPlan(pillars, 48, {
      product_id: 'product-1', country_code: 'DE', open_classification_questions: 3,
      readiness: assessProductReadiness(product(), confirmed),
      ...over,
    });

  test('the exporter is never asked for anything ClearTrade owns', () => {
    // Each of these is either impossible for an SME to source or something ClearTrade must own
    // for the evidence to mean anything. Asking for them is the tell that a product does not
    // know its own job.
    const exporterWork = plan().actions.filter((action) => action.owner === 'exporter');
    const asked = exporterWork.map((action) => `${action.label} ${action.detail}`).join(' ');
    expect(asked).not.toMatch(/exchange rate|\bFX\b|ClearTrade fee|customs valuation|tariff source|verify|verification/i);
    for (const code of ['confirm_tariff_line', 'collect_cost_quotes', 'verify_certifications', 'establish_route']) {
      expect(plan().actions.find((action) => action.code === code)!.owner).toBe('cleartrade');
    }
  });

  test('exporter-actionable items come first, because they are the only actionable ones', () => {
    const owners = plan().actions.map((action) => action.owner);
    expect(owners.indexOf('cleartrade')).toBeGreaterThan(owners.lastIndexOf('exporter'));
  });

  test('an action is listed once even when it unblocks two pillars', () => {
    const codes = plan().actions.map((action) => action.code);
    expect(new Set(codes).size).toBe(codes.length);
    // A price serves both economics and fit; it is one to-do, not two.
    expect(codes.filter((code) => code === 'add_export_price')).toHaveLength(1);
  });

  test('a fact already on file is not asked for again', () => {
    const satisfied = buildImprovementPlan(pillars, 48, {
      product_id: 'product-1', country_code: 'DE', open_classification_questions: 0,
      readiness: assessProductReadiness(
        product({ price_target_amount: decimal(1.2), price_target_currency: 'USD', price_target_quantity_unit: 'kg', price_target_incoterm: 'FOB' }),
        confirmed,
      ),
    });
    expect(satisfied.actions.find((action) => action.code === 'add_export_price')).toBeUndefined();
    // With no open questions there is no question-answering task either.
    expect(satisfied.actions.find((action) => action.code === 'answer_classification_questions')).toBeUndefined();
  });

  test('exporter actions carry somewhere to go; ClearTrade actions do not pretend to', () => {
    for (const action of plan().actions) {
      if (action.owner === 'exporter') expect(action.href).toMatch(/^\/app\/products\//);
      else expect(action.href).toBeNull();
    }
  });

  test('an analysis with nothing missing produces no busywork', () => {
    const complete = buildImprovementPlan(
      projectPillars({ demand_score: { score: 74, available: true, confidence: 100 } }).filter((pillar) => pillar.key === 'demand_score'),
      100,
      { product_id: 'p', country_code: 'DE', open_classification_questions: 0, readiness: assessProductReadiness(product(), confirmed) },
    );
    expect(complete.actions).toHaveLength(0);
    expect(complete.exporter_actions).toBe(0);
  });
});
