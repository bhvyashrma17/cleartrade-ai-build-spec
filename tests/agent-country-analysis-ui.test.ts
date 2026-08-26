import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { COUNTRY_TRUTH_PILOT_COUNTRIES, countryTruthStage, projectCountryTruthAssessment } from '@/lib/country-truth-ui';

const component = readFileSync('src/components/agent/CountryAnalysis.tsx', 'utf8');
const page = readFileSync('src/app/agent/exporters/[exporterOrgId]/page.tsx', 'utf8');
const jobRoute = readFileSync('src/app/api/v1/jobs/[jobId]/route.ts', 'utf8');

describe('Agent Country Analysis UI', () => {
  test('confirmed products can start while unconfirmed products show a blocker', () => {
    expect(page).toContain("product.hs_classification_status === 'confirmed'");
    expect(page).toContain("confirmed.revision === product.hs_classification_revision");
    expect(component).toContain('disabled={!canSubmit}');
    expect(component).toContain('Analysis blocked.');
    expect(component).toContain('Confirm a valid HS 2022 or ITC-HS classification');
  });

  test('sends only Germany, UAE, and USA names in the requested payload', () => {
    expect(COUNTRY_TRUTH_PILOT_COUNTRIES.map(country => country.name)).toEqual(['Germany', 'UAE', 'USA']);
    expect(component).toContain('{ product_id: productId, candidate_countries: countries }');
    expect(component).not.toMatch(/reporter.?code/i);
    expect(component).not.toMatch(/\b276\b|\b784\b|\b842\b/);
  });

  test('maps queued and worker progress to the six Agent-facing stages', () => {
    expect(countryTruthStage('queued', null)).toBe('Preparing analysis');
    expect(countryTruthStage('processing', 'acquiring_evidence')).toBe('Gathering trade data');
    expect(countryTruthStage('processing', 'building_manifest')).toBe('Verifying evidence');
    expect(countryTruthStage('processing', 'calculating_metrics')).toBe('Calculating market metrics');
    expect(countryTruthStage('processing', 'scoring')).toBe('Ranking markets');
    expect(countryTruthStage('completed', 'completed')).toBe('Complete');
  });

  test('prevents pending duplicates and respects a reused active job', () => {
    expect(component).toContain("!submitting && (!job || terminal)");
    expect(component).toContain('An active analysis already exists. Monitoring that run now.');
    expect(component).toContain('await poll(response.data.job_id)');
  });

  test('keeps failed jobs actionable with retry', () => {
    expect(component).toContain("job?.status === 'failed'");
    expect(component).toContain('Retry analysis');
    expect(component).toContain('completed evidence may be reused');
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
    expect(component).toContain("result.status === 'partial' ? 'Partial evidence' : 'Not rankable'");
    expect(component).toContain("result.score == null ? 'No score'");
  });

  test('reads dedicated v4 assessments and never the legacy discovery warehouse path', () => {
    expect(jobRoute).toContain("model_version: 'market-attractiveness-v4'");
    expect(jobRoute).toContain('country_trade_metrics');
    expect(jobRoute).toContain('projectCountryTruthAssessment');
    expect(jobRoute).not.toMatch(/TradeFlow|WarehouseDiscovery|warehouse-engine/);
    expect(component).not.toMatch(/TradeFlow|WarehouseDiscovery|manifest|policy.hash|raw job payload/i);
  });
});
