import type { ParsedDuty } from '@/lib/market-access/tariff-semantics';

export const SAUDI_REMEDY_REFERENCE_DATE = '2026-09-22' as const;
export const SAUDI_REMEDY_MANIFEST_VERSION = 'sa-gaft-active-remedies-2026-09-22-v1' as const;
export const SAUDI_REMEDY_SOURCE_URL = 'https://gaft.gov.sa/%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%84%D8%AC%D8%A7%D8%AA-%D8%A7%D9%84%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9/%D9%85%D8%AA%D8%A7%D8%A8%D8%B9%D8%A9-%D8%AA%D8%AD%D9%82%D9%8A%D9%82%D8%A7%D8%AA-%D8%A7%D9%84%D9%85%D8%B9%D8%A7%D9%84%D8%AC%D8%A7%D8%AA-%D8%A7%D9%84%D8%AA%D8%AC%D8%A7%D8%B1%D9%8A%D8%A9';

export interface SaudiTradeRemedy {
  id: string;
  scope: 'SAUDI_NATIONAL' | 'GCC_ALL_MEMBERS' | 'GCC_SAUDI_ONLY';
  kind: 'ANTI_DUMPING';
  product: string;
  tariff_code_prefixes: readonly string[];
  excluded_code_prefixes?: readonly string[];
  origin_countries: readonly string[];
  effective_from: string;
  effective_until: string;
  published_range: string;
  rate_min_percent_cif: number;
  rate_max_percent_cif: number;
  minimum_charge_range?: string;
  source_url: string;
  producer_or_exporter_identity_required: boolean;
}

export interface SaudiTradeRemedyManifest {
  version: typeof SAUDI_REMEDY_MANIFEST_VERSION;
  complete_as_of: typeof SAUDI_REMEDY_REFERENCE_DATE;
  source_last_modified: '2026-08-20';
  measures: readonly SaudiTradeRemedy[];
  active_safeguard_count: 0;
  active_countervailing_count: 0;
}

const measure = (value: Omit<SaudiTradeRemedy, 'kind' | 'source_url' | 'producer_or_exporter_identity_required'>): SaudiTradeRemedy => ({
  ...value, kind: 'ANTI_DUMPING', source_url: SAUDI_REMEDY_SOURCE_URL, producer_or_exporter_identity_required: true,
});

