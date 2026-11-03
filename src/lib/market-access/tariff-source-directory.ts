/**
 * Where a person finds each market's official tariff (D-024, docs/37).
 *
 * The Customs Atlas automates a market only where its authority publishes the tariff on terms and in
 * a form that can be machine-read completely (`DESTINATION_ADAPTERS`). Markets whose authoritative
 * source was researched and found not automatable carry that determination in
 * `unconfigured-sources.ts`. This directory covers every other market: the publishing authority,
 * the official page, schedule or law where the current rates can be read, and the customs union
 * whose common external tariff the market applies. A connected market appears here only where its
 * automatic read can leave a duty estimated for a reason an agent can check by hand: Andorra's
 * chapters 1–24, Singapore while no nightly copy is saved (D-029), and the members of a customs union
 * read from its common external tariff, whose own exceptions are checked at the national source (D-028).
 *
 * It is guidance for a ClearTrade agent checking a duty by hand. Nothing here is tariff evidence and
 * nothing here is scored: an agent who reads a rate from one of these sources records it through the
 * authoritative-manual path (`manual-authoritative.ts`), never by editing this file.
 *
 * Researched 14–17 Oct 2026 from the authorities' own sites and official legal publications. A null
 * `source_url` means no official copy was found online; the agent then asks the authority directly.
 */
import { DESTINATION_ADAPTERS } from '@/lib/job-handlers/market-access';
import { customsUnionSourceFor } from './providers/customs-union-sources';
import { tariffScheduleSourceFor } from './providers/tariff-schedule-sources';
import { unconfiguredSourceForCountry } from './unconfigured-sources';

export const TARIFF_SOURCE_DIRECTORY_CHECKED_ON = '2026-10-17';

/**
 * - `online_lookup`: an official search by tariff code.
 * - `schedule`: the official tariff schedule as a document.
 * - `law`: the act, order or gazette that sets the rates.
 * - `authority_page`: the authority's own page about duties, without the full schedule.
 * - `rule`: one published rule sets the duty (a free port, or one rate for all goods).
 * - `not_found`: no official copy found online.
 */
export type TariffSourceForm = 'online_lookup' | 'schedule' | 'law' | 'authority_page' | 'rule' | 'not_found';

export interface CustomsUnionTariff {
  name: string;
  members: readonly string[];
  authority: string;
  /** Where the common external tariff itself is published, when an official copy was found. */
  source_url: string | null;
  note: string;
}

