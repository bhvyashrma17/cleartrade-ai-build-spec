import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { countryTruthStage, projectCountryTruthAssessment } from '@/lib/country-truth-ui';

/**
 * This file used to assert the pilot Country Analysis surface: a three-country checkbox list
 * that posted Germany/UAE/USA by NAME. Phase 1I retired that surface, so the tests that pinned
 * it now pin its replacement — and, crucially, pin that the pilot behaviour cannot come back.
 * The projection and stage-label assertions are unchanged and still cover the same code.
 */

const component = readFileSync('src/components/agent/CountryTruthWork.tsx', 'utf8');
const page = readFileSync('src/app/agent/exporters/[exporterOrgId]/page.tsx', 'utf8');
const jobRoute = readFileSync('src/app/api/v1/jobs/[jobId]/route.ts', 'utf8');
const uiModule = readFileSync('src/lib/country-truth-ui.ts', 'utf8');

describe('Agent Country Truth surface', () => {
  test('the three-country pilot picker is gone and cannot be reintroduced', () => {
    // The constant, the component and the alias-based request path are all removed.
    expect(uiModule).not.toContain('COUNTRY_TRUTH_PILOT_COUNTRIES');
    expect(() => readFileSync('src/components/agent/CountryAnalysis.tsx', 'utf8')).toThrow();
    expect(page).not.toContain('CountryAnalysis');
    // No country list is posted, and there is no control that CHOOSES markets. The surface does
    // carry a "show backlog" checkbox and market/task filters after the Demand Discovery UI
    // overhaul — those narrow what is displayed and cannot change which markets are analysed —
    // so this asserts the absence of a market PICKER, not the absence of every input.
    expect(component).not.toContain('candidate_countries');
    expect(component).not.toContain('setCountries');
    expect(component).not.toMatch(/countries\s*:\s*\[/);
  });

  test('deep analysis is requested by naming a completed screening run, never a country set', () => {
    expect(component).toContain('/deep-country-truth');
    expect(component).toContain('screening_run_id: view.screening.screening_run_id');
    expect(component).toContain('product_id: view.product.id');
    // The request carries a product and a run, and nothing describing which markets to analyse.
    expect(component).toContain('no country list');
  });

  test('only ClearTrade-owned work reaches the agent queue', () => {
    // The headline is now a prioritised count ("N need attention") rather than a raw total of
    // every action across every market; the ownership filter it depends on is unchanged.
    expect(component).toContain('WorkSummaryPanel');
    // The filter lives in the service; the component renders what it is given.
    const service = readFileSync('src/lib/country-discovery/service.ts', 'utf8');
    expect(service).toContain("if (action.owner !== 'cleartrade') continue;");
  });

  test('maps queued and worker progress to the six Agent-facing stages', () => {
    expect(countryTruthStage('queued', null)).toBe('Preparing analysis');
    expect(countryTruthStage('processing', 'acquiring_evidence')).toBe('Gathering trade data');
    expect(countryTruthStage('processing', 'building_manifest')).toBe('Verifying evidence');
    expect(countryTruthStage('processing', 'calculating_metrics')).toBe('Calculating market metrics');
    expect(countryTruthStage('processing', 'scoring')).toBe('Ranking markets');
    expect(countryTruthStage('completed', 'completed')).toBe('Complete');
  });

  test('projects partial and not-rankable v4 assessments without forcing a score', () => {
    const projected = projectCountryTruthAssessment({
      country_code: 'DE', overall_score: 73, confidence_score: 42,
      country_truth_assessment_state: 'not_rankable', rationale: 'Deterministic rationale.',
      country_trade_metrics: { metrics_payload: { metrics: {
        market_size: { value: 10_000_000, status: 'complete', unit: 'provider_trade_value_usd' },
        cagr: { value: null, status: 'partial', unit: 'percent', exclusion_reason: 'Series incomplete.' },
        india_market_share: { value: 2.5, status: 'complete', unit: 'percent' },
        supplier_hhi: { value: 0.31, status: 'complete', unit: 'index_0_1' },
      } } },
    });
    expect(projected).toMatchObject({ country: 'Germany', score: null, confidence: 42, status: 'not_rankable', market_size: { value: 10_000_000 }, growth: { value: null, status: 'partial' }, india_share: { value: 2.5 }, competition_hhi: { value: 0.31 }, rationale: 'Deterministic rationale.' });
  });

  test('country names come from the reporter registry, not a three-entry pilot table', () => {
    // The pilot mapped exactly DE/AE/US and rendered every other market as a bare ISO code.
    const projected = (code: string) => projectCountryTruthAssessment({
      country_code: code, overall_score: 50, confidence_score: 50,
      country_truth_assessment_state: 'rankable', rationale: null, country_trade_metrics: null,
    }).country;
    expect(projected('DE')).toBe('Germany');
    // A market the pilot table never knew about must still be named.
    expect(projected('VN')).not.toBe('VN');
    expect(projected('BR')).not.toBe('BR');
  });

  test('reads dedicated v4 assessments and never the legacy discovery warehouse path', () => {
    expect(jobRoute).toContain("model_version: 'market-attractiveness-v4'");
    expect(jobRoute).toContain('country_trade_metrics');
    expect(jobRoute).toContain('projectCountryTruthAssessment');
    expect(jobRoute).not.toMatch(/TradeFlow|WarehouseDiscovery|warehouse-engine/);
  });
});
