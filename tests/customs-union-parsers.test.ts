import { describe, expect, test } from 'vitest';
import { CustomsUnionParseError, parseEacCetPages, parseEacGazettePages, parseEaeuCctHtml, parseUemoaTecPages, parseUnionRate } from '@/lib/market-access/providers/customs-union-parsers';
import { assembleEacLines, assembleEaeuLines, assembleEcowasLines } from '@/lib/market-access/providers/customs-union-sources';
import type { PdfTablePage, PdfTextItem } from '@/lib/market-access/providers/pdf-table-family';

/**
 * D-028: the customs-union readers. The pages are built in the layouts measured on the official
 * files (UEMOA TEC 2022 v4, EAC CET 2022 updated June 2025, EAC Gazette of 30 June 2026, the Adilet
 * text of EAEU Council Decision No. 80): item positions as pdfjs reports them, including the quirks
 * that broke a naive reader — a rate printed on a description's middle line, a header word split in
 * pieces, a continuation page with no header row, a superscript in a quoted rate.
 */
const item = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y });
const page = (page_number: number, items: PdfTextItem[]): PdfTablePage => ({ page_number, width: 595.3, height: 841.9, items });

function uemoaHeader(y = 718): PdfTextItem[] {
  return [item('N.T.S.', 127.2, y), item('Désignation des marchandises', 220, y), item('US', 407.4, y), item('PC', 518.1, y), item('DD', 432.7, y - 13), item('RS', 461.5, y - 13), item('PCS', 486.6, y - 13)];
}
const uemoaRow = (code: string, description: string, unit: string, dd: string, y: number, rateDy = 0): PdfTextItem[] => [
  item(code, 108, y), item(description, 196, y), item(unit, 408.7, y - rateDy), item(dd, 433.8, y - rateDy), item('1', 464.9, y - rateDy), item('0,8', 489.6, y - rateDy), item('0,5', 517.9, y - rateDy),
];

describe('ECOWAS common external tariff (UEMOA TEC 2022)', () => {
  test('reads the DD column of every code row, wherever in the row the rate is printed, and nothing else', () => {
    const pages = [
      page(1, [item('Notes. Le n° 8701.20.10.00 est cité dans une note.', 130, 700)]),
      page(54, [
        ...uemoaHeader(),
        // The description wraps over three lines; the rates sit on the middle one.
        item('1006.30.10.00', 108, 680), item('- En emballage immédiat de plus de 5kg ou en', 196, 680), item('vrac', 199, 666),
        item('kg', 408.7, 673), item('10', 433.8, 673), item('1', 464.9, 673), item('0,8', 489.6, 673), item('0,5', 517.9, 673),
        ...uemoaRow('1006.30.90.00', '- En emballage immédiat de 5kg ou moins', 'kg', '10', 650),
        // pdfjs repeats a bold item; the repeated value is one value.
        ...uemoaRow('0802.80.00.00', 'Noix d’arec', 'kg', '20', 630), item('20', 433.8, 630),
        // The last row of a page, printed at the bottom margin.
        ...uemoaRow('2922.39.00.00', '- Autres', 'kg', '5', 33.2),
      ]),
      // A page with the header spelled "NTS".
      page(276, [item('NTS', 130.9, 625.4), item('US', 407.4, 625.4), item('DD', 432.7, 612.8), item('RS', 461.5, 612.8), ...uemoaRow('6101.20.00.00', '- De coton', 'u', '20', 590)]),
    ];
    const { lines, data_pages } = parseUemoaTecPages(pages);
    expect(data_pages).toBe(2);
    expect(lines.map((line) => [line.code, line.raw_rate, line.unit, line.locator])).toEqual([
      ['1006301000', '10', 'kg', 'p.54'], ['1006309000', '10', 'kg', 'p.54'], ['0802800000', '20', 'kg', 'p.54'], ['2922390000', '5', 'kg', 'p.54'], ['6101200000', '20', 'u', 'p.276'],
    ]);
    expect(lines[0]!.description).toBe('- En emballage immédiat de plus de 5kg ou en vrac');
    expect(assembleEcowasLines(lines)[0]).toMatchObject({ duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 10, expression: '10%' }, exception: null });
  });

  test('a code row without a single DD rate, or one code with two rates, stops the read', () => {
    expect(() => parseUemoaTecPages([page(9, [...uemoaHeader(), item('0101.21.00.00', 108, 680), item('- Reproducteurs', 196, 680)])])).toThrow(CustomsUnionParseError);
    expect(() => parseUemoaTecPages([page(9, [...uemoaHeader(), ...uemoaRow('0101.21.00.00', 'A', 'u', '5', 680)]), page(10, [...uemoaHeader(), ...uemoaRow('0101.21.00.00', 'A', 'u', '10', 680)])])).toThrow(/twice with different rates/);
    expect(() => parseUemoaTecPages([page(9, [...uemoaRow('0101.21.00.00', 'A', 'u', '5', 680)])])).toThrow(/no DD\/RS\/US header/);
  });
});

