import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { V5Results, type V5Row } from '../src/app/app/markets/V5Results';
import { exporterFitView, type ExporterFitView } from '../src/lib/demand-discovery-v5/exporter-inputs';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '../src/lib/demand-discovery-v5/policy';

/**
 * Stage 1, item 7: the results page asks for the exporter's FOB price and capacity when a run had to
 * leave them out, names each missing figure with the run's own reason, links to the product's
 * details, and says when a score used fewer than 100 points.
 */
const PRICE_REASON = 'Your FOB price per kg is not on the product form yet.';
const CAPACITY_REASON = 'Your monthly capacity in a weight unit is not on the product form yet (volume fit needs a weight and a period).';
const POINTS = { price_fit: POLICY.points.price_fit, volume_fit: POLICY.points.volume_fit };

const row = (overrides: Partial<V5Row>): V5Row => ({
  id: 'a1', country_code: 'US', overall_score: 72, confidence_score: 80, market_status: 'ranked', rank: 1, live_points: 100, data_year: 2024,
  labels: [], reasons: [], flag_reasons: [], handed_off: true, ...overrides,
});
const render = (exporterFit: ExporterFitView | null, productId: string | null = 'product-1', rows: V5Row[] = [row({})]) =>
  renderToStaticMarkup(createElement(V5Results, { rows, notes: [], provenanceNote: null, exporterFit, productId }));

describe("the exporter's figures as a run froze them", () => {
  test('reads both figures, their reasons when missing, and the points each measure carries', () => {
    expect(exporterFitView({ exporter: { usd_per_kg: { value: 2, basis: {} }, yearly_kg: { value: 48_000, basis: {} } } }, POLICY)).toEqual({
      points: POINTS, price: { usd_per_kg: 2, reason: null }, capacity: { kg_per_year: 48_000, reason: null },
    });
    expect(exporterFitView({ exporter: { usd_per_kg: { value: null, reason: PRICE_REASON }, yearly_kg: { value: null, reason: CAPACITY_REASON } } }, POLICY)).toEqual({
      points: POINTS, price: { usd_per_kg: null, reason: PRICE_REASON }, capacity: { kg_per_year: null, reason: CAPACITY_REASON },
    });
    // A run that stored no policy still says what is missing; it just cannot say how many points.
    expect(exporterFitView({ exporter: { usd_per_kg: { value: null, reason: PRICE_REASON }, yearly_kg: { value: 10, basis: {} } } }, null)?.points).toEqual({ price_fit: null, volume_fit: null });
    // Runs from before exporter figures were frozen, and unreadable values, give nothing rather than a guess.
    expect(exporterFitView({ baci: {} }, POLICY)).toBeNull();
    expect(exporterFitView(null, POLICY)).toBeNull();
    expect(exporterFitView({ exporter: { usd_per_kg: { value: 'two' }, yearly_kg: 7 } }, POLICY)).toEqual({ points: POINTS, price: { usd_per_kg: null, reason: null }, capacity: { kg_per_year: null, reason: null } });
  });
});

describe('the results page', () => {
  const both: ExporterFitView = { points: POINTS, price: { usd_per_kg: null, reason: PRICE_REASON }, capacity: { kg_per_year: null, reason: CAPACITY_REASON } };

  test('with neither figure, it says fit with the business is left out, names both, and links to the product', () => {
    const html = render(both);
    expect(html).toContain(`Fit with your business is left out of these scores (${POINTS.price_fit + POINTS.volume_fit} of 100 points).`);
    expect(html).toContain(PRICE_REASON);
    expect(html).toContain('Your monthly capacity in a weight unit is not on the product form yet');
    expect(html).toContain('then run Demand Discovery again to use all 100');
    expect(html).toContain('href="/app/products/product-1/facts"');
    expect(html).toContain('Add product details');
  });

  test('with one figure missing, it names that one and its points only', () => {
    const html = render({ ...both, price: { usd_per_kg: 2.4, reason: null } });
    expect(html).toContain(`Part of the fit with your business is left out of these scores (${POINTS.volume_fit} of 100 points).`);
    expect(html).not.toContain(PRICE_REASON);
    expect(html).toContain('Your monthly capacity in a weight unit is not on the product form yet');
  });

  test('with both figures, or without the run’s figures, it asks for nothing', () => {
    expect(render({ points: POINTS, price: { usd_per_kg: 2.4, reason: null }, capacity: { kg_per_year: 50_000, reason: null } })).not.toContain('left out of these scores');
    expect(render(null)).not.toContain('left out of these scores');
    // Without a product (a guest's ad-hoc search) it still explains, with no link to follow.
    const guest = render(both, null);
    expect(guest).toContain('left out of these scores');
    expect(guest).not.toContain('/facts');
  });

  test('a card says how many points its score used when that is fewer than 100', () => {
    const html = render(null, 'product-1', [row({ id: 'a1', live_points: 90 }), row({ id: 'a2', country_code: 'DE', rank: 2, live_points: 100 })]);
    expect(html.match(/on \d+ of 100 points/g)).toEqual(['on 90 of 100 points']);
  });

  test('the results API returns the figures as the run used them, with the product', () => {
    const route = readFileSync('src/app/api/v1/discovery-runs/[runId]/market-assessments/route.ts', 'utf8');
    expect(route).toContain('exporter_figures: exporterFitView(run.frozen_inputs, run.scoring_policy_snapshot)');
    expect(route).toContain('product_id: run.product_id');
    expect(readFileSync('src/app/app/markets/DemandDiscovery.tsx', 'utf8')).toContain('exporterFit={runMeta?.exporter_figures ?? null}');
  });
});