/** Customs unions whose members apply one common external tariff, with national exceptions. */
export const CUSTOMS_UNION_TARIFFS: Readonly<Record<string, CustomsUnionTariff>> = Object.freeze({
  EU: {
    name: 'European Union common customs tariff',
    members: ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'AX', 'MC', 'MQ', 'SM', 'AD'],
    authority: 'European Commission (TARIC)',
    source_url: null,
    note: 'Connected through the official TARIC extraction. Andorra applies it to HS chapters 25–97 only.',
  },
  ECOWAS: {
    name: 'ECOWAS common external tariff',
    members: ['BJ', 'BF', 'CV', 'CI', 'GM', 'GH', 'GN', 'GW', 'LR', 'ML', 'NE', 'NG', 'SN', 'SL', 'TG'],
    authority: 'ECOWAS Commission',
    source_url: 'https://ecotis.ecowas.int/?p=24111',
    note: 'Five bands from 0% to 35%, plus national supplementary measures and Community levies. Read automatically for every member but Cabo Verde, which keeps its own tariff, from the UEMOA edition (D-028).',
  },
  UEMOA: {
    name: 'UEMOA edition of the ECOWAS common external tariff',
    members: ['BJ', 'BF', 'CI', 'GW', 'ML', 'NE', 'SN', 'TG'],
    authority: 'UEMOA Commission',
    source_url: 'https://e-docucenter.uemoa.int/sites/default/files/2024-09/UEMOA_TEC2022_V4.pdf',
    note: 'TEC 2022, version 4: one schedule for all eight UEMOA members, with the regional levies. Connected (D-028): its DD column is read as the ECOWAS common external tariff.',
  },
  EAC: {
    name: 'East African Community common external tariff',
    members: ['KE', 'UG', 'TZ', 'RW', 'BI', 'SS', 'CD', 'SO'],
    authority: 'EAC Secretariat',
    source_url: 'https://repository.eac.int/items/e30ab63f-9077-40d3-9b44-8f9863584319',
    note: 'CET 2022 (four bands: 0%, 10%, 25%, 35%), changed each July by the EAC Gazette, with per-country stays of application. DR Congo and Somalia have joined but do not yet apply it. Connected (D-028) for Burundi, Kenya, Rwanda, Tanzania and Uganda with the 2026/27 Gazette; South Sudan applies it only in part.',
  },
  CEMAC: {
    name: 'CEEAC–CEMAC common external tariff',
    members: ['CM', 'CF', 'TD', 'CG', 'GQ', 'GA'],
    authority: 'CEMAC Commission / ECCAS',
    source_url: null,
    note: 'A new CEEAC–CEMAC tariff (0% to 40%) approved on 18 October 2024 applies in Cameroon from 1 January 2026; no official copy was found online.',
  },
  SACU: {
    name: 'Southern African Customs Union common external tariff',
    members: ['ZA', 'BW', 'LS', 'NA', 'SZ'],
    authority: 'South African Revenue Service (Schedule 1 to the Customs and Excise Act is the SACU tariff)',
    source_url: 'https://www.sars.gov.za/legal-counsel/primary-legislation/schedules-to-the-customs-and-excise-act-1964/',
    note: 'SARS publishes the schedules; its terms require written consent for automated acquisition (see ZA_SARS_TARIFF).',
  },
  EAEU: {
    name: 'Eurasian Economic Union common customs tariff',
    members: ['RU', 'BY', 'KZ', 'KG', 'AM'],
    authority: 'Eurasian Economic Commission',
    source_url: 'https://adilet.zan.kz/rus/docs/H21EV000080',
    note: 'EEC Council Decision No. 80 of 14 September 2021 and its amendments. Kazakhstan, Kyrgyzstan and Armenia apply lower WTO-commitment rates on listed lines. Connected (D-028) from the consolidated text; those national rates are not modelled.',
  },
  GCC: {
    name: 'Gulf Cooperation Council common customs tariff',
    members: ['SA', 'KW', 'QA', 'OM', 'AE', 'BH'],
    authority: 'GCC customs administrations',
    source_url: 'https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/IntegratedCustomsTariff.pdf',
    note: 'Mostly 5%, with national exceptions; each member publishes its own execution. Saudi Arabia, Kuwait, Qatar and Oman are connected from their own tariffs; the UAE and Bahrain are connected (D-028, D-030) from the unified tariff as Dubai Customs publishes it, with the UAE’s CEPA rates for Indian goods.',
  },
  CARICOM: {
    name: 'CARICOM common external tariff',
    members: ['AG', 'BB', 'BZ', 'DM', 'GD', 'GY', 'JM', 'KN', 'LC', 'MS', 'SR', 'TT', 'VC'],
    authority: 'CARICOM Secretariat; each member executes it nationally',
    source_url: null,
    note: 'Each member applies the CET with its own exception lists and suspensions; read the national tariff.',
  },
  SICA: {
    name: 'Central American import tariff (Arancel Centroamericano de Importación)',
    members: ['CR', 'SV', 'GT', 'HN', 'NI'],
    authority: 'SIECA; each member executes it nationally',
    source_url: null,
    note: 'Largely harmonised, with national rates on some lines.',
  },
  MERCOSUR: {
    name: 'MERCOSUR common external tariff',
    members: ['AR', 'BR', 'PY', 'UY'],
    authority: 'MERCOSUR; each member executes it nationally',
    source_url: 'https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes',
    note: 'Each member keeps national exception lists. Brazil is connected (D-030) from its CAMEX workbook; Argentina, Paraguay and Uruguay from its Annex I, the common external tariff (D-028), their exception lists and capital-goods/IT regimes not modelled.',
  },
});

export interface TariffSourceDirectoryEntry {
  country_code: string;
  authority: string;
  /** Where the current rates can be read; null when no official copy was found online. */
  source_url: string | null;
  form: TariffSourceForm;
  note: string;
}

const UEMOA_TEC = CUSTOMS_UNION_TARIFFS.UEMOA!.source_url;
const ECOWAS_CET = CUSTOMS_UNION_TARIFFS.ECOWAS!.source_url;

