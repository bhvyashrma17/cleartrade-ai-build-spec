import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const MOROCCO_REMEDY_REFERENCE_DATE = '2026-09-23' as const;
export const MOROCCO_REMEDY_MANIFEST_VERSION = 'ma-adii-trade-remedies-2026-09-23-v1' as const;
export const MOROCCO_CIRCULAR_LISTING_URL = 'https://www.douane.gov.ma/circulaires/dernierContentEntriesParTerme.jsf?cc=1&ami=1&' as const;
export const MOROCCO_REMEDY_NOTICES_URL = 'https://www.mcinet.gov.ma/fr/antidumping?field_type_avis_target_id=80' as const;
const circular = (documentId: number) => `https://www.douane.gov.ma/dms/loadDocument?documentId=${documentId}&application=circulaire`;

export type MoroccoRemedyKind = 'ANTI_DUMPING' | 'SAFEGUARD';
export interface MoroccoRemedyRate { origin: string; producers: readonly string[]; expression: string; basis: 'named' | 'all_others' | 'origin_wide' }
/** A safeguard duty that is liberalised on a published calendar; each step is inclusive. */
export interface MoroccoRemedyStep { from: string; until: string; expression: string }
export interface MoroccoTradeRemedy {
  id: string; kind: MoroccoRemedyKind; product: string;
  /** Exact ten-digit TDI lines, or the heading/subheading prefixes the implementing circular names. */
  tariff_codes: readonly string[]; code_prefixes: readonly string[];
  /** Codes printed in the circular that match no current TDI line (authority typographical or legacy codes), recorded rather than guessed. */
  codes_not_in_schedule: readonly string[];
  /** Codes printed by a pre-HS 2022 instrument; informational only, never matched against today's lines. */
  legacy_codes: readonly string[];
  /** Anti-dumping: the listed origins. Safeguard: erga omnes except the listed developing countries. */
  origin_scope: 'listed_origins' | 'erga_omnes_except';
  origin_countries: readonly string[]; exempt_origins: readonly string[];
  effective_from: string; effective_until: string | null;
  duty_form: 'ad_valorem' | 'specific_mad_per_kg';
  rates: readonly MoroccoRemedyRate[]; schedule: readonly MoroccoRemedyStep[];
  /** Conditions under which the duty does not apply (Industry-visaed invoice, quota with customs franchise request, product scope). */
  exclusions: readonly string[];
  product_scope_condition: string | null;
  instrument: string; source_url: string;
}
export interface MoroccoHistoricalRemedy { case: string; product: string; origin_countries: readonly string[]; status: 'EXPIRED' | 'SUSPENDED_UNDERTAKING' | 'PROVISIONAL_LAPSED'; ended: string; basis: string }
export interface MoroccoPendingRemedy { case: string; product: string; origin_countries: readonly string[]; status: 'INVESTIGATION' | 'REVIEW' | 'DETERMINATION_WITHOUT_IMPLEMENTING_ACT'; opened: string; notice: string }
export interface MoroccoTradeRemedyManifest {
  version: typeof MOROCCO_REMEDY_MANIFEST_VERSION; complete_as_of: typeof MOROCCO_REMEDY_REFERENCE_DATE;
  register_enumeration_complete: true; enumeration_basis: string;
  measures: readonly MoroccoTradeRemedy[]; historical: readonly MoroccoHistoricalRemedy[]; pending: readonly MoroccoPendingRemedy[];
}

const EU = ['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK'];
const codes = (...values: string[]) => values.map(value => value.replace(/[.\s]/g, ''));
const wide = (origin: string, expression: string): MoroccoRemedyRate => ({ origin, producers: [], expression, basis: 'origin_wide' });
const named = (origin: string, producers: string[], expression: string): MoroccoRemedyRate => ({ origin, producers, expression, basis: 'named' });
const others = (origin: string, expression: string): MoroccoRemedyRate => ({ origin, producers: [], expression, basis: 'all_others' });
const INDUSTRY_VISA = 'Imports covered by an invoice visaed by the government department in charge of industry are excluded.';

