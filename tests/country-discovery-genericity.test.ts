import { Prisma } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { deriveRefinementQuestions, narrowCandidates, type CandidateLine } from '@/lib/market-access/classification-refinement';
import { normalizeOperationalCost, type CostNormalizationBasis, type OperationalCostRow } from '@/lib/country-truth/operational-evidence';
import { assessProductReadiness } from '@/lib/country-discovery/readiness';
import { projectMarketDetail, type AssessmentRecord } from '@/lib/country-discovery/market-view';
import { explainMarket } from '@/lib/country-discovery/explanations';

/**
 * Phase 1 genericity audit.
 *
 * Phase 1 was validated almost entirely on Basmati rice, and rice is an unusually convenient
 * product: it is sold by weight, its tariff lines differ on words a farmer can answer, and its
 * HS chapter is rich in exactly the distinctions the questionnaire understood. These tests
 * exercise the same pipeline with three deliberately un-rice-like archetypes — knotted carpets,
 * lead-crystal glassware and copper/brass tableware — to prove the architecture is generic and
 * not accidentally shaped around one commodity.
 *
 * The distinction being defended: a policy that is *intentionally* limited to an HS chapter is
 * correct and must be preserved; a generic pipeline that silently only works for rice is a bug.
 */

const line = (code: string, description: string, path: string[] = []): CandidateLine => ({
  national_tariff_code: code, description, description_path: path,
  duty_expression: '5.0%', duty_kind: 'ad_valorem',
});

/** Real CN/HS shapes. Descriptions are the nomenclature's own words, not invented ones. */
const ARCHETYPES: Record<string, CandidateLine[]> = {
  // Bhadohi carpets — HS 5701/5702.
  carpets: [
    line('57011000', 'Of wool or fine animal hair', ['Carpets, knotted', 'Hand-knotted']),
    line('57019010', 'Of silk, of waste silk', ['Carpets, knotted']),
    line('57024200', 'Of man-made textile materials', ['Carpets, woven', 'Machine-woven, of pile construction']),
  ],
  // Firozabad glassware — HS 7013.
  glassware: [
    line('70132200', 'Of lead crystal', ['Drinking glasses', 'Stemware']),
    line('70132800', 'Other', ['Drinking glasses', 'Stemware']),
    line('70134110', 'Of lead crystal, hand-gathered', ['Glassware for table or kitchen purposes']),
  ],
  // Moradabad brassware — HS 7418/8306.
  brassware: [
    line('74181010', 'Of copper, hand-made', ['Table, kitchen or other household articles of copper']),
    line('74181090', 'Other', ['Table, kitchen or other household articles of copper']),
    line('83062100', 'Plated with precious metal', ['Statuettes and other ornaments']),
  ],
};

describe('classification refinement is not rice-specific', () => {
  test.each(Object.keys(ARCHETYPES))('%s produces answerable questions, not silence', (archetype) => {
    // Before the Phase 1 audit this returned [] for all three: a carpet exporter facing a real
    // multi-candidate classification was asked nothing and had no route forward.
    const questions = deriveRefinementQuestions(ARCHETYPES[archetype]!);
    expect(questions.length).toBeGreaterThan(0);
    for (const question of questions) {
      // A question a manufacturer can actually answer about their own goods.
      expect(question.question).toMatch(/\?$/);
      expect(question.options).toHaveLength(2);
      // Every question must genuinely split the set, or it teaches the exporter nothing.
      expect(question.options[0]!.keeps_codes.length).toBeGreaterThan(0);
      expect(question.options[1]!.keeps_codes.length).toBeGreaterThan(0);
    }
  });

  test('no rice vocabulary is put to a carpet, glass or metal exporter', () => {
    for (const candidates of Object.values(ARCHETYPES)) {
      const asked = deriveRefinementQuestions(candidates).map((question) => question.question).join(' ');
      expect(asked).not.toMatch(/rice|parboiled|basmati|grain|milled|husked/i);
    }
  });

  test('cereal-specific signals stay available for cereals', () => {
    // The chapter-specific family is an intentional domain policy and must not have been
    // deleted in the name of genericity.
    const rice = [
      line('1006302110', 'In immediate packings of a net content not exceeding 5 kg', ['Semi-milled rice', 'Parboiled', 'Round grain']),
      line('1006302712', 'Basmati rice', ['Semi-milled rice', 'Parboiled', 'Long grain', 'Aromatic rice']),
      line('1006309692', 'Other', ['Wholly milled rice', 'Long grain']),
    ];
    const attributes = deriveRefinementQuestions(rice).map((question) => question.attribute);
    expect(attributes).toContain('basmati');
    expect(attributes).toContain('parboiled');
  });

  test('answers narrow a non-rice set exactly as they narrow rice', () => {
    const narrowed = narrowCandidates(ARCHETYPES.carpets!, { material_wool: 'yes' });
    expect(narrowed.remaining).toHaveLength(1);
    expect(narrowed.remaining[0]!.national_tariff_code).toBe('57011000');
    expect(narrowed.applied).toEqual([expect.objectContaining({ attribute: 'material_wool' })]);
  });

  test('a signal only fires when the authority itself makes the distinction', () => {
    // Every candidate is lead crystal, so "is it lead crystal?" separates nothing and is not
    // asked. This is what stops the engine inventing a distinction the source did not make.
    const allCrystal = [
      line('70132210', 'Of lead crystal, cut', ['Drinking glasses']),
      line('70132290', 'Of lead crystal, other', ['Drinking glasses']),
    ];
    expect(deriveRefinementQuestions(allCrystal).map((entry) => entry.attribute)).not.toContain('lead_crystal');
  });
});

