import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const VIETNAM_REMEDY_REFERENCE_DATE = '2026-09-23' as const;
export const VIETNAM_REMEDY_MANIFEST_VERSION = 'vn-trav-trade-remedies-2026-09-23-v1' as const;
export const VIETNAM_REMEDY_REGISTER_URL = 'https://trav.gov.vn/default.aspx?page=news&do=browse&category_id=91b07cf1-3658-4f39-b688-73b9e8ff8a05' as const;
const TRAV = 'https://trav.gov.vn/data/00195410-a87c-4a80-989d-83a83a4e020d/userfiles/files/';

export type VietnamRemedyKind = 'ANTI_DUMPING' | 'ANTI_DUMPING_AND_COUNTERVAILING' | 'ANTI_CIRCUMVENTION';
export interface VietnamRemedyRate { origin: string; producers: readonly string[]; related_traders: readonly string[]; expression: string; basis: 'named' | 'cooperating_non_sampled' | 'all_others' | 'origin_wide' | 'published_range' }
export interface VietnamTradeRemedy {
  id: string; case_code: string; kind: VietnamRemedyKind; product: string;
  tariff_codes: readonly string[]; origin_countries: readonly string[];
  effective_from: string; effective_until: string | null;
  decision: string; source_url: string;
  /** India-origin measures carry the complete producer table; others carry the official published range and any residual rate. */
  evidence_grade: 'producer_table_confirmed' | 'published_range_confirmed';
  published_range: string; rates: readonly VietnamRemedyRate[]; note: string | null;
}
/** `decided` is the verified date of the closing decision, or null where only the outcome (not its date) was verified. */
export interface VietnamHistoricalRemedy { case_code: string; product: string; origin_countries: readonly string[]; status: 'EXPIRED' | 'TERMINATED' | 'NOT_IMPOSED' | 'TERMINATED_FOR_ORIGIN'; decided: string | null; decision: string }
export interface VietnamPendingRemedy { case_code: string; product: string; origin_countries: readonly string[]; status: 'INVESTIGATION' | 'REVIEW'; opened: string; decision: string }
export interface VietnamTradeRemedyManifest {
  version: typeof VIETNAM_REMEDY_MANIFEST_VERSION; complete_as_of: typeof VIETNAM_REMEDY_REFERENCE_DATE;
  register_enumeration_complete: true; enumeration_basis: string;
  measures: readonly VietnamTradeRemedy[]; historical: readonly VietnamHistoricalRemedy[]; pending: readonly VietnamPendingRemedy[];
}

const rate = (origin: string, producers: string[], expression: string, related_traders: string[] = [], basis: VietnamRemedyRate['basis'] = 'named'): VietnamRemedyRate => ({ origin, producers, related_traders, expression, basis });
const others = (origin: string, expression: string): VietnamRemedyRate => ({ origin, producers: [], related_traders: [], expression, basis: 'all_others' });
const range = (origin: string, expression: string): VietnamRemedyRate => ({ origin, producers: [], related_traders: [], expression, basis: 'published_range' });
const codes = (...values: string[]) => values.map(value => value.replace(/\./g, ''));

const AD23_COOPERATING: readonly [string[], string[]][] = [
  [['Orinda Industries LLP'], []], [['Bluezone Vitrified Private Limited', 'Bluegress Porselano LLP', 'Bluezone Tiles LLP'], ['Bluezone Impex']], [['Intile Ceramika'], []],
  [['Kalyan Glazed Tiles', 'Letic Vitrified Private Limited', 'Latigres Vitrified Private Limited'], []], [['Sega Granito LLP'], []],
  [['Boffo Granito LLP', 'Big Tiles', 'Bonza Vitrified Private Limited'], []], [['Coverstone Ceramic LLP'], ['Winasa Ceramica']], [['Simero Vitrified Private Limited'], []],
  [['Mozilla Granito LLP', 'Sunpark Granito Private Limited'], []], [['Valenza Granito LLP'], ['Valenza Ceramic LLP']], [['Blizzard Ceramica LLP'], ['Hindgres Ceramica Private Limited']],
  [['Itaca Ceramic Private Limited', 'Ita Lake Ceramic Private Limited', 'Clayrock Granito LLP'], []], [['Italica Granito Private Limited'], []],
  [['Livenza Granito LLP', 'L-Tile Granito LLP'], ['L Group International LLP']], [['Octiva Ceramic', 'Vizoli Tiles LLP'], ['Novagres Ceramica']],
  [['Pavit Ceramics Private Limited', 'Victory Ceratech Private Limited'], []], [['Sparten Granito Private Limited'], []], [['Soriso Ceramic Private Limited'], ['Dali Ceramico LLP']],
  [['Acecon Vitrified Private Limited'], []], [['Icon Granito Private Limited'], []], [['Adicon Ceramics Limited'], []], [['Agrasenprime Overseas Private Limited'], []],
  [['Commander Vitrified Private Limited'], []], [['Cyan Granito LLP'], ['Concor International']], [['Lavit Tile LLP'], []], [['Laxveer Ceramic LLP'], []], [['Lonix Ceramica LLP'], []],
  [['Maps Granito Private Limited'], []], [['Max Granito Private Limited'], []], [['Neelson Ceramic LLP'], []], [['Nexion Surfaces Private Limited'], []],
  [['Simpolo Vitrified Private Limited'], ['Simpolo International Private Limited']], [['Rey Cera Creation Private Limited'], []], [['Silon Granito LLP'], []], [['Spera Vitrified LLP'], []],
  [['Varmora Granito Limited'], []], [['Cefone Ceramic LLP'], []], [['Saans Vitrified LLP'], []], [['Arkiton Tiles LLP'], []], [['Keval Granito LLP'], []], [['Sunhearrt Ceramix Private Limited'], []],
];