/** Developing countries not subject to each safeguard, transcribed from the annex of the latest implementing circular. */
const HOT_ROLLED_EXEMPT = 'AE AG AL AM AO AR BB BD BF BH BI BJ BN BO BW BZ CD CF CG CI CL CM CO CR CU CV DJ DM DO EC FJ GA GD GE GH GM GN GT GW GY HN HT ID JM JO KE KG KH KN KW KZ LA LC LK LS MD ME MG MK ML MM MN MR MU MV MW MX MY MZ NA NE NG NI NP OM PA PE PG PH PK PY QA RW SB SG SL SN SR SV SZ TD TG TJ TN TO TT TZ UG UY VC VE VU WS YE ZA ZM ZW'.split(' ');
const TUBES_EXEMPT = 'AE AG AL AM AO AR BB BD BF BH BI BJ BN BO BR BW BZ CD CF CG CI CL CM CO CR CU CV DJ DM DO EC EG FJ GA GD GE GH GM GN GT GW GY HN HT ID IN JM JO KE KG KH KN KR KW KZ LA LC LK LS MD ME MG MK ML MM MN MO MR MU MV MW MX MY MZ NA NE NG NI NP OM PA PE PG PH PK PY QA RW SA SB SG SL SN SR SV SZ TD TG TH TJ TN TO TT TW TZ UG UY VC VE VN VU WS YE ZA ZM ZW'.split(' ');
const WOOD_PANELS_EXEMPT = 'AE AF AG AL AM AO AR BB BD BF BH BI BJ BN BO BR BW BZ CD CF CG CI CL CM CN CO CR CU CV DJ DM DO EC EG FJ GA GD GE GH GM GN GT GW GY HK HN HT ID IN JM JO KE KG KH KN KR KW KZ LA LC LK LR LS MD ME MG MK ML MM MN MO MR MU MV MW MX MY MZ NA NE NG NI NP OM PA PE PG PH PK PY QA RW SA SB SC SG SL SN SR SV SZ TD TG TH TJ TN TO TT TW TZ UA UG UY VC VE VN VU WS YE ZA ZM ZW'.split(' ');
const FIBREBOARD_EXEMPT = 'AE AF AG AL AM AO AR BB BD BF BH BI BJ BN BO BR BW BZ CD CF CG CI CL CM CO CR CU CV DJ DM DO EC EG FJ GA GD GE GH GM GN GT GW GY HK HN HT ID IN JM JO KE KG KH KM KN KW KZ LA LC LK LR LS MD ME MG MK ML MM MN MO MR MU MV MW MX MY MZ NA NE NG NI NP OM PA PE PG PH PK PY QA RW SA SB SC SL SN SR SV SZ TD TG TH TJ TL TN TO TT TZ UG UY VC VE VN VU WS YE ZA ZM ZW'.split(' ');

const base = { code_prefixes: [] as string[], codes_not_in_schedule: [] as string[], legacy_codes: [] as string[], exempt_origins: [] as string[], schedule: [] as MoroccoRemedyStep[], product_scope_condition: null as string | null };
/**
 * Every Moroccan trade-remedy duty in force on 2026-09-23, enumerated from the complete ADII annual
 * circular listings 2015–2026 (every anti-dumping, safeguard and countervailing circular reviewed) and
 * cross-checked against the Ministry of Industry and Commerce notice stream. Rates and codes are read
 * from each implementing circular. No measure applies to India-origin goods except the hot-rolled
 * steel safeguard, whose developing-country exemption list does not include India.
 */