/** Every market without a connected adapter or a recorded determination, plus Andorra's chapters 1–24 and Singapore before its first saved copy. */
const ENTRIES: readonly TariffSourceDirectoryEntry[] = [
  // --- Free ports and one-rate markets: v5 scores the published rule (policy rule_rates). ---
  { country_code: 'MO', authority: 'Macao Trade and Investment Promotion Institute', source_url: 'https://investhere.ipim.gov.mo/en/macau/investmentinformation/foreigntrade', form: 'rule', note: 'Free port: no duty on imports; consumption tax on tobacco and strong alcohol.' },
  { country_code: 'SX', authority: 'Government of Sint Maarten, Customs', source_url: 'https://www.sintmaartengov.org/Ministries/Departments/Pages/Customs.aspx', form: 'rule', note: 'No import duty; customs taxes only petrol.' },
  { country_code: 'BQ', authority: 'Belastingdienst Caribisch Nederland', source_url: 'https://english.belastingdienst-cn.nl/topics/customs-business/company-import-tax', form: 'rule', note: 'Import tax is 0% on all goods; general expenditure tax applies separately.' },
  { country_code: 'VA', authority: 'Holy See / Italy (Lateran Treaty)', source_url: 'https://spcp.prf.cuni.cz/dokument/lateran.htm', form: 'rule', note: 'Goods for the Vatican City cross Italy free of customs duties (Art. 20).' },
  { country_code: 'TL', authority: 'Customs Authority of Timor-Leste', source_url: 'https://customs.gov.tl/doing-business/duties-taxes/', form: 'rule', note: 'One customs duty rate (5%) on the value of all imports, set in the annual State Budget.' },
  { country_code: 'BL', authority: 'French customs (DGDDI) for the Collectivité de Saint-Barthélemy', source_url: 'https://www.douane.gouv.fr/fiche/cas-particuliers-de-lile-de-saint-martin-et-de-lile-de-saint-barthelemy', form: 'rule', note: 'Outside the EU customs territory; 5% droit de quai on all goods brought onto the island.' },

  // --- EU tariff partners: chapters outside the customs union. ---
  { country_code: 'AD', authority: "Govern d'Andorra, Departament de Duana", source_url: null, form: 'not_found', note: 'Chapters 25–97 are connected through the EU tariff; for chapters 1–24 Andorra applies its own tariff, not found online.' },

  // --- Connected from a copy saved in the authority's own window (D-029): checked by hand only while none is saved. ---
  { country_code: 'SG', authority: 'Attorney-General’s Chambers of Singapore — Singapore Statutes Online, Customs (Duties) Order, First Schedule', source_url: 'https://sso.agc.gov.sg/SL/CA1960-OR4?ProvIds=Sc4-XX-Sc4-', form: 'law', note: 'Read automatically from the copy saved each night between 03:00 and 07:00 Singapore Time; check here only while none is saved. Only liquor, tobacco, motor vehicles and petroleum products are dutiable.' },

  // --- ECOWAS members (UEMOA schedule for the eight UEMOA members). ---
  { country_code: 'BJ', authority: 'Direction Générale des Douanes du Bénin', source_url: UEMOA_TEC, form: 'schedule', note: 'Applies the UEMOA edition of the ECOWAS CET.' },
  { country_code: 'BF', authority: 'Direction Générale des Douanes du Burkina Faso', source_url: UEMOA_TEC, form: 'schedule', note: 'Applies the UEMOA edition of the ECOWAS CET.' },
  { country_code: 'GW', authority: 'Direção-Geral das Alfândegas da Guiné-Bissau', source_url: UEMOA_TEC, form: 'schedule', note: 'Applies the UEMOA edition of the ECOWAS CET.' },
  { country_code: 'ML', authority: 'Direction Générale des Douanes du Mali', source_url: UEMOA_TEC, form: 'schedule', note: 'Applies the UEMOA edition of the ECOWAS CET.' },
  { country_code: 'NE', authority: 'Direction Générale des Douanes du Niger', source_url: UEMOA_TEC, form: 'schedule', note: 'Applies the UEMOA edition of the ECOWAS CET.' },
  { country_code: 'TG', authority: 'Office Togolais des Recettes', source_url: UEMOA_TEC, form: 'schedule', note: 'Applies the UEMOA edition of the ECOWAS CET.' },
  { country_code: 'GM', authority: 'Gambia Revenue Authority', source_url: ECOWAS_CET, form: 'schedule', note: 'Applies the ECOWAS CET; no national schedule found online.' },
  { country_code: 'GN', authority: 'Direction Générale des Douanes de Guinée', source_url: ECOWAS_CET, form: 'schedule', note: 'Applies the ECOWAS CET; no national schedule found online.' },
  { country_code: 'LR', authority: 'Liberia Revenue Authority', source_url: ECOWAS_CET, form: 'schedule', note: 'Applies the ECOWAS CET; no national schedule found online.' },
  { country_code: 'SL', authority: 'National Revenue Authority of Sierra Leone', source_url: ECOWAS_CET, form: 'schedule', note: 'Applies the ECOWAS CET; national measures in the annual Finance Act.' },
  { country_code: 'CV', authority: 'Direção Nacional de Receitas do Estado, Alfândegas de Cabo Verde', source_url: null, form: 'not_found', note: 'ECOWAS member with its own Pauta Aduaneira, published in the Boletim Oficial; no current copy found online.' },

  // --- CEMAC members. ---
  { country_code: 'CM', authority: 'Direction Générale des Douanes du Cameroun', source_url: null, form: 'not_found', note: 'Applies the CEEAC–CEMAC CET from 1 January 2026; no official copy found online.' },
  { country_code: 'CF', authority: 'Direction Générale des Douanes et Droits Indirects (RCA)', source_url: null, form: 'not_found', note: 'CEMAC member; national application of the 2026 CET not confirmed.' },
  { country_code: 'TD', authority: 'Direction Générale des Douanes et Droits Indirects du Tchad', source_url: null, form: 'not_found', note: 'CEMAC member; national application of the 2026 CET not confirmed.' },
  { country_code: 'CG', authority: 'Direction Générale des Douanes et Droits Indirects du Congo', source_url: null, form: 'not_found', note: 'CEMAC member; regional instruments are republished by the Secrétariat Général du Gouvernement (sgg.cg).' },
  { country_code: 'GQ', authority: 'Dirección General de Aduanas de Guinea Ecuatorial', source_url: null, form: 'not_found', note: 'CEMAC member; national application of the 2026 CET not confirmed.' },
  { country_code: 'GA', authority: 'Direction Générale des Douanes et Droits Indirects du Gabon', source_url: null, form: 'not_found', note: 'CEMAC member; national application of the 2026 CET not confirmed.' },

  // --- EAC members. ---
  { country_code: 'BI', authority: 'Office Burundais des Recettes', source_url: 'https://obr.bi/images/pdf/TEC-2022--Version-Word-amend--30-Avril-2024-CORRIGE.pdf', form: 'schedule', note: 'EAC CET 2022 as amended to 30 April 2024 (French).' },
  { country_code: 'SS', authority: 'National Revenue Authority of South Sudan', source_url: null, form: 'not_found', note: 'EAC member applying the CET only in part; national rates set in the annual Financial Act.' },
  { country_code: 'CD', authority: 'Direction Générale des Douanes et Accises (DGDA)', source_url: null, form: 'not_found', note: 'EAC member since 2022 that still applies its own tariff; no official copy found online.' },
  { country_code: 'SO', authority: 'Federal Ministry of Finance, Revenue Directorate', source_url: 'https://mail.revenuedirectorate.gov.so/sites/default/files/gva-sliderlayer-upload/Somali_Customs_Tariff_Final.pdf', form: 'schedule', note: 'Somali Customs Tariff (federal). EAC member since 2024; the EAC CET is not yet applied.' },

  // --- SACU members. ---
  { country_code: 'LS', authority: 'Revenue Services Lesotho', source_url: null, form: 'not_found', note: 'Applies the SACU tariff (SARS Schedule 1).' },
  { country_code: 'SZ', authority: 'Eswatini Revenue Service', source_url: null, form: 'not_found', note: 'Applies the SACU tariff (SARS Schedule 1).' },

  // --- CARICOM members (national execution of the CET). ---
  { country_code: 'AG', authority: 'Customs and Excise Division, Antigua and Barbuda', source_url: null, form: 'not_found', note: 'CET with national exceptions under the Customs Duties Act; no schedule found online.' },
  { country_code: 'BB', authority: 'Barbados Revenue Authority, Customs and Excise Department', source_url: null, form: 'not_found', note: 'CET with national exceptions; no schedule found online.' },
  { country_code: 'DM', authority: 'Customs and Excise Division, Dominica', source_url: null, form: 'not_found', note: 'CET with national exceptions; no schedule found online.' },
  { country_code: 'GD', authority: 'Customs and Excise Division, Grenada', source_url: 'https://grenadaparliament.gd/wp-content/uploads/2021/08/Cap75C-CUSTOMS-DUTIES-ACT.pdf', form: 'law', note: 'Customs Duties Act (Cap. 75C) with the CET schedule.' },
  { country_code: 'GY', authority: 'Guyana Revenue Authority', source_url: 'https://www.gra.gov.gy/', form: 'authority_page', note: 'CET with national exceptions; GRA publishes rate changes as notices.' },
  { country_code: 'KN', authority: 'Customs and Excise Department, Saint Kitts and Nevis', source_url: null, form: 'not_found', note: 'CET with national exceptions; no schedule found online.' },
  { country_code: 'LC', authority: 'Customs and Excise Department, Saint Lucia', source_url: 'https://www.customs.gov.lc/customs-tariff.php', form: 'online_lookup', note: 'Official customs tariff page.' },
  { country_code: 'MS', authority: 'Montserrat Customs and Revenue Service', source_url: null, form: 'not_found', note: 'CET with national exceptions; no schedule found online.' },
  { country_code: 'SR', authority: 'Douane Suriname', source_url: null, form: 'not_found', note: 'Wet Tarief van Invoerrechten, amended by decrees in the Staatsblad (sris.sr); no consolidated copy found.' },
  { country_code: 'VC', authority: 'Customs and Excise Department, Saint Vincent and the Grenadines', source_url: 'https://www.gov.vc/index.php/business/regulations', form: 'authority_page', note: 'Government regulations page; CET with national exceptions.' },
  { country_code: 'HT', authority: 'Administration Générale des Douanes, Haïti', source_url: null, form: 'not_found', note: 'CARICOM member not applying the CET; rates set by the annual finance law.' },

  // --- Caribbean and Atlantic territories with their own tariffs. ---
  { country_code: 'BS', authority: 'Bahamas Customs Department', source_url: 'https://www.bahamascustoms.gov.bs/resources/laws-on-line/', form: 'law', note: 'Customs Duty (Most Favoured Nation) Tariff Act and amendments.' },
  { country_code: 'BM', authority: 'Government of Bermuda, Customs Department', source_url: 'https://www.gov.bm/schedules-customs-tariff-act-1970', form: 'schedule', note: 'Schedules to the Customs Tariff Act 1970.' },
  { country_code: 'KY', authority: 'Cayman Islands Customs and Border Control', source_url: 'https://www.gov.ky/cbc/trade/imports/import-entry', form: 'authority_page', note: 'Rates in the Customs Tariff Act schedules.' },
  { country_code: 'VG', authority: 'BVI Customs Department', source_url: null, form: 'not_found', note: 'Customs Management and Duties Act; temporary reductions are announced by press release.' },
  { country_code: 'AI', authority: 'Anguilla Customs Department', source_url: null, form: 'not_found', note: 'No current schedule found online.' },
  { country_code: 'TC', authority: 'Turks and Caicos Islands Customs Department', source_url: 'https://customs.gov.tc/webuploads/currdoc/Frequently%20Asked%20Questions.pdf', form: 'authority_page', note: 'Customs FAQ with the general rates.' },
  { country_code: 'CW', authority: 'Douane Curaçao', source_url: 'https://gobiernu.cw/wp-content/uploads/2026/04/70-GT.-Lvo.-tarief-van-invoerrechten.pdf', form: 'law', note: 'Landsverordening tarief van invoerrechten (consolidated, April 2026).' },
  { country_code: 'AW', authority: 'Departamento di Aduana Aruba', source_url: 'https://www.gobierno.aw/en/import-duties', form: 'authority_page', note: 'Government page on import duties.' },
  { country_code: 'CU', authority: 'Aduana General de la República de Cuba', source_url: null, form: 'not_found', note: 'The Arancel de Aduanas is published in the Gaceta Oficial; no consolidated official copy found.' },
  { country_code: 'GI', authority: 'HM Customs Gibraltar', source_url: 'https://www.gibraltarlaws.gov.gi/legislations/integrated-tariff-regulations-2017-2817/download', form: 'law', note: 'Integrated Tariff Regulations 2017.' },
  { country_code: 'SH', authority: 'St Helena Government, Customs', source_url: 'https://www.sainthelena.gov.sh/wp-content/uploads/2023/04/LN-4-Customs-and-Excise-Tariffs-and-ExemptionsAmendment-Regulations-2023-002.pdf', form: 'law', note: 'Customs and Excise Tariffs regulations, amended each year.' },
  { country_code: 'PM', authority: 'Collectivité territoriale de Saint-Pierre-et-Miquelon', source_url: 'https://www.jo-spm.fr/', form: 'law', note: 'Rates set by deliberations published in the Journal officiel de Saint-Pierre-et-Miquelon.' },
  { country_code: 'FO', authority: 'TAKS (Faroese tax and customs administration)', source_url: 'https://www.taks.fo/en/business/customs/customs-tariff', form: 'online_lookup', note: 'Official customs tariff page.' },
  { country_code: 'GL', authority: 'Greenland Tax Agency', source_url: 'https://aka.gl/-/media/aka/til-sitecore/niels-olav/import-custom-duties-2025/greenlandic-import-duties-january-2025.pdf', form: 'schedule', note: 'Import duties on listed goods only (alcohol, sugar products, tobacco, vehicles and a few others).' },

  // --- Pacific. ---
  { country_code: 'NC', authority: 'Direction régionale des douanes de Nouvelle-Calédonie', source_url: 'https://douane.gouv.nc/sites/default/files/atoms/files/tarif_des_douanes_mj01012023.pdf', form: 'schedule', note: 'Tarif des douanes; also published daily as open data on data.gouv.nc (a candidate for automation).' },
  { country_code: 'PF', authority: 'Direction régionale des douanes de Polynésie française', source_url: 'https://www.service-public.pf/douane/professionnels/la-fiscalite-douaniere/', form: 'authority_page', note: 'Customs taxation page; the tarif des douanes is also published by ISPF.' },
  { country_code: 'WF', authority: 'Service des douanes de Wallis-et-Futuna', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'FJ', authority: 'Fiji Revenue and Customs Service', source_url: 'https://www.frcs.org.fj/wp-content/uploads/2012/11/Customs_-Tariff_-Act_Revised_-29_-Jan_-2010.pdf', form: 'law', note: 'Customs Tariff Act (revised 2010), amended by each budget.' },
  { country_code: 'PG', authority: 'Papua New Guinea Customs Service', source_url: 'https://customs.gov.pg/tev/tariff', form: 'online_lookup', note: 'Online tariff; also the Customs Tariff Act 1990, HS 2022 edition.' },
  { country_code: 'SB', authority: 'Customs and Excise Division, Solomon Islands', source_url: null, form: 'not_found', note: 'Tariff changes are gazetted (Solomon Islands Gazette on PacLII); no consolidated schedule found.' },
  { country_code: 'VU', authority: 'Vanuatu Customs and Inland Revenue', source_url: 'https://vanuatucustoms.gov.vu/images/Customs_Tariff/2024/IMPORT%20DUTIES%20CONSOLIDATION%20AMENDMENT%20ACT%20NO.%2024%20OF%202023.pdf', form: 'law', note: 'Import Duties (Consolidation) Amendment Act No. 24 of 2023.' },
  { country_code: 'WS', authority: 'Ministry of Customs and Revenue, Samoa', source_url: 'https://palemene.ws/PDFfiles/Customs%20Tariff%20Amendment%20Act%202022%20-%20Eng_English.pdf', form: 'law', note: 'Customs Tariff Act as amended in 2022.' },
  { country_code: 'TO', authority: 'Ministry of Revenue and Customs, Tonga', source_url: 'https://paclii.org/to/legis/consol_act/caeas286', form: 'law', note: 'Customs and Excise Act; duty orders on PacLII.' },
  { country_code: 'KI', authority: 'Kiribati Customs Service', source_url: 'https://paclii.org/ki/legis/sub_leg/ca1993cto1998336', form: 'law', note: 'Customs Tariff Order under the Customs Act; check later orders.' },
  { country_code: 'TV', authority: 'Tuvalu Customs', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'NR', authority: 'Nauru Customs, Department of Finance', source_url: 'https://paclii.org/nr/legis/num_act/coda2010267', form: 'law', note: 'Customs (Rates of Duty) Act 2010.' },
  { country_code: 'CK', authority: 'Cook Islands Ministry of Finance and Economic Management, Revenue Management', source_url: 'https://paclii.org/ck/legis/num_act/cta1980178', form: 'law', note: 'Customs Tariff Act 1980 and orders.' },
  { country_code: 'NU', authority: 'Niue Customs', source_url: 'https://paclii.org/nu/legis/consol_act/cta1982178', form: 'law', note: 'Customs Tariff Act 1982.' },
  { country_code: 'TK', authority: 'Government of Tokelau', source_url: 'https://paclii.org/tk/legis/num_act/cr1991233', form: 'law', note: 'Customs Regulations 1991.' },
  { country_code: 'FM', authority: 'FSM Department of Finance and Administration, Customs and Tax', source_url: 'https://fsmlaw.org/fsm/code/title54/T54_Ch02_SubChpII_2014.html', form: 'law', note: 'Import duty of 4% of CIF on goods not otherwise listed (FSM Code Title 54 §221(11), 2014 compilation; later amendments not checked).' },
  { country_code: 'MH', authority: 'Division of Customs, Marshall Islands', source_url: 'https://paclii.org/mh/legis/consol_act/ida1989178', form: 'law', note: 'Import Duties Act 1989 and amendments.' },
  { country_code: 'PW', authority: 'Palau Bureau of Revenue and Taxation', source_url: null, form: 'not_found', note: 'The 2023 tax reform introduced a goods and services tax; the remaining import tax was not confirmed.' },
  { country_code: 'MP', authority: 'CNMI Department of Finance, Division of Customs', source_url: 'https://www.finance.gov.mp/cus-import-requirements.php', form: 'authority_page', note: 'Outside the US customs territory; excise tax on imports under 4 CMC.' },

  // --- Africa (outside the unions above). ---
  { country_code: 'DZ', authority: 'Direction Générale des Douanes, Algérie', source_url: null, form: 'not_found', note: 'Only third-party copies of the tariff were found online.' },
  { country_code: 'AO', authority: 'Administração Geral Tributária (AGT)', source_url: null, form: 'not_found', note: 'Pauta Aduaneira 2024; no official copy found online.' },
  { country_code: 'ET', authority: 'Ethiopian Customs Commission', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'ER', authority: 'Customs Department, Ministry of Finance, Eritrea', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'DJ', authority: 'Direction des Douanes et Droits Indirects, Djibouti', source_url: null, form: 'not_found', note: 'Customs code published; tariff schedule not found online.' },
  { country_code: 'KM', authority: 'Administration Générale des Douanes et Droits Indirects, Comores', source_url: null, form: 'not_found', note: 'Customs code published on the customs site; tariff schedule not found online.' },
  { country_code: 'MG', authority: 'Direction Générale des Douanes, Madagascar', source_url: null, form: 'not_found', note: 'A public eTariff tool was launched in July 2024; its address was not confirmed.' },
  { country_code: 'MW', authority: 'Malawi Revenue Authority', source_url: null, form: 'not_found', note: 'Customs and Excise (Tariff) orders in the Government Gazette; no consolidated copy found.' },
  { country_code: 'MZ', authority: 'Autoridade Tributária de Moçambique', source_url: null, form: 'not_found', note: 'Pauta Aduaneira (Lei 11/2016 as amended in 2022), published in the Boletim da República; no official copy found online.' },
  { country_code: 'MR', authority: 'Direction Générale des Douanes, Mauritanie', source_url: null, form: 'not_found', note: 'No current schedule found online.' },
  { country_code: 'ST', authority: 'Direção das Alfândegas de São Tomé e Príncipe', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'SC', authority: 'Seychelles Revenue Commission', source_url: 'https://src.gov.sc/faq/', form: 'authority_page', note: 'Imports pay trades tax on listed goods (Trades Tax Regulations).' },
  { country_code: 'ZW', authority: 'Zimbabwe Revenue Authority (ZIMRA)', source_url: 'https://www.zimra.co.zw/downloads/category/85-statutory-instruments-2024', form: 'law', note: 'Tariff set and changed by statutory instruments.' },
  { country_code: 'SD', authority: 'Sudan Customs Authority', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'LY', authority: 'Libyan Customs Authority', source_url: null, form: 'not_found', note: 'No official schedule found online.' },

  // --- Asia and the Middle East. ---
  { country_code: 'AF', authority: 'Afghanistan Customs Department, Ministry of Finance', source_url: null, form: 'not_found', note: 'Only third-party copies of the 2014 tariff were found online.' },
  { country_code: 'AZ', authority: 'State Customs Committee of Azerbaijan', source_url: 'https://customs.gov.az/en/faydali/gomruk-statistikasi/tariff-statistics', form: 'authority_page', note: 'Rates set by Cabinet of Ministers decision; the committee publishes tariff statistics.' },
  { country_code: 'MM', authority: 'Customs Department, Ministry of Planning and Finance, Myanmar', source_url: 'https://www.mopf.gov.mm/sites/default/files/Customs%20Tariff%20of%20Myanmar%202022_0.pdf', form: 'schedule', note: 'Customs Tariff of Myanmar 2022 (AHTN 2022).' },
  { country_code: 'IR', authority: 'Islamic Republic of Iran Customs Administration (IRICA)', source_url: null, form: 'not_found', note: 'Annual Export and Import Regulations Book, in Persian; no official copy found online.' },
  { country_code: 'IQ', authority: 'General Commission of Customs, Ministry of Finance, Iraq', source_url: 'https://moj.gov.iq/upload/pdf/%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%A7%D9%84%D8%AA%D8%B9%D8%B1%D9%8A%D9%81%D8%A9%20%D8%A7%D9%84%D9%83%D9%85%D8%B1%D9%83%D9%8A%D8%A9.pdf', form: 'law', note: 'Customs Tariff Law (Arabic); rates updated in 2025 are contested, so check current instructions.' },
  { country_code: 'SY', authority: 'General Directorate of Customs, Syria', source_url: null, form: 'not_found', note: 'A new unified tariff was introduced in 2025; no official copy found online.' },
  { country_code: 'YE', authority: 'Yemen Customs Authority', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'PS', authority: 'Palestinian Ministry of Finance, Customs, Excise and VAT Department', source_url: null, form: 'not_found', note: "Applies Israel's customs tariff under the Paris Protocol (1994), except for listed goods." },
  { country_code: 'TJ', authority: 'Customs Service under the Government of Tajikistan', source_url: null, form: 'not_found', note: 'No official schedule found online.' },
  { country_code: 'TM', authority: 'State Customs Service of Turkmenistan', source_url: 'https://customs.gov.tm/en/customs-info/customs-fees/excices', form: 'authority_page', note: 'Customs fees and excise pages; import duty schedule not found.' },
  { country_code: 'KP', authority: 'None (comprehensive UN sanctions)', source_url: null, form: 'not_found', note: 'Excluded from Demand Discovery: comprehensive UN Security Council sanctions.' },

  // --- Americas. ---
  { country_code: 'VE', authority: 'SENIAT', source_url: null, form: 'not_found', note: 'Arancel de Aduanas by decree in the Gaceta Oficial; temporary exonerations change often.' },
];

