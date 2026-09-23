import { describe, expect, test } from 'vitest';
import { DESTINATION_ADAPTERS } from '../src/lib/job-handlers/market-access';
import { unconfiguredSourceForCountry } from '../src/lib/market-access/unconfigured-sources';
import { __test__ as acquisitionInternals, uzbekistanOfficialUrl } from '../src/lib/market-access/providers/uzbekistan-acquisition';
import {
  parseUzbekistanDuty,
  parseUzbekistanNomenclature,
  parseUzbekistanRateGrid,
  resolveUzbekistanSchedule,
  UZBEKISTAN_BUNDLE_READER_VERSION,
  UZBEKISTAN_PARSER_VERSION,
  type UzbekistanAuthorityBundle,
  type UzbekistanNomenclatureLine,
  type UzbekistanRateRow,
} from '../src/lib/market-access/providers/uzbekistan-bundle';
import { buildUzbekistanMarketAccess, replayUzbekistanTariff, uzbekistanNonMfnAdditionalDuty } from '../src/lib/market-access/providers/uzbekistan-parser';
import { UZBEKISTAN_TRADE_REMEDY_MANIFEST, validateUzbekistanRemedyManifest, type UzbekistanTradeRemedyManifest } from '../src/lib/market-access/providers/uzbekistan-remedies';

const nomenclatureLine = (code: string, unit: string | null = null): [string, UzbekistanNomenclatureLine] => [code, { code, description: `line ${code}`, unit, page: 1 }];
const row = (codes: string[], expression: string): UzbekistanRateRow => ({ codes, description: `row ${codes.join(',')}`, expression, footnote: parseUzbekistanDuty(expression).footnote });

function fixture(): UzbekistanAuthorityBundle {
  const nomenclature = new Map([
    nomenclatureLine('0105110000', 'дона'), nomenclatureLine('0105120000', 'дона'), nomenclatureLine('0105941000', 'дона'), nomenclatureLine('1006309800'),
    nomenclatureLine('6403990000', 'жуфт'), nomenclatureLine('8703221011', 'дона'), nomenclatureLine('7106920000'),
    nomenclatureLine('7113190000'), nomenclatureLine('7113200000'), nomenclatureLine('6907210000', 'м2'),
  ]);
  const grid = [
    row(['0105'], '10'), row(['010511', '010512'], '0'), row(['1006'], '0'),
    row(['6403'], '20, лекин ҳар бир жуфти учун 3 АҚШ долларидан кам бўлмаган миқдорда'),
    row(['8703221011'], '15 + 0,6 АҚШ доллари ҳар бир куб. см. учун*****'),
    row(['7106'], '5**'), row(['7113'], '20***'), row(['6907'], '30'),
  ];
  const lines = resolveUzbekistanSchedule({ nomenclature, grid });
  return {
    checksum: 'fixture-sha256', size_bytes: 1, release_identifier: '2026-09-23', source_url: 'https://lex.uz/docs/3802363', files: [],
    schedule_lines: new Map(lines.map(line => [line.code, line])), remedies: UZBEKISTAN_TRADE_REMEDY_MANIFEST,
    reader_version: UZBEKISTAN_BUNDLE_READER_VERSION, parser_version: UZBEKISTAN_PARSER_VERSION,
  };
}
const build = (hs6: string, at = '2026-09-23', origin = 'IN') => buildUzbekistanMarketAccess({ bundle: fixture(), release_id: 'release-1', release_reference_date: new Date('2026-09-23T00:00:00Z'), retrieved_at: new Date('2026-09-23T00:00:00Z'), hs6, at: new Date(`${at}T00:00:00Z`), origin_country: origin });