const MEASURES: readonly MoroccoTradeRemedy[] = [
  { ...base, id: 'MA-AD-PVC-EU-GB-MX', kind: 'ANTI_DUMPING', product: 'Suspension-polymerised PVC, primary form, not mixed', tariff_codes: codes('3904.10.90.00'), origin_scope: 'listed_origins', origin_countries: [...EU, 'GB', 'MX'],
    effective_from: '2023-08-10', effective_until: '2027-08-03', duty_form: 'ad_valorem', rates: [...EU.map(origin => wide(origin, '5.5%')), wide('GB', '5.5%'), wide('MX', '8%')],
    exclusions: ['Emulsion-polymerised PVC covered by an invoice visaed by the department in charge of industry is excluded.'], instrument: 'Circular 6489/211 of 2023-08-09 (joint order 2003-23)', source_url: circular(92531) },
  { ...base, id: 'MA-AD-PVC-US', kind: 'ANTI_DUMPING', product: 'Polyvinyl chloride', tariff_codes: codes('3904.10.90.00'), origin_scope: 'listed_origins', origin_countries: ['US'],
    effective_from: '2025-01-03', effective_until: '2030-01-02', duty_form: 'ad_valorem', rates: [wide('US', '24.88%')], exclusions: [INDUSTRY_VISA], instrument: 'Circular 6626/211 of 2025-01-03 (joint order 3182.24)', source_url: circular(95286) },
  { ...base, id: 'MA-AD-PVC-EG', kind: 'ANTI_DUMPING', product: 'Polyvinyl chloride', tariff_codes: codes('3904.10.90.00'), origin_scope: 'listed_origins', origin_countries: ['EG'],
    effective_from: '2026-02-03', effective_until: '2031-02-02', duty_form: 'ad_valorem', rates: [named('EG', ['Egyptian Petrochemicals Company'], '74.87%'), others('EG', '92.19%')],
    exclusions: ['Emulsion-polymerised PVC covered by an invoice visaed by the department in charge of industry is excluded.'], instrument: 'Circular 6719/211 of 2026-02-03 (joint order 2984.25)', source_url: circular(97477) },
  { ...base, id: 'MA-AD-CRC-EG', kind: 'ANTI_DUMPING', product: 'Cold-rolled flat steel, not clad, plated or coated',
    tariff_codes: codes('7209150000', '7209160010', '7209160091', '7209160099', '7209170010', '7209170090', '7209180010', '7209180090', '7209250000', '7209260010', '7209260091', '7209260099', '7209270010', '7209270090', '7209280010', '7209280090', '7209901000', '7209902010', '7209902090', '7209909000', '7211230020', '7211230030', '7211230051', '7211230058', '7211230090', '7211290010', '7211290030', '7211290040', '7211290060', '7211290090', '7211901000', '7211902000', '7211909000', '7226200019', '7226200020', '7226200061', '7226200069', '7226200090', '7226920000', '7226991000', '7226998000'),
    origin_scope: 'listed_origins', origin_countries: ['EG'], effective_from: '2026-07-03', effective_until: '2031-07-02', duty_form: 'ad_valorem',
    rates: [named('EG', ['Kandil Steel', 'El Obour for Metallurgical Industries (Galva Metal)', 'Kama for Coating and Manufacturing'], '60.40%'), others('EG', '84.39%')], exclusions: [INDUSTRY_VISA], instrument: 'Circular 6753/211 of 2026-07-02 (joint order 1165.26)', source_url: circular(98443) },
  { ...base, id: 'MA-AD-PLYWOOD-CN', kind: 'ANTI_DUMPING', product: 'Plywood of okoumé or other wood, each ply ≤6 mm',
    tariff_codes: codes('4412109100', '4412109910', '4412109920', '4412109990', '4412319200', '4412319810', '4412319820', '4412319890', '4412339100', '4412339910', '4412339920', '4412339990', '4412349100', '4412349910', '4412349920', '4412349990', '4412399100', '4412399910', '4412399920', '4412399990', '4412419100', '4412419910', '4412419920', '4412419990', '4412429100', '4412429910', '4412429920', '4412429990', '4412499100', '4412499910', '4412499920', '4412499990', '4412519100', '4412519910', '4412519990', '4412529100', '4412529910', '4412529990', '4412599100', '4412599910', '4412599920', '4412599990', '4412919100', '4412919910', '4412919920', '4412919990', '4412929100', '4412929910', '4412929920', '4412929990', '4412999300', '4412999710', '4412999720', '4412999790'),
    // The TDI has since split 4412.51.99.20 and 4412.52.99.20; no instrument maps them, so the whole 4412.51.99/4412.52.99 range is scoped by product identity.
    code_prefixes: ['44125199', '44125299'], codes_not_in_schedule: codes('4412.51.99.20', '4412.52.99.20'),
    origin_scope: 'listed_origins', origin_countries: ['CN'], effective_from: '2023-09-25', effective_until: '2027-08-28', duty_form: 'ad_valorem', rates: [wide('CN', '76%')], exclusions: [],
    product_scope_condition: 'Only plywood whose every ply is ≤6 mm thick.', instrument: 'Circular 6497/211 of 2023-09-25 (joint order 2178-23)', source_url: circular(92751) },
  { ...base, id: 'MA-AD-BLOCKBOARD-EG', kind: 'ANTI_DUMPING', product: 'Blockboard (contreplaqué latté)', tariff_codes: [], code_prefixes: codes('4412.51', '4412.52', '4412.59'),
    legacy_codes: codes('4412.10.99.21', '4412.10.99.29', '4412.10.99.90', '4412.31.99.21', '4412.31.99.29', '4412.31.99.90', '4412.32.99.21', '4412.32.99.29', '4412.32.99.90', '4412.39.99.21', '4412.39.99.29', '4412.39.99.90', '4412.94.99.21', '4412.94.99.29', '4412.94.99.90', '4412.99.98.21', '4412.99.98.29', '4412.99.98.90'),
    origin_scope: 'listed_origins', origin_countries: ['EG'], effective_from: '2025-12-22', effective_until: null, duty_form: 'ad_valorem', rates: [wide('EG', '28.13%')], exclusions: [],
    product_scope_condition: 'The measure names only pre-HS 2022 lines; in the HS 2022 TDI blockboard falls under 4412.51/52/59 ("à âme lattée"), so the duty applies only once the goods are identified as blockboard.',
    instrument: 'Circular 5554/211 (2015) as maintained by 6122/211 and 6294/211; provisionally maintained pending expiry review by 6725/211 of 2026-02-25 (joint order 63.26)', source_url: circular(97648) },
  { ...base, id: 'MA-AD-NOTEBOOKS-TN', kind: 'ANTI_DUMPING', product: 'Exercise books (cahiers)', tariff_codes: codes('4820.20.00.00'), origin_scope: 'listed_origins', origin_countries: ['TN'],
    effective_from: '2025-02-06', effective_until: '2030-02-05', duty_form: 'ad_valorem', rates: [named('TN', ['SOTEFI'], '27.71%'), named('TN', ['SITPEC'], '15.69%'), others('TN', '27.71%')], exclusions: [],
    instrument: 'Circular 6634/211 of 2025-02-06 (joint order 1.25) extending the rates of 5895/211', source_url: circular(95475) },
  { ...base, id: 'MA-AD-CARPETS-CN-EG-JO', kind: 'ANTI_DUMPING', product: 'Machine-made carpets and other textile floor coverings',
    tariff_codes: codes('5701100010', '5701100090', '5701901000', '5701902000', '5701909000', '5702310000', '5702320000', '5702390000', '5702410000', '5702420000', '5702490010', '5702490090', '5702500010', '5702500020', '5702500091', '5702500099', '5702910000', '5702920000', '5702990010', '5702990090', '5703100010', '5703100091', '5703100099', '5703210010', '5703210091', '5703210099', '5703290010', '5703290091', '5703290099', '5703310010', '5703310091', '5703310099', '5703390010', '5703390091', '5703390099', '5703900010', '5703900091', '5703900092', '5703900099', '5704100000', '5704200000', '5704900000', '5705000010', '5705000050', '5705000080'),
    origin_scope: 'listed_origins', origin_countries: ['CN', 'EG', 'JO'], effective_from: '2022-09-09', effective_until: '2027-09-08', duty_form: 'ad_valorem',
    rates: [wide('CN', '144%'), named('EG', ['Oriental Weavers'], '35.33%'), others('EG', '35.33%'), named('JO', ['Arab Weavers'], '0%'), others('JO', '0%')], exclusions: [],
    instrument: 'Circular 6366/211 of 2022-09-12 (joint order 2242.22)', source_url: circular(90320) },
  { ...base, id: 'MA-AD-GALV-WIRE-TR', kind: 'ANTI_DUMPING', product: 'Galvanised (zinc-coated) wire, diameter >0.85 mm', tariff_codes: codes('7217.20.10.00', '7217.20.99.00'), origin_scope: 'listed_origins', origin_countries: ['TR'],
    effective_from: '2023-05-05', effective_until: '2028-05-04', duty_form: 'ad_valorem', rates: [named('TR', ['Aslanli Tel Sanayi'], '21%'), named('TR', ['Güney Çelik'], '61%'), others('TR', '61%')], exclusions: [],
    product_scope_condition: 'Only wire of a diameter exceeding 0.85 mm.', instrument: 'Circular 6454/211 of 2023-05-04', source_url: circular(92009) },
  { ...base, id: 'MA-AD-TOMATO-EG', kind: 'ANTI_DUMPING', product: 'Prepared or preserved tomatoes (conserves de tomate)', tariff_codes: codes('2002.90.90.11', '2002.90.90.19', '2002.90.90.91', '2002.90.90.99', '2005.99.35.00'),
    origin_scope: 'listed_origins', origin_countries: ['EG'], effective_from: '2024-12-24', effective_until: '2029-12-23', duty_form: 'ad_valorem', rates: [wide('EG', '29.93%')], exclusions: [],
    instrument: 'Circular 6618/211 of 2024-12-23', source_url: circular(95241) },
  { ...base, id: 'MA-AD-OVENS-TR', kind: 'ANTI_DUMPING', product: 'Portable, non-built-in domestic electric ovens ≤70 litres', tariff_codes: codes('8516.60.00.11'), origin_scope: 'listed_origins', origin_countries: ['TR'],
    effective_from: '2025-01-03', effective_until: '2030-01-02', duty_form: 'ad_valorem', rates: [named('TR', ['Itimat Makina Sanayi ve Ticaret A.S.'], '32.82%'), others('TR', '62.07%')], exclusions: ['Air fryers and any product outside the definition are excluded.'],
    product_scope_condition: 'Only mobile, non-built-in domestic electric ovens of a capacity not exceeding 70 litres.', instrument: 'Circular 6625/211 of 2025-01-03', source_url: circular(95285) },
  { ...base, id: 'MA-SG-HOT-ROLLED', kind: 'SAFEGUARD', product: 'Hot-rolled flat steel', tariff_codes: codes('7226200011', '7226200020', '7226200051', '7226200052', '7226200059', '7226998000'), code_prefixes: ['7208', '721113', '721114', '721119', '722530', '722540', '722691'],
    origin_scope: 'erga_omnes_except', origin_countries: [], exempt_origins: HOT_ROLLED_EXEMPT, effective_from: '2026-06-19', effective_until: '2029-06-18', duty_form: 'ad_valorem', rates: [],
    schedule: [{ from: '2026-06-19', until: '2027-06-18', expression: '19%' }, { from: '2027-06-19', until: '2028-06-18', expression: '18%' }, { from: '2028-06-19', until: '2029-06-18', expression: '17%' }],
    exclusions: [INDUSTRY_VISA], instrument: 'Circular 6744/211 of 2026-06-16 (joint order 996.26) over the scope of 6469/211', source_url: circular(98344) },
  { ...base, id: 'MA-SG-TUBES', kind: 'SAFEGUARD', product: 'Iron or steel tubes and pipes',
    tariff_codes: codes('7306.19.10.90', '7306.19.99.00', '7306.30.10.99', '7306.30.99.00', '7306.50.10.90', '7306.50.99.00', '7306.61.10.10', '7306.61.10.90', '7306.61.90.00', '7306.69.10.00', '7306.69.99.00', '7306.90.20.12', '7306.90.20.19', '7306.90.20.22', '7306.90.20.29', '7306.90.20.39', '7306.90.90.19', '7306.90.90.99'),
    codes_not_in_schedule: codes('7603.90.90.19'), origin_scope: 'erga_omnes_except', origin_countries: [], exempt_origins: TUBES_EXEMPT, effective_from: '2023-11-06', effective_until: '2026-11-05', duty_form: 'ad_valorem', rates: [],
    schedule: [{ from: '2023-11-06', until: '2024-11-05', expression: '22%' }, { from: '2024-11-06', until: '2025-11-05', expression: '21%' }, { from: '2025-11-06', until: '2026-11-05', expression: '20%' }],
    exclusions: [INDUSTRY_VISA, 'Exempt developing-country origin must be proved by an origin document visaed by that country.'], instrument: 'Circular 6515/211 of 2023-12-15 (joint order 2766.23); its misprinted 7603.90.90.19 is 7306.90.90.19 per MIC notice DDC/09/2026', source_url: circular(93158) },
  { ...base, id: 'MA-SG-COATED-PARTICLE-BOARD', kind: 'SAFEGUARD', product: 'Coated particle/wood panels', tariff_codes: codes('4410.11.20.90', '4410.11.30.90', '4410.19.92.90', '4410.19.93.90'), origin_scope: 'erga_omnes_except', origin_countries: [], exempt_origins: WOOD_PANELS_EXEMPT,
    effective_from: '2025-09-20', effective_until: '2028-09-19', duty_form: 'specific_mad_per_kg', rates: [], schedule: [{ from: '2025-09-20', until: '2028-09-19', expression: '1.6 MAD/kg' }],
    exclusions: ['Imports within the annual tariff quota (35,280,000 kg to 2026-09-19; 38,808,000 kg to 2027-09-19; 42,688,800 kg to 2028-09-19) are excluded; quota availability is never established here.'],
    instrument: 'Circular 6692/211 of 2025-11-21 (joint order 2418.25) at the 1.6 MAD/kg of 5968/211 and 6367/211', source_url: circular(97052) },
  { ...base, id: 'MA-SG-COATED-FIBREBOARD', kind: 'SAFEGUARD', product: 'Coated wood fibreboard (melamine paper or plastic sheet)', tariff_codes: codes('4411.12.00.90', '4411.13.00.90', '4411.14.00.90', '4411.92.00.90', '4411.93.00.90', '4411.94.00.90'),
    origin_scope: 'erga_omnes_except', origin_countries: [], exempt_origins: FIBREBOARD_EXEMPT, effective_from: '2025-04-15', effective_until: '2028-04-14', duty_form: 'specific_mad_per_kg', rates: [], schedule: [{ from: '2025-04-15', until: '2028-04-14', expression: '1 MAD/kg' }],
    exclusions: ['Laminate flooring and wooden skirting are excluded.', 'Imports within the annual quota (17,600 t to 2027-02-20) under a customs franchise request are excluded; quota availability is never established here.', 'China was removed from the exemption list with effect from 2026-07-03.'],
    instrument: 'Circular 6651/211 of 2025-04-11 as amended by 6754/211 of 2026-07-02', source_url: circular(98445) },
];