export const TARIFF_SOURCE_DIRECTORY: Readonly<Record<string, TariffSourceDirectoryEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((item) => [item.country_code, item] as const)),
);

/** The customs union whose common external tariff `countryCode` applies, if any (UEMOA before ECOWAS). */
export function customsUnionFor(countryCode: string): (CustomsUnionTariff & { key: string }) | null {
  const code = countryCode.trim().toUpperCase();
  for (const key of ['UEMOA', ...Object.keys(CUSTOMS_UNION_TARIFFS).filter((name) => name !== 'UEMOA')]) {
    const union = CUSTOMS_UNION_TARIFFS[key]!;
    if (union.members.includes(code)) return { key, ...union };
  }
  return null;
}

export type OfficialTariffSource =
  | { kind: 'connected'; country_code: string; provider_key: string }
  | { kind: 'documented'; country_code: string; authority: string; source_url: string | null; reason: string }
  | { kind: 'directory'; country_code: string; authority: string; source_url: string | null; form: TariffSourceForm; note: string }
  | { kind: 'none'; country_code: string };

/**
 * Where `countryCode`'s official tariff comes from: a connected adapter, a researched determination,
 * or this directory. `none` means the market has not been researched — a gap the coverage test
 * refuses for every market in the screening universe.
 */
export function officialTariffSourceFor(countryCode: string): OfficialTariffSource {
  const code = countryCode.trim().toUpperCase();
  const adapter = DESTINATION_ADAPTERS[code];
  if (adapter) return { kind: 'connected', country_code: code, provider_key: adapter.provider_key };
  const documented = unconfiguredSourceForCountry(code);
  if (documented) return { kind: 'documented', country_code: code, authority: documented.authority, source_url: documented.references[0] ?? null, reason: documented.reason };
  const entry = TARIFF_SOURCE_DIRECTORY[code];
  if (entry) return { kind: 'directory', ...entry };
  return { kind: 'none', country_code: code };
}