function eacHeader(offset: number, withUnit = true): PdfTextItem[] {
  return [item('Heading', 47.9 + offset, 764.9), item('H.S. Code /', 96.2 + offset, 770.3), item('Tariff No.', 100.6 + offset, 759.5), item('Descripti', 261.1 + offset, 764.9), item('o', 300 + offset, 764.9), item('n', 305 + offset, 764.9),
    ...(withUnit ? [item('Unit of', 429.8 + offset, 770.3), item('Quantity', 425.8 + offset, 759.5)] : []), item('Rate', (withUnit ? 479.2 : 447.2) + offset, 764.9)];
}

describe('EAC common external tariff 2022', () => {
  test('reads Schedule 1 on offset odd and even pages and on a page without a header, Schedule 2, and stops at the appended notices', () => {
    const pages = [
      page(2, [item('Legal Notice No. EAC/117/2022', 42, 800)]),
      page(60, [...eacHeader(0), item('10.06', 54.4, 600), item('Rice.', 155.2, 600),
        item('1006.30.00', 97.5, 522.3), item('- Semi-milled or wholly milled rice', 155.2, 522.3), item('kg', 439.3, 522.3), item('SI', 484.7, 522.3), item('glazed', 155.2, 511.5)]),
      // An odd page, as measured: header and columns about 43 points to the right.
      page(333, [item('Heading', 91.4, 764.9), item('H.S. Code /', 139.7, 770.3), item('Unit of', 452.5, 770.3), item('Rate', 511.3, 764.9), item('6309.00.10', 140.9, 493.7), item('--- Worn items of clothing', 198.6, 493.7), item('kg', 462, 493.7),
        item('35% or USD', 496.1, 493.7), item('0.40/kg', 506.3, 482.9), item('whichever is', 496.3, 472.1), item('higher', 508.6, 461.3)]),
      // No header row on this page: the codes sit where page 60's did.
      page(242, [item('4602.11.00', 97.8, 636.6), item('-- Of bamboo', 155.2, 636.6), item('kg', 439.3, 636.6), item('25%', 480, 636.6), item('first-day', 381, 620)]),
      page(558, [item('SCHEDULE 2', 230.5, 775.9), item('SENSITIVE ITEMS', 225, 750), ...eacHeader(0, false),
        item('1006.30.00', 97.5, 647.3), item('- Semi-Milled or wholly milled rice', 155.2, 647.3), item('75% or $345/MT', 420, 647.3), item('whichever is higher', 415, 636.9)]),
      page(560, [item('Legal Notice No. EAC/263/2022', 42, 800), item('1006.30.00', 97.5, 600), item('25%', 480, 600)]),
    ];
    const { schedule_1, schedule_2 } = parseEacCetPages(pages);
    expect(schedule_1.map((line) => [line.code, line.raw_rate, line.unit])).toEqual([['10063000', 'SI', 'kg'], ['63090010', '35% or USD 0.40/kg whichever is higher', 'kg'], ['46021100', '25%', 'kg']]);
    expect(schedule_1[2]!.description).toBe('-- Of bamboo first-day');
    expect(schedule_2.map((line) => [line.code, line.raw_rate])).toEqual([['10063000', '75% or $345/MT whichever is higher']]);
  });
});

