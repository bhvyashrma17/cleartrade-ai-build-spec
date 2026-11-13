import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { regionalTitle } from '../src/app/app/markets/[marketAssessmentId]/MarketDetail';
import { RegionalDemand, coreSentence } from '../src/app/app/markets/[marketAssessmentId]/RegionalDemand';
import { regionalDemandView } from '../src/lib/regional-demand/service';

/** The market page's regional section for markets without official figures (D-048, docs/38 §1.3). */

const render = async (country: string, name: string) =>
  renderToStaticMarkup(createElement(RegionalDemand, { assessmentId: 'no-run', countryName: name, initial: await regionalDemandView('no-run', country), canRequest: true }));

describe('the regional section of the market page', () => {
  test('a one-place market says "Not needed": one search area, with its main city and gateways', async () => {
    const html = await render('SG', 'Singapore');
    expect(html).toContain('Not needed');
    expect(html).toContain('One search area: buyers anywhere in Singapore can be searched as one market.');
    expect(html).toContain('Main city: Singapore.');
    expect(html).toContain('Singapore Changi (SIN)');
    expect(html).toContain('Natural Earth v5.1.2');
    expect(html).not.toContain('In the 80%');
  });

  test('a hub-and-gateway market shows its main cities by size, the 80% marked in words, and its gateways', async () => {
    const html = await render('AE', 'the United Arab Emirates');
    expect(html).toContain('Estimate');
    expect(html).toContain('Main cities, by size');
    expect(html).toContain('with Sharjah');
    expect(html).toContain('The first 2 hold 80% or more of the main cities’ population, marked “In the 80%”.');
    expect(html.match(/In the 80%</g)).toHaveLength(2);
    expect(html).toContain('Ports:');
    expect(html).toContain('Dubai Int&#x27;l (DXB)');
    expect(html).toContain('It is the same for every product.');
  });

  test('the section title claims imports only where official figures exist', async () => {
    expect(regionalTitle(await regionalDemandView('no-run', 'SG'), 'Singapore')).toBe('Where in Singapore to look for buyers');
    expect(regionalTitle(await regionalDemandView('no-run', 'BD'), 'Bangladesh')).toBe('Where in Bangladesh buyers are likely to be');
    expect(regionalTitle({ supported: true, publisher: 'U.S. Census Bureau', latest: null, shown: null, evidence: null, estimate: null }, 'the United States')).toBe('Where in the United States it is imported');
  });

  test('the 80% line says how many areas it takes, or why it cannot be placed', () => {
    expect(coreSentence({ count: 3, listed_share_percent: 82 }, 'importers', 10)).toBe('The first 3 hold 80% or more of the importers listed, marked “In the 80%”.');
    expect(coreSentence({ count: 14, listed_share_percent: 71.5 }, 'all_origins_value', 10)).toBe('It takes 14 to reach 80% of the product’s imports; the 10 listed hold 71.5%.');
    expect(coreSentence({ count: null, listed_share_percent: 64 }, 'india_value', 10)).toBe('The 10 listed hold 64% of India’s shipments of it; the rest are summed, so the 80% line cannot be placed.');
    expect(coreSentence({ count: null, listed_share_percent: null }, 'india_value', 0)).toBeNull();
  });
});