describe('operational economics is unit-generic', () => {
  const basis = (over: Partial<CostNormalizationBasis> = {}): CostNormalizationBasis => ({
    shipment_quantity: 500, quantity_unit: 'piece', containers_per_shipment: 1, equipment_code: null,
    goods_value_per_unit: 40, goods_value_currency: 'USD', supported_percent_bases: ['invoice_value'],
    ...over,
  });
  const row = (over: Partial<OperationalCostRow> = {}): OperationalCostRow => ({
    id: 'row-1', exporter_org_id: 'org', product_id: 'product', destination_country: 'DE',
    hs6_code: '701322', hs_revision: 'HS2022', quote_type: 'cha', amount: 1000, currency: 'USD',
    rate_basis: 'per_shipment', quantity_unit: null, percent_of_value: null, percent_basis: null,
    cost_owner: 'exporter', route_evidence_id: null, transport_mode: null, equipment_code: null,
    observed_at: new Date('2026-08-20T00:00:00Z'), effective_from: new Date('2026-08-20T00:00:00Z'),
    valid_until: new Date('2026-09-30T00:00:00Z'), assertion_class: 'partner_quote',
    evidence_origin: 'manually_entered_real', source: 'Partner', source_reference: 'Q-1',
    confidence: 1, status: 'verified', superseded_at: null, component: 'origin_charges',
    ...over,
  });

  test('a per-shipment cost normalizes onto pieces exactly as it does onto kilograms', () => {
    expect(normalizeOperationalCost(row(), basis())).toMatchObject({ status: 'normalized', amount_per_unit: 2, quantity_unit: 'piece' });
    expect(normalizeOperationalCost(row(), basis({ quantity_unit: 'kg', shipment_quantity: 20_000 })))
      .toMatchObject({ status: 'normalized', amount_per_unit: 0.05, quantity_unit: 'kg' });
    // Carpets are commercially quoted per square metre.
    expect(normalizeOperationalCost(row(), basis({ quantity_unit: 'm²', shipment_quantity: 250 })))
      .toMatchObject({ status: 'normalized', amount_per_unit: 4, quantity_unit: 'm²' });
  });

  test('incompatible units are refused, never silently converted', () => {
    // The dangerous version of this function multiplies by 1000 and produces a landed cost that
    // is off by three orders of magnitude while looking entirely plausible.
    const tonneQuote = row({ rate_basis: 'per_unit', quantity_unit: 'tonne', amount: 90 });
    expect(normalizeOperationalCost(tonneQuote, basis({ quantity_unit: 'kg', shipment_quantity: 20_000 })))
      .toMatchObject({ status: 'not_normalizable', reason: 'per_unit_quote_is_in_tonne_but_economics_is_in_kg' });

    const pieceQuote = row({ rate_basis: 'per_unit', quantity_unit: 'piece', amount: 3 });
    expect(normalizeOperationalCost(pieceQuote, basis({ quantity_unit: 'm²', shipment_quantity: 250 })))
      .toMatchObject({ status: 'not_normalizable', reason: 'per_unit_quote_is_in_piece_but_economics_is_in_m²' });
  });

  test('a per-shipment quote counting a different unit from the economics basis is refused', () => {
    const quote = row({ rate_basis: 'per_shipment', quantity_unit: 'kg' });
    expect(normalizeOperationalCost(quote, basis({ quantity_unit: 'piece' })))
      .toMatchObject({ status: 'not_normalizable' });
  });

  test('a per-container quote still needs a container count, whatever the unit', () => {
    const quote = row({ rate_basis: 'per_container', amount: 1800, quote_type: 'international_freight' });
    expect(normalizeOperationalCost(quote, basis({ containers_per_shipment: null })))
      .toMatchObject({ status: 'not_normalizable', reason: 'per_container_quote_needs_a_declared_container_count' });
    expect(normalizeOperationalCost(quote, basis({ containers_per_shipment: 2 })))
      .toMatchObject({ status: 'normalized', amount_per_unit: (1800 * 2) / 500 });
  });

  test('with no declared commercial basis nothing normalizes at all', () => {
    expect(normalizeOperationalCost(row(), basis({ quantity_unit: null })))
      .toMatchObject({ status: 'not_normalizable', reason: 'no_frozen_quantity_unit_to_normalize_onto' });
  });
});

