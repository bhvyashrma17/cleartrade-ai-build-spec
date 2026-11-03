import { createHash } from 'node:crypto';

export const MALAYSIA_REMEDY_MANIFEST_VERSION = 'my-trade-remedies-manifest-v1' as const;
export const MALAYSIA_REMEDY_REFERENCE_DATE = '2026-09-21' as const;

export interface MalaysiaRemedyRate {
  producer_or_exporter: string;
  rate_percent_cif: number;
  catch_all: boolean;
  exclusions?: readonly string[];
}

export interface MalaysiaTradeRemedy {
  /** Unique instrument + origin schedule identity. */
  id: string;
  instrument_id: string;
  instrument: string;
  amendments: readonly string[];
  source_url: string;
  source_sha256: string;
  source_documents: readonly { instrument: string; url: string; sha256: string }[];
  effective_from: string;
  effective_to: string;
  operation: 'ADD';
  description: string;
  tariff_codes: readonly string[];
  origin_country: string;
  rates: readonly MalaysiaRemedyRate[];
}

export interface MalaysiaTradeRemedyManifest {
  version: typeof MALAYSIA_REMEDY_MANIFEST_VERSION;
  complete_as_of: string;
  remedies: readonly MalaysiaTradeRemedy[];
}

/**
 * Complete active instrument inventory at the qualification reference date. Schedule rows are
 * carried in the acquired manifest and authenticated by source checksum; this inventory prevents
 * an acquisition from quietly omitting an older measure or a current expiry-review continuation.
 */
export const MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS = Object.freeze([
  { id: 'PUA147-2025', instrument: 'P.U. (A) 147/2025', amendments: ['P.U. (A) 18/2026'], effective_from: '2025-05-07', effective_to: '2030-05-06', product: 'Polyethylene terephthalate' },
  { id: 'PUA152-2025', instrument: 'P.U. (A) 152/2025', amendments: ['P.U. (A) 19/2026'], effective_from: '2025-05-11', effective_to: '2030-05-10', product: 'Electrolytic tinplate or tinplate' },
  { id: 'PUA192-2025', instrument: 'P.U. (A) 192/2025', amendments: ['P.U. (A) 20/2026'], effective_from: '2025-06-23', effective_to: '2030-06-22', product: 'Cold rolled coils wider than 1,300 mm' },
  { id: 'PUA398-2025', instrument: 'P.U. (A) 398/2025', amendments: [], effective_from: '2025-11-01', effective_to: '2030-10-31', product: 'Hot-dip galvanised iron or steel coils and sheets' },
  { id: 'PUA225-2023', instrument: 'P.U. (A) 225/2023', amendments: ['P.U. (A) 17/2026'], effective_from: '2023-07-27', effective_to: '2028-07-26', product: 'Cold rolled stainless steel' },
  { id: 'PUA285-2023', instrument: 'P.U. (A) 285/2023', amendments: ['P.U. (A) 16/2026'], effective_from: '2023-09-29', effective_to: '2028-09-28', product: 'Cold rolled coils below 1,300 mm from Japan' },
  { id: 'PUA469-2021', instrument: 'P.U. (A) 469/2021', amendments: ['P.U. (A) 52/2025'], effective_from: '2021-12-25', effective_to: '2026-12-24', product: 'Stranded steel wire for prestressing concrete' },
  { id: 'PUA24-2026', instrument: 'P.U. (A) 24/2026', amendments: ['P.U. (A) 132/2026'], effective_from: '2026-01-15', effective_to: '2026-10-08', product: 'Cold rolled coils below 1,300 mm from China' },
  { id: 'PUA267-2026', instrument: 'P.U. (A) 267/2026', amendments: [], effective_from: '2026-07-20', effective_to: '2027-01-15', product: 'Prepainted, painted or colour-coated steel coils (expiry review)' },
] as const);

const parliament = (paper: number) => `https://www.parlimen.gov.my/ipms/eps/2026-03-02/ST.${paper}.2026%20-%20ST${paper}.2026.pdf`;
const document = (instrument: string, url: string, sha256: string) => ({ instrument, url, sha256 });
const rate = (producer_or_exporter: string, rate_percent_cif: number, catch_all = false, exclusions?: readonly string[]): MalaysiaRemedyRate => ({ producer_or_exporter, rate_percent_cif, catch_all, ...(exclusions ? { exclusions } : {}) });
const codes = (...values: string[]) => values;

