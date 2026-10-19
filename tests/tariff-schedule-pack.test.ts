import { createHash, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { AuthorityReleaseStatus, OrgTier, UserRole } from '@prisma/client';
import { acquireTariffEvidence } from '@/lib/country-truth/tariff-acquisition';
import { dutyInputs } from '@/lib/demand-discovery-v5/duty-inputs';
import { metricSentence } from '@/lib/demand-discovery-v5/explain';
import { scoreDuty } from '@/lib/demand-discovery-v5/metrics';
import { DEMAND_DISCOVERY_V5_DEFAULT_POLICY as POLICY } from '@/lib/demand-discovery-v5/policy';
import { __test__ as runInputs } from '@/lib/demand-discovery-v5/run-inputs';
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { CUSTOMS_UNION_SOURCES } from '@/lib/market-access/providers/customs-union-sources';
import type { PdfTablePage, PdfTextItem } from '@/lib/market-access/providers/pdf-table-family';
import { buildTariffScheduleBundle, readTariffScheduleBundle } from '@/lib/market-access/providers/tariff-schedule-bundle';
import { lineDutyAt, preferenceDutyAt } from '@/lib/market-access/providers/tariff-schedule-market-access';
import {
  parseBrazilCamexWorkbook, parseChinaProvisionalAnnexPages, parseChinaTariffPages, parseGccIntegratedTariffPages, parseUaeCepaSchedulePages, type ChinaProvisionalEntry, type ChinaTariffRow,
} from '@/lib/market-access/providers/tariff-schedule-readers';
import { fetchTariffScheduleMarketAccess, importTariffScheduleRelease, setTariffScheduleSourceForTesting, __test__ as scheduleService } from '@/lib/market-access/providers/tariff-schedule-service';
import {
  assembleBrazilLines, assembleChinaLines, assembleGccLines, assembleMercosurLines, cepaYear, TARIFF_SCHEDULE_SOURCES, tariffScheduleBasisFor, tariffScheduleSourceFor,
  type ScheduleLine, type TariffScheduleKey, type TariffScheduleSource,
} from '@/lib/market-access/providers/tariff-schedule-sources';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/**
 * D-030 / D-031: cluster 1's retained tariff schedules. The readers run on page layouts measured from
 * the official files (positions as pdfjs reports them); fixture releases built from what they read go
 * through the real bundle, import, activation, market-access and Demand Discovery code. The real
 * releases' pins and markets are checked as configuration.
 */
const MARKER = `schedule-${randomUUID()}`;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const at = (str: string, x: number, y: number): PdfTextItem => ({ str, x, y });
const page = (page_number: number, items: PdfTextItem[], width = 595.32, height = 841.92): PdfTablePage => ({ page_number, width, height, items });
const day = (value: string) => new Date(`${value}T00:00:00Z`);
const percent = (rate: number) => ({ kind: 'ad_valorem', ad_valorem_rate_percent: rate });

// --- the GCC tariff as Dubai Customs prints it (code x ≈ 1021, description from 245, unit ≈ 150, duty < 120) ---
const GCC_PAGE = page(40, [
  at('10 06 30 10 00 00', 1021, 900), at('Semi-milled or wholly milled rice, parboiled', 245, 900), at('KG', 150, 900), at('0%', 80, 900),
  // A duty beside a wrapped description sits up to a line away from its code.
  at('62 05 20 00 00 00', 1021, 870), at('Men’s or boys’ shirts, of cotton', 245, 870), at('U', 150, 870), at('5%', 80, 863),
  at('22 03 00 00 00 00', 1021, 840), at('Beer made from malt', 245, 840), at('LTR', 150, 840), at('50%', 80, 840),
  at('93 01 10 00 00 00', 1021, 810), at('Artillery weapons, self-propelled', 245, 810), at('PROHIBITED', 60, 810),
  at('27 10 12 11 00 00', 1021, 780), at('Motor spirit', 245, 780), at('LTR', 150, 780), at('special goods', 40, 780),
], 1267, 1791);

// --- the UAE's CEPA schedule (Annex 2B, 842 × 595): code, description, base rate, offer, years 1–10 ---
const CEPA_X = [391.6, 434.1, 476.5, 519.0, 561.5, 604.0, 646.5, 689.0, 731.5, 779.5];
const cepaRow = (y: number, code: string, description: string, base: string, category: string, years: readonly string[]) => [
  at(code, 70, y), at(description, 105, y), at(base, 315, y), at(category, 355, y), ...years.map((value, index) => at(value, CEPA_X[index]!, y)),
];
const STAGED = ['4.5', '4', '3.5', '3', '2.5', '2', '1.5', '1', '0.5', '0'];
const CEPA_PAGE = page(77, [
  at('Offer', 352, 540), at('Year 1', 385, 540), at('Year 10', 772, 540),
  ...cepaRow(500, '62052000', 'Men’s or boys’ shirts of cotton', '5', 'C', STAGED),
  ...cepaRow(480, '22030000', 'Beer made from malt', '50', 'F', Array(10).fill('EXC')),
  // The schedule drops leading zeros.
  ...cepaRow(460, '9024010', 'Black tea', '5', 'A', Array(10).fill('0')),
], 842, 595);

// --- China's 2026 tariff book (positions from p.161 and p.170 of the official PDF) ---
const CN_PAGE = page(161, [
  at('税则号列', 64.9, 758.2), at('货品名称', 140, 758.2), at('最惠国', 236, 758.2), at('协定税率', 340, 758.2), at('特惠', 470, 758.2), at('普通', 522, 758.2),
  // Oolong tea: each agreement rate opens a line; the agreements' codes wrap onto the lines below.
  at('801', 43.1, 700), at('0902.', 61.6, 700), at('4010', 79.8, 700), at('---', 100.6, 700), at('乌龙茶', 109, 700), at('15', 243.7, 700),
  at('7.5', 286.1, 700), at('亚太', 304.5, 700), at('AP', 321.7, 700), at('100', 525.6, 700),
  at('0', 286.1, 688), at('东盟', 304.5, 688), at('AS,', 321.7, 688), at('智', 334.9, 688), at('CL', 343.4, 688),
  at('澳', 304.5, 676), at('AU', 316.9, 676),
  // Iron ore: a provisional rate after △ replaces the MFN rate.
  at('802', 43.1, 650), at('2601.1110', 61.6, 650), at('---', 100.6, 650), at('平均粒度小于 0.8 毫米的', 109, 650), at('6', 240, 650), at('△', 251, 650), at('3', 261, 650),
  at('0', 286.1, 650), at('东盟', 304.5, 650), at('AS', 321.7, 650), at('35', 525.6, 650),
  // Printed with "ex": the rate covers only the goods named.
  at('803', 43.1, 625), at('ex', 58.5, 625), at('0904.2100', 66, 625), at('干辣椒', 109, 625), at('20', 243.7, 625), at('10', 286.1, 625), at('亚太', 304.5, 625), at('AP', 321.7, 625), at('70', 525.6, 625),
  // Rice: an MFN rate with a footnote (the in-quota rate); no AP rate.
  at('804', 43.1, 600), at('1006.3020', 61.6, 600), at('长粒米', 109, 600), at('65', 239.7, 600), at('①', 248.7, 600), at('0', 286.1, 600), at('港', 304.5, 600), at('HK,', 313, 600), at('180', 525.6, 600),
  // Digits printed as two glyph runs ("1", "4") are one rate.
  at('805', 43.1, 575), at('6205.2000', 61.6, 575), at('棉制', 109, 575), at('1', 240, 575), at('4', 246, 575), at('3', 286.1, 575), at('亚太', 304.5, 575), at('AP', 321.7, 575), at('90', 525.6, 575),
  // A specific duty printed as a footnote.
  at('806', 43.1, 550), at('0207.1422', 61.6, 550), at('----', 100.6, 550), at('鸡爪', 109, 550), at('②', 243.7, 550),
  at('①', 53.9, 86.3), at('关税配额税率：', 66, 86.3), at('1%', 121.9, 86.3), at('。', 130, 86.3),
  at('②', 53.9, 76), at('最惠国税率：', 66, 76), at('1', 121.9, 76), at('元 / 千克。', 130, 76),
]);

// --- Annex 1 of the 2026 adjustment plan: EX ≈ 89, code ≈ 127, name, MFN ≈ 466, provisional ≈ 525 ---
const CN_ANNEX_PAGE = page(3, [
  at('序号', 50, 760), at('税则号列', 127, 760), at('商品名称', 250, 760), at('最惠国税率', 466, 760), at('暂定税率', 525, 760),
  at('41', 50, 700), at('26011110', 127, 700), at('平均粒度小于0.8毫米的铁矿砂', 180, 700), at('6', 466, 700), at('3', 525, 700),
  at('42', 50, 680), at('ex', 89, 680), at('09042100', 127, 680), at('干辣椒（未磨），供加工用', 180, 680), at('20', 466, 680), at('5', 525, 680),
]);

/** A CAMEX workbook laid out as published: a header row naming each annex's columns. */
async function camexWorkbook() {
  const { default: Excel } = await import('exceljs');
  const workbook = new Excel.Workbook();
  const tec = workbook.addWorksheet('Anexo I - TEC');
  tec.addRow(['Atualizado até Resolução Gecex nº 926, de 24 de junho de 2026']);
  tec.addRow(['NCM', 'Descrição', 'TEC (%)']);
  for (const row of [
    ['1006.30.21', 'Polido ou brunido', '10.8'], ['6205.20.00', '-De algodão', 35], ['7418.10.00', '-Serviços de mesa, artigos de cozinha', 16],
    ['8471.30.12', 'De peso inferior a 3,5 kg', '16BIT'], ['8501.10.11', 'De passo não superior a 1,8°', '0BIT'], ['1001.99.00', '--Outros', 10], ['3004.90.99', 'Outros', '7.2'],
  ]) tec.addRow(row);
  const applied = workbook.addWorksheet('Anexo II - Alíquotas aplicadas');
  applied.addRow(['NCM', 'Descrição', 'TEC (%)', 'Alíquota aplicada (%)', 'Fundamentação']);
  applied.addRow(['7418.10.00', '-Serviços de mesa, artigos de cozinha', 16, 14.4, 'Resolução Gecex nº 353/2022']);
  applied.addRow(['6205.20.00', '-De algodão', 35, 35, null]);
  const header = ['NCM', 'Nº Ex', 'Descrição', 'Alíquota (%)', 'Quota', 'Unidade', 'Início de vigência', 'Término de vigência', 'Ato de inclusão'];
  const annex = (name: string, rows: unknown[][]) => { const sheet = workbook.addWorksheet(name); sheet.addRow(header); for (const row of rows) sheet.addRow(row); };
  annex('Anexo IV - Desabastecimento', [['3004.90.99', '001', 'Medicamento X, em comprimidos', 0, null, null, '01/03/2026', '28/02/2027', 'Resolução Gecex nº 850']]);
  annex('Anexo V - LETEC', [
    ['1006.30.21', '-', 'Polido ou brunido', 9, null, null, day('2026-01-01'), day('2026-12-31'), 'Resolução Gecex nº 700'],
    ['6205.20.00', '-', '-De algodão', 20, null, null, day('2026-01-01'), day('2026-12-31'), 'Resolução Gecex nº 701'],
  ]);
  annex('Anexo VI - LEBIT-BK', [['8471.30.12', '-', 'De peso inferior a 3,5 kg', 0, null, null, day('2026-03-01'), '-', 'Resolução Gecex nº 852']]);
  annex('Anexo VIII - Quotas', [['1001.99.00', '-', '--Outros', 0, 750000, 'Toneladas', day('2022-05-05'), null, 'Resolução Gecex nº 332']]);
  annex('Anexo IX - Elevações', [
    ['7418.10.00', '-', '-Serviços de mesa', 25, null, null, day('2026-07-01'), day('2027-06-30'), 'Resolução Gecex nº 901'],
    ['6205.20.00', '-', '-De algodão', 30, null, null, day('2026-06-01'), day('2026-12-31'), 'Resolução Gecex nº 902'],
  ]);
  annex('Anexo X - Automotivos', [['8703.40.00', '12', 'Automóvel desmontado', 14, null, null, day('2025-07-01'), day('2026-12-31'), 'Resolução Gecex nº 774']]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** A release definition pinned to fixture files, in a family of its own so other suites' releases are not this file's. */
function fixtureSource(key: TariffScheduleKey, files: { name: string; role: string; bytes: Buffer }[], lines: readonly ScheduleLine[]): TariffScheduleSource {
  const real = TARIFF_SCHEDULE_SOURCES[key];
  return {
    ...real, source_family: `${real.source_family}_FIXTURE_${MARKER}`,
    release: {
      ...real.release, identifier: `fixture-${key.toLowerCase()}-${MARKER}`, line_count: lines.length,
      files: files.map((file) => ({ name: file.name, role: file.role, url: `https://example.test/${file.name}`, sha256: sha256(file.bytes), size_bytes: file.bytes.length })),
    },
  };
}

const CN_BOOK = Buffer.from(`%PDF-fixture 2026 tariff book ${MARKER}`);
const CN_ANNEX = Buffer.from(`%PDF-fixture 2026 provisional annex ${MARKER}`);
const CN_LINES = assembleChinaLines(parseChinaTariffPages([CN_PAGE]), parseChinaProvisionalAnnexPages([CN_ANNEX_PAGE]));
const CN_FILES = [{ name: 'book.pdf', role: 'official_tariff', bytes: CN_BOOK }, { name: 'annex.pdf', role: 'official_provisional_rates', bytes: CN_ANNEX }];
const CN_SOURCE = fixtureSource('CN', CN_FILES, CN_LINES);
const GCC_TARIFF = Buffer.from(`%PDF-fixture GCC tariff ${MARKER}`);
const GCC_CEPA = Buffer.from(`%PDF-fixture UAE CEPA schedule ${MARKER}`);
const GCC_LINES = assembleGccLines(parseGccIntegratedTariffPages([GCC_PAGE]), parseUaeCepaSchedulePages([CEPA_PAGE]));
const GCC_FILES = [{ name: 'tariff.pdf', role: 'official_common_tariff', bytes: GCC_TARIFF }, { name: 'cepa.pdf', role: 'official_preference_schedule', bytes: GCC_CEPA }];
const GCC_SOURCE = fixtureSource('GCC', GCC_FILES, GCC_LINES);

let ops: Principal;
let orgId: string;

beforeAll(async () => {
  const user = await prisma.user.create({ data: { email: `${MARKER}@test.local`, name: 'Atlas ops', role: UserRole.ops_supervisor } });
  ops = { id: user.id, email: user.email, name: 'Atlas ops', role: UserRole.ops_supervisor, exporter_org_id: null, tier: OrgTier.paid };
  orgId = (await prisma.exporterOrg.create({ data: { display_name: `Schedules ${MARKER}`, tier: OrgTier.paid }, select: { id: true } })).id;
});
afterEach(() => { for (const key of Object.keys(TARIFF_SCHEDULE_SOURCES) as TariffScheduleKey[]) setTariffScheduleSourceForTesting(key, null); scheduleService.clearCaches(); });
afterAll(async () => { await prisma.$disconnect(); });

const importFixture = async (key: TariffScheduleKey, source: TariffScheduleSource, files: { name: string; bytes: Buffer }[], lines: readonly ScheduleLine[]) => {
  setTariffScheduleSourceForTesting(key, source);
  const bytes = await buildTariffScheduleBundle({ source, files, lines });
  return importTariffScheduleRelease(key, { actor: ops, bytes, release_identifier: source.release.identifier, reference_date: day(source.release.reference_date), source_url: source.release.source_url, activate: true, correlation_id: `${MARKER}-${key}`, retrieved_at: day('2026-10-19') });
};
const acquire = (country: string, hs6: string, clock: Date) => acquireTariffEvidence({
  job_id: `job-${MARKER}-${country}-${hs6}`, hs6, destinations: [country], resolution_clock: clock,
  policy: { policy_version: 'test', enabled: true, origin_country: 'IN', max_destinations: 1, live_fetch_timeout_ms: 5_000 }, completed: [], onOutcome: async () => undefined,
});

describe('the readers, on layouts measured from the official files', () => {
  test('GCC: twelve-digit codes with description, unit and the duty nearest the code; a second rate beside one code is refused', () => {
    expect(parseGccIntegratedTariffPages([GCC_PAGE])).toEqual([
      { code: '100630100000', description: 'Semi-milled or wholly milled rice, parboiled', unit: 'KG', raw_rate: '0%', locator: 'p.40' },
      { code: '620520000000', description: 'Men’s or boys’ shirts, of cotton', unit: 'U', raw_rate: '5%', locator: 'p.40' },
      { code: '220300000000', description: 'Beer made from malt', unit: 'LTR', raw_rate: '50%', locator: 'p.40' },
      { code: '930110000000', description: 'Artillery weapons, self-propelled', unit: null, raw_rate: 'PROHIBITED', locator: 'p.40' },
      { code: '271012110000', description: 'Motor spirit', unit: 'LTR', raw_rate: 'special goods', locator: 'p.40' },
    ]);
    expect(() => parseGccIntegratedTariffPages([page(41, [at('10 06 30 10 00 00', 1021, 900), at('5%', 80, 900), at('10%', 80, 895)], 1267, 1791)])).toThrow(expect.objectContaining({ code: 'conflicting_rate' }));
    expect(() => parseGccIntegratedTariffPages([GCC_PAGE, page(41, [at('10 06 30 10 00 00', 1021, 500)], 1267, 1791)])).toThrow(expect.objectContaining({ code: 'duplicate_code' }));
  });

  test('CEPA: eight-digit codes (leading zero restored), base rate, offer and all ten years; a missing year is refused', () => {
    expect(parseUaeCepaSchedulePages([CEPA_PAGE])).toEqual([
      { code: '62052000', description: 'Men’s or boys’ shirts of cotton', base: '5', category: 'C', years: STAGED, locator: 'p.77' },
      { code: '22030000', description: 'Beer made from malt', base: '50', category: 'F', years: Array(10).fill('EXC'), locator: 'p.77' },
      { code: '09024010', description: 'Black tea', base: '5', category: 'A', years: Array(10).fill('0'), locator: 'p.77' },
    ]);
    const short = page(78, [at('Offer', 352, 540), at('Year 10', 772, 540), ...cepaRow(500, '62052000', 'Shirts', '5', 'C', STAGED).slice(0, -1)], 842, 595);
    expect(() => parseUaeCepaSchedulePages([short])).toThrow(expect.objectContaining({ code: 'missing_year' }));
    // A page without the schedule's header is not read.
    expect(parseUaeCepaSchedulePages([page(1, cepaRow(500, '62052000', 'Shirts', '5', 'C', STAGED), 842, 595)])).toEqual([]);
  });

  test('China: MFN, provisional after △, the AP rate among wrapped agreement entries, ex lines, footnotes and split glyphs', () => {
    expect(parseChinaTariffPages([CN_PAGE])).toEqual([
      { code: '09024010', ex: false, description: '--- 乌龙茶', mfn: '15', mfn_note: null, provisional: null, apta: '7.5', locator: 'p.161' },
      { code: '26011110', ex: false, description: '--- 平均粒度小于 0.8 毫米的', mfn: '6', mfn_note: null, provisional: '3', apta: null, locator: 'p.161' },
      { code: '09042100', ex: true, description: '干辣椒', mfn: '20', mfn_note: null, provisional: null, apta: '10', locator: 'p.161' },
      { code: '10063020', ex: false, description: '长粒米', mfn: '65', mfn_note: '关税配额税率： 1% 。', provisional: null, apta: null, locator: 'p.161' },
      { code: '62052000', ex: false, description: '棉制', mfn: '14', mfn_note: null, provisional: null, apta: '3', locator: 'p.161' },
      { code: '02071422', ex: false, description: '---- 鸡爪', mfn: '最惠国税率： 1 元 / 千克。', mfn_note: null, provisional: null, apta: null, locator: 'p.161' },
    ]);
    const header = [at('税则号列', 64.9, 758.2)];
    // An agreement code before any agreement rate, or a footnote the page does not print, is refused.
    expect(() => parseChinaTariffPages([page(9, [...header, at('0902.4010', 61.6, 700), at('15', 243.7, 700), at('AP', 321.7, 700)])])).toThrow(expect.objectContaining({ code: 'agreement_without_rate' }));
    expect(() => parseChinaTariffPages([page(9, [...header, at('0902.4010', 61.6, 700), at('③', 243.7, 700)])])).toThrow(expect.objectContaining({ code: 'missing_footnote' }));
    // A page without the tariff's header row is not read.
    expect(parseChinaTariffPages([page(9, [at('0902.4010', 61.6, 700), at('15', 243.7, 700)])])).toEqual([]);
  });

  test('China Annex 1: whole-line and ex entries', () => {
    expect(parseChinaProvisionalAnnexPages([CN_ANNEX_PAGE])).toEqual([
      { code: '26011110', ex: false, description: '平均粒度小于0.8毫米的铁矿砂', mfn: '6', provisional: '3', locator: 'p.3' },
      { code: '09042100', ex: true, description: '干辣椒（未磨），供加工用', mfn: '20', provisional: '5', locator: 'p.3' },
    ]);
  });

  test('Brazil: the TEC, Annex II applied rates and the exception annexes, columns found by their names', async () => {
    const data = await parseBrazilCamexWorkbook(await camexWorkbook());
    expect(data.updated_through).toBe('Resolução Gecex nº 926, de 24 de junho de 2026');
    expect(data.tec).toHaveLength(7);
    expect(data.tec[0]).toEqual({ code: '10063021', description: 'Polido ou brunido', raw: '10.8' });
    expect(data.tec.find((row) => row.code === '84713012')?.raw).toBe('16BIT');
    expect(data.applied).toEqual([
      { code: '74181000', description: '-Serviços de mesa, artigos de cozinha', tec_raw: '16', applied_raw: '14.4', basis: 'Resolução Gecex nº 353/2022' },
      { code: '62052000', description: '-De algodão', tec_raw: '35', applied_raw: '35', basis: null },
    ]);
    expect(data.exceptions).toHaveLength(8);
    expect(data.exceptions.find((entry) => entry.annex === 'IV')).toEqual({ annex: 'IV', code: '30049099', ex: '001', description: 'Medicamento X, em comprimidos', raw_rate: '0', quota: null, quota_unit: null, from: '2026-03-01', to: '2027-02-28', act: 'Resolução Gecex nº 850' });
    expect(data.exceptions.find((entry) => entry.annex === 'VI')).toMatchObject({ code: '84713012', ex: '-', raw_rate: '0', from: '2026-03-01', to: null });
    expect(data.exceptions.find((entry) => entry.annex === 'VIII')).toMatchObject({ code: '10019900', quota: '750000', quota_unit: 'Toneladas', from: '2022-05-05', to: null });
    expect(data.exceptions.find((entry) => entry.annex === 'X')).toMatchObject({ code: '87034000', ex: '12', raw_rate: '14' });
  });
});

describe('assembling the lines a market pays', () => {
  test('GCC: PROHIBITED and special-goods lines are not scored; the UAE’s CEPA rate is staged from 1 May 2022, counted by anniversary', () => {
    const byCode = new Map(GCC_LINES.map((line) => [line.code, line]));
    expect(byCode.get('100630100000')).toMatchObject({ duty: percent(0), exception: null, india_preference: null });
    expect(byCode.get('930110000000')).toMatchObject({ duty: { kind: 'unparsed' }, exception: { countries: [], reason: expect.stringContaining('PROHIBITED') } });
    expect(byCode.get('271012110000')?.exception?.reason).toMatch(/special-goods line/);
    expect(byCode.get('220300000000')).toMatchObject({ duty: percent(50), india_preference: null, notes: ['Excluded from the UAE’s CEPA concessions (category F, Annex 2B p.77).'] });
    const shirts = byCode.get('620520000000')!;
    expect(shirts.india_preference).toEqual({
      countries: ['AE'], program: 'India–UAE CEPA, Annex 2B', scope: 'direct', raw_rate: 'base 5, category C', locator: 'Annex 2B p.77 · 62052000', is_quota: false,
      staging: { entry_into_force: '2022-05-01', years: STAGED },
    });
    expect([day('2022-04-30'), day('2022-05-01'), day('2023-04-30'), day('2023-05-01'), day('2026-10-19')].map((date) => cepaYear(date, '2022-05-01'))).toEqual([null, 1, 1, 2, 5]);
    expect(preferenceDutyAt(shirts, 'AE', day('2026-10-19'))).toMatchObject({ year: 5, duty: percent(2.5) });
    expect(preferenceDutyAt(shirts, 'AE', day('2027-05-01'))).toMatchObject({ year: 6, duty: percent(2) });
    // After year 10 the final rate stays; before entry into force, and for Bahrain, there is none.
    expect(preferenceDutyAt(shirts, 'AE', day('2033-01-01'))).toMatchObject({ year: 11, duty: percent(0) });
    expect(preferenceDutyAt(shirts, 'AE', day('2022-04-01'))).toBeNull();
    expect(preferenceDutyAt(shirts, 'BH', day('2026-10-19'))).toBeNull();
  });

  test('Mercosur: the TEC, with capital-goods and IT lines left to each member', async () => {
    const lines = assembleMercosurLines(await parseBrazilCamexWorkbook(await camexWorkbook()));
    const byCode = new Map(lines.map((line) => [line.code, line]));
    expect(byCode.get('10063021')).toMatchObject({ duty: percent(10.8), exception: null, locator: 'Anexo I (TEC)' });
    expect(byCode.get('84713012')?.exception?.reason).toMatch(/^An information-technology \(BIT\) line of the TEC/);
    expect(byCode.get('85011011')?.exception).not.toBeNull();
  });

  test('Brazil: Annex II’s rate, else the TEC; whole-line exception rates while in force; two different rates in force state none', async () => {
    const lines = assembleBrazilLines(await parseBrazilCamexWorkbook(await camexWorkbook()));
    const byCode = new Map(lines.map((line) => [line.code, line]));
    const rice = byCode.get('10063021')!;
    expect(rice).toMatchObject({ duty: percent(10.8), locator: 'Anexo I (TEC)', dated: [{ from: '2026-01-01', to: '2026-12-31', duty: percent(9), locator: 'Anexo V, Resolução Gecex nº 700' }] });
    expect(lineDutyAt(rice, 'BR', day('2026-10-19'))).toMatchObject({ duty: percent(9), locator: 'Anexo V, Resolução Gecex nº 700', dated: true });
    expect(lineDutyAt(rice, 'BR', day('2027-01-04'))).toMatchObject({ duty: percent(10.8), dated: false });
    const brass = byCode.get('74181000')!;
    expect(brass).toMatchObject({ duty: percent(14.4), locator: 'Anexo II' });
    expect(lineDutyAt(brass, 'BR', day('2026-06-30'))).toMatchObject({ duty: percent(14.4) });
    expect(lineDutyAt(brass, 'BR', day('2026-10-19'))).toMatchObject({ duty: percent(25), locator: 'Anexo IX, Resolução Gecex nº 901' });
    const shirts = byCode.get('62052000')!;
    expect(lineDutyAt(shirts, 'BR', day('2026-03-01'))).toMatchObject({ duty: percent(20) });
    expect(lineDutyAt(shirts, 'BR', day('2026-10-19'))).toEqual({ duty: null, reason: 'Two different dated rates are in force (20% under Anexo V, Resolução Gecex nº 701; 30% under Anexo IX, Resolução Gecex nº 902).' });
    // An open-ended LEBIT/BK rate; a BIT line is Brazil's own rate, not an exception.
    expect(lineDutyAt(byCode.get('84713012')!, 'BR', day('2026-10-19'))).toMatchObject({ duty: percent(0), dated: true });
    expect(byCode.get('84713012')).toMatchObject({ duty: percent(16), exception: null });
    // Quotas and ex-tarifários are said, never scored.
    expect(byCode.get('10019900')).toMatchObject({ duty: percent(10), notes: ['0% within a quota of 750000 Toneladas (Anexo VIII, Resolução Gecex nº 332; 2022-05-05 to open-ended).'] });
    expect(byCode.get('30049099')).toMatchObject({ duty: percent(7.2), notes: ['Ex 001: 0% for “Medicamento X, em comprimidos” (Anexo IV, Resolução Gecex nº 850; 2026-03-01 to 2027-02-28).'] });
  });

  test('China: the provisional rate replaces MFN, Annex 1 must agree with the book, and specific and “lower of” duties keep every operand', () => {
    const byCode = new Map(CN_LINES.map((line) => [line.code, line]));
    expect(byCode.get('09024010')).toMatchObject({
      duty: percent(15), raw_rate: '15', exception: null,
      india_preference: { countries: ['CN'], program: 'Asia-Pacific Trade Agreement (亚太 AP)', scope: 'group', raw_rate: '7.5', is_quota: false, duty: percent(7.5) },
    });
    expect(byCode.get('26011110')).toMatchObject({ duty: percent(3), raw_rate: 'MFN 6; provisional △3', notes: ['Provisional rate for 2026 in place of the MFN rate (6).'], india_preference: null });
    expect(byCode.get('09042100')).toMatchObject({
      exception: { countries: [], reason: 'The line is printed with “ex”: its rate covers only the goods its description names.' },
      notes: ['A provisional rate of 5% applies to part of this line only (“干辣椒（未磨），供加工用”, Annex 1 p.3).'],
    });
    expect(byCode.get('10063020')).toMatchObject({ duty: percent(65), notes: ['Tariff-rate quota: 关税配额税率： 1% 。 The rate scored is the out-of-quota rate.'] });
    expect(byCode.get('02071422')?.duty).toMatchObject({ kind: 'specific', specific_amount: 1, specific_currency: 'CNY', specific_unit: 'kg', specific_unit_quantity: 1, expression: '最惠国税率： 1 元 / 千克。' });

    const rows: ChinaTariffRow[] = [
      { code: '37024229', ex: false, description: '其他', mfn: '最惠国税率： 1.6 元 / 平方米。', mfn_note: null, provisional: '最惠国暂定税率： 1.0 元 / 平方米。', apta: '8', locator: 'p.476' },
      { code: '40012100', ex: false, description: '烟胶片', mfn: '20', mfn_note: null, provisional: '最惠国暂定税率： 20% 或 1500 元 / 吨，两者从低。', apta: '17', locator: 'p.540' },
    ];
    const annex: ChinaProvisionalEntry[] = [
      { code: '37024229', ex: false, description: '其他', mfn: '1.6元/平方米', provisional: '1.0元/平方米', locator: 'p.9' },
      { code: '40012100', ex: false, description: '烟胶片', mfn: '20', provisional: '20%或1500元/吨，两者从低', locator: 'p.11' },
    ];
    const [film, rubber] = assembleChinaLines(rows, annex);
    expect(film!.duty).toMatchObject({ kind: 'specific', specific_amount: 1, specific_currency: 'CNY', specific_unit: 'm2' });
    expect(rubber!.duty).toMatchObject({ kind: 'mixed', ad_valorem_rate_percent: 20, specific_amount: 1500, specific_currency: 'CNY', specific_unit: 'kg', specific_unit_quantity: 1000 });
    // The book and Annex 1 disagree, Annex 1 names a line the book lacks, the book marks △ without Annex 1: refused.
    const tea = parseChinaTariffPages([CN_PAGE]);
    expect(() => assembleChinaLines(tea, [{ ...parseChinaProvisionalAnnexPages([CN_ANNEX_PAGE])[0]!, provisional: '2' }])).toThrow(expect.objectContaining({ code: 'annex_disagrees' }));
    expect(() => assembleChinaLines(tea, [...parseChinaProvisionalAnnexPages([CN_ANNEX_PAGE]), { code: '99999999', ex: false, description: '', mfn: '5', provisional: '1', locator: 'p.4' }])).toThrow(expect.objectContaining({ code: 'annex_code_missing' }));
    expect(() => assembleChinaLines(tea, [])).toThrow(expect.objectContaining({ code: 'annex_disagrees' }));
    expect(() => assembleChinaLines([{ ...rows[1]!, provisional: null, mfn: '最惠国税率： 3 元 / 升。' }], [])).toThrow(expect.objectContaining({ code: 'unreadable_rate' }));
  });
});

describe('the tariff-schedule bundle', () => {
  test('is deterministic and refuses another file, a changed line count, or tampering', async () => {
    const files = CN_FILES.map(({ name, bytes }) => ({ name, bytes }));
    const one = await buildTariffScheduleBundle({ source: CN_SOURCE, files, lines: CN_LINES });
    expect((await buildTariffScheduleBundle({ source: CN_SOURCE, files: [...files].reverse(), lines: [...CN_LINES].reverse() })).equals(one)).toBe(true);
    const read = await readTariffScheduleBundle({ bytes: one, source: CN_SOURCE, release_identifier: CN_SOURCE.release.identifier, verify_files: true });
    expect(read).toMatchObject({ schedule: 'CN', release_identifier: CN_SOURCE.release.identifier, exception_count: 1, india_preference_count: 3, effective_from: '2026-01-01', valid_until: '2026-12-31' });
    expect(read.lines.size).toBe(6);
    expect(read.rights_basis).toMatch(/^The Copyright Law of the People’s Republic of China \(2020\), Article 5/);
    expect(read.files.map((file) => file.name)).toEqual(['book.pdf', 'annex.pdf', 'normalized-lines.json']);
    await expect(buildTariffScheduleBundle({ source: CN_SOURCE, files: [{ name: 'book.pdf', bytes: Buffer.from('another edition') }, files[1]!], lines: CN_LINES })).rejects.toMatchObject({ code: 'source_checksum_mismatch' });
    await expect(buildTariffScheduleBundle({ source: CN_SOURCE, files, lines: CN_LINES.slice(1) })).rejects.toMatchObject({ code: 'line_count_changed' });
    await expect(buildTariffScheduleBundle({ source: CN_SOURCE, files: files.slice(0, 1), lines: CN_LINES })).rejects.toMatchObject({ code: 'unexpected_manifest' });
    const JSZip = (await import('jszip')).default;
    // Lines edited after the build no longer authenticate.
    const edited = await JSZip.loadAsync(one);
    edited.file('normalized-lines.json', JSON.stringify(CN_LINES.map((line) => ({ ...line, duty: { ...line.duty, ad_valorem_rate_percent: 0 } }))));
    await expect(readTariffScheduleBundle({ bytes: Buffer.from(await edited.generateAsync({ type: 'nodebuffer' })), source: CN_SOURCE, release_identifier: CN_SOURCE.release.identifier })).rejects.toMatchObject({ code: 'artifact_integrity_failure' });
    // An official file swapped inside the bundle is caught when files are verified (at import).
    const swapped = await JSZip.loadAsync(one);
    swapped.file('book.pdf', Buffer.from('another edition'));
    await expect(readTariffScheduleBundle({ bytes: Buffer.from(await swapped.generateAsync({ type: 'nodebuffer' })), source: CN_SOURCE, release_identifier: CN_SOURCE.release.identifier, verify_files: true })).rejects.toMatchObject({ code: 'source_checksum_mismatch' });
    // A manifest that does not record its rights check is refused.
    const unrighted = await JSZip.loadAsync(one);
    const manifest = JSON.parse(await unrighted.file('manifest.json')!.async('string')) as Record<string, unknown>;
    delete manifest.rights_basis;
    unrighted.file('manifest.json', JSON.stringify(manifest));
    await expect(readTariffScheduleBundle({ bytes: Buffer.from(await unrighted.generateAsync({ type: 'nodebuffer' })), source: CN_SOURCE, release_identifier: CN_SOURCE.release.identifier })).rejects.toMatchObject({ code: 'missing_rights_basis' });
    // The real release pins other files.
    await expect(readTariffScheduleBundle({ bytes: one, source: TARIFF_SCHEDULE_SOURCES.CN, release_identifier: CN_SOURCE.release.identifier })).rejects.toMatchObject({ code: 'unexpected_manifest' });
  });
});

describe('a market’s access from its schedule’s release', () => {
  test('China: no_release until imported; then its own tariff, labelled, with India’s AP rate as needing origin proof, and nothing outside 2026', async () => {
    setTariffScheduleSourceForTesting('CN', CN_SOURCE);
    const clock = new Date('2026-10-19T06:00:00Z');
    expect(await acquire('CN', '090240', clock)).toMatchObject([{ country_code: 'CN', outcome: 'no_release', provider_key: 'cn_customs_tariff_2026', reason: 'No China’s 2026 customs tariff release has been imported and activated.' }]);

    const imported = await importFixture('CN', CN_SOURCE, CN_FILES, CN_LINES);
    expect(imported.release).toMatchObject({ status: AuthorityReleaseStatus.active, destination_scope: ['CN'] });
    expect(imported.release.validation).toMatchObject({ schedule: 'CN', tariff_line_count: 6, exception_count: 1, india_preference_count: 3, valid_until: '2026-12-31', trade_remedies_modelled: false, per_artifact_sha256_validated: true, rights_basis: expect.stringContaining('Article 5') });

    const tea = await fetchTariffScheduleMarketAccess('CN', 'CN', '090240', { now: clock, origin_country: 'IN' });
    expect(tea).toMatchObject({
      country_code: 'CN', provider: 'cn_customs_tariff_2026', national_code_system: 'CN_CUSTOMS_TARIFF', source_release_id: imported.release.id,
      resolution: { resolution: 'exact' }, general_duty: percent(15),
      india_preference: { applicability: 'potentially_applicable_requires_origin_proof', duty: percent(7.5), geographic_area_id: 'Asia-Pacific Trade Agreement (亚太 AP)' },
      raw_evidence: { schedule_read: { schedule: 'CN', label: 'China’s 2026 customs tariff', market: 'CN', trade_remedies_modelled: false } },
    });
    expect(tea.raw_evidence).not.toHaveProperty('common_tariff');
    expect(await fetchTariffScheduleMarketAccess('CN', 'CN', '260111', { now: clock })).toMatchObject({ general_duty: percent(3), raw_evidence: { notes: ['26011110: Provisional rate for 2026 in place of the MFN rate (6).'] } });
    expect(await fetchTariffScheduleMarketAccess('CN', 'CN', '100630', { now: clock })).toMatchObject({ general_duty: percent(65), india_preference: { applicability: 'not_applicable', basis: expect.stringContaining('prints no Asia-Pacific Trade Agreement') } });
    expect(await fetchTariffScheduleMarketAccess('CN', 'CN', '090421', { now: clock })).toMatchObject({ general_duty: null, resolution: { resolution: 'unavailable', reason: expect.stringContaining('09042100 not read automatically for CN') } });
    expect(await fetchTariffScheduleMarketAccess('CN', 'CN', '620520', { now: clock, origin_country: 'BD' })).toMatchObject({ general_duty: percent(14), india_preference: { applicability: 'not_applicable', basis: 'The requested origin is BD, not India.' } });
    // Outside the release's year it states nothing.
    expect(await fetchTariffScheduleMarketAccess('CN', 'CN', '090240', { now: day('2027-01-01') })).toMatchObject({ general_duty: null, resolution: { reason: expect.stringContaining('covers the tariff to 2026-12-31') } });
    expect(await fetchTariffScheduleMarketAccess('CN', 'CN', '090240', { now: day('2025-12-31') })).toMatchObject({ general_duty: null, resolution: { reason: expect.stringContaining('in force from 2026-01-01') } });
    await expect(fetchTariffScheduleMarketAccess('CN', 'BR', '090240', { now: clock })).rejects.toThrow(/not served by the CN release/);
    // The adapter a run uses reads the same release.
    expect(await DESTINATION_ADAPTERS.CN!.fetch({ hs6: '620520', destination_country: 'CN', origin_country: 'IN', now: clock })).toMatchObject({ general_duty: percent(14) });
  });

  test('China in Demand Discovery v5: scored at the schedule-read quality and said so; a duty per kilogram is converted at its currency’s rate', async () => {
    setTariffScheduleSourceForTesting('CN', CN_SOURCE);
    const clock = new Date('2026-10-19T06:00:00Z');
    await importFixture('CN', CN_SOURCE, CN_FILES, CN_LINES);
    expect(await acquire('CN', '090240', clock)).toMatchObject([{ outcome: 'acquired', provider_key: 'cn_customs_tariff_2026' }]);
    expect(await acquire('CN', '020714', clock)).toMatchObject([{ outcome: 'acquired' }]);
    const asOf = new Date('2026-10-19T12:00:00Z');
    const usd = async (currency: string) => ({ rate: currency === 'CNY' ? 0.14 : 1, frozen: null });
    const official = await runInputs.officialDuties({ markets: ['CN'], hs6: '090240', as_of: asOf, exporter_org_id: orgId, hs_revision: 'HS2022', minimum_confidence: POLICY.duty.official_minimum_confidence, usd });
    expect(official.resolutions.get('CN')).toMatchObject({ status: 'percent', duty_percent: 15, schedule_read: { schedule: 'CN', label: 'China’s 2026 customs tariff' } });
    expect(official.resolutions.get('CN')).not.toHaveProperty('common_tariff');
    const duty = dutyInputs({ markets: ['CN'], hs6: '090240', as_of: asOf, official: official.resolutions, primary_tariffs: new Map(), manufactured_tariffs: new Map(), agreements: [], policy: POLICY }).get('CN')!;
    const quality = { official: POLICY.quality.official, estimate: POLICY.quality.duty_estimate, agent_recorded: POLICY.quality.official_agent_recorded, common_tariff: POLICY.quality.official_common_tariff, schedule_read: POLICY.quality.official_schedule_read };
    const scored = scoreDuty(duty, POLICY, quality);
    expect(POLICY.quality.official_schedule_read).toBe(0.9);
    expect(scored).toMatchObject({ score: 40, quality: 0.9, inputs: { basis: 'official', duty_percent: 15, schedule_read: 'China’s 2026 customs tariff', preference_percent: 7.5 } });
    expect(metricSentence(scored)).toBe('Duty on Indian goods is 15% (read from China’s 2026 customs tariff; trade remedies are not checked); 7.5% may apply with proof of Indian origin.');

    const chicken = await runInputs.officialDuties({ markets: ['CN'], hs6: '020714', as_of: asOf, exporter_org_id: orgId, hs_revision: 'HS2022', minimum_confidence: POLICY.duty.official_minimum_confidence, usd });
    expect(chicken.resolutions.get('CN')).toMatchObject({ status: 'specific', usd_per_kg: 0.14, expression: '最惠国税率： 1 元 / 千克。', fx: { currency: 'CNY', usd_per_unit: 0.14 }, schedule_read: { schedule: 'CN' } });
  });

  test('the UAE and Bahrain: the GCC common tariff, labelled; the UAE’s CEPA rate for India by year, or none where lines differ or the line is excluded', async () => {
    const clock = new Date('2026-10-19T06:00:00Z');
    const imported = await importFixture('GCC', GCC_SOURCE, GCC_FILES, GCC_LINES);
    expect(imported.release).toMatchObject({ status: AuthorityReleaseStatus.active, destination_scope: ['AE', 'BH'] });
    const shirts = await fetchTariffScheduleMarketAccess('GCC', 'AE', '620520', { now: clock });
    expect(shirts).toMatchObject({
      provider: 'gcc_unified_customs_tariff', national_code_system: 'GCC_INTEGRATED', general_duty: percent(5),
      india_preference: { applicability: 'potentially_applicable_requires_origin_proof', duty: percent(2.5), geographic_area_id: 'India–UAE CEPA, Annex 2B', source_reference: expect.stringContaining('Annex 2B p.77 · 62052000'), raw_evidence: { scope: 'direct', staging: { entry_into_force: '2022-05-01' } } },
      raw_evidence: { common_tariff: { union: 'GCC', label: 'GCC common customs tariff', member: 'AE', national_exceptions_modelled: false } },
    });
    expect(await fetchTariffScheduleMarketAccess('GCC', 'AE', '620520', { now: day('2027-05-01') })).toMatchObject({ india_preference: { duty: percent(2) } });
    expect(await fetchTariffScheduleMarketAccess('GCC', 'BH', '620520', { now: clock })).toMatchObject({ general_duty: percent(5), india_preference: { applicability: 'not_applicable', basis: expect.stringContaining('Bahrain') }, raw_evidence: { common_tariff: { member: 'BH' } } });
    expect(await fetchTariffScheduleMarketAccess('GCC', 'AE', '220300', { now: clock })).toMatchObject({ general_duty: percent(50), india_preference: { applicability: 'not_applicable', basis: expect.stringContaining('Excluded from the UAE’s CEPA concessions') } });
    expect(await fetchTariffScheduleMarketAccess('GCC', 'AE', '100630', { now: clock })).toMatchObject({ general_duty: percent(0), india_preference: { applicability: 'unknown', basis: expect.stringContaining('no line matching') } });
    expect(await fetchTariffScheduleMarketAccess('GCC', 'AE', '930110', { now: clock })).toMatchObject({ general_duty: null, resolution: { reason: expect.stringContaining('PROHIBITED') } });
    expect(await fetchTariffScheduleMarketAccess('GCC', 'BH', '271012', { now: clock })).toMatchObject({ general_duty: null, resolution: { reason: expect.stringContaining('special-goods line') } });
  });

  test('lines with the same duty but different India rates state the duty and no single India rate', async () => {
    const line = (code: string, staged: boolean): ScheduleLine => ({
      code, description: 'Shirts', unit: 'U', duty: { kind: 'ad_valorem', ad_valorem_rate_percent: 5, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: '5%', note: null }, raw_rate: '5%', locator: 'p.40', exception: null,
      ...(staged ? { india_preference: { countries: ['AE'], program: 'India–UAE CEPA, Annex 2B', scope: 'direct' as const, raw_rate: 'base 5, category C', locator: 'Annex 2B p.77', is_quota: false, staging: { entry_into_force: '2022-05-01', years: STAGED } } } : { notes: ['Excluded from the UAE’s CEPA concessions (category F, Annex 2B p.77).'], india_preference: null }),
    });
    const lines = [line('620520000010', true), line('620520000090', false)];
    const files = [{ name: 'tariff.pdf', role: 'official_common_tariff', bytes: Buffer.from(`%PDF-split ${MARKER}`) }, { name: 'cepa.pdf', role: 'official_preference_schedule', bytes: Buffer.from(`%PDF-split cepa ${MARKER}`) }];
    const source = { ...fixtureSource('GCC', files, lines), source_family: `GCC_SPLIT_FIXTURE_${MARKER}` };
    await importFixture('GCC', source, files, lines);
    expect(await fetchTariffScheduleMarketAccess('GCC', 'AE', '620520', { now: day('2026-10-19') })).toMatchObject({
      general_duty: percent(5), resolution: { resolution: 'all_children_equivalent' },
      india_preference: { applicability: 'unknown', duty: null, basis: 'The national lines beneath 620520 carry different India rates (620520000010: 2.5%; 620520000090: excluded); the product\'s declarable line decides which applies.' },
    });
  });

  test('Brazil: a dated exception rate in force is the duty, said with where it comes from; two different ones state none', async () => {
    const workbook = await camexWorkbook();
    const lines = assembleBrazilLines(await parseBrazilCamexWorkbook(workbook));
    const files = [{ name: 'camex.xlsx', role: 'official_tariff_workbook', bytes: workbook }];
    const source = fixtureSource('BR', files, lines);
    await importFixture('BR', source, files, lines);
    const clock = day('2026-10-19');
    const rice = await fetchTariffScheduleMarketAccess('BR', 'BR', '100630', { now: clock });
    expect(rice).toMatchObject({ general_duty: percent(9), raw_evidence: { schedule_read: { schedule: 'BR', label: 'Brazil’s CAMEX applied tariff' } } });
    expect(rice.lines[0]).toMatchObject({ duty: percent(9), conditions: { dated_rate: 'Anexo V, Resolução Gecex nº 700', basis: 'national_schedule' } });
    expect(await fetchTariffScheduleMarketAccess('BR', 'BR', '620520', { now: clock })).toMatchObject({ general_duty: null, resolution: { reason: expect.stringContaining('Two different dated rates are in force') } });
    expect(await fetchTariffScheduleMarketAccess('BR', 'BR', '741810', { now: clock })).toMatchObject({ general_duty: percent(25) });
  });
});

describe('the real releases', () => {
  test('pin their official files and serve seven markets no other source serves', () => {
    const all = Object.values(TARIFF_SCHEDULE_SOURCES);
    const markets = all.flatMap((source) => Object.keys(source.countries));
    expect(markets.sort()).toEqual(['AE', 'AR', 'BH', 'BR', 'CN', 'PY', 'UY']);
    expect(new Set(all.map((source) => source.provider)).size).toBe(4);
    const unionMembers = new Set(Object.values(CUSTOMS_UNION_SOURCES).flatMap((source) => source.members));
    for (const source of all) {
      expect(source.release.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256) && file.size_bytes > 100_000 && file.url.startsWith('https://')), source.key).toBe(true);
      for (const [code, country] of Object.entries(source.countries)) {
        expect(unionMembers.has(code), code).toBe(false);
        expect(country.note.length, code).toBeGreaterThan(40);
        expect(DESTINATION_ADAPTERS[code], code).toMatchObject({ provider_key: source.provider, retrieval: 'retained_release' });
        expect(tariffScheduleSourceFor(code)?.key, code).toBe(source.key);
        expect(tariffScheduleBasisFor(source.provider, code), code).toEqual({ basis: country.basis, key: source.key, label: source.label });
      }
    }
    expect(Object.fromEntries(all.map((source) => [source.key, source.release.line_count]))).toEqual({ GCC: 13_449, MERCOSUR: 10_516, CN: 8_972, BR: 10_516 });
    expect(TARIFF_SCHEDULE_SOURCES.CN.release.valid_until).toBe('2026-12-31');
    // Each release records its rights check (D-030).
    for (const source of all) expect(source.release.rights.length, source.key).toBeGreaterThan(200);
    // Unions read as common tariffs (D-028); China and Brazil read as their own tariffs (D-031).
    expect(Object.values(TARIFF_SCHEDULE_SOURCES.GCC.countries).map((country) => country.basis)).toEqual(['common_tariff', 'common_tariff']);
    expect(TARIFF_SCHEDULE_SOURCES.CN.countries.CN!.basis).toBe('national_schedule');
    expect(TARIFF_SCHEDULE_SOURCES.BR.countries.BR!.basis).toBe('national_schedule');
    // Saudi Arabia keeps its national pack; a provider that is not a schedule labels nothing.
    expect(tariffScheduleSourceFor('SA')).toBeNull();
    expect(tariffScheduleBasisFor('gcc_unified_customs_tariff', 'SA')).toBeNull();
    expect(tariffScheduleBasisFor('eu_taric', 'DE')).toBeNull();
  });
});