const HISTORICAL: readonly MoroccoHistoricalRemedy[] = [
  { case: 'AD refrigerators', product: 'Refrigerators', origin_countries: ['TR', 'TH', 'CN'], status: 'EXPIRED', ended: '2023-01-17', basis: 'Five-year definitive duty of 5754/211 (2018-01-17); no extension circular.' },
  { case: 'AD A4 paper', product: 'A4 paper', origin_countries: ['PT'], status: 'EXPIRED', ended: '2022-09-21', basis: 'Measure of 5658/211 and 5710/211 (2017); no extension circular.' },
  { case: 'AD insulin', product: 'Insulin', origin_countries: ['DK'], status: 'SUSPENDED_UNDERTAKING', ended: '2023-06-01', basis: '6471/211: duty suspended from entry into force by joint order 379-23 on Novo Nordisk\'s price undertaking; expiry review closed by MIC notice DDC/12/2025.' },
  { case: 'AD galvanised wire (provisional)', product: 'Galvanised wire', origin_countries: ['EG', 'AE'], status: 'PROVISIONAL_LAPSED', ended: '2026-06-12', basis: 'Four-month provisional duty of 6723/211 from 2026-02-13; no definitive implementing circular by the reference date.' },
  { case: 'SG cold-rolled and coated sheet', product: 'Cold-rolled, clad, plated or coated sheet', origin_countries: [], status: 'EXPIRED', ended: '2024-12-31', basis: 'Extended to 2024-12-31 by 6264/211; no later circular.' },
  { case: 'SG wire rod and rebar', product: 'Wire rod and reinforcing bars', origin_countries: [], status: 'EXPIRED', ended: '2023-10-15', basis: 'Extended to 2023-10-15 by 6266/211; no later circular.' },
  { case: 'Preferential SG textiles (Türkiye)', product: 'Textiles and clothing', origin_countries: ['TR'], status: 'EXPIRED', ended: '2022-12-31', basis: 'Extended to 2022-12-31 by 6265/211; no later circular.' },
  { case: 'SG paper rolls and reams', product: 'Paper in rolls and reams', origin_countries: [], status: 'EXPIRED', ended: '2020-12-31', basis: 'Three-year measure of 5654/211 liberalised by 5978/211; no later circular.' },
];