const sourceChains = {
  'PUA147-2025': [document('P.U. (A) 147/2025', 'https://traderemedies.miti.gov.my/investigation/PUA_147__2025_.pdf', '3180f88f80cebb0ad8809b2b5655db3781381a1beec254a7233e11785a8b69ed'), document('P.U. (A) 18/2026', parliament(42), 'dd151645540493169a90b7e7d05b1937c1216dc968ea054ce8ea636a29ce8657')],
  'PUA152-2025': [document('P.U. (A) 152/2025', 'https://traderemedies.miti.gov.my/investigation/PUA_152__2025_.pdf', '808ee2bd04c47b0ec37124a37e01e087ee4bb930c000ddeace54f32b5cd02d34'), document('P.U. (A) 19/2026', parliament(43), '71b2f262db794b36d5fbc602f8e7bc90343ce6b7e1445d111f4f9400f556da5b')],
  'PUA192-2025': [document('P.U. (A) 192/2025', 'https://traderemedies.miti.gov.my/investigation/PUA_192_2025.pdf', '3a4daf5649af7e239bf49cbfb6372b0c711089c51457716ee2f3922e6dfffb4f'), document('P.U. (A) 20/2026', parliament(44), '91ff4325fd7e0a0475d85709cbe89e3ea242410a6fd9c6e6d940ae12466e3db6')],
  'PUA398-2025': [document('P.U. (A) 398/2025', 'https://traderemedies.miti.gov.my/investigation/PUA_398_CUSTOMS_ORDER_2025.pdf', '42332d408f5ca6311b69caefff0585f39e783afaa2d0189dd043f37293c49f69')],
  'PUA225-2023': [document('P.U. (A) 225/2023', 'https://traderemedies.miti.gov.my/investigation/measure_in_force/11_Cold_Rolled_Stainless_Steel_in_Coils_Sheets_or_Any_Other_Form/3.Custom%20Order/PUA225_2023.pdf', 'c260dbef9521e34dfd50206dd775de277ac2a51ec1ca1f85f58080e87354af90'), document('P.U. (A) 17/2026', parliament(41), 'e1b2c26cda3a243af7e07c6d9e8feb850922d714342b1e2d88e6220c2a7745cb')],
  'PUA285-2023': [document('P.U. (A) 285/2023', 'https://traderemedies.miti.gov.my/investigation/measure_in_force/12_Cold_Rolled_Coils_of_Alloy_or_Non_Alloy_Steel_of_a_Width_Less_Than_1300mm/2.Custom%20Order/PUA285_2023.pdf', '4816050adc44f17d837eb4d0166600dff354a0c52ca5afa348b83b3a048e27e4'), document('P.U. (A) 16/2026', parliament(40), '7df6275389091c78b20318d59f04c24a40ec7977472f8d55fdc2f59ff8c145e7')],
  'PUA469-2021': [document('P.U. (A) 469/2021', 'https://traderemedies.miti.gov.my/investigation/pua_20211223_P_U_A__469_2021.pdf', '6a89dc2b1de3ccd5f7530787288c4b89cec1298bf65bdd6b233c64befdda9752'), document('P.U. (A) 52/2025', 'https://www.miti.gov.my/miti/resources/Anti-Dumping%20and%20Countervailing%20Measure/Investigations/PUA52_2025.pdf', '0b42ab190ebc7045c0c029bd2734d35be81f93e9f00a6b73ed55f089a072dac6')],
  'PUA24-2026': [document('P.U. (A) 24/2026', parliament(48), '09ab9b9775c495060fe26c26695097001e152465324c37904ca445141bcd9a84'), document('P.U. (A) 132/2026', 'https://www.customs.gov.my/images/06-prosedur/perintah-kastam/perintah/PUA_132_2026.pdf', 'ccfc6e20399128a3e46083384db86547af43ea689afb171878baf87498bef685')],
  'PUA267-2026': [document('P.U. (A) 267/2026', 'https://traderemedies.miti.gov.my/public/article/prepainted-china', '7c47d316cd9c8c5cd4791f6f4ba962994de95ccfa5e7a2cdfcedb4897a7066cf')],
} as const;