describe('EAC Gazette: the year’s measures (Legal Notice EAC/160/2026)', () => {
  const pages = [
    page(3, [item('Legal Notice No. EAC/160/2026', 42.5, 761.6), item('TABLE I: APPROVED MEASURES ON IMPORT DUTY RATES IN THE EAC CET', 113.6, 562.8), item('S/N', 47.6, 538.4),
      item('3', 52.9, 480), item('8523.52.00', 93.9, 480), item('(a) Tanzania to stay the application of the EAC CET rate of 25%', 344.2, 490), item('(b) Rwanda to stay the application', 344.2, 470)]),
    page(40, [item('TABLE III: THE REPUBLIC OF KENYA TO STAY THE APPLICATION OF EAC CET RATE ON THE SPECIFIED', 52, 756), item('PRODUCTS BELOW AND APPLY A DUTY RATE OF 25%', 64, 745), item('S/N', 53.8, 716.8),
      item('1.', 55, 699), item('0901.21.00', 99.3, 699)]),
    page(65, [
      item('65', 542.8, 790.1),
      item('TABLE X: AMENDMENT TO DUTY RATES IN THE EAC CET', 170.9, 152.5), item('S/N', 53.3, 132.7), item('HS CODE', 86.1, 132.7), item('DECISION', 379.5, 132.7),
      item('Amend EAC CET duty rate from 25% to', 379.5, 115.1), item('1.', 56.9, 109.6), item('2102.10.00', 85.9, 109.6), item('“25% or US$ 0.66 / KG whichever is higher”', 379.5, 104.1),
      item('Amend EAC CET duty rate from 25%', 379.5, 86.5), item('2.', 56.9, 75.5), item('2710.19.51', 85.9, 75.5), item('to', 379.5, 75.5), item('“25% or US$ 0.46 / liter whichever is', 388.7, 75.5), item('higher”', 379.5, 64.5),
    ]),
    page(66, [
      item('66', 42.5, 790.1), item('TABLE X: AMENDMENT TO DUTY RATES IN THE EAC CET', 170.9, 753.8), item('S/N', 53.3, 733.9),
      item('Amend EAC CET duty rate from 35% to', 379.5, 637.2), item('5.', 56.9, 631.7), item('6907.21.00', 85.9, 631.7),
      // The superscript of m² is its own item, printed a little higher on the line.
      item('2', 449.7, 629.2), item('“35% or US$ 3 / m', 379.5, 626.2), item('whichever is higher”', 454.6, 626.2),
      item('RT. HON. REBECCA ALITWALA KADAGA', 366.4, 433.7),
    ]),
    page(67, [item('Legal Notice No. EAC/161/2026', 42.5, 761.6), item('TABLE A: APPROVED DUTY REMISSION', 50, 700), item('8539.31.00', 86, 650)]),
  ];

  test('reads every code by table, the partner state a national table is for, and each amendment row’s new rate', () => {
    const measures = parseEacGazettePages(pages, 'EAC/160/2026');
    expect(measures.stays).toEqual([
      { code: '85235200', members: [], table: 'I', locator: 'p.3' },
      { code: '09012100', members: ['KE'], table: 'III', locator: 'p.40' },
    ]);
    expect(measures.amendments.map((row) => [row.code, row.raw_rate])).toEqual([
      ['21021000', '25% or US$ 0.66 / KG whichever is higher'], ['27101951', '25% or US$ 0.46 / liter whichever is higher'], ['69072100', '35% or US$ 3 / m2 whichever is higher'],
    ]);
    // Duty remission (EAC/161/2026) is not a rate a buyer pays and is not read.
    expect(measures.stays.some((stay) => stay.code === '85393100')).toBe(false);
  });

  test('assembled, a sensitive item takes its Schedule 2 rate, an amended line its new rate, and a stayed line is an exception', () => {
    const measures = parseEacGazettePages(pages, 'EAC/160/2026');
    const line = (code: string, raw_rate: string) => ({ code, description: code, unit: 'kg', raw_rate, locator: 'p.1' });
    const lines = assembleEacLines(
      [line('10063000', 'SI'), line('21021000', '25%'), line('85235200', '25%'), line('09012100', '35%'), line('52051100', '10%')],
      [line('10063000', '75% or $345/MT whichever is higher')], measures,
    );
    const byCode = new Map(lines.map((item) => [item.code, item]));
    expect(byCode.get('10063000')).toMatchObject({ duty: { kind: 'mixed', ad_valorem_rate_percent: 75, specific_amount: 345, specific_currency: 'USD', specific_unit: 'kg', specific_unit_quantity: 1000 }, exception: null });
    expect(byCode.get('21021000')).toMatchObject({ raw_rate: '25% or US$ 0.66 / KG whichever is higher', duty: { kind: 'mixed', specific_amount: 0.66 } });
    expect(byCode.get('85235200')!.exception).toMatchObject({ members: [], reason: expect.stringContaining('not scored for any member') });
    expect(byCode.get('09012100')!.exception).toMatchObject({ members: ['KE'] });
    expect(byCode.get('52051100')).toMatchObject({ duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 10 }, exception: null });
  });
});

