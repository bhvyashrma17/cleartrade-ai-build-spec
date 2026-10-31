import { describe, expect, test } from 'vitest';
import { buildHsIndex, findHsCodes, OTHER, tokenize } from '@/lib/hs-finder/finder';
import { parseBaciProductCodes } from '@/lib/reference-datasets/baci-products';
import { referenceDatasetDefinition } from '@/lib/reference-datasets/registry';

/** E-043 (the owner's option B): the product code finder, with no AI. */
const ROWS = [
  { hs6: '741810', description: 'Copper; table, kitchen or other household articles and parts thereof, pot scourers and scouring or polishing pads, gloves and the like' },
  { hs6: '732393', description: 'Iron or steel; table, kitchen or other household articles and parts thereof, of stainless steel' },
  { hs6: '761510', description: 'Aluminium; table, kitchen or other household articles and parts thereof, pot scourers and scouring or polishing pads, gloves and the like' },
  { hs6: '691110', description: 'Ceramic products; tableware and kitchenware, of porcelain or china' },
  { hs6: '691200', description: 'Ceramic tableware, kitchenware, other household articles and toilet articles; other than of porcelain or china' },
  { hs6: '090931', description: 'Spices; seeds of cumin, neither crushed nor ground' },
  { hs6: '090932', description: 'Spices; seeds of cumin, crushed or ground' },
  { hs6: '090230', description: 'Tea, black; (fermented) and partly fermented tea, in immediate packings of a content not exceeding 3kg' },
  { hs6: '090240', description: 'Tea, black; (fermented) and partly fermented tea, in immediate packings of a content exceeding 3kg' },
  { hs6: '610910', description: 'T-shirts, singlets and other vests; of cotton, knitted or crocheted' },
  { hs6: '610990', description: 'T-shirts, singlets and other vests; of textile materials (other than cotton), knitted or crocheted' },
  { hs6: '330741', description: 'Agarbatti and other odoriferous preparations which operate by burning' },
  { hs6: '100630', description: 'Cereals; rice, semi-milled or wholly milled, whether or not polished or glazed' },
  { hs6: '100640', description: 'Cereals; rice, broken' },
  { hs6: '100620', description: 'Cereals; rice, husked (brown)' },
  { hs6: '091030', description: 'Spices; turmeric (curcuma)' },
  { hs6: '630221', description: 'Bed linen; printed, of cotton, (not knitted or crocheted)' },
  { hs6: '630231', description: 'Bed linen; (not printed, knitted or crocheted), of cotton' },
];
const index = buildHsIndex(ROWS);
const codes = (result: { candidates: { hs6: string }[] }) => result.candidates.map((candidate) => candidate.hs6);

describe('the product list from the BACI archive', () => {
  test('reads code and description, restores a dropped leading zero, and refuses anything short of the full list', () => {
    const lines = ['code,description', '10121,"Horses; live, pure-bred breeding animals"', ...Array.from({ length: 4_100 }, (_, i) => `${String(200000 + i)},"Product ${i}"`)];
    const parsed = parseBaciProductCodes(Buffer.from(lines.join('\n')));
    expect(parsed.rows[0]).toEqual({ hs6: '010121', description: 'Horses; live, pure-bred breeding animals' });
    expect(parsed.rows).toHaveLength(4_101);
    expect(() => parseBaciProductCodes(Buffer.from('code,description\n010121,Horses\n'))).toThrow(/not the full HS 2022 product list/);
    expect(() => parseBaciProductCodes(Buffer.from('hs,text\n010121,Horses\n'))).toThrow(/columns code and description/);
    expect(() => parseBaciProductCodes(Buffer.from([...lines, '010121,"Again"'].join('\n')))).toThrow(/appears twice/);
    expect(referenceDatasetDefinition('cepii:product-codes:HS22')).toMatchObject({ licence: 'etalab-2.0', source_form: 'publisher_file' });
  });
});