const remedy = (instrument_id: keyof typeof sourceChains, origin_country: string, tariff_codes: readonly string[], rates: readonly MalaysiaRemedyRate[]): MalaysiaTradeRemedy => {
  const inventory = MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS.find((item) => item.id === instrument_id)!;
  const source_documents = sourceChains[instrument_id];
  return { id: `${instrument_id}:${origin_country}`, instrument_id, instrument: inventory.instrument, amendments: inventory.amendments, source_url: source_documents[0].url, source_sha256: source_documents[0].sha256, source_documents, effective_from: inventory.effective_from, effective_to: inventory.effective_to, operation: 'ADD', description: inventory.product, tariff_codes, origin_country, rates };
};

const crcUnder1300 = codes('7209150000', '7209161000', '7209169000', '7209171000', '7209179000', '7209189900', '7225501000', '7225509000');
const galvanised = codes('7210491100', '7210491700', '7210491800', '7210491900', '7210499100', '7210499900', '7212301100', '7212301200', '7212301300', '7212301400', '7212301900', '7212309000', '7225929000', '7225999000', '7226991100', '7226991900', '7226999100', '7226999900');
const stainless = codes('7219310000', '7219320000', '7219330000', '7219340000', '7219350000', '7220201000', '7220209000');
const prepainted = codes('7210701200', '7210701300', '7210701900', '7210702100', '7210702900', '7210709100', '7210709900');