const PENDING: readonly MoroccoPendingRemedy[] = [
  { case: 'DDC/07/2026', product: 'Ceramic tiles', origin_countries: ['IN'], status: 'INVESTIGATION', opened: '2026-04-22', notice: 'MIC public notice DDC/07/2026 opening an anti-dumping investigation; no provisional or definitive duty.' },
  { case: 'DDC/10/2026', product: 'Galvanised wire', origin_countries: ['EG', 'AE'], status: 'DETERMINATION_WITHOUT_IMPLEMENTING_ACT', opened: '2025-03-12', notice: 'MIC notice DDC/10/2026 (2026-07-28) on the final determination; no implementing joint order or ADII circular by the reference date.' },
  { case: 'DDC/11/2026', product: 'Thick-core wood panels', origin_countries: ['CN', 'ID'], status: 'DETERMINATION_WITHOUT_IMPLEMENTING_ACT', opened: '2026-02-19', notice: 'MIC notice DDC/11/2026 (2026-07-28) on the preliminary determination; no provisional-duty circular by the reference date.' },
  { case: 'DDC/08/2026', product: 'Long-pile fabrics for blankets', origin_countries: ['CN', 'EG'], status: 'INVESTIGATION', opened: '2026-05-21', notice: 'MIC public notice DDC/08/2026.' },
  { case: 'DDC/11/2025', product: 'Machine-made carpets', origin_countries: ['JO'], status: 'INVESTIGATION', opened: '2025-09-26', notice: 'MIC public notice DDC/11/2025; the existing Jordan rate remains 0%.' },
  { case: 'DDC/14/2025', product: 'Blockboard (expiry review)', origin_countries: ['EG'], status: 'REVIEW', opened: '2025-12-19', notice: 'MIC public notice DDC/14/2025; the duty is provisionally maintained by 6725/211.' },
  { case: 'DDC/16/2025', product: 'LED street-lighting luminaires (9405.42.00.10)', origin_countries: ['CN'], status: 'DETERMINATION_WITHOUT_IMPLEMENTING_ACT', opened: '2024-09-02', notice: 'MIC notice DDC/16/2025 (2025-12-23) closes the investigation and envisages a 27% definitive duty; no implementing joint order or ADII circular by the reference date.' },
  { case: 'DDC/02/2026', product: 'Machine-made carpets (Oriental Weavers partial review)', origin_countries: ['EG'], status: 'DETERMINATION_WITHOUT_IMPLEMENTING_ACT', opened: '2025-02-13', notice: 'MIC notice DDC/02/2026 (2026-02-11) envisages revising the Oriental Weavers group rate to 24.59%; no implementing ADII circular, so the 35.33% of 6366/211 remains the customs rate.' },
  { case: 'DDC/09/2026', product: 'Iron or steel tubes and pipes (extension review)', origin_countries: [], status: 'REVIEW', opened: '2026-06-17', notice: 'MIC notice DDC/09/2026; continuation beyond 2026-11-05 is not presumed.' },
  { case: 'DDC/04/2026', product: 'Rice (safeguard investigation)', origin_countries: [], status: 'INVESTIGATION', opened: '2026-04-01', notice: 'MIC notice DDC/04/2026 opening a safeguard investigation; no duty.' },
];