describe('Uzbekistan authority pack', () => {
  test('parses the three published rate shapes without inventing an ad-valorem equivalent; blank is never zero', () => {
    expect(parseUzbekistanDuty('0').duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 0 });
    expect(parseUzbekistanDuty('15').duty).toMatchObject({ kind: 'ad_valorem', ad_valorem_rate_percent: 15 });
    expect(parseUzbekistanDuty('').duty).toMatchObject({ kind: 'none', ad_valorem_rate_percent: null });
    expect(parseUzbekistanDuty('20, лекин ҳар бир килограмми учун 0,2 АҚШ долларидан кам бўлмаган миқдорда').duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 20, specific_amount: 0.2, specific_currency: 'USD', specific_unit: 'kg', specific_unit_quantity: 1 });
    expect(parseUzbekistanDuty('30, лекин ҳар 1000 донаси учун 3 АҚШ долларидан кам бўлмаган миқдорда').duty).toMatchObject({ kind: 'mixed', specific_amount: 3, specific_unit: 'piece', specific_unit_quantity: 1000 });
    expect(parseUzbekistanDuty('70 + 3 АҚШ доллари ҳар бир куб. см. учун').duty).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: 70, specific_amount: 3, specific_unit: 'cm3' });
    expect(parseUzbekistanDuty('10*')).toMatchObject({ footnote: '*', duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 10 } });
    expect(parseUzbekistanDuty('15 + 0,6 АҚШ доллари ҳар бир куб. см. учун*****')).toMatchObject({ footnote: '*****', duty: { kind: 'compound' } });
    expect(parseUzbekistanDuty('ставка белгиланмаган').duty).toMatchObject({ kind: 'unparsed', ad_valorem_rate_percent: null });
  });

  test('reads the Annex 1 grid and fails closed on layout changes', () => {
    const cell = (text: string) => `<td><p><span>${text}</span></p></td>`;
    const html = (rows: string[]) => `<table><tr>${cell('x')}</tr></table><table><tr>${cell('ТИФ ТНнинг 2022 йилги таҳрири')}${cell('Товар номи')}${cell('Импорт божхона божи ставкаси')}</tr>${rows.join('')}</table>`;
    const parsed = parseUzbekistanRateGrid(html([`<tr>${cell('0105')}${cell('Тирик уй паррандалари')}${cell('10')}</tr>`, `<tr><td><p><span>010511,</span></p><p><span>010512</span></p></td>${cell('185 г дан кўп эмас')}${cell('0')}</tr>`]));
    expect(parsed).toEqual([{ codes: ['0105'], description: 'Тирик уй паррандалари', expression: '10', footnote: '' }, { codes: ['010511', '010512'], description: '185 г дан кўп эмас', expression: '0', footnote: '' }]);
    expect(() => parseUzbekistanRateGrid(html([`<tr>${cell('0105')}${cell('10')}</tr>`]))).toThrow(/instead of 3/);
    expect(() => parseUzbekistanRateGrid(html([`<tr>${cell('01A5')}${cell('x')}${cell('10')}</tr>`]))).toThrow(/unrecognised code cell/);
  });

  test('reads code-column nomenclature lines and ignores codes quoted in notes, prose and ranges', () => {
    const item = (str: string, x: number, y: number) => ({ str, x, y });
    const pages = [{ page_number: 20, width: 595, height: 842, items: [
      item('0207 42', 94, 741), item('300', 132, 741), item('0', 151, 741), item('–', 174, 741), item('“70% лик ўрдак”', 198, 741), item('–', 532, 741),
      item('0102 29', 95, 700), item('05', 133, 700), item('0', 145, 700), item('0', 153, 700), item('–', 175, 700), item('Bibos зотлари', 199, 700), item('дона', 521, 700),
      item('2716 00 000 0', 91, 660), item('Электроэнергия', 171, 660), item('1000 кВт.с', 520, 660),
      item('1515 90 690 0', 100, 620), item('ва 1518 00 310 0 субпозицияларда', 150, 620),
      item('2710 19 310 0', 105, 580), item('–', 170, 580), item('2710 19 980 0 подсубпозицияларидаги', 178, 580),
      item('0204 50 510 0', 140, 540), item('–', 200, 540), item('подсубпозицияга кирувчи', 210, 540),
    ] }];
    const lines = parseUzbekistanNomenclature(pages);
    expect([...lines.keys()].sort()).toEqual(['0102290500', '0207423000', '2716000000']);
    expect(lines.get('0102290500')).toMatchObject({ description: 'Bibos зотлари', unit: 'дона' });
    expect(lines.get('0207423000')?.unit).toBeNull();
  });

  test('resolves each national code by the longest listed prefix and refuses conflicts, orphans and gaps', () => {
    const schedule = fixture().schedule_lines;
    expect(schedule.get('0105110000')?.duty.ad_valorem_rate_percent).toBe(0);
    expect(schedule.get('0105941000')?.duty.ad_valorem_rate_percent).toBe(10);
    expect(schedule.get('0105110000')?.rate_prefix).toBe('010511');
    const nomenclature = new Map([nomenclatureLine('0105110000')]);
    expect(() => resolveUzbekistanSchedule({ nomenclature, grid: [row(['0105'], '10'), row(['0105'], '5')] })).toThrow(/non-declarable/);
    expect(() => resolveUzbekistanSchedule({ nomenclature, grid: [row(['0105'], '10'), row(['9999'], '5')] })).toThrow(/matches no PP-181/);
    expect(() => resolveUzbekistanSchedule({ nomenclature, grid: [row(['0106'], '10')] })).toThrow(/matches no PP-181|has no PP-3818/);
  });

  test('replays live footnote rates only through their end dates; spent footnotes and pre-base dates are never applied', () => {
    const bundle = fixture();
    expect(replayUzbekistanTariff(bundle, new Date('2026-02-15T00:00:00Z')).size).toBe(0);
    const now = replayUzbekistanTariff(bundle, new Date('2026-09-23T00:00:00Z'));
    expect(now.get('7113190000')).toMatchObject({ declarable: true, duty: { ad_valorem_rate_percent: 10 }, effective_to: '2027-01-01' });
    expect(now.get('7113200000')?.duty.ad_valorem_rate_percent).toBe(20);
    expect(now.get('7106920000')).toMatchObject({ declarable: false, duty: { kind: 'unparsed' } });
    expect(now.get('8703221011')?.duty).toMatchObject({ kind: 'compound', ad_valorem_rate_percent: 15, specific_amount: 0.6 });
    const later = replayUzbekistanTariff(bundle, new Date('2027-10-02T00:00:00Z'));
    expect(later.get('7113190000')?.duty.ad_valorem_rate_percent).toBe(20);
    expect(later.get('7106920000')).toMatchObject({ declarable: true, duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 5 } });
  });

  test('India: no preference, and the non-MFN additional duty stays a conditional non-declarable exposure, never applied from origin alone', () => {
    const result = build('100630');
    expect(result.india_preference).toMatchObject({ applicability: 'not_applicable', duty: null });
    expect(result.general_duty?.ad_valorem_rate_percent).toBe(0);
    const additional = result.lines.find(line => line.measure_kind === 'additional_duty');
    expect(additional).toMatchObject({ declarable: false, applies_to_origin_country: 'IN', duty: { kind: 'unparsed', ad_valorem_rate_percent: null } });
    expect(additional?.duty.expression).toMatch(/^Additional 5% \(Customs Code art\. 300¹\)/);
    expect(result.requirements.map(item => item.requirement_code)).toEqual(['UZ_MFN_TREATMENT_ORIGIN_EVIDENCE']);
    expect(result.raw_evidence).toMatchObject({ remedy_status: 'not_applicable', active_remedy_count: 0, tariff_treatment_complete: false, origin_mfn_status: 'unverified_requires_evidence' });
    expect(result.regulatory_coverage_complete).toBe(false);
    const beforeArticle = build('100630', '2026-02-20');
    expect(beforeArticle.lines.some(line => line.measure_kind === 'additional_duty')).toBe(false);
    expect(beforeArticle.raw_evidence).toMatchObject({ tariff_treatment_complete: true, origin_mfn_status: 'not_yet_in_force' });
  });

  test('statutory band boundaries are shown as ambiguous rather than silently chosen', () => {
    const band = (rate: number) => uzbekistanNonMfnAdditionalDuty({ kind: 'ad_valorem', ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${rate}%`, note: null }).expression;
    expect(band(5)).toMatch(/^Additional 5% /);
    expect(band(10)).toMatch(/^Additional 5% or 10% /);
    expect(band(20)).toMatch(/^Additional 10% or 15% /);
    expect(band(30)).toMatch(/^Additional 20% /);
    expect(build('640399').general_duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 20, specific_amount: 3, specific_unit: 'pair' });
  });

  test('the zero-remedy manifest is complete and never represents draft work as a duty', () => {
    expect(() => validateUzbekistanRemedyManifest(UZBEKISTAN_TRADE_REMEDY_MANIFEST)).not.toThrow();
    expect(UZBEKISTAN_TRADE_REMEDY_MANIFEST.pending_work).toEqual([expect.objectContaining({ instrument: 'PF-175 of 2026-08-27, annex item 37', status: 'DRAFT_LEGISLATION_TASK' })]);
    expect(() => validateUzbekistanRemedyManifest({ ...UZBEKISTAN_TRADE_REMEDY_MANIFEST, active_anti_dumping_count: 1 } as unknown as UzbekistanTradeRemedyManifest)).toThrow(/without rate evidence/);
    expect(() => validateUzbekistanRemedyManifest({ ...UZBEKISTAN_TRADE_REMEDY_MANIFEST, pending_work: [{ ...UZBEKISTAN_TRADE_REMEDY_MANIFEST.pending_work[0]!, status: 'IMPOSED' }] } as unknown as UzbekistanTradeRemedyManifest)).toThrow(/never be represented/);
  });

  test('accepts only HTTPS lex.uz and reads the newest lex.uz edition date', () => {
    expect(uzbekistanOfficialUrl('https://lex.uz/docs/3802363')).toBe('https://lex.uz/docs/3802363');
    expect(() => uzbekistanOfficialUrl('https://tarif.customs.uz/en')).toThrow(/rejects tarif\.customs\.uz/);
    expect(() => uzbekistanOfficialUrl('http://lex.uz/docs/3802363')).toThrow(/rejects/);
    expect(acquisitionInternals.latestEdition('Ўзгартиришлар манбаси Расмий нашр манбаси 16.02.2026 20.05.2025')).toBe('16.02.2026');
  });

  test('routes UZ to the legal-instrument provider and removes the stale unconfigured entry', () => {
    expect(DESTINATION_ADAPTERS.UZ?.provider_key).toBe('uz_lex_customs_tariff');
    expect(unconfiguredSourceForCountry('UZ')).toBeNull();
  });
});