/** Complete active-measure inventory published by GAFT's national + GCC tracker on the reference date. */
export const SAUDI_ACTIVE_TRADE_REMEDY_MANIFEST: SaudiTradeRemedyManifest = Object.freeze({
  version: SAUDI_REMEDY_MANIFEST_VERSION,
  complete_as_of: SAUDI_REMEDY_REFERENCE_DATE,
  source_last_modified: '2026-08-20',
  active_safeguard_count: 0,
  active_countervailing_count: 0,
  measures: Object.freeze([
    measure({ id:'sa-ductile-iron-pipe-in',scope:'SAUDI_NATIONAL',product:'Ductile cast-iron pipes',tariff_code_prefixes:['730300000001'],origin_countries:['IN'],effective_from:'2026-08-04',effective_until:'2031-08-03',published_range:'16.96%–29.94% of CIF, minimum SAR 714–1,260 per metric tonne',rate_min_percent_cif:16.96,rate_max_percent_cif:29.94,minimum_charge_range:'SAR 714–1,260/metric tonne' }),
    measure({ id:'sa-tio2-cn',scope:'SAUDI_NATIONAL',product:'Titanium dioxide (TiO2)',tariff_code_prefixes:['282300000002','282300009999','320611000000'],origin_countries:['CN'],effective_from:'2025-10-27',effective_until:'2030-10-26',published_range:'19.39%–45% of CIF, minimum SAR 1.6–4.4/kg',rate_min_percent_cif:19.39,rate_max_percent_cif:45,minimum_charge_range:'SAR 1.6–4.4/kg' }),
    measure({ id:'sa-stainless-pipe-cn-tw',scope:'SAUDI_NATIONAL',product:'Longitudinally welded circular stainless-steel pipes',tariff_code_prefixes:['730611000001','730611000002','730621000001','730621000002','730640100000','730640200000','730640300000','730650100000','730650200000','730650300000'],origin_countries:['CN','TW'],effective_from:'2025-06-30',effective_until:'2030-05-29',published_range:'China 6.5%–24.6%, minimum SAR 1.750–4.111/kg; Taiwan 23.7%–27.3%, minimum SAR 2.822–3.141/kg',rate_min_percent_cif:6.5,rate_max_percent_cif:27.3,minimum_charge_range:'SAR 1.750–4.111/kg (CN); SAR 2.822–3.141/kg (TW)' }),
    measure({ id:'sa-pvc-coated-fabric-cn-kr',scope:'SAUDI_NATIONAL',product:'PVC-coated fabrics',tariff_code_prefixes:['590310000000','392112000000','392190400000','392690610000'],origin_countries:['CN','KR'],effective_from:'2024-12-17',effective_until:'2029-12-16',published_range:'China 25.56%–51%, minimum SAR 2.06–3.0/kg; Korea 26.83%–41.84%, minimum SAR 2.17–3.03/kg',rate_min_percent_cif:25.56,rate_max_percent_cif:51,minimum_charge_range:'SAR 2.06–3.0/kg (CN); SAR 2.17–3.03/kg (KR)' }),
    measure({ id:'sa-snf-cn-ru',scope:'SAUDI_NATIONAL',product:'Sulphonated naphthalene formaldehyde concrete improvers (SNF)',tariff_code_prefixes:['290410000000','382440000000'],origin_countries:['CN','RU'],effective_from:'2024-12-03',effective_until:'2029-12-02',published_range:'China 18.12%–34%, minimum SAR 435.5–580.5/tonne; Russia 28.77%, minimum SAR 699.6/tonne',rate_min_percent_cif:18.12,rate_max_percent_cif:34,minimum_charge_range:'SAR 435.5–580.5/tonne (CN); SAR 699.6/tonne (RU)' }),
    measure({ id:'gcc-cement-ir',scope:'GCC_ALL_MEMBERS',product:'Cement including clinker',tariff_code_prefixes:['2523'],origin_countries:['IR'],effective_from:'2020-06-20',effective_until:'2031-05-27',published_range:'39.65% of CIF',rate_min_percent_cif:39.65,rate_max_percent_cif:39.65 }),
    measure({ id:'gcc-ceramic-tiles-cn-in',scope:'GCC_ALL_MEMBERS',product:'Ceramic tiles except 69073000',tariff_code_prefixes:['6907'],excluded_code_prefixes:['69073000'],origin_countries:['CN','IN'],effective_from:'2020-06-06',effective_until:'2031-05-27',published_range:'China 23.5%–76%; India 70.2%–106% of CIF',rate_min_percent_cif:23.5,rate_max_percent_cif:106 }),
    measure({ id:'gcc-engine-batteries-cn-my',scope:'GCC_ALL_MEMBERS',product:'Lead-acid starter batteries',tariff_code_prefixes:['85071000'],origin_countries:['CN','MY'],effective_from:'2026-01-13',effective_until:'2031-01-12',published_range:'China 25.8%–74%; Malaysia 43.2%–77% of CIF',rate_min_percent_cif:25.8,rate_max_percent_cif:77 }),
    measure({ id:'gcc-switches-plugs-cn',scope:'GCC_ALL_MEMBERS',product:'Electrical switches, plugs, sockets and connections',tariff_code_prefixes:['853650','853669','85444291','85444221'],origin_countries:['CN'],effective_from:'2024-08-20',effective_until:'2029-09-25',published_range:'11.3%–42% of CIF',rate_min_percent_cif:11.3,rate_max_percent_cif:42 }),
    measure({ id:'gcc-car-batteries-kr',scope:'GCC_ALL_MEMBERS',product:'Car batteries, 35–115 ampere',tariff_code_prefixes:['85071000'],origin_countries:['KR'],effective_from:'2017-06-25',effective_until:'2028-04-22',published_range:'12%–25% of CIF',rate_min_percent_cif:12,rate_max_percent_cif:25 }),
    measure({ id:'gcc-engine-batteries-tr-in',scope:'GCC_ALL_MEMBERS',product:'Engine batteries, 32–225 ampere',tariff_code_prefixes:['85071000'],origin_countries:['TR','IN'],effective_from:'2022-10-01',effective_until:'2027-09-30',published_range:'Turkey 39%; India 8%–41% of CIF',rate_min_percent_cif:8,rate_max_percent_cif:41 }),
    measure({ id:'gcc-sap-sa-only',scope:'GCC_SAUDI_ONLY',product:'Superabsorbent polymers',tariff_code_prefixes:['390690'],origin_countries:['CN','BE','SG','KR','FR'],effective_from:'2023-03-04',effective_until:'2028-03-03',published_range:'China 6%–27.7%; Belgium 8.3%–40.7%; Singapore 13.6%–21.2%; Korea 124%; France 51% of CIF',rate_min_percent_cif:6,rate_max_percent_cif:124 }),
    measure({ id:'gcc-coated-aluminium-cn',scope:'GCC_ALL_MEMBERS',product:'Coated or coloured aluminium-alloy sheets, plates, coils and strips',tariff_code_prefixes:['76061230','76061220','76061210'],origin_countries:['CN'],effective_from:'2025-03-19',effective_until:'2030-04-24',published_range:'7.1%–20% of CIF',rate_min_percent_cif:7.1,rate_max_percent_cif:20 }),
    measure({ id:'gcc-sanitary-ware-cn-in',scope:'GCC_ALL_MEMBERS',product:'Ceramic sanitary ware',tariff_code_prefixes:['69101000','69109000'],origin_countries:['CN','IN'],effective_from:'2025-07-08',effective_until:'2030-07-07',published_range:'China 35.6%–51%; India 21.4%–83.4% of CIF',rate_min_percent_cif:21.4,rate_max_percent_cif:83.4 }),
  ]),
});