export const MOROCCO_TRADE_REMEDY_MANIFEST: MoroccoTradeRemedyManifest = Object.freeze({
  version: MOROCCO_REMEDY_MANIFEST_VERSION, complete_as_of: MOROCCO_REMEDY_REFERENCE_DATE, register_enumeration_complete: true,
  enumeration_basis: 'Complete ADII annual circular listings 2015–2026 (every anti-dumping, safeguard and countervailing circular reviewed), cross-checked against the complete Ministry of Industry and Commerce anti-dumping, safeguard and countervailing notice streams.',
  measures: MEASURES, historical: HISTORICAL, pending: PENDING,
}) as MoroccoTradeRemedyManifest;

export function validateMoroccoRemedyManifest(manifest: MoroccoTradeRemedyManifest) {
  if (manifest.version !== MOROCCO_REMEDY_MANIFEST_VERSION || manifest.register_enumeration_complete !== true) throw new Error('Morocco trade-remedy manifest is not the reviewed complete enumeration.');
  for (const measure of manifest.measures) {
    if (!measure.tariff_codes.length && !measure.code_prefixes.length) throw new Error(`Morocco remedy ${measure.id} lacks a tariff scope.`);
    if (measure.tariff_codes.some(code => !/^\d{10}$/.test(code))) throw new Error(`Morocco remedy ${measure.id} lists a code that is not ten digits.`);
    if (measure.kind === 'ANTI_DUMPING' && measure.origin_countries.some(origin => !measure.rates.some(rate => rate.origin === origin))) throw new Error(`Morocco remedy ${measure.id} lacks rate evidence for every origin.`);
    if (measure.kind === 'SAFEGUARD' && !measure.schedule.length) throw new Error(`Morocco safeguard ${measure.id} lacks its duty schedule.`);
  }
  if (manifest.pending.some(entry => manifest.measures.some(measure => measure.id === entry.case))) throw new Error('A pending Morocco investigation is represented as a duty.');
}