describe('EAEU Common Customs Tariff (Council Decision No. 80)', () => {
  const row = (code: string, description: string, unit: string, rate: string) => `<tr><td colspan="3"><p>\n${code}</p>\n</td><td><p>\n${description}</p>\n</td><td><p>\n${unit}</p>\n</td><td><p>\n${rate}</p>\n</td></tr>`;
  const html = `<article><table>${[
    row('0910 99 330 0', '– – – – – прочий', '–', '5'),
    '<tr><td colspan="3"><br>\n</td><td><p>\n– – – прочие:</p>\n</td><td><br>\n</td><td><br>\n</td></tr>',
    row('1006 30 210 0', '– – – – – круглозерный', '–', '10, но не менее 0,03 евро за 1 кг'),
    row('0106 41 000 1', 'пчелы', 'шт', '5 63С)'),
    row('6205 20 000 0', 'из хлопчатобумажной пряжи', 'шт', '10, но не менее 1,75 евро за 1 кг'),
    row('6109 10 000 0', 'из хлопчатобумажной пряжи', 'шт', '1,75 евро за 1 кг'),
    row('2402 20 900 0', 'прочие', '1000 шт', '7 плюс 0,3 евро за 1 кг'),
    row('8703 23 199 1', 'прочие', 'шт', '15, либо 12,5, но не менее 0,6 евро за 1 см 3 объема двигателя'),
  ].join('')}</table></article>`;

  test('reads every ten-digit row with its rate form, keeping footnote marks', () => {
    const lines = parseEaeuCctHtml(html);
    expect(lines.map((line) => [line.code, line.raw_rate, line.notes ?? null])).toEqual([
      ['0910993300', '5', null], ['1006302100', '10, но не менее 0,03 евро за 1 кг', null], ['0106410001', '5', ['63С']],
      ['6205200000', '10, но не менее 1,75 евро за 1 кг', null], ['6109100000', '1,75 евро за 1 кг', null], ['2402209000', '7 плюс 0,3 евро за 1 кг', null],
      ['8703231991', '15, либо 12,5, но не менее 0,6 евро за 1 см 3 объема двигателя', null],
    ]);
    const duties = new Map(assembleEaeuLines(lines).map((line) => [line.code, line]));
    expect(duties.get('0910993300')!.duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 5 });
    expect(duties.get('1006302100')!.duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 10, specific_amount: 0.03, specific_currency: 'EUR', specific_unit: 'kg' });
    expect(duties.get('6109100000')!.duty).toMatchObject({ kind: 'specific', specific_amount: 1.75, specific_currency: 'EUR', specific_unit: 'kg', specific_unit_quantity: 1 });
    expect(duties.get('2402209000')!.duty).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: 7, specific_amount: 0.3 });
    expect(duties.get('8703231991')!.duty.kind).toBe('unparsed');
    // A rate under a tariff note is not scored for any member.
    expect(duties.get('0106410001')!.exception).toMatchObject({ members: [], reason: expect.stringContaining('note 63С') });
    expect(duties.get('0910993300')!.exception).toBeNull();
  });
});

describe('published rates', () => {
  test('every qualified form keeps its operands; anything else is unparsed, never a number', () => {
    expect(parseUnionRate('35', 'ECOWAS')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 35, expression: '35%' });
    expect(parseUnionRate('0', 'EAEU')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseUnionRate('12,5', 'EAEU')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 12.5 });
    expect(parseUnionRate('0,2 евро за 1 л', 'EAEU')).toMatchObject({ kind: 'specific', specific_unit: 'litre', specific_amount: 0.2 });
    expect(parseUnionRate('100 % or $ 460/MT whichever is higher', 'EAC')).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 100, specific_amount: 460, specific_unit_quantity: 1000 });
    expect(parseUnionRate('35% or US$ 3 / m2 whichever is higher', 'EAC')).toMatchObject({ kind: 'mixed', specific_unit: 'm2' });
    expect(parseUnionRate('Ex', 'EAC')).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseUnionRate('SI', 'EAC')).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
    expect(parseUnionRate('', 'EAC')).toMatchObject({ kind: 'none' });
    expect(parseUnionRate('10 or 20', 'ECOWAS')).toMatchObject({ kind: 'unparsed' });
  });
});