/** Reviewed active schedules, including nil rates and exclusion lists, as of the reference date. */
export const MALAYSIA_ACTIVE_TRADE_REMEDY_MANIFEST: MalaysiaTradeRemedyManifest = Object.freeze({
  version: MALAYSIA_REMEDY_MANIFEST_VERSION,
  complete_as_of: MALAYSIA_REMEDY_REFERENCE_DATE,
  remedies: Object.freeze([
    remedy('PUA147-2025', 'CN', codes('3907610000'), [rate('Far Eastern Industries (Shanghai) Ltd.', 4.58), rate('Jiangsu Hailun Petrochemical Co., Ltd.', 2.29), rate('Jiangsu Xingye Plastic Co., Ltd.', 2.29), rate('Jiangyin Xingtai New Material Co., Ltd.', 2.29), rate('Other producers or exporters', 11.74, true)]),
    remedy('PUA147-2025', 'ID', codes('3907610000'), [rate('All producers or exporters', 37.44, true)]),
    remedy('PUA152-2025', 'CN', codes('7210119000', '7210129000'), [rate('Baoshan Iron & Steel Co., Ltd.', 4.78), rate('GDH Zhongyue (Qinhuangdao) Tinplate Industrial Co., Ltd.', 4.48), rate('GDH Zhongyue (Zhongshan) Tinplate Industry Co., Ltd.', 4.48), rate('Hesteel Group Hengshui Strip Processing Co., Ltd.', 16.44), rate('Shougang Jingtang United Iron & Steel Co., Ltd.', 19.48), rate('Other producers or exporters', 20.42, true)]),
    remedy('PUA152-2025', 'IN', codes('7210119000', '7210129000'), [rate('All producers or exporters', 27.88, true)]),
    remedy('PUA152-2025', 'JP', codes('7210119000', '7210129000'), [rate('Nippon Steel Corporation', 15.74), rate('Other producers or exporters', 36.8, true)]),
    remedy('PUA152-2025', 'KR', codes('7210119000', '7210129000'), [rate('KG Dongbu Steel Co., Ltd.', 21.6), rate('Other producers or exporters', 35.43, true)]),
    remedy('PUA192-2025', 'CN', codes('7209150000', '7209169000', '7209179000', '7209189900'), [rate('Angang Steel Company Limited', 4.82), rate('Maanshan Iron and Steel Co., Ltd.', 4.76), rate('Shougang Jingtang United Iron & Steel Co., Ltd.', 8.74), rate('Other producers or exporters', 26.38, true)]),
    remedy('PUA192-2025', 'JP', codes('7209150000', '7209169000', '7209179000', '7209189900'), [rate('All producers or exporters', 26.39, true)]),
    remedy('PUA398-2025', 'CN', galvanised, [rate('Shougang Jingtang United Iron & Steel Co., Ltd.', 7.72), rate('Other producers or exporters', 26.8, true, ['Baoshan Iron & Steel Co., Ltd.', 'Beijing Shougang Cold Rolling Co., Ltd.', 'Fujian Kaijing Greentech Material Co., Ltd.'])]),
    remedy('PUA398-2025', 'KR', galvanised, [rate('Hyundai Steel Company', 5.61), rate('KG Dongbu Steel Co., Ltd.', 13.82), rate('POSCO', 2.21), rate('Other producers or exporters', 31.47, true)]),
    remedy('PUA398-2025', 'VN', galvanised, [rate('China Steel and Nippon Steel Vietnam Joint Stock Company', 4.76), rate('Southern Steel Sheet Co., Ltd.', 9.91), rate('Tan Phuoc Khanh Trading and Manufacturing Coil Steel Joint Stock Company', 48.05), rate('Tay Nam Steel Manufacturing & Trading Co., Ltd.', 42.58), rate('TVP Steel Joint Stock Company', 42.58), rate('Other producers or exporters', 57.9, true, ['Hoa Phat Steel Sheet Limited Liability Company', 'Hoa Sen Group', 'Nam Kim Steel Joint Stock Company', 'Ton Dong A Corporation'])]),
    remedy('PUA225-2023', 'CN', stainless, [rate('Shanxi Taigang Stainless Steel Co., Ltd.', 2.68), rate('Other producers or exporters', 23.95, true)]),
    remedy('PUA225-2023', 'KR', stainless, [rate('POSCO', 4.44), rate('Other producers or exporters', 7.27, true, ['Hyundai BNG Steel Co., Ltd.', 'Hyundai Steel Company'])]),
    remedy('PUA225-2023', 'TW', stainless, [rate('Tang Eng Iron Works Co., Ltd.', 7.78), rate('Walsin Lihwa Corporation', 2.79), rate('Other producers or exporters', 14.02, true, ['Chia Far Industrial Factory Co., Ltd.', 'Yieh United Steel Corporation'])]),
    remedy('PUA225-2023', 'TH', stainless, [rate('POSCO-Thainox Public Company Limited', 22.86), rate('Other producers or exporters', 111.61, true)]),
    remedy('PUA285-2023', 'JP', codes('7209150000', '7209161000', '7209169000', '7209171000', '7209179000', '7209189900', '7225509000', '7225999000'), [rate('Nippon Steel Corporation', 9.03), rate('Other producers or exporters', 22.62, true, ['Daido Steel Co., Ltd.', 'JFE Steel Corporation'])]),
    remedy('PUA469-2021', 'CN', codes('7312109100'), [rate('Silvery Dragon Prestressed Materials Co., Ltd. Tianjin', 9.07), rate('Tianjin Dalu Steel Strand For Prestressed Co., Ltd.', 3.12), rate('Other producers or exporters', 21.72, true)]),
    remedy('PUA24-2026', 'CN', crcUnder1300, [rate('Bengang Steel Plates Co., Ltd.', 42.08), rate('BX Steel POSCO Cold Rolled Sheet Co., Ltd.', 35.89), rate('Jiangsu Shagang International Trade Co., Ltd.', 42.08), rate('Other producers or exporters', 42.08, true)]),
    remedy('PUA267-2026', 'CN', prepainted, [rate('All producers or exporters', 52.1, true)]),
    remedy('PUA267-2026', 'VN', prepainted, [rate('Maruichi Sun Steel Joint Stock Company', 12.06), rate('NS Bluescope Vietnam Limited', 34.85), rate('Nam Kim Steel Joint Stock Company', 0), rate('Other producers or exporters', 34.85, true)]),
  ]),
});

