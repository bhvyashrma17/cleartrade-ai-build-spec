import { describe, expect, test } from 'vitest';
import {
  concentrationLabel,
  projectMarketDetail,
  projectPillars,
  rankMarkets,
  type AssessmentRecord,
} from '@/lib/country-discovery/market-view';
import { percent, periodRange, sharePercent, shortDate, signedPercent, usdCompact } from '@/lib/country-discovery/format';
import { countryName, knownCountryCount } from '@/lib/country-discovery/country-names';
import { explainMarket, summariseMarket } from '@/lib/country-discovery/explanations';

/**
 * Phase 1I product-semantics pass.
 *
 * These are adversarial: each test is a specific way a plausible-looking UI would have told the
 * exporter something the evidence does not support. The projection layer computes no scores, so
 * what is being defended here is meaning, not arithmetic.
 */

/** The real shape scoring-v4 writes, taken from the live DE assessment on staging. */
function assessment(over: Partial<AssessmentRecord> = {}): AssessmentRecord {
  return {
    id: 'assessment-de',
    country_code: 'DE',
    overall_score: 76,
    confidence_score: 48,
    country_truth_assessment_state: 'rankable',
    country_truth_period_set: [2021, 2022, 2023, 2024, 2025],
    country_truth_as_of_date: new Date('2026-08-27T00:00:00Z'),
    generated_at: new Date('2026-08-31T04:17:45Z'),
    rationale: "DE's recorded 100630 import market was 511317180.09 in 2025.",
    field_provenance: {
      demand_score: { score: 74, available: true, confidence: 100, base_weight: 25, effective_weight: 0.5, exclusion_reason: null },
      growth_score: { score: 82, available: true, confidence: 100, base_weight: 10, effective_weight: 0.2, exclusion_reason: null },
      competition_score: { score: 68, available: true, confidence: 100, base_weight: 10, effective_weight: 0.2, exclusion_reason: null },
      risk_resilience: { score: 87, available: true, confidence: 60, base_weight: 5, effective_weight: 0.1, exclusion_reason: null },
      market_access: { score: null, available: false, confidence: 0, base_weight: 10, effective_weight: 0, exclusion_reason: 'tariff: A current authoritative India-preference applicability determination is unavailable.' },
      export_economics: { score: null, available: false, confidence: 0, base_weight: 15, effective_weight: 0, exclusion_reason: 'No sufficient sourced export-economics input.' },
      exporter_market_fit: { score: null, available: false, confidence: 0, base_weight: 15, effective_weight: 0, exclusion_reason: 'insufficient_exporter_data' },
      logistics_feasibility: { score: null, available: false, confidence: 0, base_weight: 10, effective_weight: 0, exclusion_reason: 'No current explicit route-availability evidence exists.' },
    },
    is_selected: false,
    saved_at: null,
    country_trade_metrics: {
      metrics_payload: {
        metrics: {
          market_size: { value: 511317180.09, status: 'complete', unit: 'provider_trade_value_usd' },
          cagr: { value: 10.734514179614, status: 'complete', unit: 'percent' },
          india_market_share: { value: 12.4, status: 'complete', unit: 'percent' },
          supplier_hhi: { value: 0.11, status: 'complete', unit: 'index_0_1' },
        },
      },
    },
    ...over,
  };
}

describe('exporter-facing formatting', () => {
  test('rounds for display without ever implying precision the statistic lacks', () => {
    expect(usdCompact(511_317_180.09)).toBe('$511M');
    expect(usdCompact(1_400_000_000)).toBe('$1.4B');
    expect(usdCompact(950_000)).toBe('$950K');
    expect(percent(10.734514179614)).toBe('10.7%');
    // Direction is never dropped: a contraction must not read as growth.
    expect(signedPercent(10.73)).toBe('+10.7%');
    expect(signedPercent(-4.2)).toBe('-4.2%');
    expect(periodRange([2021, 2022, 2023, 2024, 2025])).toBe('2021–2025');
    expect(shortDate(new Date('2026-08-31T04:17:45Z'))).toBe('31 Aug 2026');
  });

  test('a missing value formats as null, never as zero', () => {
    for (const formatter of [usdCompact, percent, signedPercent, sharePercent]) {
      expect(formatter(null)).toBeNull();
      expect(formatter(undefined)).toBeNull();
      expect(formatter(Number.NaN)).toBeNull();
    }
    expect(shortDate(null)).toBeNull();
    expect(periodRange([])).toBeNull();
  });

  test('a share outside 0–100 is refused rather than rescaled into a plausible number', () => {
    // A 0.75 fraction silently multiplied by 100 becomes a 75% claim nobody made.
    expect(sharePercent(0.75)).toBe('0.8%');
    expect(sharePercent(120)).toBeNull();
    expect(sharePercent(-1)).toBeNull();
  });

  test('every screened market can be named, not just the three pilot countries', () => {
    expect(countryName('DE')).toBe('Germany');
    expect(countryName('VN')).not.toBe('VN');
    // An unknown code shows as itself rather than as a guess.
    expect(countryName('ZZ')).toBe('ZZ');
    expect(knownCountryCount()).toBeGreaterThan(150);
  });
});