const HRC_CODES = codes('7208.25.00', '7208.26.00', '7208.27.19', '7208.27.99', '7208.36.00', '7208.37.00', '7208.38.00', '7208.39.20', '7208.39.40', '7208.39.90', '7208.51.00', '7208.52.00', '7208.53.00', '7208.54.90', '7208.90.90', '7211.14.15', '7211.14.16', '7211.14.19', '7211.19.13', '7211.19.19', '7211.90.12', '7211.90.19', '7225.30.90', '7225.40.90', '7225.99.90', '7226.91.10', '7226.91.90');
const SUGAR_CODES = codes('1701.13.00', '1701.14.00', '1701.91.00', '1701.99.10', '1701.99.90', '1702.90.91');

/**
 * Every Vietnamese trade-remedy measure in force on 2026-09-23. Enumerated from the complete Trade
 * Remedies Authority "Vietnam investigations" news stream (68 pages, 681 items, including every
 * imposition, review result, extension and termination notice) because the TRAV case register itself
 * stops at AD16. Rates and HS scope were read from each official decision; scanned decisions were
 * read from the page images. India-origin measures carry complete producer tables.
 */
const MEASURES: readonly VietnamTradeRemedy[] = [
  {
    id: 'VN-AD23-IN-CERAMIC-TILES', case_code: 'AD23', kind: 'ANTI_DUMPING', product: 'Ceramic and porcelain wall and floor tiles (water absorption ≤0.5%)',
    tariff_codes: codes('6907.21.21', '6907.21.22', '6907.21.23', '6907.21.24', '6907.21.91', '6907.21.92', '6907.21.93', '6907.21.94'), origin_countries: ['IN'],
    effective_from: '2026-09-22', effective_until: '2031-09-21', decision: '2174/QĐ-BCT of 2026-09-07 (effective 15 days after issue; 5-year term)',
    source_url: `${TRAV}2026_7_09_QD%20so%202174_QD-BCT%20kem%20Thong%20bao%20ap%20thue%20CBPG%20chinh%20thuc.pdf`, evidence_grade: 'producer_table_confirmed', published_range: '5.55%–45.30%',
    rates: [
      rate('IN', ['Rollza Granito LLP', 'Rollstar Granito LLP'], '22.27%', ['Rollzet Granito LLP', 'Valenza Ceramic LLP', 'Ulixo Cera LLP', 'Eliza Exim LLP', 'Dali Ceramico LLP']),
      rate('IN', ['Rock Granito LLP'], '5.55%', ['M-Bo Granito LLP', 'Orkay Tiles', 'Vinson International', 'Reya Impex', 'Nagmati Trade Solutions LLP', 'Bhimani International LLP', 'Eliza Exim LLP']),
      rate('IN', ['Vetican Granito LLP', 'Veritaas Granito LLP', 'Pioneer Ceramic Industries'], '45.30%'),
      ...AD23_COOPERATING.map(([producers, traders]) => rate('IN', producers, '18.29%', traders, 'cooperating_non_sampled')),
      others('IN', '45.30%'),
    ],
    note: 'Customs checks the certificate of origin, then the producer\'s original quality certificate, then the producer/exporter named on the contract and invoice; a missing document falls to 45.30%.',
  },
  {
    id: 'VN-AD14-SORBITOL', case_code: 'AD14', kind: 'ANTI_DUMPING', product: 'Sorbitol syrup (TCVN 6466:2008 / QCVN 4-33:2020/BYT)',
    tariff_codes: codes('2905.44.00', '3824.60.00'), origin_countries: ['IN', 'ID', 'CN'],
    effective_from: '2021-11-23', effective_until: '2026-11-22', decision: '2644/QĐ-BCT of 2021-11-23; end review 2144/QĐ-BCT of 2026-09-03 decided no extension, effective 2026-11-23',
    source_url: `${TRAV}Quyet%20dinh%202644%20QD-BCT%2023_11_2021.pdf`, evidence_grade: 'producer_table_confirmed', published_range: '44.39%–68.50%',
    rates: [
      rate('IN', [], '52.75%', [], 'origin_wide'),
      rate('ID', ['PT Sorini Agro Asia Corporindo'], '44.39%'), rate('ID', ['PT Sorini Towa Berlian Corporindo'], '44.39%'), others('ID', '57.55%'),
      rate('CN', ['Shandong Tianli Pharmaceutical Co., Ltd'], '44.99%', ['Shandong Lianmeng International Trade Co., Ltd.']), others('CN', '68.50%'),
    ],
    note: 'India carries one origin-wide rate (52.75%) for every producer; the measure lapses on 2026-11-23 under the non-extension decision.',
  },
  {
    id: 'VN-AD10-POLYESTER-FILAMENT', case_code: 'AD10', kind: 'ANTI_DUMPING', product: 'Polyester filament yarn (POY, DTY, FDY)',
    tariff_codes: codes('5402.33.10', '5402.33.90', '5402.46.10', '5402.46.90', '5402.47.10', '5402.47.90'), origin_countries: ['IN', 'ID', 'MY', 'CN'],
    effective_from: '2021-10-16', effective_until: '2026-10-15', decision: '2302/QĐ-BCT of 2021-10-13 (effective 3 days after issue), corrected by 928/QĐ-BCT and amended by 2963/QĐ-BCT; first review 2866/QĐ-BCT; end review ER01.AD10 opened by 3013/QĐ-BCT, deadline 2026-10-14 (1635/QĐ-BCT)',
    source_url: `${TRAV}QD%202302.pdf`, evidence_grade: 'producer_table_confirmed', published_range: '3.24%–54.90%',
    rates: [
      rate('IN', ['Beekaylon Synthetics Pvt. Ltd'], '54.90%'), rate('IN', ['Dodhia Synthetics Private Limited'], '54.90%'), rate('IN', ['Polygenta Technologies Limited'], '54.90%'), others('IN', '54.90%'),
      others('ID', '21.94%'), others('MY', '21.45%'), range('CN', 'company-group rates within 3.24%–54.90% (2302/QĐ-BCT as amended by 2963/QĐ-BCT and reviewed by 2866/QĐ-BCT)'),
    ],
    note: 'Every India row in 2302/QĐ-BCT is 54.90%. 928/QĐ-BCT (TRAV archive 1305.rar) corrects only the MFN/FTA reference-rate table; 2963/QĐ-BCT was not published in the TRAV stream and was not retrieved; the end-review initiation 3013/QĐ-BCT states the current range as 3.24%–54.90% by producer/exporter. The only completed review (2866/QĐ-BCT) adjusted Chinese company groups, and AR02.AD10 concerns Chinese producers only. Continuation beyond 2026-10-15 is not presumed while the end review is pending.',
  },
  {
    id: 'VN-AD13AS01-SUGAR-TH', case_code: 'AD13-AS01', kind: 'ANTI_DUMPING_AND_COUNTERVAILING', product: 'Cane sugar', tariff_codes: SUGAR_CODES, origin_countries: ['TH'],
    effective_from: '2026-06-16', effective_until: '2031-06-15', decision: '1578/QĐ-BCT of 2021-06-15; end review ER01.AD13-AS01 extended the anti-dumping and countervailing duties by 5 years from 2026-06-16',
    source_url: `${TRAV}QD%20ket%20qua%20ra%20soat%20ER01_AD13-AS01.pdf`, evidence_grade: 'published_range_confirmed', published_range: '47.64% (anti-dumping 42.99% + countervailing 4.65%), lower reviewed producer rates',
    rates: [others('TH', '47.64% (anti-dumping 42.99% + countervailing 4.65%)')], note: 'Producer-specific rates set by reviews (e.g. 32.75%, 25.73% anti-dumping) require producer evidence.',
  },
  {
    id: 'VN-AC02-SUGAR-CIRCUMVENTION', case_code: 'AC02.AD13-AS01', kind: 'ANTI_CIRCUMVENTION', product: 'Cane sugar transshipped via ASEAN origins', tariff_codes: codes('1701.13.00', '1701.14.00', '1701.99.10', '1701.99.90', '1702.90.91'), origin_countries: ['KH', 'ID', 'LA', 'MY', 'MM'],
    effective_from: '2022-08-01', effective_until: '2031-06-15', decision: '1514/QĐ-BCT of 2022-08-01; continued by 2868/QĐ-BCT (2025-10-13) and new-exporter results 1407, 1708 and 1504/QĐ-BCT',
    source_url: `${TRAV}QD%202868%20ket%20qua%20ra%20soat%20lan%20tranh%20cong%20ty%20Wilmar_13_10_2025.pdf`, evidence_grade: 'published_range_confirmed', published_range: '47.64% (extension of the Thai duties); certified exporters exempt',
    rates: [...['KH', 'ID', 'LA', 'MY', 'MM'].map(origin => others(origin, '47.64%'))], note: 'Named certified exporters are exempted by review decisions; exemption requires the exporter\'s own certification.',
  },
  {
    id: 'VN-AD03-HBEAM-CN', case_code: 'AD03', kind: 'ANTI_DUMPING', product: 'H-section steel', tariff_codes: codes('7216.33.11', '7216.33.19', '7216.33.90', '7228.70.10', '7228.70.90'), origin_countries: ['CN'],
    effective_from: '2022-09-06', effective_until: '2027-09-05', decision: '1640/QĐ-BCT of 2022-08-19 (end-review extension, effective 2022-09-06); third review 2084/QĐ-BCT of 2026-08-22; second end review ER02.AD03 opened by 1454/QĐ-BCT',
    source_url: `${TRAV}QD%202084_22_8_26%20ket%20qua%20ra%20soat%20lan%203_AR03_AD03.pdf`, evidence_grade: 'published_range_confirmed', published_range: 'Hebei Jinxi group 6.78% from 2026-09-06; other producers per 1640/QĐ-BCT (not transcribed)',
    rates: [rate('CN', ['Hebei Jinxi Section Steel Co., Ltd.'], '6.78%', ['Hebei Jinxi International Trade Co., Ltd.', 'Hebei Jinxi Iron and Steel Group Co., Ltd.', 'Tianjin New Asia Prosperity Proprietary Limited', 'China Oriental Singapore Pte Ltd', 'Qianxi Kaijia Trade Company Limited']), range('CN', 'per 1640/QĐ-BCT for other producers (not transcribed)')], note: null,
  },
  {
    id: 'VN-AD04-COLOUR-COATED', case_code: 'AD04', kind: 'ANTI_DUMPING', product: 'Painted/coated flat-rolled steel',
    tariff_codes: codes('7210.70.12', '7210.70.13', '7210.70.19', '7210.70.21', '7210.70.29', '7210.70.91', '7210.70.99', '7212.40.11', '7212.40.12', '7212.40.13', '7212.40.14', '7212.40.19', '7212.40.91', '7212.40.99', '7225.99.90', '7226.99.19', '7226.99.99'), origin_countries: ['CN', 'KR'],
    effective_from: '2024-10-24', effective_until: '2029-10-23', decision: '2822/QĐ-BCT of 2024-10-24 (5-year extension)', source_url: `${TRAV}QD%202822%20ket%20qua%20ra%20soat%20cuoi%20ky%20vu%20viec%20AD04_24_10_2024.pdf`, evidence_grade: 'published_range_confirmed', published_range: '0%–34.27%',
    rates: [range('CN', '0%–34.27%'), range('KR', '0%–34.27%')], note: null,
  },
  {
    id: 'VN-AD05-ALUMINIUM-CN', case_code: 'AD05', kind: 'ANTI_DUMPING', product: 'Aluminium bars, rods and profiles', tariff_codes: codes('7604.10.10', '7604.10.90', '7604.21.90', '7604.29.10', '7604.29.90'), origin_countries: ['CN'],
    effective_from: '2024-10-03', effective_until: '2029-10-02', decision: '2531/QĐ-BCT of 2024-09-23 (5-year extension, effective 2024-10-03)', source_url: `${TRAV}QD%202531%20ket%20qua%20ra%20soat%20ER01_AD05.pdf`, evidence_grade: 'published_range_confirmed', published_range: '2.85%–35.58%',
    rates: [range('CN', '2.85%–35.58%'), others('CN', '35.58%')], note: null,
  },
  {
    id: 'VN-AD08-COLD-ROLLED-CN', case_code: 'AD08', kind: 'ANTI_DUMPING', product: 'Cold-rolled carbon steel in coils or sheets',
    tariff_codes: codes('7209.16.10', '7209.16.90', '7209.17.10', '7209.17.90', '7209.18.91', '7209.18.99', '7209.26.10', '7209.26.90', '7209.27.10', '7209.27.90', '7209.28.10', '7209.28.90', '7209.90.90', '7211.23.20', '7211.23.30', '7211.23.90', '7211.29.20', '7211.29.30', '7211.29.90', '7225.50.90'), origin_countries: ['CN'],
    effective_from: '2025-12-28', effective_until: '2030-12-27', decision: '3765/QĐ-BCT of 2025-12-26 (5-year extension from 2025-12-28)', source_url: `${TRAV}12_%20QD%203765%20gia%20han%20ap%20dung%20bien%20phap%20CBPG%20thep%20can%20nguoi.pdf`, evidence_grade: 'published_range_confirmed', published_range: '4.43%–25.22%',
    rates: [range('CN', '4.43%–25.22%'), others('CN', '25.22%')], note: null,
  },
  {
    id: 'VN-AD09-MSG', case_code: 'AD09', kind: 'ANTI_DUMPING', product: 'Monosodium glutamate', tariff_codes: codes('2922.42.20'), origin_countries: ['ID', 'CN'],
    effective_from: '2025-07-23', effective_until: '2030-07-22', decision: '1914/QĐ-BCT of 2025-07-02 (5-year extension, effective 2025-07-23)', source_url: `${TRAV}QD%20kem%20Thong%20bao%20ve%20ket%20qua%20ra%20soat%20cuoi%20ky%20vu%20viec%20ER01_AD09(1).pdf`, evidence_grade: 'published_range_confirmed', published_range: 'VND 3,396,156–6,385,289 per tonne',
    rates: [range('ID', 'VND 3,396,156–6,385,289 per tonne'), range('CN', 'VND 3,396,156–6,385,289 per tonne')], note: 'Specific duties per tonne; no ad-valorem equivalent is computed.',
  },
  {
    id: 'VN-AD15-WELDING', case_code: 'AD15', kind: 'ANTI_DUMPING', product: 'Welding materials',
    tariff_codes: codes('7217.10.10', '7217.30.19', '7217.90.10', '7229.20.00', '7229.90.21', '7229.90.29', '7229.90.99', '8311.10.10', '8311.10.90', '8311.30.91', '8311.30.99', '8311.90.00'), origin_countries: ['MY', 'TH', 'CN'],
    effective_from: '2022-08-20', effective_until: '2027-08-19', decision: '1624/QĐ-BCT of 2022-08-15; end review ER01.AD15 opened by 1453/QĐ-BCT (2026-06-19)', source_url: `${TRAV}QD%201624%2015_08_2022%20thue%20CBPG%20CT%20AD15-r.pdf`, evidence_grade: 'published_range_confirmed', published_range: '0%–36.56%',
    rates: ['MY', 'TH', 'CN'].map(origin => range(origin, '0%–36.56%')), note: null,
  },
  {
    id: 'VN-AD16-FURNITURE-CN', case_code: 'AD16', kind: 'ANTI_DUMPING', product: 'Office chairs and tables',
    tariff_codes: codes('9401.31.00', '9401.39.00', '9401.41.00', '9401.49.00', '9401.61.00', '9401.69.90', '9401.71.00', '9401.79.90', '9401.80.00', '9403.30.00'), origin_countries: ['CN'],
    effective_from: '2023-02-13', effective_until: '2028-02-12', decision: '235/QĐ-BCT of 2023-02-13 (Malaysia investigation terminated)', source_url: `${TRAV}QD%20235%20-%20ap%20%20thue%20CBPG%20chinh%20thuc%20-%20AD16-r(1).pdf`, evidence_grade: 'published_range_confirmed', published_range: '21.40% (chairs), 35.20% (tables)',
    rates: [range('CN', '21.40% (chairs); 35.20% (tables)')], note: null,
  },
  {
    id: 'VN-AD17-PC-STRAND', case_code: 'AD17', kind: 'ANTI_DUMPING', product: 'Prestressed concrete steel strand', tariff_codes: codes('7312.10.91', '7312.10.99'), origin_countries: ['MY', 'TH', 'CN'],
    effective_from: '2025-01-29', effective_until: '2030-01-28', decision: '143/QĐ-BCT of 2025-01-14 (effective 15 days after issue); first review AR01.AD17 pending', source_url: `${TRAV}QD%20143_ap%20thue%20chinh%20thuc%20AD17.pdf`, evidence_grade: 'published_range_confirmed', published_range: '9.79%–28%',
    rates: ['MY', 'TH', 'CN'].map(origin => range(origin, '9.79%–28%')), note: null,
  },
  {
    id: 'VN-AD18-WIND-TOWERS-CN', case_code: 'AD18', kind: 'ANTI_DUMPING', product: 'Wind towers', tariff_codes: codes('7308.20.11', '7308.20.19', '8502.31.10', '8502.31.20'), origin_countries: ['CN'],
    effective_from: '2025-01-08', effective_until: '2030-01-07', decision: '3453/QĐ-BCT of 2024-12-24 (effective 15 days after issue)', source_url: `${TRAV}2024_12_24%20Quyet%20dinh%20so%203453_QD_BCT%20ap%20thue%20chinh%20thuc.pdf`, evidence_grade: 'published_range_confirmed', published_range: '0% (Jiangsu Zhenjiang New Energy Equipment) – 97%',
    rates: [rate('CN', ['Jiangsu Zhenjiang New Energy Equipment Co., Ltd'], 'no anti-dumping duty'), others('CN', '97%')], note: '8502.31.10/.20 apply when towers are imported as part of a wind generating set.',
  },
  {
    id: 'VN-AD19-GALVANIZED', case_code: 'AD19', kind: 'ANTI_DUMPING', product: 'Galvanized/plated flat steel',
    tariff_codes: codes('7210.41.11', '7210.41.12', '7210.41.19', '7210.49.11', '7210.49.14', '7210.49.15', '7210.49.16', '7210.49.17', '7210.49.18', '7210.49.19', '7210.50.00', '7210.61.11', '7210.61.12', '7210.61.19', '7210.69.11', '7210.69.19', '7210.90.10', '7210.90.90', '7212.30.11', '7212.30.12', '7212.30.13', '7212.30.14', '7212.30.19', '7212.50.14', '7212.50.19', '7212.50.23', '7212.50.24', '7212.50.29', '7212.50.93', '7212.50.94', '7212.50.99', '7212.60.11', '7212.60.12', '7212.60.19', '7225.92.20', '7225.92.90', '7225.99.90', '7226.99.11', '7226.99.19', '7226.99.91', '7226.99.99'), origin_countries: ['CN', 'KR'],
    effective_from: '2025-08-14', effective_until: '2030-08-13', decision: '2310/QĐ-BCT of 2025-08-14', source_url: `${TRAV}QD%202310%20ap%20thue%20chinh%20thuc.pdf`, evidence_grade: 'published_range_confirmed', published_range: 'up to 37.13% (China), up to 15.67% (Korea)',
    rates: [range('CN', 'up to 37.13%'), range('KR', 'up to 15.67%')], note: 'HS scope read from Article 1 of the scanned decision (41 codes).',
  },
  {
    id: 'VN-AD20-HRC-CN', case_code: 'AD20', kind: 'ANTI_DUMPING', product: 'Hot-rolled steel', tariff_codes: HRC_CODES, origin_countries: ['CN'],
    effective_from: '2025-07-06', effective_until: '2030-07-05', decision: '1959/QĐ-BCT of 2025-07-04 (India investigation terminated without duty)', source_url: `${TRAV}QD%201959%20ap%20dung%20thue%20CBPG%20chinh%20thuc%20thep%20can%20nong.pdf`, evidence_grade: 'published_range_confirmed', published_range: '23.10%–27.83%',
    rates: [range('CN', '23.10%–27.83%'), others('CN', '27.83%')], note: null,
  },
  {
    id: 'VN-AC03-HRC-WIDE-CN', case_code: 'AC03.AD20', kind: 'ANTI_CIRCUMVENTION', product: 'Hot-rolled steel wider than 1,880 mm and up to 2,300 mm', tariff_codes: HRC_CODES, origin_countries: ['CN'],
    effective_from: '2026-08-12', effective_until: '2030-07-05', decision: '1917/QĐ-BCT of 2026-07-28 (effective 15 days after issue)', source_url: `${TRAV}QD%201917%20ap%20dung%20chong%20lan%20tranh%20chinh%20thuc%20thep%20can%20nong_28_07_2026.pdf`, evidence_grade: 'published_range_confirmed', published_range: '27.83%',
    rates: [others('CN', '27.83% (width >1,880 mm and ≤2,300 mm)')], note: 'Applies only to the width band; width evidence is required.',
  },
  {
    id: 'VN-AD21-FIBREBOARD', case_code: 'AD21', kind: 'ANTI_DUMPING', product: 'Wood fibreboard', tariff_codes: codes('4411.12.00', '4411.13.00', '4411.14.00', '4411.92.00', '4411.93.00', '4411.94.00'), origin_countries: ['TH', 'CN'],
    effective_from: '2026-01-19', effective_until: '2031-01-18', decision: '121/QĐ-BCT of 2026-01-19', source_url: `${TRAV}QD%20121-19_1_26%20ap%20dung%20thue%20CBPG%20chinh%20thuc%20AD21.pdf`, evidence_grade: 'published_range_confirmed', published_range: 'China 2.59%–39.88%; Thailand 3.09%–20.20%',
    rates: [range('CN', '2.59%–39.88%'), range('TH', '3.09%–20.20%')], note: null,
  },
  {
    id: 'VN-AD22-FLOAT-GLASS', case_code: 'AD22', kind: 'ANTI_DUMPING', product: 'Clear float glass', tariff_codes: codes('7005.29.20', '7005.29.90'), origin_countries: ['ID', 'MY'],
    effective_from: '2026-06-14', effective_until: '2031-06-13', decision: '1400/QĐ-BCT of 2026-06-12 (effective 2026-06-14)', source_url: `${TRAV}QD%201400%20QD%20BCT%2012_06_2026.pdf`, evidence_grade: 'published_range_confirmed', published_range: 'Indonesia 32.78%–43.78%; Malaysia 41.07%–63.39%',
    rates: [range('ID', '32.78%–43.78%'), range('MY', '41.07%–63.39%')], note: null,
  },
];

