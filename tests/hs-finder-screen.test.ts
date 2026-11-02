import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { HsFinderResultView, type HsFinderResponse } from '../src/components/hs-finder/HsFinder';

/** E-046: the product code finder screen, each state as the API answers it (staging, 31 Oct). */
const SOURCE = 'CEPII BACI product codes HS22 (5609 codes)';
const base: HsFinderResponse = { available: true, source: SOURCE, candidates: [], question: null, more: 0, understood: [], note: null };
const noop = () => {};
const render = (result: HsFinderResponse, answered: { dimension: string; value: string; label: string }[] = []) =>
  renderToStaticMarkup(createElement(HsFinderResultView, { result, answered, pending: false, onAnswer: noop, onPick: noop, onReset: noop }));
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const THALI = { hs6: '741810', description: 'Copper; table, kitchen or other household articles and parts thereof, pot scourers and scouring or polishing pads, gloves and the like', matched: ['pooja thali', 'thali'] };
const WHOLE = { hs6: '090931', description: 'Spices; seeds of cumin, neither crushed nor ground', matched: ['jeera'] };
const GROUND = { hs6: '090932', description: 'Spices; seeds of cumin, crushed or ground', matched: ['jeera'] };
const QUESTION = {
  dimension: 'processing', text: 'Is it whole, or crushed or ground?',
  options: [{ value: 'whole', label: 'Whole (neither crushed nor ground)' }, { value: 'ground', label: 'Crushed or ground' }, { value: 'other', label: 'Other / not sure' }],
};

describe('the product code finder screen', () => {
  test('one code that fits: what was read from the words, the code, its official description and one button to use it', () => {
    const html = render({ ...base, candidates: [THALI], understood: [{ dimension: 'material', value: 'copper', label: 'Copper or brass' }] });
    expect(text(html)).toContain('Taken into account: Copper or brass');
    expect(text(html)).toContain('The code that fits 741810 Copper; table, kitchen');
    expect(text(html)).toContain('Matched: pooja thali, thali');
    expect(html).toContain('aria-label="Use code 741810"');
    expect(html).not.toContain('<fieldset');
    expect(text(html)).toContain(`From the official code list: ${SOURCE}`);
  });

  test('codes that differ on a detail: the question with the answers the descriptions offer, above the closest codes', () => {
    const html = render({ ...base, candidates: [WHOLE, GROUND], question: QUESTION, more: 2 });
    expect(text(html)).toContain('Is it whole, or crushed or ground? Whole (neither crushed nor ground) Crushed or ground Other / not sure');
    expect(text(html)).toContain('Closest codes so far 090931');
    expect(text(html)).toContain('2 more codes also match. Answering the question narrows them.');
    expect(html.indexOf('<fieldset')).toBeLessThan(html.indexOf('090931'));
  });

  test('after an answer: the answer is shown with a way to start over', () => {
    const html = render({ ...base, candidates: [WHOLE] }, [{ dimension: 'processing', value: 'whole', label: 'Whole (neither crushed nor ground)' }]);
    expect(text(html)).toContain('Taken into account: Whole (neither crushed nor ground) Start over');
    expect(text(html)).not.toContain('Is it whole');
  });

  test('nothing found, or no code list here: says so and what to do, never an empty box', () => {
    const none = render({ ...base, note: 'No product code matches these words. Try other words, such as what it is made of or what it is used for, or ask an agent.' });
    expect(text(none)).toContain('No product code matches these words.');
    expect(none).not.toContain('Use code');
    const missing = render({ ...base, available: false, reason: 'The product code list is not loaded in this environment yet.' });
    expect(text(missing)).toBe('The product code list is not loaded in this environment yet. Enter the code yourself, or ask a ClearTrade agent.');
  });
});
