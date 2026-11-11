import { describe, expect, test } from 'vitest';
import { buildHsIndex, findHsCodes, isHsChapterCode, OTHER, tokenize } from '@/lib/hs-finder/finder';
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
  test('only HS chapters 01–97 are offered: never CEPII\'s 999999 placeholder or the reserved chapter 77 (E-046)', () => {
    expect(['010121', '970600', '741810'].every(isHsChapterCode)).toBe(true);
    expect(['999999', '770000', '980100', '000000'].some(isHsChapterCode)).toBe(false);
    const withPlaceholder = buildHsIndex([...ROWS, { hs6: '999999', description: 'Commodities not specified according to kind' }]);
    expect(withPlaceholder.codes.has('999999')).toBe(false);
    expect(codes(findHsCodes(withPlaceholder, { description: 'commodities not specified according to kind' }))).toEqual([]);
  });

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

/**
 * E-070: the production probe of 20 everyday products (10 Nov 2026) missed five. These rows are CEPII's
 * own wording, copied from product_codes_HS22_V202601.csv, which the fixture above does not use: the
 * list says "Steel, stainless: …" where the HS says "… of stainless steel".
 */
const CEPII_ROWS = [
  { hs6: '720421', description: 'Ferrous waste and scrap: of stainless steel' },
  { hs6: '720429', description: 'Ferrous waste and scrap: of alloy steel (excluding stainless)' },
  { hs6: '732393', description: 'Steel, stainless: table, kitchen and other household articles and parts thereof' },
  { hs6: '732399', description: 'Iron or steel: table, kitchen and other household articles and parts thereof, of iron or steel n.e.c. in heading no. 7323' },
  { hs6: '741810', description: 'Copper: table, kitchen or other household articles and parts thereof: pot scourers and scouring or polishing pads, gloves and the like' },
  { hs6: '761510', description: 'Aluminium: table, kitchen or other household articles and parts thereof: pot scourers and scouring or polishing pads, gloves and the like' },
  { hs6: '730411', description: 'Iron or steel (excluding cast iron): seamless, line pipe of a kind used for oil or gas pipelines, of stainless steel' },
  { hs6: '730419', description: 'Iron or steel (excluding cast iron or stainless steel): seamless, line pipe of a kind used for oil or gas pipelines' },
  { hs6: '071331', description: 'Vegetables, leguminous: beans of the species vigna mungo (l.) hepper or vigna radiata (l.) wilczek, shelled, whether or not skinned or split, dried' },
  { hs6: '080450', description: 'Fruit, edible: guavas, mangoes and mangosteens, fresh or dried' },
  { hs6: '230320', description: 'Beet-pulp, bagasse and other waste of sugar manufacture: whether or not in the form of pellets' },
  { hs6: '470100', description: 'Wood pulp: mechanical wood pulp' },
  { hs6: '200799', description: 'Jams, fruit jellies, marmalades, purees and pastes: of fruit or nuts n.e.c. in heading no. 2007, cooked preparations (excluding homogenised), whether or not containing added sugar or other sweetening matter' },
  { hs6: '200899', description: 'Fruit, nuts and other edible parts of plants: prepared or preserved, whether or not containing added sugar, other sweetening matter or spirit, n.e.c. in heading no. 2008' },
  { hs6: '630221', description: 'Bed linen: of cotton, printed, not knitted or crocheted' },
  { hs6: '630231', description: 'Bed linen: of cotton (not printed, knitted or crocheted)' },
  { hs6: '630232', description: 'Bed linen: of man-made fibres (not printed, knitted or crocheted)' },
  { hs6: '120721', description: 'Oil seeds: cotton seeds, seed, whether or not broken' },
  { hs6: '120729', description: 'Oil seeds: cotton seeds, other than seed, whether or not broken' },
  { hs6: '140420', description: 'Vegetable products: cotton linters' },
  { hs6: '120730', description: 'Oil seeds: castor oil seeds, whether or not broken' },
  { hs6: '151530', description: 'Vegetable oils: castor oil and its fractions, whether or not refined, but not chemically modified' },
  { hs6: '100620', description: 'Cereals: husked (brown) rice' },
  { hs6: '100630', description: 'Cereals: rice, semi-milled or wholly milled, whether or not polished or glazed' },
  { hs6: '100640', description: 'Cereals: rice, broken' },
  { hs6: '090111', description: 'Coffee: not roasted or decaffeinated' },
  { hs6: '090112', description: 'Coffee: decaffeinated, not roasted' },
  { hs6: '090121', description: 'Coffee: roasted, not decaffeinated' },
  { hs6: '090122', description: 'Coffee: roasted, decaffeinated' },
  { hs6: '090210', description: 'Tea, green: (not fermented), in immediate packings of a content not exceeding 3kg' },
  { hs6: '090220', description: 'Tea, green: (not fermented), in immediate packings of a content exceeding 3kg' },
  { hs6: '210111', description: 'Extracts, essences and concentrates: of coffee, and preparations with a basis of these extracts, essences or concentrates or with a basis of coffee' },
  { hs6: '370120', description: 'Photographic plates and film: instant print film, in the flat, sensitised, unexposed, whether or not in packs' },
];
const cepii = buildHsIndex(CEPII_ROWS);