describe('pillar projection', () => {
  test('an unavailable pillar is null with a reason, and is never rendered as zero', () => {
    const pillars = projectPillars(assessment().field_provenance);
    const marketAccess = pillars.find((pillar) => pillar.key === 'market_access')!;
    expect(marketAccess.score).toBeNull();
    expect(marketAccess.state).toBe('not_established');
    expect(marketAccess.score).not.toBe(0);
    // The engineering reason is translated, not echoed at the exporter.
    expect(marketAccess.not_established_because).toMatch(/import duty that applies to Indian goods/i);
    expect(marketAccess.raw_exclusion_reason).toContain('India-preference applicability');

    // Both authorities' wordings must translate. Staging UAT caught the US phrasing reaching the
    // screen as raw engineering prose because the pattern only matched the UK's.
    const usPhrasing = projectPillars({
      market_access: { score: null, available: false, exclusion_reason: 'tariff: India preference applicability is unknown; ordinary duty cannot be assumed.' },
    }).find((pillar) => pillar.key === 'market_access')!;
    expect(usPhrasing.not_established_because).toMatch(/import duty that applies to Indian goods/i);
    expect(usPhrasing.not_established_because).not.toMatch(/ordinary duty cannot be assumed/);

    const fit = pillars.find((pillar) => pillar.key === 'exporter_market_fit')!;
    expect(fit.not_established_because).toMatch(/product details are needed/i);
    expect(fit.not_established_because).not.toContain('insufficient_exporter_data');
  });

  test('both scoring-v4 key spellings are read, so no pillar silently reads as absent', () => {
    // v4 writes `demand_score` but bare `market_access`. A projection that only knew one
    // spelling would show four of the eight pillars as permanently unassessed.
    const pillars = projectPillars(assessment().field_provenance);
    expect(pillars.filter((pillar) => pillar.state === 'available').map((pillar) => pillar.key).sort())
      .toEqual(['competition_score', 'demand_score', 'growth_score', 'risk_resilience']);
    expect(pillars).toHaveLength(8);
  });

  test('a stale score with available:false stays unavailable', () => {
    const pillars = projectPillars({
      market_access: { score: 55, available: false, confidence: 0, exclusion_reason: 'superseded' },
    });
    const marketAccess = pillars.find((pillar) => pillar.key === 'market_access')!;
    expect(marketAccess.score).toBeNull();
    expect(marketAccess.state).toBe('not_established');
  });

  test('a legacy assessment with no provenance degrades to unassessed rather than throwing', () => {
    const pillars = projectPillars(null);
    expect(pillars).toHaveLength(8);
    expect(pillars.every((pillar) => pillar.state === 'not_established')).toBe(true);
  });
});

describe('market projection', () => {
  test('attractiveness and evidence confidence stay separate quantities', () => {
    const view = projectMarketDetail(assessment(), 1);
    expect(view.attractiveness).toBe(76);
    expect(view.evidence_confidence).toBe(48);
    // Nothing blends them into a single "quality" figure.
    expect(Object.values(view)).not.toContain(62);
  });

  test('a not_rankable assessment shows no score rather than its stored number', () => {
    const view = projectMarketDetail(assessment({ country_truth_assessment_state: 'not_rankable' }), 3);
    expect(view.attractiveness).toBeNull();
    expect(view.rankable).toBe(false);
  });

  test('a metric under a non-complete status is not published as a result', () => {
    const view = projectMarketDetail(assessment({
      country_trade_metrics: { metrics_payload: { metrics: { cagr: { value: 4.2, status: 'partial' } } } },
    }), 1);
    expect(view.growth.state).toBe('not_established');
    expect(view.growth.raw).toBeNull();
  });

  test('HHI is labelled as concentration, never rendered as a percentage share', () => {
    expect(concentrationLabel(0.11)).toBe('Diversified');
    expect(concentrationLabel(0.20)).toBe('Moderately concentrated');
    expect(concentrationLabel(0.31)).toBe('Highly concentrated');
    const view = projectMarketDetail(assessment(), 1);
    expect(view.supplier_concentration.display).toBe('Diversified (HHI 0.11)');
    // `0.11` must never surface as "11%", which reads as a share of the market.
    expect(view.supplier_concentration.display).not.toContain('11%');
  });

  test('trade period and analysis date are separate fields', () => {
    const view = projectMarketDetail(assessment(), 1);
    expect(view.trade_periods).toBe('2021–2025');
    expect(view.generated_at).toBe('2026-08-31T04:17:45.000Z');
    expect(view.as_of_date).toBe('2026-08-27T00:00:00.000Z');
  });

  test('ranking is total and stable, and unrankable markets sort last without being dropped', () => {
    const rows = [
      assessment({ id: 'a', country_code: 'AA', overall_score: 60, confidence_score: 40 }),
      assessment({ id: 'b', country_code: 'BB', overall_score: null, country_truth_assessment_state: 'not_rankable' }),
      assessment({ id: 'c', country_code: 'CC', overall_score: 60, confidence_score: 70 }),
      assessment({ id: 'd', country_code: 'DD', overall_score: 90, confidence_score: 10 }),
    ];
    expect(rankMarkets(rows).map((row) => row.country_code)).toEqual(['DD', 'CC', 'AA', 'BB']);
    // Stable across permutations of the input.
    expect(rankMarkets([...rows].reverse()).map((row) => row.country_code)).toEqual(['DD', 'CC', 'AA', 'BB']);
  });
});