describe('readiness and explanations carry no commodity assumption', () => {
  const decimal = (value: number) => new Prisma.Decimal(value);
  const product = (over: Record<string, unknown> = {}) => ({
    price_target_amount: null, price_target_currency: null, price_target_quantity_unit: null, price_target_incoterm: null,
    capacity_value: null, capacity_unit: null, moq_value: null, moq_unit: null, lead_time_days: null,
    packaging_format: null, shipment_quantity_value: null, shipment_quantity_unit: null, origin_gateway_code: null,
    ...over,
  }) as Parameters<typeof assessProductReadiness>[0];

  test('readiness never mentions a commodity, a unit or a certificate type', () => {
    const readiness = assessProductReadiness(product(), { hs6_code: '570110', status: 'confirmed' } as never);
    const prose = readiness.requirements.map((entry) => `${entry.label} ${entry.why}`).join(' ');
    // \b on both sides: "price" and "packaging" legitimately contain "rice"/"kg"-like runs.
    expect(prose).not.toMatch(/\brice\b|\bgrain\b|\bkg\b|\bkilograms?\b|\bphytosanitary\b|\bjute\b|\bfood\b|\bagricultur\w*\b/i);
    expect(readiness.can_discover).toBe(true);
  });

  test('a price declared in square metres satisfies readiness the same as one in kilograms', () => {
    for (const unit of ['kg', 'piece', 'm²']) {
      const readiness = assessProductReadiness(
        product({ price_target_amount: decimal(40), price_target_currency: 'USD', price_target_quantity_unit: unit, price_target_incoterm: 'FOB' }),
        { hs6_code: '570110', status: 'confirmed' } as never,
      );
      expect(readiness.requirements.find((entry) => entry.code === 'export_price')!.satisfied).toBe(true);
    }
  });

  test('market explanations describe any product category without naming one', () => {
    const assessment: AssessmentRecord = {
      id: 'a', country_code: 'DE', overall_score: 70, confidence_score: 48,
      country_truth_assessment_state: 'rankable', country_truth_period_set: [2021, 2025],
      country_truth_as_of_date: null, generated_at: new Date('2026-08-31T00:00:00Z'),
      rationale: null, field_provenance: null, is_selected: false, saved_at: null,
      country_trade_metrics: { metrics_payload: { metrics: {
        market_size: { value: 250_000_000, status: 'complete' },
        cagr: { value: 7.5, status: 'complete' },
        india_market_share: { value: 30, status: 'complete' },
        supplier_hhi: { value: 0.12, status: 'complete' },
      } } },
    };
    const prose = explainMarket(projectMarketDetail(assessment, 1)).map((entry) => `${entry.headline} ${entry.detail}`).join(' ');
    expect(prose).not.toMatch(/\brice\b|\bgrain\b|\btonnes?\b|\bkilograms?\b|\bkg\b|\bphytosanitary\b|\bharvest\b|\bcrops?\b/i);
    // It still says something substantive about the market.
    expect(prose).toMatch(/imported each year|grew/i);
  });
});