describe('E-070: the five misses from the production probe, on CEPII\'s own wording', () => {
  test('stainless steel utensils, mango pulp, bedsheets, cotton bedsheets and green coffee beans find their codes', () => {
    // Was 720421, ferrous scrap: "Steel, stainless: …" was not read as stainless, so 7323.93 was narrowed away.
    const utensils = findHsCodes(cepii, { description: 'stainless steel utensils' });
    expect(codes(utensils)[0]).toBe('732393');
    expect(codes(utensils)).not.toContain('720421');
    // Was fresh mangoes, vigna mungo beans (a one-letter slip) and beet-pulp waste.
    expect(codes(findHsCodes(cepii, { description: 'mango pulp' }))).toEqual(['200799', '200899']);
    // Was nothing: "bedsheets" did not meet the everyday name "bedsheet".
    expect(codes(findHsCodes(cepii, { description: 'bedsheets' }))).toEqual(['630221', '630231', '630232']);
    // Was cotton seeds, then "Which kind of rice?" because the seeds are "whether or not broken".
    const cotton = findHsCodes(cepii, { description: 'cotton bedsheets' });
    expect(codes(cotton)).toEqual(['630221', '630231']);
    expect(cotton.question).toMatchObject({ dimension: 'printing' });
    // Was green tea first.
    expect(codes(findHsCodes(cepii, { description: 'green coffee beans' }))).toEqual(['090111', '090112']);
  });

  test('rice is asked about only for rice; waste and scrap only when the exporter says so', () => {
    // Castor seeds are "whether or not broken" and castor oil is not: that used to ask "Which kind of rice?".
    const castor = findHsCodes(cepii, { description: 'castor' });
    expect(codes(castor)).toEqual(['120730', '151530']);
    expect(castor.question).toBeNull();
    expect(findHsCodes(cepii, { description: 'rice' }).question).toMatchObject({ dimension: 'rice' });
    expect(codes(findHsCodes(cepii, { description: 'broken rice' }))).toEqual(['100640']);
    const scrap = findHsCodes(cepii, { description: 'stainless steel scrap' });
    expect(codes(scrap)[0]).toBe('720421');
  });

  test('"steel" is stainless for household goods only; "SS" is stainless steel', () => {
    expect(codes(findHsCodes(cepii, { description: 'steel utensils' }))).toEqual(['732393']);
    // Pipes and scrap come in every grade: bare "steel" no longer narrows them to stainless.
    const pipes = findHsCodes(cepii, { description: 'steel pipes' });
    expect(pipes.understood).toEqual([]);
    expect(codes(pipes)).toEqual(expect.arrayContaining(['730411', '730419']));
    expect(codes(findHsCodes(cepii, { description: 'steel scrap' }))).toEqual(expect.arrayContaining(['720421', '720429']));
    expect(codes(findHsCodes(cepii, { description: 'SS utensils' }))[0]).toBe('732393');
  });

  test('a name inside a longer one does not count; an explained word offers nothing else; a slip prefers an added letter', () => {
    // "mango pulp" is not "mango", and wood pulp shares only a word the name already explains.
    expect(codes(findHsCodes(cepii, { description: 'mango pulp' }))).not.toContain('470100');
    // "mango" is an everyday name, so no slip is looked for ("mungo").
    expect(codes(findHsCodes(cepii, { description: 'mango' }))).toEqual(['080450']);
    // Not a name: "mango" alone in other words still meets "mangoes" (stem "mangoe") before "mungo".
    const withoutNames = buildHsIndex(CEPII_ROWS, []);
    expect(codes(findHsCodes(withoutNames, { description: 'mango' }))[0]).toBe('080450');
    expect(codes(findHsCodes(cepii, { description: 'instant coffee' }))).toEqual(['210111']);
    expect(codes(findHsCodes(cepii, { description: 'green tea' }))).toEqual(['090210', '090220']);
  });
});