describe('deterministic explanations', () => {
  test('growth is stated as history with its window, never as a forecast', () => {
    const explanations = explainMarket(projectMarketDetail(assessment(), 1));
    const growth = explanations.find((entry) => entry.code === 'imports_grew')!;
    expect(growth.headline).toBe('Imports grew +10.7% a year over 2021–2025');
    const prose = `${growth.headline} ${growth.detail}`;
    expect(prose).toMatch(/not a forecast/i);
    expect(prose).not.toMatch(/\bwill grow\b|\bexpected to\b|\bprojected\b|\bforecast to\b/i);
  });

  test('a high Indian share produces BOTH the signal and the caution', () => {
    const view = projectMarketDetail(assessment({
      country_trade_metrics: { metrics_payload: { metrics: { india_market_share: { value: 76.2, status: 'complete' } } } },
    }), 1);
    const explanations = explainMarket(view);
    expect(explanations.find((entry) => entry.code === 'india_proven_access')).toBeTruthy();
    const caution = explanations.find((entry) => entry.code === 'india_share_crowded')!;
    // The naive product says "India is strong here!" and stops. Both readings are true.
    expect(caution.kind).toBe('caution');
    expect(caution.detail).toMatch(/less room left|not automatically an advantage/i);
  });

  test('a thin Indian share is not asserted to be headroom', () => {
    const view = projectMarketDetail(assessment({
      country_trade_metrics: { metrics_payload: { metrics: { india_market_share: { value: 0.4, status: 'complete' } } } },
    }), 1);
    const thin = explainMarket(view).find((entry) => entry.code === 'india_share_thin')!;
    expect(thin.kind).toBe('caution');
    expect(thin.detail).toMatch(/or it can mean a barrier/i);
  });

  test('an unassessed pillar is a gap, never described as a weakness', () => {
    const explanations = explainMarket(projectMarketDetail(assessment(), 1));
    const gaps = explanations.filter((entry) => entry.kind === 'gap');
    expect(gaps).toHaveLength(4);
    for (const gap of gaps) {
      expect(gap.headline).toMatch(/has not been assessed yet/);
      expect(`${gap.headline} ${gap.detail}`).not.toMatch(/\bpoor\b|\bweak\b|\bbad\b|\bunsuitable\b/i);
    }
  });

  test('no duty is ever stated while the tariff line is unconfirmed', () => {
    const explanations = explainMarket(projectMarketDetail(assessment(), 1));
    const prose = explanations.map((entry) => `${entry.headline} ${entry.detail}`).join(' ');
    expect(prose).not.toMatch(/duty of|import duty is|tariff rate is|you will pay/i);
  });

  test('no explanation quotes a unit value as an achievable selling price', () => {
    const explanations = explainMarket(projectMarketDetail(assessment(), 1));
    const prose = explanations.map((entry) => `${entry.headline} ${entry.detail}`).join(' ');
    expect(prose).not.toMatch(/per kg|price you can|sell(ing)? (at|for)|achievable price/i);
  });

  test('the card summary never contradicts the detail page', () => {
    const view = projectMarketDetail(assessment(), 1);
    const summary = summariseMarket(view);
    const explanations = explainMarket(view);
    expect(explanations.some((entry) => entry.headline === summary.stands_out)).toBe(true);
    // With four unassessed pillars and no caution-worthy metric, the improvement line counts gaps.
    expect(summary.can_improve).toBeTruthy();
  });

  test('a market with nothing established makes no claims at all', () => {
    const view = projectMarketDetail(assessment({
      country_trade_metrics: { metrics_payload: { metrics: {} } },
      field_provenance: null,
    }), 9);
    const summary = summariseMarket(view);
    expect(summary.stands_out).toBeNull();
    expect(explainMarket(view).every((entry) => entry.kind === 'gap')).toBe(true);
  });
});
