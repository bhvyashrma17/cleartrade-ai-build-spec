import type { PdfTableProfile } from './pdf-table-family';

export type GreenWaveCountry = 'NP' | 'BT' | 'AL' | 'MU' | 'LK';

export interface GreenWaveSourceArtifact {
  name: string;
  role: string;
  url: string;
  kind: 'pdf' | 'zip' | 'evidence_json' | 'generated_member_manifest';
  markers: readonly string[];
  evidence?: Readonly<Record<string, unknown>>;
}

export interface GreenWaveConfig {
  country_code: GreenWaveCountry;
  jurisdiction: string;
  family: 'OFFICIAL_PDF_TABLE' | 'VERSIONED_ARCHIVE' | 'BASELINE_PLUS_AMENDMENTS';
  source_family: string;
  authority: string;
  dataset: string;
  provider: string;
  national_code_system: 'NP_CUSTOMS_TARIFF' | 'BT_TRADE_CLASSIFICATION' | 'AL_COMBINED_NOMENCLATURE' | 'MU_INTEGRATED_TARIFF' | 'LK_CUSTOMS_TARIFF';
  parser_version: string;
  currency: string;
  tariff_url: string;
  tariff_sha256: string;
  profile: PdfTableProfile;
  artifacts: readonly GreenWaveSourceArtifact[];
  /**
   * Artifact sets (name -> role) of earlier qualified editions. Their retained releases stay
   * readable after the current edition moves on; new imports must match `artifacts`.
   */
  retired_artifact_sets?: readonly Readonly<Record<string, string>>[];
  general_column: string;
  india_column: string | null;
  india_area_id: string | null;
  india_basis: 'group_requires_origin' | 'bilateral_zero_requires_origin' | 'direct_requires_origin' | 'complete_list_excludes_india';
  rights_evidence: Record<string, unknown>;
  preference_evidence: Record<string, unknown>;
}

const TARIFF_SCOPE = Object.freeze({
  tariff_treatment_complete: true,
  regulatory_coverage_complete: false,
  omitted_regulatory_layer: 'The authority tariff publication does not establish a complete versioned set of permits, prohibitions and product controls; absence of a parsed requirement is not evidence of no restriction.',
});

export const GREEN_WAVE_SCOPE = TARIFF_SCOPE;