const HISTORICAL: readonly VietnamHistoricalRemedy[] = [
  { case_code: 'AD20', product: 'Hot-rolled steel', origin_countries: ['IN'], status: 'TERMINATED_FOR_ORIGIN', decided: '2025-07-04', decision: '1959/QĐ-BCT article 2 terminated the India investigation without duty' },
  { case_code: 'AD01', product: 'Cold-rolled stainless steel', origin_countries: ['TW', 'ID', 'MY', 'CN'], status: 'EXPIRED', decided: '2024-11-12', decision: '3011/QĐ-BCT (end review: terminated, not extended)' },
  { case_code: 'AD02', product: 'Galvanized steel (2017 measure)', origin_countries: ['CN', 'KR'], status: 'TERMINATED', decided: '2022-05-12', decision: '924/QĐ-BCT' },
  { case_code: 'AD07', product: 'Propylene-polymer plastics (BOPP film)', origin_countries: ['MY', 'TH', 'CN'], status: 'EXPIRED', decided: '2025-07-14', decision: '2027/QĐ-BCT (end review: terminated, not extended)' },
  { case_code: 'AD12', product: 'H-section steel', origin_countries: ['MY'], status: 'EXPIRED', decided: '2026-04-16', decision: '915/QĐ-BCT (end review: not extended)' },
  { case_code: 'AD11', product: 'High-fructose corn syrup', origin_countries: ['CN', 'KR'], status: 'NOT_IMPOSED', decided: null, decision: 'Investigation (1715/QĐ-BCT) closed without measures: causation not established' },
  { case_code: 'AD06', product: 'MDF fibreboard', origin_countries: ['TH', 'MY'], status: 'NOT_IMPOSED', decided: null, decision: '940/QĐ-BCT (no anti-dumping measure applied)' },
  { case_code: 'SG04', product: 'Steel billets and long steel', origin_countries: ['*'], status: 'EXPIRED', decided: '2023-03-21', decision: '691/QĐ-BCT (billets not extended; long steel stepped to 0% from 2026-03-22)' },
  { case_code: 'AC01.SG04', product: 'Steel wire and coil (circumvention of SG04)', origin_countries: ['*'], status: 'EXPIRED', decided: '2023-03-21', decision: '693/QĐ-BCT (stepped to 0% from 2026-03-22)' },
  { case_code: 'SG06', product: 'DAP and MAP fertilisers', origin_countries: ['*'], status: 'EXPIRED', decided: null, decision: '715/QĐ-BCT (not extended)' },
];

