import { afterEach, describe, expect, test, vi } from 'vitest';
import { fetchUkMarketAccess } from '@/lib/market-access/uk-tariff';
import { fetchUsMarketAccess } from '@/lib/market-access/us-hts';

/**
 * R-51 (11 Nov 2026): two live look-ups found no rated line and the run scored an estimate.
 * - UK, turmeric 0910.30: the HS6 is itself a declarable commodity, so the search answers with that
 *   commodity and its document carries it as `data`. Only `included` was read, which holds none.
 * - US, brass 7418.10: the only rated line is "7418.10.00". The USITC export orders it before
 *   "7418.10.00.00", so a range starting there returned only the unrated statistical breakouts.
 * Response shapes below are the sources' own (read 11 Nov 2026), trimmed to what the readers use.
 */
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const NOW = new Date('2026-11-11T05:00:00Z');

function ukCommodity(code: string, description: string, duty: string) {
  const measure = `m-${code}`;
  return {
    data: { id: `c-${code}`, type: 'commodity', attributes: { goods_nomenclature_item_id: code, declarable: true, description, producline_suffix: '80' }, relationships: { ancestors: { data: [] } } },
    included: [
      { id: measure, type: 'measure', attributes: { import: true, effective_start_date: '2021-01-01T00:00:00.000Z', effective_end_date: null, vat: false, excise: false }, relationships: { duty_expression: { data: { id: `${measure}-duty_expression`, type: 'duty_expression' } }, measure_type: { data: { id: '103', type: 'measure_type' } }, geographical_area: { data: { id: '1011', type: 'geographical_area' } }, measure_conditions: { data: [] }, excluded_countries: { data: [] } } },
      { id: `${measure}-duty_expression`, type: 'duty_expression', attributes: { base: duty } },
      { id: '103', type: 'measure_type', attributes: { description: 'Third country duty' } },
      { id: '1011', type: 'geographical_area', attributes: { description: 'ERGA OMNES' } },
    ],
  };
}

describe('the UK look-up reads an HS6 that is itself a declarable line', () => {
  test('turmeric 0910.30: the commodity the search names is the line, read from one document', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/search?q=091030')) return json({ data: { id: '1', type: 'exact_search', attributes: { type: 'exact_match', entry: { endpoint: 'commodities', id: '0910300000' } } } });
      if (url.endsWith('/commodities/0910300000')) return json(ukCommodity('0910300000', 'Turmeric (curcuma)', '0.00 %'));
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchUkMarketAccess('091030', { now: NOW });
    expect(result.resolution.resolved_line?.national_tariff_code).toBe('0910300000');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(result.parser_version).toBe('uk-tariff-v3');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('an HS6 answered with a subheading still reads the declarable lines beneath it', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/search?q=100630')) return json({ data: { id: '1', type: 'exact_search', attributes: { type: 'exact_match', entry: { endpoint: 'subheadings', id: '1006300000-10' } } } });
      if (url.endsWith('/subheadings/1006300000-10')) return json({ data: { id: 's-1', type: 'subheading', attributes: { goods_nomenclature_item_id: '1006300000', declarable: false } }, included: [{ id: 'c-1006309800', type: 'commodity', attributes: { goods_nomenclature_item_id: '1006309800', declarable: true, description: '' } }] });
      if (url.endsWith('/commodities/1006309800')) return json(ukCommodity('1006309800', 'Other', '7.70 %'));
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchUkMarketAccess('100630', { now: NOW });
    expect(result.resolution.resolved_line?.national_tariff_code).toBe('1006309800');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 7.7 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('the US look-up starts its export at the HS6', () => {
  const RATED = { htsno: '7418.10.00', indent: '1', description: 'Table, kitchen or other household articles and parts thereof; pot scourers and scouring or polishing pads, gloves and the like', units: [], general: '3%', special: 'Free (A*,AU,BH,CL,CO,D,E,IL,JO,KR,MA,OM,P,PA,PE,S,SG)', other: '40%', footnotes: [] };
  const BREAKOUTS = [
    { htsno: '', indent: '2', description: 'Pot scourers and scouring or polishing pads, gloves and the like:', units: [], general: '', special: '', other: '', footnotes: null },
    { htsno: '7418.10.00.02', indent: '3', description: 'Of copper-zinc base alloys (brass)', units: ['kg'], general: '', special: '', other: '', footnotes: [] },
    { htsno: '7418.10.00.04', indent: '3', description: 'Other', units: ['kg'], general: '', special: '', other: '', footnotes: [] },
  ];

  test('brass 7418.10: the eight-digit line ending .00 is read, with its 3% General rate', async () => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requested.push(url.search);
      // The USITC export as it answers: a range from 7418.10.00.00 leaves out 7418.10.00 itself.
      const from = url.searchParams.get('from');
      return json(from === '7418.10' ? [RATED, ...BREAKOUTS] : BREAKOUTS);
    }));
    const result = await fetchUsMarketAccess('741810', { now: NOW });
    expect(requested).toEqual(['?from=7418.10&to=7418.10.99.99&format=JSON&styles=false']);
    expect(result.resolution.resolved_line?.national_tariff_code).toBe('74181000');
    expect(result.general_duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 3, expression: '3%' });
    expect(result.parser_version).toBe('us-hts-v2');
  });
});