export const GREEN_WAVE_CONFIGS: Readonly<Record<GreenWaveCountry, GreenWaveConfig>> = Object.freeze({
  NP: {
    country_code: 'NP', jurisdiction: 'NP', family: 'OFFICIAL_PDF_TABLE', source_family: 'NP_CUSTOMS_PDF',
    authority: 'Nepal Department of Customs', dataset: 'Customs Tariff 2026/2027', provider: 'np_customs_tariff_pdf',
    national_code_system: 'NP_CUSTOMS_TARIFF', parser_version: 'np-customs-tariff-parser-v1', currency: 'NPR',
    tariff_url: 'https://giwmscdnone.gov.np/media/files/Customs%20Tariff%202026.27%20Final%205_26_olewrcw.pdf',
    tariff_sha256: '2ed7d946b52e5e57fea1eaa2c3f3e5bb71a96770ce98a79a55cc2d537ba8d30d',
    profile: {
      country_code: 'NP', label: 'Nepal Customs Tariff 2026/2027', expected_pdf_pages: 555,
      table_first_page: 14, table_last_page: 544, expected_line_count: 6144,
      code_pattern: /^\d{4}\.\d{2}\.\d{2}$/, code_header: /^Su(?:b)?$/i, description_header: /^Descr/i, unit_header: /^(?:Unit|Un|U)$/i,
      columns: [{ key: 'saarc', header: /^(?:SAARC|SAA)$/i, required: false }, { key: 'general', header: /^(?:GENERAL|GENER)$/i, required: false }],
      code_tolerance_points: 16, effective_from: '2026-07-17', layout_strategy: 'nepal_rate_headers',
    },
    artifacts: [
      { name: 'customs-tariff-2026-27.pdf', role: 'official_consolidated_national_tariff', url: 'https://giwmscdnone.gov.np/media/files/Customs%20Tariff%202026.27%20Final%205_26_olewrcw.pdf', kind: 'pdf', markers: [] },
      { name: 'copyright-act-section-4.json', role: 'reviewed_official_statute_citation_excluding_administrative_decisions_and_facts', url: 'https://repository.lawcommission.gov.np/np/category/documents/law-archives/statutes-acts-law-archives/%E0%A4%AA%E0%A5%8D%E0%A4%B0%E0%A4%A4%E0%A4%BF%E0%A4%B2%E0%A4%BF%E0%A4%AA%E0%A4%BF-%E0%A4%85%E0%A4%A7%E0%A4%BF%E0%A4%95%E0%A4%BE%E0%A4%B0-%E0%A4%90%E0%A4%A8-%E0%A5%A8%E0%A5%A6%E0%A5%AB%E0%A5%AF/', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', provision: 'Copyright Act 2059 section 4', finding: 'Administrative decisions and ordinary facts/data are excluded; website presentation and protected compilation expression are not claimed.' } },
      { name: 'india-nepal-treaty-index.json', role: 'reviewed_government_of_india_bilateral_trade_treaty_citation', url: 'https://www.commerce.gov.in/ministryofcommerce/node/3398', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', instrument: 'India–Nepal Treaty of Trade', finding: 'The SAARC/treaty relationship does not establish shipment origin; documentary origin qualification remains required.' } },
    ],
    general_column: 'general', india_column: 'saarc', india_area_id: 'SAARC', india_basis: 'group_requires_origin',
    rights_evidence: { artifact: 'copyright-act-section-4.json', rule: 'Nepal Copyright Act section 4 excludes administrative decisions and ordinary facts/data. ClearTrade retains official text and tariff facts only; it claims no right in website presentation, software or any protected original compilation arrangement.' },
    preference_evidence: { artifact: 'india-nepal-treaty-index.json', programme: 'SAARC column / India–Nepal trade arrangements', india_membership_and_treaty_do_not_establish_shipment_origin: true, requires_origin_proof: true },
  },
  BT: {
    country_code: 'BT', jurisdiction: 'BT', family: 'OFFICIAL_PDF_TABLE', source_family: 'BT_DRC_PDF',
    authority: 'Bhutan Department of Revenue and Customs', dataset: 'Bhutan Trade Classification and Tariff Schedule, 7th edition, amended 2026', provider: 'bt_drc_tariff_pdf',
    national_code_system: 'BT_TRADE_CLASSIFICATION', parser_version: 'bt-drc-tariff-parser-v1', currency: 'BTN',
    tariff_url: 'https://www.drc.gov.bt/wp-content/uploads/2026/07/Bhutan-Trade-Classification-and-Tariff-Schedule_Amended-2026.pdf',
    tariff_sha256: '186e9df1fef0b9d540e04ebf19bcfe72d503b67eb58f994c062ecf3d59427c92',
    profile: {
      country_code: 'BT', label: 'Bhutan Trade Classification and Tariff Schedule amended 2026', expected_pdf_pages: 493,
      table_first_page: 12, table_last_page: 492, expected_line_count: 5864,
      code_pattern: /^\d{4}\.\d{2}\.\d{2}$/, code_header: /^BTC$/i, description_header: /^Comm/i, unit_header: /^Unit$/i,
      columns: [
        { key: 'customs_duty', header: /^CD$/i, required: false },
        { key: 'domestic_tax_1', header: /^(?:GST|ST)$/i, required: false },
        { key: 'domestic_tax_2', header: /^(?:ET|E|GT)$/i, required: false },
      ],
      code_tolerance_points: 18, effective_from: '2026-07-30',
    },
    artifacts: [
      { name: 'tariff-schedule-amended-2026.pdf', role: 'official_consolidated_national_tariff', url: 'https://www.drc.gov.bt/wp-content/uploads/2026/07/Bhutan-Trade-Classification-and-Tariff-Schedule_Amended-2026.pdf', kind: 'pdf', markers: [] },
      { name: 'copyright-act-2001.pdf', role: 'official_statute_excluding_data_and_official_texts', url: 'https://www.moice.gov.bt/wp-content/uploads/2023/03/Copyright-Act-of-Kingdom-of-Bhutan-2001.pdf', kind: 'pdf', markers: [] },
      { name: 'india-bhutan-agreement-index.json', role: 'reviewed_government_of_india_bilateral_agreement_citation', url: 'https://www.commerce.gov.in/ministryofcommerce/node/3398', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', instrument: 'India–Bhutan Agreement on Trade, Commerce and Transit', finding: 'Duty-free treatment is conditional on origin and documents; GST and excise remain distinct.' } },
    ],
    general_column: 'customs_duty', india_column: null, india_area_id: 'IN-BT_BILATERAL', india_basis: 'bilateral_zero_requires_origin',
    rights_evidence: { artifact: 'copyright-act-2001.pdf', rule: 'Bhutan Copyright Act section 7 excludes mere data and official legislative, administrative and legal texts. ClearTrade retains those facts/texts only and excludes site presentation and software.' },
    preference_evidence: { artifact: 'india-bhutan-agreement-index.json', programme: 'India–Bhutan bilateral free-trade treatment', tariff_schedule_additional_note_requires_rules_of_origin_and_documents: true, customs_duty_rate_percent: 0, gst_and_excise_remain_separate: true, requires_origin_proof: true },
  },
  AL: {
    country_code: 'AL', jurisdiction: 'AL', family: 'VERSIONED_ARCHIVE', source_family: 'AL_CUSTOMS_ARCHIVE',
    authority: 'Albanian Customs Administration', dataset: 'Combined Nomenclature of Goods 2026 (VKM 789/2025)', provider: 'al_customs_nomenclature_archive',
    national_code_system: 'AL_COMBINED_NOMENCLATURE', parser_version: 'al-customs-nomenclature-parser-v1', currency: 'ALL',
    tariff_url: 'https://dogana.gov.al/dokument/6715/nomenklatura-2026',
    tariff_sha256: '30d4a16cc998db4a0e6f3c95770bbdb66ce9ab8e826aa7d47fe790d902066815',
    profile: {
      country_code: 'AL', label: 'Albania Combined Nomenclature 2026', expected_pdf_pages: 961,
      table_first_page: 18, table_last_page: 662, expected_line_count: 8278,
      code_pattern: /^\d{4}(?: \d{2}){2}$/, code_header: /^Kodi/i, description_header: /^Pers/i, unit_header: /^Nje/i,
      columns: [{ key: 'general', header: /^Tarifa/i, required: false }], code_tolerance_points: 24, effective_from: '2026-01-01',
    },
    artifacts: [
      { name: 'combined-nomenclature-2026.pdf', role: 'official_annual_national_tariff_archive', url: 'https://dogana.gov.al/dokument/6715/nomenklatura-2026', kind: 'pdf', markers: [] },
      { name: 'copyright-law-article-12.json', role: 'reviewed_wipo_lex_law_citation_excluding_official_texts_and_simple_facts', url: 'https://www.wipo.int/wipolex/en/text/410069', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', provision: 'Law 35/2016 article 12', finding: 'Official public-information creations and simple facts/data are excluded; protected presentation and compilation expression are not claimed.' } },
      { name: 'preferential-programmes.json', role: 'reviewed_official_complete_preferential_tariff_and_quota_programme_index', url: 'https://dogana.gov.al/d/169/182/249/266/tarifat-preferenciale-dhe-kuotat-tarifore', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', complete_programme_enumeration_reviewed: true, india_listed: false } },
    ],
    general_column: 'general', india_column: null, india_area_id: null, india_basis: 'complete_list_excludes_india',
    rights_evidence: { artifact: 'copyright-law-article-12.json', rule: 'Albania Law 35/2016 article 12 excludes official creations/collections informing the public and simple data or facts. ClearTrade excludes protected presentation, software and original compilation expression.' },
    preference_evidence: { artifact: 'preferential-programmes.json', complete_programme_enumeration_reviewed: true, india_listed: false, result: 'not_applicable' },
  },
  MU: {
    country_code: 'MU', jurisdiction: 'MU', family: 'BASELINE_PLUS_AMENDMENTS', source_family: 'MU_MRA_TARIFF',
    authority: 'Mauritius Revenue Authority, Customs Department', dataset: 'Integrated Tariff as at 01 October 2026 (no post-baseline notices through 11 October 2026)', provider: 'mu_mra_integrated_tariff',
    national_code_system: 'MU_INTEGRATED_TARIFF', parser_version: 'mu-mra-baseline-amendments-parser-v1', currency: 'MUR',
    tariff_url: 'https://www.mra.mu/download/TariffInf011026.pdf',
    tariff_sha256: 'c631ca50bfe4d5e8117983c35822af2dca858aa19285f5ce7d25de23141b035a',
    profile: {
      country_code: 'MU', label: 'Mauritius Integrated Tariff as at 01 October 2026', expected_pdf_pages: 810,
      table_first_page: 21, table_last_page: 809, expected_line_count: 6938,
      code_pattern: /^\d{4}\.\d{2}\.\d{2}$/, code_header: /^(?:H\.S\. Code|H\.S\.)$/i, description_header: /^Descr/i, unit_header: /^(?:Unit|U|Statisti|Statist|Stati|Stat)$/i,
      columns: [
        { key: 'general', header: /^(?:General|Genera|Gener|Gen)$/i, required: false },
        { key: 'excise_duty', header: /^(?:Exci|Excise|Excise Duty)$/i, right_header: /^Levy$/i, required: false },
        { key: 'vat', header: /^VAT$/i, required: false },
        { key: 'india', header: /^INDIA$/i, required: false },
      ],
      code_tolerance_points: 28, effective_from: '2026-10-01', layout_strategy: 'mauritius_percent_row',
    },
    artifacts: [
      { name: 'integrated-tariff-2026-10-01.pdf', role: 'official_integrated_tariff_baseline', url: 'https://www.mra.mu/download/TariffInf011026.pdf', kind: 'pdf', markers: [] },
      { name: 'notice-index.json', role: 'reviewed_official_complete_dated_post_baseline_notice_index', url: 'https://www.mra.mu/customs1/notice-to-stakeholders', kind: 'evidence_json', markers: [], evidence: {
        reviewed_on: '2026-10-11', baseline_date: '2026-10-01', through_date: '2026-10-11', post_baseline_notices: [],
        pre_baseline_changes_verified_in_baseline: ['2026-09-04 VAT replacement annex (general duty identical on all six rows)', '2026-09-29 plastic-bottle excise and tariff restructuring effective 2026-10-01 (Annex I and II codes present; 3923.30.10 excise Rs 2 per unit)'],
        non_rate_notices_reviewed: ['2026-09-29 refrigerating-appliance minimum energy performance standards (GN 56 of 2026; product control, not a commodity rate)', '2026-09-30 ruling and electronic-seal fees (not a commodity rate)'],
      } },
      { name: 'notice-plastic-bottles-2026-09-29.pdf', role: 'official_pre_baseline_tariff_restructuring_notice_verified_in_baseline', url: 'https://www.mra.mu/download/NotPlasticBottles.pdf', kind: 'pdf', markers: [] },
      { name: 'annex-i-plastic-bottles-2026-09-29.pdf', role: 'official_pre_baseline_excise_code_changes_verified_in_baseline', url: 'https://www.mra.mu/download/Anx1PlasticBottles.pdf', kind: 'pdf', markers: [] },
      { name: 'annex-ii-plastic-bottles-2026-09-29.pdf', role: 'official_pre_baseline_tariff_code_changes_verified_in_baseline', url: 'https://www.mra.mu/download/Anx2PlasticBottles.pdf', kind: 'pdf', markers: [] },
      { name: 'notice-energy-standards-2026-09-29.pdf', role: 'official_product_control_notice_not_a_commodity_rate', url: 'https://www.mra.mu/download/NoticeEnergy.pdf', kind: 'pdf', markers: [] },
      { name: 'india-cecpa-notice.pdf', role: 'official_india_cecpa_implementation_notice', url: 'https://www.mra.mu/download/NoticeCECPA260321.pdf', kind: 'pdf', markers: [] },
      { name: 'government-copyright-policy.json', role: 'reviewed_government_reuse_policy_citation', url: 'https://www.govmu.org/EN/Pages/Copyright.aspx', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', finding: 'Government material may be reproduced accurately with source acknowledgement; third-party content is excluded.' } },
      { name: 'copyright-act-record.json', role: 'reviewed_wipo_lex_statutory_official_text_and_data_citation', url: 'https://www.wipo.int/wipolex/en/legislation/details/15447', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-15', finding: 'Official texts and mere data are separately excluded; protected site presentation and software are not claimed.' } },
    ],
    // The 13 August 2026 edition (TariffInf130826.pdf, 6,920 lines, plus the 4 September VAT
    // annex applied as a post-baseline amendment). MRA no longer serves it; releases already
    // retained from it stay readable.
    retired_artifact_sets: [{
      'integrated-tariff-2026-08-13.pdf': 'official_integrated_tariff_baseline',
      'notice-index.json': 'reviewed_official_complete_dated_post_baseline_notice_index',
      'notice-vat-2026-09-04.pdf': 'official_post_baseline_vat_amendment_notice',
      'annex-vat-2026-09-04.pdf': 'official_post_baseline_vat_replacement_rows',
      'notice-finance-act-2026-09-03.pdf': 'official_conditional_excise_and_vat_exemption_notice',
      'notice-processing-fee-2026-08-26.pdf': 'official_processing_fee_notice_not_a_commodity_rate',
      'notice-payment-2026-08-26.pdf': 'official_payment_timing_notice_not_a_commodity_rate',
      'notice-vehicle-display-2026-08-21.pdf': 'official_procedure_code_notice_not_a_commodity_rate',
      'notice-rulings-2026-08-14.pdf': 'official_tariff_ruling_validity_notice',
      'notice-classification-2026-09-08.pdf': 'official_product_specific_classification_ruling_withdrawal',
      'india-cecpa-notice.pdf': 'official_india_cecpa_implementation_notice',
      'government-copyright-policy.json': 'reviewed_government_reuse_policy_citation',
      'copyright-act-record.json': 'reviewed_wipo_lex_statutory_official_text_and_data_citation',
    }],
    general_column: 'general', india_column: 'india', india_area_id: 'IN_CECPA', india_basis: 'direct_requires_origin',
    rights_evidence: { artifact: 'government-copyright-policy.json', statutory_cross_check: 'copyright-act-record.json', rule: 'Mauritius government material may be reproduced accurately with source acknowledgement. Official texts and mere data are separately excluded by statute. ClearTrade excludes third-party content, site presentation and software.' },
    preference_evidence: { artifact: 'india-cecpa-notice.pdf', programme: 'Mauritius–India CECPA', direct_tariff_column: 'INDIA', requires_origin_proof: true, origin_qualification_not_established_by_origin_country: true },
  },
  LK: {
    country_code: 'LK', jurisdiction: 'LK', family: 'BASELINE_PLUS_AMENDMENTS', source_family: 'LK_CUSTOMS_PDF',
    authority: 'Sri Lanka Customs', dataset: 'National Imports Tariff Guide 16 May 2026 plus ordered Gazette overlay', provider: 'lk_customs_tariff',
    national_code_system: 'LK_CUSTOMS_TARIFF', parser_version: 'lk-customs-tariff-parser-v2', currency: 'LKR',
    tariff_url: 'https://www.customs.gov.lk/wp-content/uploads/2026/06/Import%20Tariff%20Guide%2016.05.2026.zip',
    tariff_sha256: 'd9273968e731b8e626016eecc78c20a2db9b8bf0e5b865246229e8d8dc0f3947',
    profile: {
      country_code: 'LK', label: 'Sri Lanka National Imports Tariff Guide 16 May 2026', expected_pdf_pages: 641,
      table_first_page: 1, table_last_page: 641, expected_line_count: 6609,
      code_pattern: /^\d{4}\.\d{2}(?:\.\d{2})?$/, code_header: /^HS Code$/i, description_header: /^Description$/i, unit_header: /^(?:Unit|Stat\. Unit)$/i,
      columns: [
        { key: 'pref_ap', header: /^AP$/, required: false }, { key: 'pref_ad', header: /^AD$/, required: false },
        { key: 'pref_bn', header: /^BN$/, required: false }, { key: 'pref_gt', header: /^GT$/, required: false },
        { key: 'india', header: /^IN$/, required: false }, { key: 'pref_pk', header: /^PK$/, required: false },
        { key: 'pref_sa', header: /^SA$/, required: false }, { key: 'pref_sf', header: /^SF$/, required: false },
        { key: 'pref_sd', header: /^SD$/, required: false }, { key: 'pref_sg', header: /^SG$/, required: false },
        { key: 'general', header: /^Duty$/, required: false }, { key: 'vat', header: /^VAT$/, required: false },
        { key: 'pal_general', header: /^Gen$/, required: false }, { key: 'pal_sg', header: /^SG$/, required: false },
        { key: 'cess_general', header: /^GEN$/, required: false }, { key: 'cess_sg', header: /^SG$/, required: false },
        { key: 'excise', header: /^Excise$/, required: false }, { key: 'surcharge', header: /^Surcharge$/, required: false },
        { key: 'sscl', header: /^SSCL$/, required: false }, { key: 'scl_indicator', header: /^SCL$/, required: false },
      ], code_tolerance_points: 24, effective_from: '2026-05-16', layout_strategy: 'sri_lanka_multi_column',
    },
    artifacts: [
      { name: 'import-tariff-guide-2026-05-16.zip', role: 'official_consolidated_national_tariff_archive', url: 'https://www.customs.gov.lk/wp-content/uploads/2026/06/Import%20Tariff%20Guide%2016.05.2026.zip', kind: 'zip', markers: [] },
      { name: 'import-tariff-guide-2026-05-16-members.json', role: 'deterministic_per_member_archive_manifest', url: 'https://www.customs.gov.lk/wp-content/uploads/2026/06/Import%20Tariff%20Guide%2016.05.2026.zip', kind: 'generated_member_manifest', markers: [] },
      { name: 'gazette-2487-02.pdf', role: 'official_baseline_special_commodity_levy_order', url: 'https://www.treasury.gov.lk/api/file/1641a539-1f4d-4f2a-90bb-67bfcb305a73', kind: 'pdf', markers: [] },
      { name: 'gazette-2488-56.pdf', role: 'official_vehicle_surcharge_order', url: 'https://www.treasury.gov.lk/api/file/b5fee09e-8b6d-419e-9b52-54eb0927979e', kind: 'pdf', markers: [] },
      { name: 'gazette-2488-69.pdf', role: 'official_tariff_affecting_vehicle_surcharge_applicability_amendment', url: 'https://www.treasury.gov.lk/api/file/d9eada68-6238-4f2c-a233-25d5de554627', kind: 'pdf', markers: [] },
      { name: 'gazette-2493-02.pdf', role: 'official_reviewed_customs_fees_notice_no_commodity_tariff_effect', url: 'https://www.treasury.gov.lk/api/file/dce992ba-973b-4662-b351-5a73df2f7b2a', kind: 'pdf', markers: [] },
      { name: 'gazette-2497-06.json', role: 'reviewed_official_index_confirmation_no_rate_change', url: 'https://documents.gov.lk/web/extra_gazettes', kind: 'evidence_json', markers: [], evidence: { gazette: '2497/06', date: '2026-07-14', instrument: 'Parliamentary confirmation of Revenue Protection Order No. 01/2026', classification: 'REVIEWED_NO_RATE_CHANGE', reviewed_on: '2026-09-20' } },
      { name: 'gazette-2501-88.pdf', role: 'official_vehicle_surcharge_extension_order', url: 'https://www.treasury.gov.lk/api/file/1cd1a221-5c6f-49b9-9e60-519fa156c9f8', kind: 'pdf', markers: [] },
      { name: 'vat-amendment-act-14-2026.pdf', role: 'official_reviewed_vat_amendment_no_customs_import_duty_effect', url: 'https://www.ird.gov.lk/en/publications/Value%20Added%20Tax_Acts/VAT_Act_No_14-2026_E.PDF', kind: 'pdf', markers: [] },
      { name: 'gazette-enumeration-through-2026-09-16.json', role: 'reviewed_complete_authoritative_post_baseline_publication_enumeration', url: 'https://documents.gov.lk/web/extra_gazettes', kind: 'evidence_json', markers: [], evidence: { baseline_date: '2026-05-16', through_date: '2026-09-16', registers: ['Treasury Trade and Investment Policy Gazette register', 'Treasury Fiscal Policy Gazette register', 'Government Printer Extraordinary Gazette index'], trade_register_items: ['2488/69', '2493/02', '2501/88'], generic_index_item: '2497/06', conclusion: 'All identified post-baseline customs/import-tax instruments were retained or classified; generic-titled entries were inspected.' } },
      { name: 'copyright-act-section-8.json', role: 'reviewed_official_statute_citation_excluding_administrative_decisions_and_facts', url: 'https://www.nipo.gov.lk/web/images/pdf_downloads/Intellectual_Property_Act_No_36_of_2003.pdf', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-16', provision: 'Intellectual Property Act No. 36 of 2003, section 8', finding: 'Mere data and official legislative/administrative/legal texts excluded from copyright. ClearTrade retains official text and tariff facts only.' } },
      { name: 'isfta-index.json', role: 'reviewed_government_of_india_bilateral_trade_agreement_citation', url: 'https://www.commerce.gov.in/ministryofcommerce/node/3398', kind: 'evidence_json', markers: [], evidence: { reviewed_on: '2026-09-16', instrument: 'ISFTA', finding: 'India-origin preference requires RoO proof; negative list applies.' } },
    ],
    general_column: 'general', india_column: 'india', india_area_id: 'ISFTA', india_basis: 'direct_requires_origin',
    rights_evidence: { artifact: 'copyright-act-section-8.json', rule: 'Sri Lanka IP Act section 8 excludes mere data and official legislative/administrative/legal texts. ClearTrade retains official text and tariff facts only; claims no right in website presentation, software or protected compilation arrangement.' },
    preference_evidence: { artifact: 'isfta-index.json', programme: 'ISFTA', direct_tariff_column: 'INDIA', requires_origin_proof: true, origin_qualification_not_established_by_origin_country: true },
  },
});

export function greenWaveConfig(country: string): GreenWaveConfig {
  const config = GREEN_WAVE_CONFIGS[country.trim().toUpperCase() as GreenWaveCountry];
  if (!config) throw new Error(`No activated green-wave configuration exists for ${country}.`);
  return config;
}