const PENDING: readonly VietnamPendingRemedy[] = [
  { case_code: 'AD24', product: 'Prestressed steel bar', origin_countries: ['CN'], status: 'INVESTIGATION', opened: '2026-07-27', decision: '1903/QĐ-BCT' },
  { case_code: 'ER01.AD10', product: 'Polyester filament yarn', origin_countries: ['IN', 'ID', 'MY', 'CN'], status: 'REVIEW', opened: '2025-10-16', decision: '3013/QĐ-BCT (deadline 2026-10-14)' },
  { case_code: 'ER01.AD15', product: 'Welding materials', origin_countries: ['MY', 'TH', 'CN'], status: 'REVIEW', opened: '2026-06-19', decision: '1453/QĐ-BCT' },
  { case_code: 'ER02.AD03', product: 'H-section steel', origin_countries: ['CN'], status: 'REVIEW', opened: '2026-06-19', decision: '1454/QĐ-BCT' },
  { case_code: 'AR02.AD10', product: 'Polyester filament yarn (certain Chinese producers/exporters only)', origin_countries: ['CN'], status: 'REVIEW', opened: '2025-02-18', decision: '421/QĐ-BCT; deadline extended to 2025-11-18 by 2324/QĐ-BCT; no result notice in the TRAV stream' },
  { case_code: 'AR01.AD17', product: 'Prestressed concrete steel strand', origin_countries: ['MY', 'TH', 'CN'], status: 'REVIEW', opened: '2025-01-14', decision: '150/QĐ-BCT' },
];