/**
 * Where an agent checks this market's tariff by hand when its duty is estimated or missing: the
 * directory entry, the researched source, or, for a connected market, nothing (its tariff is read
 * automatically) unless the directory names a source for the case the automatic read leaves open.
 * Andorra's chapters 1–24 fall outside its EU customs union, so a chapter tells this which applies;
 * Singapore's entry covers the time before its first nightly copy is saved.
 */
export function manualTariffCheckFor(countryCode: string, hs6?: string): { authority: string; source_url: string | null; note: string } | null {
  const code = countryCode.trim().toUpperCase();
  const source = officialTariffSourceFor(code);
  if (source.kind === 'connected') {
    const entry = TARIFF_SOURCE_DIRECTORY[code];
    // D-028: a common-tariff duty is left open where the member applies a line its own way; its
    // national source (directory entry or researched source) is where that is checked.
    const union = customsUnionSourceFor(code);
    if (union) {
      const documented = unconfiguredSourceForCountry(code);
      const authority = entry?.authority ?? documented?.authority;
      if (!authority) return null;
      return { authority, source_url: entry?.source_url ?? documented?.references[0] ?? null, note: `Read automatically from the ${union.label}; check here for this market's own exceptions. ${union.member_notes[code] ?? ''}`.trim() };
    }
    // D-030: a retained schedule leaves some lines open (special goods, ex-tarifários, capital-goods
    // regimes, quota lines); the market's own source is where an agent checks those.
    const schedule = tariffScheduleSourceFor(code);
    if (schedule) {
      const documented = unconfiguredSourceForCountry(code);
      const authority = entry?.authority ?? documented?.authority;
      if (!authority) return null;
      return { authority, source_url: entry?.source_url ?? documented?.references[0] ?? null, note: `Read automatically from ${schedule.countries[code]?.basis === 'common_tariff' ? 'the ' : ''}${schedule.label}; check here for the lines it leaves open. ${schedule.countries[code]?.note ?? ''}`.trim() };
    }
    if (!entry) return null;
    const chapter = hs6 ? Number(hs6.slice(0, 2)) : null;
    if (code === 'AD' && !(chapter != null && chapter < 25)) return null;
    return { authority: entry.authority, source_url: entry.source_url, note: entry.note };
  }
  if (source.kind === 'documented') return { authority: source.authority, source_url: source.source_url, note: 'Researched: the official source is recorded but cannot be read automatically.' };
  if (source.kind === 'directory') return { authority: source.authority, source_url: source.source_url, note: source.note };
  return null;
}