const covers = (measure: MoroccoTradeRemedy, code: string) => measure.tariff_codes.includes(code) || measure.code_prefixes.some(prefix => code.startsWith(prefix));
const applies = (measure: MoroccoTradeRemedy, origin: string) => (measure.origin_scope === 'listed_origins' ? measure.origin_countries.includes(origin) : !measure.exempt_origins.includes(origin));

/** Investigations, reviews, lapsed provisional duties and suspended measures are never duties; a safeguard applies to every origin not on its exemption list. */
export function selectMoroccoTradeRemedies(args: { manifest: MoroccoTradeRemedyManifest; code: string; origin_country: string; at: Date }) {
  const on = args.at.toISOString().slice(0, 10);
  return args.manifest.measures.filter(measure => covers(measure, args.code) && applies(measure, args.origin_country) && measure.effective_from <= on && (!measure.effective_until || on <= measure.effective_until)
    && (measure.kind !== 'SAFEGUARD' || measure.schedule.some(step => step.from <= on && on <= step.until)));
}

/** Identity needed before the duty can be selected: a producer table, a product-scope definition, or a legacy-code mapping. */
export function moroccoRemedyIdentityRequired(measure: MoroccoTradeRemedy, origin: string) {
  if (measure.product_scope_condition) return true;
  if (measure.kind === 'SAFEGUARD') return false;
  const rows = measure.rates.filter(rate => rate.origin === origin);
  return !(rows.length === 1 && rows[0]!.basis === 'origin_wide') && new Set(rows.map(rate => rate.expression)).size > 1;
}