export const VIETNAM_TRADE_REMEDY_MANIFEST: VietnamTradeRemedyManifest = Object.freeze({
  version: VIETNAM_REMEDY_MANIFEST_VERSION, complete_as_of: VIETNAM_REMEDY_REFERENCE_DATE, register_enumeration_complete: true,
  enumeration_basis: 'Complete TRAV "Vietnam investigations" news stream (68 pages, 681 items, 81 measure-changing notices reviewed); the TRAV case register (AD01–AD16) is stale and was used only as a cross-check.',
  measures: MEASURES, historical: HISTORICAL, pending: PENDING,
}) as VietnamTradeRemedyManifest;

export function validateVietnamRemedyManifest(manifest: VietnamTradeRemedyManifest) {
  if (manifest.version !== VIETNAM_REMEDY_MANIFEST_VERSION || manifest.register_enumeration_complete !== true) throw new Error('Vietnam trade-remedy manifest is not the reviewed complete enumeration.');
  for (const measure of manifest.measures) {
    if (!measure.tariff_codes.length || measure.tariff_codes.some(code => !/^\d{8}$/.test(code))) throw new Error(`Vietnam remedy ${measure.id} lacks eight-digit tariff codes.`);
    if (!measure.origin_countries.length || measure.origin_countries.some(origin => !measure.rates.some(item => item.origin === origin))) throw new Error(`Vietnam remedy ${measure.id} lacks rate evidence for every origin.`);
    if (measure.origin_countries.includes('IN') && measure.evidence_grade !== 'producer_table_confirmed') throw new Error(`India-origin Vietnam remedy ${measure.id} lacks a confirmed producer table.`);
  }
}