export function validateSaudiRemedyManifest(manifest: SaudiTradeRemedyManifest) {
  if (manifest.version !== SAUDI_REMEDY_MANIFEST_VERSION || manifest.complete_as_of !== SAUDI_REMEDY_REFERENCE_DATE || manifest.measures.length !== 14) throw new Error('Saudi active-remedy manifest is not the reviewed 2026-09-22 inventory.');
  if (new Set(manifest.measures.map((item) => item.id)).size !== manifest.measures.length) throw new Error('Saudi active-remedy identities must be unique.');
  for (const item of manifest.measures) if (!item.tariff_code_prefixes.length || !item.origin_countries.length || item.rate_min_percent_cif < 0 || item.rate_max_percent_cif < item.rate_min_percent_cif || !item.source_url.startsWith('https://gaft.gov.sa/')) throw new Error(`Saudi trade-remedy ${item.id} is incomplete.`);
  return manifest;
}

export type SaudiRemedyDecision = { status:'not_applicable';remedies:readonly [] } | { status:'producer_refinement_required';candidates:readonly SaudiTradeRemedy[];required_evidence:readonly string[] };

export function selectSaudiTradeRemedies(args:{manifest:SaudiTradeRemedyManifest;code:string;origin_country:string;at:Date}):SaudiRemedyDecision {
  validateSaudiRemedyManifest(args.manifest);
  const date=args.at.toISOString().slice(0,10),origin=args.origin_country.trim().toUpperCase();
  const candidates=args.manifest.measures.filter((item)=>item.origin_countries.includes(origin)&&date>=item.effective_from&&date<=item.effective_until&&item.tariff_code_prefixes.some((prefix)=>args.code.startsWith(prefix))&&!(item.excluded_code_prefixes??[]).some((prefix)=>args.code.startsWith(prefix)));
  if(!candidates.length)return{status:'not_applicable',remedies:[]};
  return{status:'producer_refinement_required',candidates,required_evidence:['producer_identity','exporter_identity','origin_country','exporting_country','commercial_invoice']};
}

export function unresolvedSaudiRemedyDuty(item:SaudiTradeRemedy):ParsedDuty{return{kind:'mixed',ad_valorem_rate_percent:null,specific_amount:null,specific_currency:null,specific_unit:null,specific_unit_quantity:null,expression:item.published_range,note:'The active anti-dumping schedule is producer/exporter-specific. The GAFT tracker range is retained, but no rate is selected without the shipment identity evidence and applicable detailed schedule.'};}
