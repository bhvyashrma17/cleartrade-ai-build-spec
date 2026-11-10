import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { V5Results, type V5Row } from '../src/app/app/markets/V5Results';
import { V5Breakdown } from '../src/app/app/markets/[marketAssessmentId]/V5Breakdown';
import { v5Detail, type V5AssessmentFields } from '../src/lib/demand-discovery-v5/detail';
import { projectMarketRow, type AssessmentRecord } from '../src/lib/country-discovery/market-view';
import { v5MarketStatus } from '../src/lib/country-discovery/v5-work';

/**
 * D-044 (policy v9): "all countries should be ranked". On production the basmati run listed Vatican
 * City (93 on 20 of 100 points), Martinique and the Faroe Islands under "Not ranked" beside North
 * Korea. Every market but an excluded one now holds a rank: markets short of data after every fully
 * scored market, each measure without data counting as zero, and markets with no recorded imports
 * last. Runs from before v9 keep their own presentation.
 */
const row = (country: string, overrides: Partial<V5Row>): V5Row => ({
  id: `id-${country}`, country_code: country, overall_score: 85, confidence_score: 82, market_status: 'ranked', rank: 1, live_points: 100, data_year: 2024,
  labels: [], reasons: [], flag_reasons: [], handed_off: true, ...overrides,
});
const render = (rows: V5Row[]) => renderToStaticMarkup(createElement(V5Results, { rows, notes: [], provenanceNote: null }));

describe('the Markets page', () => {
  test('lists every ranked market, the ones short of data last and labelled; only excluded markets stay apart', () => {
    const html = render([
      row('US', {}),
      row('GB', { rank: 2, overall_score: 80 }),
      row('VA', { market_status: 'not_enough_data', rank: 3, overall_score: 19, confidence_score: 0, live_points: 20, handed_off: false, reasons: [{ metric: null, effect: 'status', text: 'Ranked after the fully scored markets: market size and growth have no data, and each measure without data counts as zero.' }] }),
      row('TV', { market_status: 'no_recorded_demand', rank: 4, overall_score: null, confidence_score: 0, live_points: null, handed_off: false, reasons: [{ metric: null, effect: 'status', text: 'No imports of this product were recorded in 2019–2024, so it ranks after every market with imports.' }] }),
      row('KP', { market_status: 'excluded', rank: null, overall_score: null, confidence_score: 0, live_points: null, handed_off: false, reasons: [{ metric: null, effect: 'status', text: 'Excluded: Comprehensive UN Security Council sanctions.' }] }),
    ]);
    expect(html).toContain('4 of 5 markets ranked.');
    expect(html).toContain('The last 2 have too little data for a full score.');
    expect(html).toContain('3. Vatican City');
    expect(html).toContain('20 of 100 points have data');
    expect(html).toContain('Not enough data');
    expect(html).toContain('4. Tuvalu');
    expect(html).toContain('No score');
    expect(html).toContain('No recorded imports');
    expect(html).toContain('Not ranked: 1 excluded');
    expect(html).not.toContain('without enough data');
    expect(html).not.toContain('partial score');
  });

  test('a run from before v9 still lists its unranked markets apart, with their partial scores', () => {
    const html = render([
      row('US', {}),
      row('VA', { market_status: 'not_enough_data', rank: null, overall_score: 93, confidence_score: 0, live_points: 20, handed_off: false }),
      row('KP', { market_status: 'excluded', rank: null, overall_score: null, confidence_score: 0, live_points: null, handed_off: false }),
    ]);
    expect(html).toContain('1 of 3 markets ranked.');
    expect(html).toContain('Not ranked: 1 without enough data, 1 excluded');
    expect(html).toContain('partial score 93/100 on 20 of 100 points');
    expect(html).not.toContain('too little data for a full score');
  });
});

describe('a market’s page and the agent’s views', () => {
  const fields = (overrides: Partial<V5AssessmentFields>): V5AssessmentFields => ({
    model_version: 'market-opportunity-v5', market_status: 'not_enough_data', rank: 216, overall_score: 19, confidence_score: 0, live_points: 20, data_year: 2024,
    labels: [], reasons: [], flag_reasons: [], handed_off: false, as_of_date: new Date('2026-11-10T13:49:00Z'), score_breakdown: { parts: [], metrics: [] }, ...overrides,
  });

  test('the status line says where a ranked-last market stands and why', () => {
    const short = renderToStaticMarkup(createElement(V5Breakdown, { detail: v5Detail(fields({ score_breakdown: { parts: [{ part: 'risk', points: 10, live_points: 10, score: 95 }], metrics: [] } }), 217)! }));
    expect(short).toContain('#216</span> of 217 · 19/100 · confidence 0%');
    expect(short).toContain('each measure without data counts as zero in its score, so it ranks after the fully scored markets');
    expect(short).not.toContain('a gap is never counted as zero');
    expect(short).toContain('Ranked after the fully scored markets: 20 of 100 points have data, and each measure without data counts as zero.');
    const none = renderToStaticMarkup(createElement(V5Breakdown, { detail: v5Detail(fields({ market_status: 'no_recorded_demand', rank: 217, overall_score: null, live_points: null }), 217)! }));
    expect(none).toContain('#217</span> of 217');
    expect(none).toContain('Ranked after every market with recorded imports.');
    expect(none).not.toContain('/100');
    // Before v9: unranked, with its partial score.
    const before = renderToStaticMarkup(createElement(V5Breakdown, { detail: v5Detail(fields({ rank: null, overall_score: 93 }), 214)! }));
    expect(before).toContain('Not ranked — not enough data');
    expect(before).toContain('Partial score 93/100 on 20 of 100 points');
  });

  test('the agent’s table shows a ranked-last market’s score and says why it is last', () => {
    const record = (rank: number | null, score: number) => ({
      id: 'va', country_code: 'VA', overall_score: score, confidence_score: 0, model_version: 'market-opportunity-v5', market_status: 'not_enough_data', rank,
      country_truth_assessment_state: null, country_truth_period_set: null, country_truth_as_of_date: null, generated_at: new Date(), rationale: null,
      field_provenance: null, is_selected: false, saved_at: null, country_trade_metrics: null,
    }) as unknown as AssessmentRecord;
    expect(projectMarketRow(record(216, 19), 216).attractiveness).toBe(19);
    expect(projectMarketRow(record(null, 93), 5).attractiveness).toBeNull();
    expect(v5MarketStatus({ market_status: 'not_enough_data', handed_off: false })).toEqual({ status: 'Not enough data', status_tone: 'incomplete' });
    expect(v5MarketStatus({ market_status: 'no_recorded_demand', handed_off: false })).toEqual({ status: 'No recorded imports', status_tone: 'incomplete' });
  });
});