/** Investigation, review and termination are never duties; an active measure always needs producer/exporter identity. */
export function selectVietnamTradeRemedies(args: { manifest: VietnamTradeRemedyManifest; code: string; origin_country: string; at: Date }) {
  const on = args.at.toISOString().slice(0, 10);
  const candidates = args.code ? args.manifest.measures.filter(measure => measure.origin_countries.includes(args.origin_country) && measure.tariff_codes.includes(args.code) && measure.effective_from <= on && (!measure.effective_until || on <= measure.effective_until)) : [];
  return candidates.length
    ? { status: 'producer_refinement_required' as const, candidates, required_evidence: ['certificate of origin', 'producer\'s original quality certificate', 'commercial contract and invoice naming the producer/exporter'] }
    : { status: 'not_applicable' as const, candidates: [] as VietnamTradeRemedy[], required_evidence: [] as string[] };
}

/** An origin carrying a single origin-wide rate needs no producer identity; every other origin's rate is never selected from origin alone. */
export function vietnamRemedyProducerIdentityRequired(measure: VietnamTradeRemedy, origin: string) {
  const rows = measure.rates.filter(item => item.origin === origin);
  return !(rows.length === 1 && rows[0]!.basis === 'origin_wide' && /^\d+(?:\.\d+)?%$/.test(rows[0]!.expression));
}

export function vietnamRemedyDuty(measure: VietnamTradeRemedy, origin: string): ParsedDuty {
  const base = { specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null };
  if (!vietnamRemedyProducerIdentityRequired(measure, origin)) {
    const expression = measure.rates.find(item => item.origin === origin)!.expression;
    return { kind: 'ad_valorem', ad_valorem_rate_percent: Number(expression.slice(0, -1)), ...base, expression, note: `One origin-wide rate applies to every producer/exporter of ${origin} origin (${measure.decision}).` };
  }
  const expressions = [...new Set(measure.rates.filter(item => item.origin === origin).map(item => item.expression))];
  return { kind: 'mixed', ad_valorem_rate_percent: null, ...base, expression: `${measure.published_range} depending on producer/exporter`, note: `Rate depends on producer/exporter identity (${measure.decision}); candidate rates for this origin: ${expressions.join(', ')}. Never selected from origin alone.` };
}