export function moroccoRemedyDuty(measure: MoroccoTradeRemedy, origin: string, at: Date): ParsedDuty {
  const on = at.toISOString().slice(0, 10), empty = { specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null };
  const expressions = measure.kind === 'SAFEGUARD' ? measure.schedule.filter(step => step.from <= on && on <= step.until).map(step => step.expression) : [...new Set(measure.rates.filter(rate => rate.origin === origin).map(rate => rate.expression))];
  if (expressions.length !== 1 || moroccoRemedyIdentityRequired(measure, origin)) {
    return { kind: 'mixed', ad_valorem_rate_percent: null, ...empty, expression: `${expressions.join(' / ')} depending on ${measure.product_scope_condition ? 'product scope' : 'producer/exporter'}`, note: `${measure.instrument}. ${measure.product_scope_condition ?? 'Rate depends on producer/exporter identity.'} Never selected from origin alone.` };
  }
  const expression = expressions[0]!;
  const specific = /^(\d+(?:\.\d+)?) MAD\/kg$/.exec(expression);
  if (specific) return { kind: 'specific', ad_valorem_rate_percent: null, specific_amount: Number(specific[1]), specific_currency: 'MAD', specific_unit: 'kg', specific_unit_quantity: 1, expression, note: `${measure.instrument}. ${measure.exclusions.join(' ')}` };
  return { kind: 'ad_valorem', ad_valorem_rate_percent: Number(expression.slice(0, -1)), ...empty, expression, note: `${measure.instrument}. ${measure.exclusions.join(' ')}` };
}