export function validateMalaysiaRemedyManifest(manifest: MalaysiaTradeRemedyManifest) {
  if (manifest.version !== MALAYSIA_REMEDY_MANIFEST_VERSION || manifest.complete_as_of !== MALAYSIA_REMEDY_REFERENCE_DATE) throw new Error('Malaysia trade-remedy manifest has the wrong version or reference date.');
  const expected = new Set(MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS.map((item) => item.id));
  const actual = new Set(manifest.remedies.map((item) => item.instrument_id));
  if (expected.size !== actual.size || [...expected].some((id) => !actual.has(id))) throw new Error('Malaysia trade-remedy manifest does not cover every active instrument at the reference date.');
  if (new Set(manifest.remedies.map((item) => item.id)).size !== manifest.remedies.length) throw new Error('Malaysia trade-remedy origin schedules must have unique identities.');
  for (const remedy of manifest.remedies) {
    const inventory = MALAYSIA_ACTIVE_REMEDY_INSTRUMENTS.find((item) => item.id === remedy.instrument_id);
    if (!inventory || remedy.instrument !== inventory.instrument || remedy.effective_from !== inventory.effective_from || remedy.effective_to !== inventory.effective_to || remedy.amendments.join('|') !== inventory.amendments.join('|')) throw new Error(`Malaysia trade-remedy ${remedy.id} disagrees with the active instrument inventory.`);
    if (!/^[a-f0-9]{64}$/.test(remedy.source_sha256) || !remedy.tariff_codes.length || !remedy.rates.length || !/^[A-Z]{2}$/.test(remedy.origin_country)) throw new Error(`Malaysia trade-remedy ${remedy.id} is incomplete.`);
    if (!remedy.source_documents.length || remedy.source_documents.some((source) => !source.instrument.trim() || !source.url.startsWith('https://') || !/^[a-f0-9]{64}$/.test(source.sha256))) throw new Error(`Malaysia trade-remedy ${remedy.id} has an incomplete official source chain.`);
    const sourcedInstruments = new Set(remedy.source_documents.map((source) => source.instrument));
    if (remedy.source_documents[0]!.url !== remedy.source_url || remedy.source_documents[0]!.sha256 !== remedy.source_sha256 || [remedy.instrument, ...remedy.amendments].some((instrument) => !sourcedInstruments.has(instrument))) throw new Error(`Malaysia trade-remedy ${remedy.id} does not authenticate its complete instrument chain.`);
    if (remedy.rates.some((rate) => !rate.producer_or_exporter.trim() || !Number.isFinite(rate.rate_percent_cif) || rate.rate_percent_cif < 0)) throw new Error(`Malaysia trade-remedy ${remedy.id} has an invalid rate schedule.`);
    if (remedy.rates.filter((rate) => rate.catch_all).length !== 1) throw new Error(`Malaysia trade-remedy ${remedy.id} must have exactly one catch-all rate per origin schedule.`);
  }
  return manifest;
}

export type MalaysiaRemedyDecision =
  | { status: 'not_applicable'; remedies: readonly [] }
  | { status: 'producer_refinement_required'; candidates: readonly MalaysiaTradeRemedy[] }
  | { status: 'applicable'; remedies: readonly { remedy: MalaysiaTradeRemedy; rate: MalaysiaRemedyRate }[] };

export function selectMalaysiaTradeRemedies(args: { manifest: MalaysiaTradeRemedyManifest; code: string; origin_country: string; at: Date; producer_or_exporter?: string }): MalaysiaRemedyDecision {
  validateMalaysiaRemedyManifest(args.manifest);
  const date = args.at.toISOString().slice(0, 10); const origin = args.origin_country.trim().toUpperCase();
  const candidates = args.manifest.remedies.filter((item) => item.origin_country === origin && item.tariff_codes.includes(args.code) && date >= item.effective_from && date <= item.effective_to);
  if (!candidates.length) return { status: 'not_applicable', remedies: [] };
  const identity = args.producer_or_exporter?.trim().toLocaleLowerCase('en');
  if (!identity) return { status: 'producer_refinement_required', candidates };
  return { status: 'applicable', remedies: candidates.map((remedy) => {
    const exact = remedy.rates.find((rate) => !rate.catch_all && rate.producer_or_exporter.toLocaleLowerCase('en') === identity && !(rate.exclusions ?? []).some((item) => item.toLocaleLowerCase('en') === identity));
    const fallback = remedy.rates.find((rate) => rate.catch_all && !(rate.exclusions ?? []).some((item) => item.toLocaleLowerCase('en') === identity));
    if (!exact && !fallback) throw new Error(`Producer/exporter ${args.producer_or_exporter} is excluded from ${remedy.instrument}; no rate is inferred.`);
    return { remedy, rate: exact ?? fallback! };
  }) };
}

export const remedyManifestChecksum = (manifest: MalaysiaTradeRemedyManifest) => createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