describe('finding a product code', () => {
  test('an everyday name and a material word in the description find the one code, without asking', () => {
    const result = findHsCodes(index, { description: 'Brass pooja thali' });
    expect(codes(result)).toEqual(['741810']);
    expect(result.question).toBeNull();
    expect(result.understood).toEqual([{ dimension: 'material', value: 'copper', label: 'Copper or brass' }]);
    expect(result.candidates[0]!.matched).toEqual(expect.arrayContaining(['pooja thali']));
  });

  test('when the closest codes differ by material, it asks with the answers the descriptions offer, then narrows', () => {
    const first = findHsCodes(index, { description: 'kitchen utensils' });
    expect(first.question).toEqual({
      dimension: 'material', text: 'What is it mainly made of?',
      options: [
        { value: 'porcelain', label: 'Porcelain or china' }, { value: 'ceramic', label: 'Other ceramic (earthenware, stoneware)' },
        { value: 'stainless', label: 'Stainless steel' }, { value: 'copper', label: 'Copper or brass' }, { value: 'aluminium', label: 'Aluminium' },
        { value: OTHER, label: 'Other / not sure' },
      ],
    });
    expect(first.candidates).toHaveLength(3);
    expect(first.more).toBe(2);
    const second = findHsCodes(index, { description: 'kitchen utensils', answers: { material: 'stainless' } });
    expect(codes(second)).toEqual(['732393']);
    expect(second.question).toBeNull();
    // "Steel" in the exporter's words is read as stainless steel, the usual Indian meaning.
    expect(codes(findHsCodes(index, { description: 'steel thali' }))).toEqual(['732393']);
  });

  test('food: whole or ground, pack size, kind of rice; a hint in the words answers it', () => {
    expect(findHsCodes(index, { description: 'jeera' }).question).toMatchObject({ dimension: 'grinding', options: [{ value: 'whole' }, { value: 'ground' }, { value: OTHER }] });
    expect(codes(findHsCodes(index, { description: 'jeera powder' }))).toEqual(['090932']);
    expect(findHsCodes(index, { description: 'black tea' }).question).toMatchObject({ dimension: 'packing', options: [{ value: 'small', label: 'In packs of up to 3 kg' }, { value: 'bulk' }, { value: OTHER }] });
    expect(codes(findHsCodes(index, { description: 'black tea', answers: { packing: 'bulk' } }))).toEqual(['090240']);
    expect(findHsCodes(index, { description: 'basmati rice' }).question).toMatchObject({ dimension: 'rice' });
    expect(codes(findHsCodes(index, { description: 'broken basmati rice' }))).toEqual(['100640']);
  });

  test('textiles: a code\'s own exclusions ("other than cotton") never count as its material; printed or not', () => {
    const shirts = findHsCodes(index, { description: 't-shirt' });
    expect(shirts.question).toMatchObject({ dimension: 'material', options: [{ value: 'cotton' }, { value: OTHER }] });
    expect(codes(findHsCodes(index, { description: 't-shirt', answers: { material: 'cotton' } }))).toEqual(['610910']);
    expect(codes(findHsCodes(index, { description: 't-shirt', answers: { material: OTHER } }))).toEqual(['610990']);
    expect(findHsCodes(index, { description: 'cotton bedsheet' }).question).toMatchObject({ dimension: 'printing' });
    expect(codes(findHsCodes(index, { description: 'printed cotton bedsheet' }))).toEqual(['630221']);
  });

  test('a one-letter slip still matches; nothing matching says what to try; an answer that fits nothing keeps the codes and says so', () => {
    expect(codes(findHsCodes(index, { description: 'tumeric' }))).toEqual(['091030']);
    expect(findHsCodes(index, { description: 'xyzzy qwerty' })).toMatchObject({ candidates: [], question: null, note: expect.stringMatching(/ask an agent/) });
    const misfit = findHsCodes(index, { description: 'kitchen utensils', answers: { material: 'silk' } });
    expect(misfit.candidates).toHaveLength(3);
    expect(misfit.note).toMatch(/None of the closest codes matches/);
    expect(tokenize('Pot scourers, of the kind used')).toEqual(['pot', 'scourer']);
  });
});
