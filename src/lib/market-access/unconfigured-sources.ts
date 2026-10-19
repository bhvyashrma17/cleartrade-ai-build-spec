/**
 * Sources that exist, are authoritative, and are NOT machine-readable on terms we may rely on.
 *
 * Each entry records the determination explicitly so the gap reads as a licensing/interface fact
 * rather than as a technical failure, and so nobody later mistakes silence for "no data".
 *
 * The alternative for these destinations is not scraping. It is the authoritative-manual path in
 * `manual-authoritative.ts`: a named reviewer records the exact published tariff line, with the
 * source reference and effective date, under `agent_verified` provenance.
 */

export type UnconfiguredReason =
  | 'no_documented_machine_interface'
  | 'bulk_distribution_only'
  | 'source_insufficient'
  | 'license_pending'
  | 'individual_investigation_required'
  | 'credential_not_provisioned';

export interface UnconfiguredSource {
  jurisdiction: string;
  country_codes: readonly string[];
  authority: string;
  reason: UnconfiguredReason;
  determination: string;
  /** Where the determination can be re-checked. */
  references: readonly string[];
  /** What would have to become true for this to become an automated provider. */
  unblocked_by: string;
}

/**
 * EU TARIC was here until Phase 1 final. It is now an automated authoritative provider: ClearTrade
 * staff upload the Commission's official monthly extraction and `taric/parser.ts` machine-reads it.
 * See `src/lib/market-access/taric/` and docs/18-taric-bundle-schema-map.md.
 */
export const UNCONFIGURED_MARKET_ACCESS_SOURCES: Readonly<Record<string, UnconfiguredSource>> = Object.freeze({
  // JP_CUSTOMS was here through P1-CC4. A dataset-specific rights pass found Japan Customs' own
  // copyright notice (customs.go.jp/copyright_e.htm): Public Data License 1.0 applies by default,
  // explicitly permits commercial use, and the schedule's numerical/tabular content is stated to
  // be free of copyright protection outright. Japan is now an automated authoritative provider —
  // see src/lib/market-access/providers/japan-*.ts.
  CH_BAZG_TARES: {
    jurisdiction: 'CH',
    country_codes: ['CH'],
    authority: 'Federal Office for Customs and Border Security (BAZG/FOCBS) — Tares customs tariff',
    reason: 'source_insufficient',
    determination: 'The earlier blanket licence blocker is not sustained. Swiss Copyright Act article 5 excludes acts, ordinances, treaties and other official enactments from copyright, and BAZG now advertises regularly updated Excel deliveries free of charge. BAZG also confirms that EFTA–India TEPA rates entered Tares on 1 October 2025 and publishes current origin guidance. The remaining gate is technical and source-completeness, not a demand for written permission: the customer-delivery page does not expose a documented complete bulk Tares contract covering normal and preferential rates, agricultural components, quotas and restrictions, and no reproducible full export plus update/history manifest was established.',
    references: ['https://www.bazg.admin.ch/en/customs-tariff-tares-services-companies', 'https://www.bazg.admin.ch/en/tares-free-data-delivery-on-customers-request', 'https://www.fedlex.admin.ch/eli/cc/1993/1798_1798_1798/en?version=20250701', 'https://www.bazg.admin.ch/de/inkraftsetzung-handels-und-wirtschaftspartnerschaftsabkommen-efta-indien'],
    unblocked_by: 'A documented complete BAZG bulk/API delivery for Tares with field semantics and revision/history identity, covering normal and TEPA rates, agricultural components, quotas and restrictions, followed by a specific/compound-duty-safe parser and real-file qualification.',
  },
  MY_JKDM_HS_EXPLORER: {
    jurisdiction: 'MY',
    country_codes: ['MY'],
    authority: 'Royal Malaysian Customs Department (JKDM/RMCD) — Customs Duties Order 2025',
    reason: 'license_pending',
    determination: 'The official P.U. (A) 384/2025 PDF is a deterministic 1,466-page legal schedule and the local implementation parses 11,441 ten-digit First Schedule lines plus all 27 Appendix B TRQ lines. JKDM\'s published notice nevertheless requires prior written permission for commercial copying, distribution or use. No evidence establishes that this tariff has been released as a CC BY 4.0 dataset on data.gov.my. The implementation therefore remains local and transient: no retained normalized cache, AuthorityRelease activation, staging entry or destination route exists.',
    references: ['https://www.customs.gov.my/images/06-prosedur/perintah-kastam/perintah/PUA_384.pdf', 'https://www.customs.gov.my/en/procedure/customs/customs', 'https://mycieds.customs.gov.my/safety-policy/', 'https://data.gov.my/'],
    unblocked_by: 'Exact written JKDM permission authorizing ClearTrade to periodically acquire, retain, normalize, transform, redistribute and commercially display P.U. (A) 384/2025 tariff data and its updates, or a JKDM/data.gov.my release of that exact dataset under terms granting those rights; followed by independent rights review and a fresh currentness/replay qualification before any staging or routing change.',
  },
  HK_CED_DUTIABLE_COMMODITIES: {
    jurisdiction: 'HK',
    country_codes: ['HK'],
    authority: 'Hong Kong Customs and Excise Department — Dutiable Commodities Ordinance duty rates',
    reason: 'license_pending',
    determination: 'Hong Kong is a free port for general goods and C&ED publishes the four dutiable-commodity categories and their percentage, tiered and formula-based duties on an official page. The permissive DATA.GOV.HK PSI licence does not attach to this separate customs.gov.hk artifact, and no artifact-specific grant for automated retention, transformation and commercial display was found. The small dataset does not relax the evidence or rights gate; dynamic page HTML is not accepted as an immutable release identity.',
    references: ['https://www.customs.gov.hk/en/service-enforcement-information/trade-facilitation/dutiable-commodities/types-and-duty-rates/', 'https://data.gov.hk/en/terms-and-conditions'],
    unblocked_by: 'C&ED confirmation that the cited duty-rate content may be periodically acquired, retained, transformed and commercially displayed, plus a stable authoritative release or reviewed content-addressed capture procedure.',
  },
  TR_MINISTRY_GTIP: {
    jurisdiction: 'TR',
    country_codes: ['TR'],
    authority: 'Republic of Türkiye Ministry of Trade — national GTİP tariff schedule',
    reason: 'source_insufficient',
    determination: 'Article 31 of Law 5846 clears reuse of the governing instruments. The Ministry now publishes current consolidated 2026 import-regime and additional-customs-duty (İGV) ZIPs, both updated 17 July 2026, and separate dated amendment indexes. This removes the earlier baseline/currentness ambiguity but not the execution join: Decision 3350 article 9 contains lower-rate and component precedence, article 10 treats additional financial liabilities separately, and the Ministry maintains independent financial-liability, quota/suspension, surveillance, safeguard and import-communiqué instruments. No parser currently joins those layers with typed replacement/addition semantics, so activation could omit a liability or double-count a component. No India preference is asserted; the Other Countries column cannot be selected until origin columns are completely mapped.',
    references: ['https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/1-ithalat-rejimi-kararikarar-sayisi3350karar-metni-ve-tablolar-konsolide-edilmis-olup-gunceldir', 'https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/2-ithalatta-ilave-gumruk-vergisi-uygulanmasina-iliskin-karar-karar-sayisi-3351-karar-metni-ve-tablolar-konsolide-edilmis-olup-gunceldir', 'https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/1-1-ithalat-rejimi-kararinda-degisiklik-yapilmasina-iliskin-kararlar-2026-yili', 'https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/2-1-ithalatta-ilave-gumruk-vergisi-uygulanmasina-iliskin-kararda-degisiklik-yapilmasina-dair-kararlar-2026-yili', 'https://www.ticaret.gov.tr/ithalat/ithalat-mevzuati/ithalat-rejimi-karari-igv-karari-ve-ithalat-tebligleri/5-ek-mali-yukumluluk-kararlari', 'https://telifhaklari.ktb.gov.tr/Eklenti/106879%2Cfikir-ve-sanat-eserleri-kanunupdf.pdf?0='],
    unblocked_by: 'Join the two current consolidated ZIPs to every applicable 2026 additional-financial-liability, quota/suspension, surveillance, safeguard and import-communiqué instrument, with typed article 9/10 precedence, replacement/addition semantics, origin-column mapping and no-double-count controls.',
  },
  RS_CUSTOMS_2026_TARIFF: {
    jurisdiction: 'RS',
    country_codes: ['RS'],
    authority: 'Customs Administration of Serbia — 2026 Customs Tariff regulation',
    reason: 'individual_investigation_required',
    determination: 'Serbian Customs publishes a deterministic current integral 2026 tariff consolidating Official Gazette 107/25 and 45/26, updated 22 May 2026, and Serbian law excludes official legislation/material from copyright. The tariff blocker is narrower than the separate regulatory notices: Official Gazette 34/26, amended 58/26, imposes a cement/steel quota regime whose normal MFN/FTA rate applies within quota and whose additional 50% applies after exhaustion; Customs also publishes dated 2026 allocation supplements. A 1,836-page tariff parser and that quota/50% state-and-precedence join are not yet qualified. Excise, VAT, phytosanitary and waste notices may remain outside an activated tariff provider with regulatory_coverage_complete=false; they are not mislabeled as tariff blockers. No India preference is asserted.',
    references: ['https://www.carina.rs/privreda/tarifski-poslovi/carinska-tarifa/privreda_carinska_tarifa_opste.html', 'https://www.carina.rs/upload/media/2026/7/17/70033/Regulation_on_harmonization_of_the_Customs_Tariff_nomenclature_for_the_2026_consolidated.pdf', 'https://www.carina.rs/privreda/carinski-postupci/aktuelna-obavestenja-2.html', 'https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=439959&uuid=ed8e09a0-d597-48db-af62-f6e1c216829b', 'https://reg.pravno-informacioni-sistem.rs/api/viewdoc?doctype=reg&regactid=440302&uuid=b0e0a0b9-1135-444a-a0fc-59119da0ca72'],
    unblocked_by: 'Qualify the complete 1,836-page current tariff parser and join Official Gazette 34/26 + 58/26 with every 2026 Customs quota-allocation supplement, effective dates, quota balance/exhaustion state and the conditional additional 50% precedence rule.',
  },
  BA_UIO_CUSTOMS_TARIFF: {
    jurisdiction: 'BA',
    country_codes: ['BA'],
    authority: 'Bosnia and Herzegovina Indirect Taxation Authority (UIO/ITA) — national customs tariff',
    reason: 'source_insufficient',
    determination: 'UIO confirms that the national tariff is adopted annually and contains MFN, preferences, suspensions, safeguards, antidumping, quotas and other Bosnia and Herzegovina measures. The authority exposes an interactive tariff search and legal notices, but no complete current versioned tariff artifact or documented API with a field dictionary and exhaustive amendment history was established. EU-CN alignment is only nomenclature alignment and no India preference evidence was found.',
    references: ['https://www.uino.gov.ba/portal/bs/carine/carinska-tarifa/', 'https://www.uino.gov.ba/portal/hr/pretraga-tarife/', 'https://www.uino.gov.ba/portal/bs/propisi/carina/'],
    unblocked_by: 'A complete official current-year tariff export or supported API plus every effective amendment/overlay and field definition, with an authoritative reuse basis and any India-origin treatment expressly resolved.',
  },
  MD_CUSTOMS_NATIONAL_TARIFF: {
    jurisdiction: 'MD',
    country_codes: ['MD'],
    authority: 'Customs Service of the Republic of Moldova — national customs tariff and customs-revenue instruments',
    reason: 'source_insufficient',
    determination: 'The Customs Service publishes current 2026 normative acts, monthly bulletins and separate quota, excise and origin instruments, but no complete commodity-level national tariff distribution or supported public tariff API was established. A legal-act index and interactive trade portal cannot be normalized as a complete tariff release, and the separate instruments prove that effective national treatment cannot be inferred from EU alignment or an older baseline. No India concession or origin entitlement is asserted.',
    references: ['https://customs.gov.md/en/articles/acte-normative-1856-ro', 'https://customs.gov.md/ro/articles/buletin-informativ-2408-ro', 'https://customs.gov.md/ro/articles/acordarea-preferintelor-tarifare-la-importul-marfurilor-1884-ro'],
    unblocked_by: 'A complete current national tariff artifact or documented API, joined to an exhaustive 2026 amendment/quota/excise manifest with field semantics, reuse basis and authoritative India-origin treatment.',
  },
  XK_KOSOVO_TARIK_2026: {
    jurisdiction: 'XK',
    country_codes: ['XK'],
    authority: 'Kosovo Customs — Integrated Tariff of Kosovo (TARIK) 2026',
    reason: 'individual_investigation_required',
    determination: 'Kosovo Customs publishes a stable TARIK 2026 PDF with legally binding nomenclature and national 9th/10th digits, while TARIK says current legal texts control and the Director General amends it regularly. Reuse is now cleared: Law 08/L-205 article 6 excludes official legislative, administrative and judicial texts and their official translations, as well as facts/data, from copyright protection. The remaining gate is currentness and parsing: the public Customs law index and its tariff-act registry do not establish a complete 2026 Director-General instruction chain tied to this PDF, and the 2025–2026 correlation table is expressly indicative/non-legal. A deterministic parser without that dated chain could reproduce stale treatment. No India preference is inferred.',
    references: ['https://dogana.rks-gov.net/sharedfolder/ProductFiles/2026_488f89e7-9610-4161-b671-3e11c747d458.pdf', 'https://dogana.rks-gov.net/law', 'https://dogana.rks-gov.net/SharedFolder/DocumentFiles/Tabela%20korrelative_2025-2026.pdf', 'https://mkrs-ks.org/repository/docs/LAW_NO._08_L-205_ON_COPYRIGHT_AND_RELATED_RIGHTS.pdf', 'https://gzk.rks-gov.net/OfficialGazetteDetail.aspx?GZID=550'],
    unblocked_by: 'An authority-published, dated TARIK release declaration or complete 2026 Director-General administrative-instruction registry tied to the PDF, followed by real-file table/note parser qualification and authoritative India-treatment resolution.',
  },
  CL_SNA_NATIONAL_TARIFF: {
    jurisdiction: 'CL',
    country_codes: ['CL'],
    authority: 'Servicio Nacional de Aduanas (SNA) — Arancel Aduanero Nacional',
    reason: 'license_pending',
    determination: 'Rights research concluded on 25 September 2026 without a commercial reuse basis. Ley 17.336 has no exception for official legal texts (its exceptions, arts. 71 A-S, cover quotation, disability, libraries, education, parody and judicial or administrative use). Art. 88 vests copyright in works produced by State officials in the State, releasable only by a resolution of the rights holder into the common cultural heritage, and no such resolution was found for the Arancel Aduanero. Art. 3 no. 17 withholds compilation protection from the data themselves, but expressly without prejudice to any copyright subsisting in the materials, so it does not displace art. 88 ownership. The Servicio Nacional de Aduanas\' terms of use (clause 5, \'Derechos reservados\') reserve all rights in the portal and its contents, including intellectual property. datos.gob.cl carries 51 Aduanas datasets under ODC-BY, ODbL or CC BY, but they are import/export transaction registers and a field dictionary, not the tariff schedule, so those licences do not attach. SUBREI\'s operative Chile-India partial-scope agreement (2,099 Chilean concessions) is unaffected. No tariff was bulk-acquired and no provider was built.',
    references: ['https://www.bcn.cl/leychile/navegar?idNorma=28933', 'https://www.aduana.cl/terminos-generales-o-condiciones-de-uso-del-sitio-web/aduana/2007-02-28/140954.html', 'https://datos.gob.cl/organization/servicio_nacional_de_aduanas', 'https://www.aduana.cl/arancel-aduanero-vigente/aduana/2016-12-30/090118.html', 'https://www.subrei.gob.cl/acuerdos-comerciales/acuerdos-comerciales-vigentes/india'],
    unblocked_by: 'An art. 88 resolution releasing the Arancel Aduanero into the common cultural heritage, or an explicit SNA or open-data licence covering the current tariff schedule for commercial acquisition, retention, transformation and display; then a current consolidated tariff with price-band determinations and the Commission\'s remedy decisions.',
  },
  MX_SNICE_LIGIE: {
    jurisdiction: 'MX',
    country_codes: ['MX'],
    authority: 'Mexico Ministry of Economy (SNICE) / SAT — LIGIE/TIGIE',
    reason: 'source_insufficient',
    determination: 'Re-gated on 25 September 2026. The tariff base is sound: SNICE\'s fracciones workbook (FRACCIONESARANCELARIAS-LIGIE_20260420) carries 8,183 eight-digit fractions with import/export rates (including AMX sugar compound rates and prohibited lines) and 11,507 NICO rows, and it already incorporates every entry of SNICE\'s official modification ledger (July 2025, November 2025, December 2025 and April 2026 deltas, 11 + 8 + 1,463 + 185 fractions). The blocker is remedy completeness: Annex 2.5.1 and every controlling compensatory-duty resolution are published only in the Diario Oficial de la Federación, which is TCP-filtered from the qualification environment (as is the Cámara de Diputados), while gob.mx (UPCI) serves a proof-of-work bot challenge that is not bypassed. SNICE\'s DOF index titles alone show likely-active India-origin measures (seamless and welded carbon-steel pipe, high-carbon ferromanganese, ferrosilicomanganese, amoxicillin, textured polyester filament), which cannot be qualified from titles.',
    references: ['https://www.snice.gob.mx/cs/avi/snice/ligie.info22.html', 'https://www.snice.gob.mx/cs/avi/snice/ligie.info22.mod26.html', 'https://www.snice.gob.mx/cs/avi/snice/drrnas.cuotascomp.normatividad.html', 'https://www.snice.gob.mx/cs/avi/snice/historicos.dof.html'],
    unblocked_by: 'Reachable, unchallenged access to the Diario Oficial de la Federación (Annex 2.5.1 and every preliminary/final compensatory-duty and safeguard resolution in force), or an official current compensatory-duty register with rates, producers and dates, together with the controlling DOF texts of the tariff instruments.',
  },
  ZA_SARS_TARIFF: {
    jurisdiction: 'ZA',
    country_codes: ['ZA'],
    authority: 'South African Revenue Service (SARS) — Schedules to the Customs and Excise Act',
    reason: 'license_pending',
    determination: 'Re-gated on 25 September 2026. Copyright Act 98 of 1978 s12(8)(a) means no copyright subsists in official texts of a legislative, administrative or legal nature, so the Schedules themselves are not the obstacle. SARS\'s website terms are: clause 4.1 limits use to personal, educational or non-commercial purposes with no further reproduction or distribution; clause 4.2 forbids commercial use without SARS\'s prior written consent; clause 4.8.2 forbids using any technology or application, including crawlers, to search or copy SARS website material without prior written consent. A periodic acquisition of the Schedules from sars.gov.za would itself breach 4.8.2, so no automated acquisition or technical qualification was attempted. For a future consented build: Schedule No. 1 Part 1 was updated 28 August 2026; the 2026 Tariff Amendments ledger lists 74 notices through 18 September 2026, including GG 54974 R.7690 (10 July 2026), a provisional anti-dumping payment on ceramic and porcelain tiles (6904.90, 6907.21, 6907.22, 6907.40) from India, Mozambique, Zambia and Zimbabwe.',
    references: ['https://www.sars.gov.za/legal-counsel/primary-legislation/schedules-to-the-customs-and-excise-act-1964/', 'https://www.sars.gov.za/legal-counsel/secondary-legislation/tariff-amendments/tariff-amendments-2026/', 'https://www.sars.gov.za/terms-and-conditions/'],
    unblocked_by: 'Written SARS consent covering automated acquisition (clause 4.8.2), normalization, retention and commercial derived display (clauses 4.1-4.2), followed by a Schedule 1 Part 1 plus Schedule 2 parser qualified against the Tariff Amendments ledger.',
  },
  KE_KRA_EAC_CET: {
    jurisdiction: 'KE',
    country_codes: ['KE'],
    authority: 'Kenya Revenue Authority (KRA) — EAC Common External Tariff and Kenya implementing measures',
    reason: 'source_insufficient',
    determination: 'KRA publishes the EAC CET 2022 PDF and later EAC Gazette measures, but no single complete current national execution release or exhaustive Kenya overlay manifest was established through September 2026. The regional CET does not by itself encode every Kenya-specific stay, remission, levy, prohibition or effective date. No supported machine format/API or authoritative India-origin concession and rules-of-origin layer was found.',
    references: ['https://ikesra.kra.go.ke/items/538c6b1f-8c90-42da-ae0e-f20ea1d1fa6a', 'https://www.kra.go.ke/news-center/public-notices/1733-implementation-of-the-2022-harmonized-system-the-2022-east-african-community-common-external-tariff', 'https://www.kra.go.ke/component/search/common'],
    unblocked_by: 'A complete KRA national tariff distribution or supported API with an exhaustive EAC-and-Kenya amendment/overlay manifest, field semantics, reuse basis and authoritative India treatment.',
  },

  EG_CUSTOMS_INTEGRATED_TARIFF: {
    jurisdiction: 'EG',
    country_codes: ['EG'],
    authority: 'Egyptian Customs Authority — integrated customs tariff',
    reason: 'no_documented_machine_interface',
    determination: 'Egyptian Customs publishes an interactive commodity tariff plus separate laws, tariff circulars and 2026 notices. No documented bulk export or public tariff API with a stable release/history contract was found, and the separate amendment stream prevents treating dynamic HTML as a complete immutable release. The site footer is not treated as a legal prohibition; the blocker is the missing supported acquisition and complete amendment chain. No India preference is asserted.',
    references: ['https://customs.gov.eg/Services/Tarif', 'https://customs.gov.eg/Legislations/Manshorat?categoryId=4', 'https://customs.gov.eg/'],
    unblocked_by: 'A supported complete tariff export or documented API tied to every effective circular and legal amendment, with field semantics, an applicable reuse basis and authoritative India-origin treatment.',
  },
  JO_CUSTOMS_INTEGRATED_TARIFF: {
    jurisdiction: 'JO',
    country_codes: ['JO'],
    authority: 'Jordan Customs — Integrated Customs Tariff',
    reason: 'no_documented_machine_interface',
    determination: 'Jordan Customs exposes a line-level integrated tariff, updated in September 2026, through an interactive table and ASYCUDA lookup. The ASYCUDA UI has official PDF, Excel and CSV export actions, but a live export contains classification code, description and unit only—not duties, taxes, preferences or overlays. No documented rate-data API, complete versioned bulk release or historical replay mechanism was found. Jordan Customs also limits website downloads to personal/in-house non-commercial use unless Customs grants broader permission. The displayed fee ratio alone cannot prove every additional measure, preference, rule of origin or effective-date condition, and no India-origin qualification is asserted.',
    references: ['https://customs.gov.jo/EN/List/Integrated_customs_tariff', 'https://asytrade.customs.gov.jo/customs/tariff?lang=en', 'https://www.customs.gov.jo/EN/Pages/Copyrights'],
    unblocked_by: 'A documented Jordan Customs tariff API or complete versioned bulk release containing rates and overlays, with history and field semantics, plus written permission for periodic commercial acquisition, retention, transformation and display and authoritative India-origin treatment.',
  },
  BH_CUSTOMS_UNIFIED_TARIFF: {
    jurisdiction: 'BH',
    country_codes: ['BH'],
    authority: 'Bahrain Ministry of Interior, Customs Affairs — Unified Customs Tariff',
    reason: 'bulk_distribution_only',
    determination: 'Bahrain confirmed the exact official distribution route: a BHD 3 e-copy requested inside Ofoq 2, fulfilled in three working days. The service page publishes no pre-purchase licence or reuse terms, and no alternate anonymous full tariff release/API was found. Bahrain has an Open Government Data Licence, but the paid Ofoq artifact is not identified as data published under it. The artifact bytes, schema, release date, national overlays and update mechanism therefore remain unobserved. The GCC law expressly allows ad-valorem, specific or combined duties and member-state implementation; a GCC schedule cannot be substituted for Bahrain execution. No India preference is inferred.',
    references: ['https://www.bahrain.bh/wps/portal/en/BNP/ServicesCatalogue/GSX-UI-PServiceDetails?psID=1322', 'https://bahrain.bh/wps/portal/CustomsConditionsRegulations_en', 'https://www.bahrain.bh/wps/wcm/connect/0d8e85f5-f34a-4e2c-bcba-e75debbe32c9/Open%2BData%2BLicense%2B%D8%B1%D8%AE%D8%B5%D8%A9%2B%D8%A7%D9%84%D8%A8%D9%8A%D8%A7%D9%86%D8%A7%D8%AA%2B%D8%A7%D9%84%D9%85%D9%81%D8%AA%D9%88%D8%AD%D8%A9.pdf?CVID=pxw8t4P&MOD=AJPERES'],
    unblocked_by: 'A Bahrain-eligible Ofoq account must acquire the current e-copy and preserve its purchase terms; those terms must permit ClearTrade retention/transformation, after which its schema, national overlays, update history and India treatment can be qualified.',
  },
  // SG_CUSTOMS_STCCED was here until D-029 (18 Oct 2026). Singapore Statutes Online permits automated
  // extraction from 03:00 to 07:00 Singapore Time, so the worker now saves the consolidated First
  // Schedule in that window every night and runs read the saved release
  // (src/lib/market-access/providers/singapore-refresh.ts). Until the first saved copy passes
  // qualification a run records `no_release` for Singapore; the SSO source stays the manual pointer
  // (tariff-source-directory.ts).
  MV_CUSTOMS_TARIFF: {
    jurisdiction: 'MV',
    country_codes: ['MV'],
    authority: 'Maldives Customs Service — National Tariff Schedule',
    reason: 'no_documented_machine_interface',
    determination: 'Maldives Customs has published an English HS 2022 National Tariff Schedule and exposes a tariff service, while 2026 export/import legislation continues to change. The official service currently returns a Cloudflare browser challenge to deterministic anonymous HTTP acquisition, and no supported current API or bulk distribution with release history and dataset-specific reuse terms was found. An older tariff schedule cannot be assumed current after later statutory changes.',
    references: ['https://www.customs.gov.mv/eServices/Tariff', 'https://trade.gov.mv/en/laws-and-regulations/'],
    unblocked_by: 'A current Maldives Customs tariff API or versioned bulk release that is accessible without a browser challenge, with complete amendment history, field semantics and permission for retained commercial reuse.',
  },
  TH_CUSTOMS: {
    jurisdiction: 'TH',
    country_codes: ['TH'],
    authority: 'Thai Customs Department — integrated tariff / ASEAN Harmonised Tariff Nomenclature schedules',
    reason: 'individual_investigation_required',
    determination: 'Thai Customs publishes a deterministic reference-file directory live through 14 September 2026, including downloadable tariff and permission ZIP/XLSX/PDF changes. The directory contains about 1,952 files and the observed tariff files are deltas; no authoritative full base plus gap-free replay and precedence contract has been established. AIFTA and national control treatment must be joined rather than inferred from AHTN.',
    references: ['https://www.customs.go.th/list_strc_download_with_document.php?ini_content=reference_files&lang=en&left_menu=nmenu_esevice_006&order_by=co_last_update_datetime&show_search=1&sort_type=0', 'https://www.customs.go.th/'],
    unblocked_by: 'Identify the authoritative complete base and prove a gap-free replay of every tariff-affecting delta, with typed precedence, current AIFTA concessions and rules of origin.',
  },
  UA_CUSTOMS_DUTY_RATES: {
    jurisdiction: 'UA',
    country_codes: ['UA'],
    authority: 'State Customs Service of Ukraine — Rates of import and export duties',
    reason: 'source_insufficient',
    determination: 'The current 2026 data.gov.ua CSV is an openly licensed catalogue of governing legal acts and web links, not a commodity-level import-duty schedule. The nationwide import tariff is published separately by the Verkhovna Rada as two large legal-text schedules under Law 2697-IX. The catalogue has no classification/rate/effective-date rows that can be normalized into Market Access evidence, and this environment cannot reliably acquire the linked official schedules as retained machine releases. A legal-resource link is not a tariff row.',
    references: ['https://data.gov.ua/dataset/duty-rates', 'https://zakon.rada.gov.ua/laws/show/2697-IX'],
    unblocked_by: 'A reliably acquirable official commodity-level schedule (or documented API) carrying UKTZED code, description, preferential/full import rates, duty units and effective dates, tied to the State Customs dataset or separately licensed by the publishing authority.',
  },
  EAEU_KZ_OPEN_DATA: {
    jurisdiction: 'EAEU',
    country_codes: ['KZ', 'RU', 'BY', 'AM', 'KG'],
    authority: 'Kazakhstan Ministry of Finance / Open Data portal — EAEU nomenclature and Common Customs Tariff',
    reason: 'source_insufficient',
    determination: 'The rights-cleared data.egov.kz release fails the first EAEU source gate: its own metadata declares exactly one string field named link and describes a set of EAEU TN VED codes; it does not contain tariff-rate fields. Kazakhstan State Revenue Committee separately exposes 2026 XML/Excel tariff exports, but no dataset-specific evidence ties those bytes to the open-data release or its reuse grant. Portal openness is not transferred to a different authority webpage. No common-tariff pack or destination wrapper is activated.',
    references: ['https://data.egov.kz/datasets/view?index=euraziyalyk_ekonomikalyk_odakt', 'https://data.egov.kz/meta/euraziyalyk_ekonomikalyk_odakt/v3?pretty', 'https://akm.kgd.gov.kz/ru/nsi/impprim/10/3974'],
    unblocked_by: 'An official rights-cleared release that contains the EAEU tariff rates, or an authoritative statement tying the KGD XML/Excel exports to the open-data dataset and permitting automated retrieval, retention, commercial reuse and derived customer display.',
  },
  UY_MEF_NATIONAL_TARIFF: {
    jurisdiction: 'UY',
    country_codes: ['UY'],
    authority: 'Uruguay Ministry of Economy and Finance — National Tariff',
    reason: 'license_pending',
    determination: 'MEF publishes an executable national XLSX with AEC and Uruguayan national rates, but the observed workbook is dated February 2025 and is not a dataset in Uruguay\'s licensed open-data catalogue. No file-specific grant covers commercial normalization, retained releases or paid customer display, and no authoritative 2026 amendment manifest or national MERCOSUR–India PTA layer is attached. A licence from another government portal surface is not inherited by this workbook.',
    references: ['https://www.gub.uy/ministerio-economia-finanzas/politicas-y-gestion/nomenclatura-aranceles-uruguay', 'https://www.gub.uy/ministerio-economia-finanzas/sites/ministerio-economia-finanzas/files/2025-05/Arancel%20Nacional_Febrero%202025%20-final.xlsx', 'https://www.gub.uy/agencia-gobierno-electronico-sociedad-informacion-conocimiento/comunicacion/publicaciones/licencia-datos-abiertos-uruguay'],
    unblocked_by: 'MEF confirmation that the national open-data licence covers the exact current workbook for commercial derivatives, immutable retention and customer display, plus a 2026 release or complete amendment manifest and the operative national India-PTA instruments.',
  },
  NG_NCS_CET: {
    jurisdiction: 'NG',
    country_codes: ['NG'],
    authority: 'Nigeria Customs Service — Nigeria Customs Tariff / ECOWAS CET',
    reason: 'source_insufficient',
    determination: 'Nigeria Copyright Act 2022 sections 2(5) and 3 exclude mere data and official legislative or administrative texts from protection, so the legal tariff facts and official instruments are reusable with provenance; any original selection/arrangement or site software remains excluded. The source gate still fails because NCS did not yield an authoritative populated full-tariff release carrying Nigeria\'s national levies, prohibitions, derogations and amendment dates. The regional ECOWAS base cannot stand in for national execution.',
    references: ['https://customs.gov.ng/cet-tariff', 'https://cet.customs.gov.ng/', 'https://api.customs.gov.ng/api/pages/cet-tariff', 'https://www.wipo.int/wipolex/en/legislation/details/21820'],
    unblocked_by: 'A current populated NCS full-tariff export carrying the Nigerian national execution layer, field definitions, dates and override precedence, with any protected compilation elements excluded or separately licensed.',
  },
  BD_NBR_NATIONAL_TARIFF: {
    jurisdiction: 'BD',
    country_codes: ['BD'],
    authority: 'Bangladesh National Board of Revenue / Customs — National Tariff',
    reason: 'license_pending',
    determination: 'Bangladesh Customs advertises FY 2026–27 material and exposes a live chapter tariff, but the investigation did not establish a complete executable FY 2026–27 baseline plus SRO manifest or a source-specific commercial reuse basis. CD must remain separate from SD, VAT, AIT, RD, AT and TTI, and SAFTA membership alone cannot create India preference evidence.',
    references: ['https://customs.gov.bd/files/Tariff-2025-2026%2829-07-2025%29.pdf', 'https://customs.gov.bd/portal/services/tariff/tableOfContents.jsf'],
    unblocked_by: 'Published or written NBR reuse terms covering commercial normalization, retention and derived display, together with the complete current fiscal-year tariff/SRO manifest and any operative India-origin concession schedule and origin rules.',
  },
  CR_COMEX_NATIONAL_TARIFF: {
    jurisdiction: 'CR',
    country_codes: ['CR'],
    authority: 'Costa Rica Ministry of Foreign Trade — National Customs Tariff',
    reason: 'source_insufficient',
    determination: 'Re-gated on 25 September 2026 against the Ministry of Finance Ar@ncelNet system. From the qualification environment Ar@ncelNet is not a deterministic source. Its host (serviciosnet.hacienda.go.cr, a 30-second-TTL CNAME to Akamai) resolves only intermittently because hacienda.go.cr\'s own nameservers do not answer reliably, and when it was reached it returned HTTP 400 with an Akamai \'solicitud en revisión\' bot-review hold, which was not circumvented. MEIC\'s Dirección de Defensa Comercial (www.meic.go.cr) refuses connections, so the controlling remedy instruments could not be read. WTO records establish part of the remedy picture. The Brazil refined-sugar anti-dumping measure (case 001-2015) was terminated on expiry on 28 March 2022 (G/ADP/N/370/CRI), so it is not the one anti-dumping measure WTO data reports in force in 2026. The 2020 refined-sugar safeguard was notified for three years with liberalisation (G/SG/N/8/CRI/2) and no extension was notified. Costa Rica\'s semi-annual anti-dumping reports end at G/ADP/N/370/CRI (January-June 2022), so the current measure, special-safeguard triggers and tariff-quota treatment remain unresolved. Rights (Law 6683) were not assessed because the base gate failed first.',
    references: ['https://serviciosnet.hacienda.go.cr/arancelnet/', 'https://www.meic.go.cr/meic/web/169/defensa-comercial/resoluciones-finales.php', 'https://docs.wto.org/dol2fe/Pages/SS/directdoc.aspx?filename=q:/G/ADP/N370CRI.pdf&Open=True', 'https://docs.wto.org/dol2fe/Pages/SS/directdoc.aspx?filename=q:/G/SG/N8CRI2.pdf&Open=True'],
    unblocked_by: 'Stable, unchallenged acquisition from Ar@ncelNet (or an official current tariff release), plus reachable MEIC/DDC resolutions establishing the anti-dumping measure currently in force, any triggered special agricultural safeguard and the controlling tariff-quota instruments.',
  },
  PK_FBR_CUSTOMS_TARIFF: {
    jurisdiction: 'PK',
    country_codes: ['PK'],
    authority: 'Pakistan Federal Board of Revenue — Pakistan Customs Tariff',
    reason: 'license_pending',
    determination: 'Pakistan Copyright Ordinance section 57(1)(q) permits reproduction of official Gazette material unless government prohibits it, while FBR\'s website terms allow only narrow unmodified, no-cost local sharing. The investigation did not resolve which terms control the exact tariff/Gazette artifacts ClearTrade would retain and transform. The current baseline, Fifth Schedule and SRO chain must also be frozen together; SAFTA is not itself line-level India evidence.',
    references: ['https://www.fbr.gov.pk/categ/laws/144', 'https://www.fbr.gov.pk/Term-of-Use/544'],
    unblocked_by: 'An authoritative determination or written FBR permission resolving section 57(1)(q) against FBR\'s site terms for the exact artifacts, plus the complete current fiscal-year tariff, Fifth Schedule and SRO manifest.',
  },
  JM_JCA_INTEGRATED_TARIFF: {
    jurisdiction: 'JM',
    country_codes: ['JM'],
    authority: 'Jamaica Customs Agency — Integrated Tariff',
    reason: 'license_pending',
    determination: 'JCA publishes a current Integrated Tariff effective 1 May 2026. The official consolidated Copyright Act published by Jamaica\'s Ministry of Justice (last amendment recorded as 1 January 2015) places Acts and subsidiary legislation under Crown copyright in section 13B; the identified automatic reproduction exception is non-commercial, so commercial normalization and retained paid display remain unlicensed. CARICOM treatment, national taxes, suspensions and derogations must remain distinct, and the agreement material does not establish an India preference.',
    references: ['https://laws.moj.gov.jm/legislation/statutes/C/The%20Copyright%20Act.pdf', 'https://laws.moj.gov.jm/library/statute/the-copyright-act', 'https://jca.gov.jm/e-services/integrated-tariff-search/', 'https://jca.gov.jm/business/trade-agreements/'],
    unblocked_by: 'Written JCA permission for periodic acquisition, normalization, immutable historical retention and paid derived/customer display, with required attribution and third-party/CARICOM/WCO exclusions documented.',
  },
  PA_ANA_INTERACTIVE_TARIFF: {
    jurisdiction: 'PA',
    country_codes: ['PA'],
    authority: 'Panama National Customs Authority — Interactive National Tariff',
    reason: 'source_insufficient',
    determination: 'Panama Law 64/2012 Art. 13 excludes official legislative and administrative texts when faithfully reproduced with source attribution, clearing the legal instruments themselves. The 12-digit interactive tariff has no supported bulk/history contract, and the June 2026 Gazette contains Cabinet Decrees 7 and 8 changing tariff treatment and a rice quota. A 2025 compilation therefore cannot reproduce the September 2026 state and undocumented browser endpoints are not an acceptable substitute.',
    references: ['https://aranceles.ana.gob.pa/', 'https://aranceles-api.ana.gob.pa/', 'https://aranceles.ana.gob.pa/assets/documentos_aduanas/manual/Manual%20Herramienta%20Arancel%20Interactivo_Dic2020_V1.pdf', 'https://www.wipo.int/wipolex/en/legislation/details/15426'],
    unblocked_by: 'A supported complete export or reproducible official baseline-plus-Gazette pipeline with field dictionary and every effective amendment through the query date, preserving faithful text and source attribution.',
  },
  DO_DGA_CUSTOMS_TARIFF: {
    jurisdiction: 'DO',
    country_codes: ['DO'],
    authority: 'Dominican Republic Directorate General of Customs — National Customs Tariff',
    reason: 'source_insufficient',
    determination: 'The official Dominican copyright authority (ONDA) publishes Law 65-00, whose Art. 41 permits faithful, sourced reproduction of official texts unless expressly prohibited. Its consolidation status was not established. WIPO Lex explicitly marks its Law 65-00 text as unconsolidated and identifies later amending laws not incorporated into that text, so neither copy is represented here as definitive current consolidated law. The conservative source_insufficient blocker remains: DGA identifies the Seventh Amendment 2022 tariff through an embedded publication, but a complete current executable artifact and every subsequent amendment were not reliably acquired; no India preference evidence was established.',
    references: ['https://onda.gob.do/wp-content/uploads/2022/10/Ley-No.65-00-sobre-Derecho-de-Autor.pdf', 'https://www.wipo.int/wipolex/en/legislation/details/1191', 'https://www.aduanas.gob.do/de-interes/consultas/', 'https://www.aduanas.gob.do/consultas/arancel-de-aduanas-7ma-enmienda-2022/', 'https://www.aduanas.gob.do/media/rupaj0fj/aviso-entrada-en-vigor-enmienda.pdf'],
    unblocked_by: 'A stable official download of the complete DGA tariff plus every effective amendment and field definition, with faithful text/source attribution and any expressly protected third-party compilation elements excluded.',
  },
  AR_ARCA_SIM: {
    jurisdiction: 'AR',
    country_codes: ['AR'],
    authority: 'Argentina ARCA / Secretariat of Commerce — SIM national tariff execution',
    reason: 'source_insufficient',
    determination: 'Argentina\'s government content licence is favourable where it applies, and MERCOSUR publishes the regional NCM/AEC, but no complete current ARCA/SIM or VUCE national execution export was established. Argentina requires 11-digit measures, national exception and temporary lists, dates and units; the regional AEC alone is not executable national treatment and cannot carry the national India–MERCOSUR PTA annex.',
    references: ['https://www.argentina.gob.ar/produccion/comercio-exterior', 'https://polcom.mercosur.int/public/ncm/vigente?lang=es', 'https://www.argentina.gob.ar/terminos-y-condiciones'],
    unblocked_by: 'An official current ARCA/SIM or VUCE export containing the complete national execution and override layers, with attached reuse terms and the operative national India–MERCOSUR concession and origin instruments.',
  },
  PY_MEF_NATIONAL_TARIFF: {
    jurisdiction: 'PY',
    country_codes: ['PY'],
    authority: 'Paraguay Ministry of Economy and Finance — National Tariff',
    reason: 'source_insufficient',
    determination: 'MEF now exposes an October 2025 national compilation and underlying baseline/amendment instruments, while Paraguay Law 1328 Art. 8 excludes official texts from copyright. The compilation still disclaims legal force and the investigation did not establish an exhaustive Gazette chain through September 2026, including temporary rate reductions. It therefore cannot become current executable evidence by itself. AEC does not replace Paraguay\'s national execution or prove an India-PTA line.',
    references: ['https://economia.gov.py/index.php/paraguay-y-el-mundo/aranceles-la-importacion/arancel-nacional-vigente', 'https://www.bacn.gov.py/leyes-paraguayas/1751/ley-n-1328-derecho-de-autor-y-derechos-conexos'],
    unblocked_by: 'The official baseline annex and an exhaustive effective amendment/temporary-resolution manifest through the current date, reconciled to the October 2025 compilation, plus the national India–MERCOSUR concession instruments.',
  },
  CO_DIAN_MUISCA: {
    jurisdiction: 'CO',
    country_codes: ['CO'],
    authority: 'Colombia DIAN — MUISCA Customs Tariff Consultation',
    reason: 'source_insufficient',
    determination: 'Re-gated on 25 September 2026. Rights are clear for official texts (Law 23 of 1982 art. 41, cited by DIAN\'s own compilation), the Decree 1881 of 2021 table is available as clean text in DIAN\'s Compilación Jurídica (7,968 ten-digit subpartidas; MinCIT\'s own copy is a 549-page scan with OCR errors), and MinCIT keeps a current anti-dumping register (22 measures, including high-pressure decorative laminates from India). Currentness is the blocker. MinCIT\'s decree register is not a complete record of tariff instruments: Decree 455 of 2026 (extending the Ecuador reciprocal duties to 191 subpartidas at 35/50/75%) and Decree 583 of 2026 (repealing them) are absent from it, the Presidency\'s decree register is TCP-filtered from the qualification environment, and SUIN-Juriscol is a private-API single-page application. The Andean Price Band variable duties cannot be modelled either: Decree 547 of 1995 lists the band products only in 1995 nomenclature, and no reachable official static source publishes their current-nomenclature scope or the fortnightly variable duties (the wheat suspension of Decree 1092 of 2024 lapsed on 28 August 2026).',
    references: ['https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1881_2021.htm', 'https://www.mincit.gov.co/normatividad/decretos/2026', 'https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0547_1995.htm', 'https://normograma.dian.gov.co/dian/compilacion/docs/decreto_0170_2026.htm', 'https://normograma.dian.gov.co/dian/compilacion/creditos.html'],
    unblocked_by: 'A complete, reachable register of every decree modifying the Arancel de Aduanas (or the Diario Oficial index) through the query date, and an official current-nomenclature list of Andean Price Band products with the published variable duties or rebates for each fortnight.',
  },
  MK_CUSTOMS_2026_TARIFF: {
    jurisdiction: 'MK',
    country_codes: ['MK'],
    authority: 'North Macedonia Customs Administration — Customs Tariff 2026',
    reason: 'individual_investigation_required',
    determination: 'Focused recheck on 20 September 2026 confirmed that both the Macedonian- and English-language Customs tariff pages still fail authenticated acquisition with an expired TLS certificate; certificate verification was not bypassed. The Customs index lists the 2026 annual decision (Official Gazette 261/25) and correlation workbooks, but the Ministry of Finance also records a tariff-changing law effective 1 July 2026 for 70 raw-material and intermediate-goods lines. No secure official alternative publication containing both the executable annual archive and the mid-year line-level amendment was located. Copyright law Art. 16 clears official texts/facts, but rights do not cure the acquisition and currentness gaps. EU-CN alignment remains nomenclature alignment only.',
    references: ['https://customs.gov.mk/zakon-za-carinska-tarifa.nspx', 'https://customs.gov.mk/content/Одлука%20за%20усогласување%20и%20менување%20на%20царинска%20тарифа%20за%202026.rar', 'https://finance.gov.mk/en-GB/odnosi-so-javnost/novosti/mf-od-1-juli-2026-godina-se-vrsi-dopolnitelno-namaluvanje-i-celosno-usoglasuvanje-na-carinskite-stapki-so-eu-za-70-stoki-koi-kako-surovini-i-repromaterijali-se-koristat-vo-domasnata-industrija', 'https://www.wipo.int/wipolex/en/legislation/details/10641', 'https://www.wipo.int/wipolex/en/legislation/details/11672'],
    unblocked_by: 'Customs must restore a valid TLS chain (or publish identical files on another authenticated official endpoint), and the exact enacted line-level 1 July amendment must be acquired and reconciled with the annual annex and correlations before real-file hash, schema, row-count and rate-semantic qualification.',
  },
  ME_CUSTOMS_TARICG: {
    jurisdiction: 'ME',
    country_codes: ['ME'],
    authority: 'Montenegro Revenue and Customs Administration — TARICG',
    reason: 'individual_investigation_required',
    determination: 'Focused recheck on 20 September 2026 cleared the old WAPI timeout but exposed a stricter artifact gap. The enacted Government WAPI PDF for Official Gazette 157/2025 is stable (35,508 bytes; SHA-256 444d1d2f3f2cf1f6e98a87d08d51c6a7affd11871f1f7b8b75af724addd2edcb), but it is only four pages: the regulation plus headings for Annex I and appendices, with no executable tariff rows. A 727-page Government proposal PDF contains tariff tables, but a pre-enactment proposal cannot be substituted for the controlling final annex without an official identity/equivalence proof. TARICG still exposes no supported export/history contract and credits ZZI software; EU-CN alignment does not create EU or India tariff treatment.',
    references: ['https://www.gov.me/en/documents/c9ad2bc2-dfc4-4107-9fea-585c792b81af', 'https://wapi.gov.me/download/c9ad2bc2-dfc4-4107-9fea-585c792b81af?version=1.0', 'https://www.gov.me/en/documents/7da4dc6c-49b9-4909-962e-e316c90a6000', 'https://taric.carina.co.me/TariCG/'],
    unblocked_by: 'Publish or locate the enacted Annex I and appendices as authenticated official bytes, or obtain official proof that the 727-page proposal annex is byte-for-byte or legally identical to the enacted annex; then qualify the complete current amendment chain and PDF layout.',
  },
  TT_CUSTOMS_CET: {
    jurisdiction: 'TT',
    country_codes: ['TT'],
    authority: 'Trinidad and Tobago Customs and Excise Division / Ministry of Finance — CET',
    reason: 'source_insufficient',
    determination: 'Copyright Act section 7(1)(b) excludes official texts and simple facts, clearing faithful use of the legal tariff material while leaving any original compilation arrangement separate. The Ministry of Trade publishes the complete First Schedule in Legal Notice 218/2024, effective 1 January 2025, and Gazette notices 494/495 of December 2025 vary or suspend treatment into 2026–27. The source gate remains incomplete because no authoritative index proved that those are every later national amendment/suspension through September 2026. CARICOM CET cannot fill that gap.',
    references: ['https://tradeind.gov.tt/wp-content/uploads/2025/04/Legal-Notice-No.-218-Customs-Common-External-Tariff-Order-2024.pdf', 'https://www.customs.gov.tt/importing/notices-to-importers', 'https://printery.gov.tt/', 'https://www.wipo.int/wipolex/en/legislation/details/6639'],
    unblocked_by: 'An exhaustive Gazette/Customs manifest proving every amendment and suspension after Legal Notice 218/2024 through the query date, followed by deterministic annex parsing and precedence tests.',
  },
  PH_TARIFF_COMMISSION: {
    jurisdiction: 'PH',
    country_codes: ['PH'],
    authority: 'Philippine Tariff Commission — Philippine Tariff Finder (MFN, AIFTA and other FTA schedules, AHTN 2022)',
    reason: 'no_documented_machine_interface',
    determination: 'The controlled manual AuthorityRelease preflight is implemented, but no current official MFN/AIFTA artifact is present in this environment and its actual tariff-file schema has therefore not been established. The Finder\'s public-domain footer is site-wide boilerplate, not a substitute for observing the actual release. The Finder publishes no documented API; its private browser API is intentionally not consumed. PH remains non-queryable so missing source bytes cannot become tariff evidence.',
    references: ['https://finder.tariffcommission.gov.ph/about', 'https://tariffcommission.gov.ph/', 'https://finder.tariffcommission.gov.ph/robots.txt'],
    unblocked_by: 'Manually acquire the current AHTN 2022 baseline, EO 62/current MFN overlays and annual AIFTA artifact through the official Commission UI; record their URLs and checksums in the supported composite, then implement and real-file-qualify the observed schemas before registering a PH query adapter.',
  },
  // KR_DATA_GO_KR is retained as history, not as a routing gap: KR now has a real adapter (see
  // providers/korea-service.ts) built from the same dataset's official XLSX release, imported as a
  // manual authoritative AuthorityRelease rather than through this API. This entry is unreachable
  // for routing (DESTINATION_ADAPTERS.KR is checked first) and documents only the API's own
  // remaining gap: the odcloud.kr REST API is still a credentialed, currently-unprovisioned route
  // that would let refreshes become automated rather than manually re-uploaded, once someone
  // registers for `KCS_DATA_GO_KR_SERVICE_KEY`.
  KR_DATA_GO_KR: {
    jurisdiction: 'KR',
    country_codes: ['KR'],
    authority: 'Korea Customs Service — 관세청_품목번호별 관세율표 (data.go.kr dataset 15051179)',
    reason: 'credential_not_provisioned',
    determination: 'Rights are cleared: the dataset\'s own data.go.kr catalogue metadata records "공공저작물 : 출처표시 (제1유형)" — KOGL Type 1, the fully permissive tier (commercial use and modification permitted, attribution only) — confirmed against this specific dataset, not inferred from the platform. A real, documented REST API exists at api.odcloud.kr for this dataset. It requires a registered service key (query parameter `serviceKey` or an `Authorization` header); an unauthenticated call returns "인증키는 필수 항목 입니다" (an authentication key is required). No key is configured in this environment. This is an operational gate, not a rights or interface gap — and it is no longer the only acquisition route: the same dataset\'s official XLSX download is imported manually as an AuthorityRelease, so KR is operational for MFN today without this credential (see korea-service.ts).',
    references: ['https://www.data.go.kr/data/15051179/fileData.do', 'https://www.data.go.kr/catalog/15051179/fileData.json'],
    unblocked_by: 'A ClearTrade operator registers for a free data.go.kr account, requests API access to dataset 15051179, and provisions the resulting service key as an environment variable the acquisition layer reads — upgrading refresh from manual re-upload to an automated pull.',
  },
  CN_MOF_CUSTOMS_TARIFF_2026: {
    jurisdiction: 'CN', country_codes: ['CN'],
    authority: 'People\'s Republic of China Ministry of Finance / General Administration of Customs — 2026 Customs Tariff',
    reason: 'individual_investigation_required',
    determination: 'The Ministry of Finance publishes deterministic 2026 tariff and adjustment-plan files and Customs publishes implementation mappings. The current executable result also depends on temporary rates, quotas, preferences and product/origin/producer-specific trade remedies that were not established as one exhaustive September 2026 machine manifest. No India concession is inferred.',
    references: ['https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/t20251231_3981044.htm', 'https://gss.mof.gov.cn/gzdt/zhengcefabu/202512/t20251229_3980625.htm'],
    unblocked_by: 'Qualify the complete 2026 table schema and an exhaustive, effective-dated quota, temporary-rate, preference and trade-remedy join through the query date.',
  },
  BN_RCED_BDTTC: {
    jurisdiction: 'BN', country_codes: ['BN'],
    authority: 'Brunei Royal Customs and Excise Department — Brunei Darussalam Tariff and Trade Classification',
    reason: 'individual_investigation_required',
    determination: 'RCED publishes the BDTTC 2022 and later duty orders and classification notices, but no complete consolidated machine release or exhaustive amendment index was established. Brunei\'s ad-valorem and specific duties and AIFTA treatment are national and cannot be inferred from AHTN.',
    references: ['https://www.customs.gov.bn/ref-rced/', 'https://www.customs.gov.bn/ref-rced-customs-taxes/'],
    unblocked_by: 'Acquire and prove a complete BDTTC baseline-plus-amendment manifest, including typed duty formulas, India concessions, rules of origin and every effective overlay.',
  },
  KH_GDCE_TARIFF: {
    jurisdiction: 'KH', country_codes: ['KH'],
    authority: 'Cambodia General Department of Customs and Excise — Customs Tariff 2022 and amending instruments',
    reason: 'source_insufficient',
    determination: 'The authority manual identifies Customs Tariff 2022 and multiple later decrees changing customs and special-tax rates, but no current consolidated national release or exhaustive machine amendment chain was found. AHTN and agreement schedules do not replace Cambodia\'s current MFN, special-tax, safeguard or AIFTA execution.',
    references: ['https://tools.customs.gov.kh/documents/reader/17709/17373560374410226/Manual%20on%20Customs%20Procedures%20in%20Cambodia%20%28English%29'],
    unblocked_by: 'A current consolidated national tariff or exhaustive official 2022-to-current amendment manifest containing all tariff-affecting layers and authoritative India treatment.',
  },
  LA_TRADE_PORTAL_TARIFF: {
    jurisdiction: 'LA', country_codes: ['LA'],
    authority: 'Lao PDR Ministry of Industry and Commerce — Lao Trade Portal commodity and tariff search',
    reason: 'no_documented_machine_interface',
    determination: 'The public 10-digit commodity pages expose current normal and agreement rates and measures, but no documented bulk export/API or immutable version-history contract was found. The portal expressly says AIFTA is under revision, so its absence cannot become no preference.',
    references: ['https://www.laotradeportal.gov.la/en-gb/site/listcommodity', 'https://www.laotradeportal.gov.la/en-gb/site/display/10'],
    unblocked_by: 'A supported full tariff export/API with release history, field semantics and a completed authoritative AIFTA schedule and rules-of-origin mapping.',
  },
  MN_CUSTOMS_TARIFF: {
    jurisdiction: 'MN', country_codes: ['MN'],
    authority: 'Mongolia General Customs Administration — import customs tariff',
    reason: 'no_documented_machine_interface',
    determination: 'Customs exposes ordinary, most-favoured and preferential tariff tables through its website, but no documented complete bulk/API, versioned release, checksum or historical replay interface was found. National excise and exemptions are separate and no India preference is established.',
    references: ['https://customs.gov.mn/%D0%B3%D0%B0%D0%B0%D0%BB%D0%B8%D0%B9%D0%BD-%D1%82%D0%B0%D1%80%D0%B8%D1%84/'],
    unblocked_by: 'A documented full tariff export/API with effective dates, complete amendment history, national overlays and authoritative India-origin treatment.',
  },
  LB_CUSTOMS_INTEGRATED_TARIFF: {
    jurisdiction: 'LB', country_codes: ['LB'],
    authority: 'Lebanese Customs — Integrated Customs Tariff',
    reason: 'no_documented_machine_interface',
    determination: 'The live chapter tables contain ad-valorem and specific/minimum duties, VAT, agreement codes and amendment links, but no supported bulk/API, immutable release or complete machine amendment manifest was found. Customs also states that displayed restrictions are incomplete; no India concession is established.',
    references: ['https://www.customs.gov.lb/tariff/tariff.aspx'],
    unblocked_by: 'A supported full tariff database export/API with field definitions, release history, all tariff-affecting instruments and authoritative origin treatment.',
  },
  EC_SENAE_NATIONAL_TARIFF: {
    jurisdiction: 'EC', country_codes: ['EC'],
    authority: 'Ecuador National Customs Service (SENAE) — National Tariff / ECUAPASS',
    reason: 'no_documented_machine_interface',
    determination: 'SENAE provides current interactive tariff and requirements consultations governed by COMEX Resolution 002-2023 and later reforms, but no complete documented anonymous export/API or immutable national release was established. NANDINA is nomenclature only; FODINFA, ICE, safeguards and later COMEX measures are national.',
    references: ['https://www.aduana.gob.ec/servicio-al-ciudadano/para-importar/', 'https://www.aduana.gob.ec/gaceta-boletin/entrada-en-vigor-resolucion-comex-nro-002-2023--arancel-del-ecuador/'],
    unblocked_by: 'A supported full SENAE tariff export/API reconciled to every effective COMEX amendment, national tax and trade-remedy layer.',
  },
  BO_ADUANA_TARIFF_2026: {
    jurisdiction: 'BO', country_codes: ['BO'],
    authority: 'Bolivia Aduana Nacional — Arancel Aduanero de Importaciones 2026',
    reason: 'individual_investigation_required',
    determination: 'The annual tariff and official circulars are available, but temporary tariff changes continue during 2026, including DS 5547 setting a soybean line to zero through 31 December. The source declares update frequency on request, and no exhaustive ordered amendment manifest has been qualified. NANDINA cannot substitute for national temporary treatment.',
    references: ['https://portal.aduana.gob.bo/aduana7/content/arancel-aduanero-de-importaciones', 'https://aduana.gob.bo/NOR_circulares', 'https://www.aduana.gob.bo/sites/default/files/archivos/CIRCULAR%20066%20D.S.%205547.pdf'],
    unblocked_by: 'Acquire the complete 2026 tariff and prove an exhaustive circular/Gazette amendment engine with operation, precedence, expiry and typed duty semantics.',
  },
  GT_SAT_INTEGRATED_TARIFF: {
    jurisdiction: 'GT', country_codes: ['GT'],
    authority: 'Guatemala Superintendence of Tax Administration — Integrated Permit/Tariff Catalog',
    reason: 'no_documented_machine_interface',
    determination: 'Re-gated on 27 September 2026. The tariff base cannot be acquired from the qualification environment. SIECA (www.sieca.int, which hosts the Arancel Centroamericano de Importación, version 6) answers HTTP 403 from its AWS load balancer for every path including robots.txt, which amounts to a site-level block. SAT\'s Arancel Integrado (portal.sat.gob.gt) serves a Cloudflare challenge. The MINECO DACE host does not connect, and MINECO\'s main site does not publish the tariff. Neither block was circumvented. National overlays (2026 preferential schedules, quota instruments) cannot substitute for a missing base. Per the wave\'s source map, not re-verified here because the base gate failed first, the galvanized-steel investigation DACE/ADP.01-2024 (China) closed on 1 October 2025 (Resolution 000627) without a finding of dumping, so it would create no duty.',
    references: ['https://www.sieca.int/producto/arancel-centroamericano-de-importacion/', 'https://portal.sat.gob.gt/portal/arancel-integrado/', 'https://www.mineco.gob.gt/'],
    unblocked_by: 'Unchallenged acquisition of the official SIECA ACI (or a complete SAT national tariff release), followed by the Guatemala national overlay chain (MINECO preferential schedules, quota instruments and any later instrument changing payable duty).',
  },
  SV_DGA_SAC_2026: {
    jurisdiction: 'SV', country_codes: ['SV'],
    authority: 'El Salvador Directorate General of Customs — SAC and 2026 national dispositions',
    reason: 'individual_investigation_required',
    determination: 'Re-gated on 27 September 2026. The only national tariff, DGA\'s SAC Electrónico (aduana2.mh.gob.sv/SAC), is an Angular application over undocumented backend calls, which are not used. The lawful fallback of rebuilding from SIECA\'s legal tariff plus national dispositions is closed, because www.sieca.int answers HTTP 403 site-wide from the qualification environment. DGA\'s site exposes no tariff document. Later 2026 dispositions (DGA-010, DGA-011 with Annex III, DGA-012) would also need review. The latex-paint anti-dumping measure is resolved: the final five-year review resolution of 11 May 2023 (ED-DATCO-2-ADP-2016, official scanned PDF on MINEC InfoTrade) extended the definitive duties from 12 May 2023 to 12 May 2028. They apply to standard-quality architectural latex paint from the United States (regardless of provenance) under SAC 3209.10.90.00 and 3209.90.10.00, declaring GDB INTERNATIONAL, INC. as exporter, with FOB below USD 5.12 per gallon: a complementary 376% ad valorem on the declared FOB value, applied on top of the MFN or FTA tariff, whatever the importer. Paint declared Premium below that FOB is also caught. No price undertaking. The separate fluid UHT milk case from Costa Rica (DATCO-3-ADP, definitive resolution of 17 May 2019) was not resolved.',
    references: ['https://aduana2.mh.gob.sv/SAC', 'https://www.sieca.int/producto/arancel-centroamericano-de-importacion/', 'https://infotrade.economia.gob.sv/examen-quinquenal-de-derechos-antidumping/', 'https://sitio.aduana.gob.sv/download/disposicion-administrativa-de-caracter-general-no-dga-002-2026/'],
    unblocked_by: 'A lawful complete tariff route: an official DGA tariff release, or unchallenged SIECA legal material plus a complete replay of the 2026 DGA dispositions (including DGA-010 to DGA-012), with quota balance, effective-date and expiry semantics.',
  },
  HN_CUSTOMS_SAC: {
    jurisdiction: 'HN', country_codes: ['HN'],
    authority: 'Honduras Customs Administration — national Sistema Arancelario Centroamericano execution',
    reason: 'no_documented_machine_interface',
    determination: 'The authority implements the regional SAC but no complete supported national tariff export/API or exhaustive current amendment index was found. SIECA Resolution 450 preserves unilateral member DAI changes, so regional rows cannot substitute for Honduras execution.',
    references: ['https://www.aduanas.gob.hn/', 'https://www.aduanas.gob.hn/wp-content/uploads/2022/10/ADUANAS-DNOA-010-2022.pdf', 'https://www.sieca.int/producto/arancel-centroamericano-de-importacion/'],
    unblocked_by: 'A documented national export/API, or an acquirable current SIECA base plus every Honduras tariff-affecting national overlay.',
  },
  NI_DGA_SAC: {
    jurisdiction: 'NI', country_codes: ['NI'],
    authority: 'Nicaragua Directorate General of Customs — national Sistema Arancelario Centroamericano execution',
    reason: 'no_documented_machine_interface',
    determination: 'No complete current supported bulk/API, immutable national release or exhaustive national amendment chain was established. The SIECA regional SAC is not proof of Nicaragua\'s executable rates, unilateral changes, taxes, quotas or trade remedies.',
    references: ['https://www.dga.gob.ni/', 'https://www.sieca.int/producto/arancel-centroamericano-de-importacion/'],
    unblocked_by: 'A complete documented Nicaragua tariff release/API with national overlays, effective dates, update history and authoritative origin treatment.',
  },
  BZ_CUSTOMS_TARIFF_2023: {
    jurisdiction: 'BZ', country_codes: ['BZ'],
    authority: 'Belize Customs and Excise — Tariff and Trade Classification',
    reason: 'source_insufficient',
    determination: 'Customs publishes a complete CARICOM-CET-based national schedule effective 1 January 2023, while live 2026 calculators expose RRD, excise and environmental-tax formulas. No consolidated 2026 tariff or exhaustive post-2023 Gazette change manifest was provided, so the older schedule is not current executable evidence.',
    references: ['https://customs.gov.bz/ttpg.html', 'https://www.customs.gov.bz/exchangeRates.php', 'https://www.customs.gov.bz/Customs_CommonGoods.php'],
    unblocked_by: 'A current consolidated national tariff or exhaustive post-2023 Gazette/amendment manifest including RRD, excise and every tariff-affecting override.',
  },
  GH_GRA_ICUMS_TARIFF: {
    jurisdiction: 'GH', country_codes: ['GH'],
    authority: 'Ghana Revenue Authority Customs Division — ICUMS / ECOWAS CET national tariff',
    reason: 'no_documented_machine_interface',
    determination: 'GRA publishes the five ECOWAS bands and a national levy list, but no commodity-level complete export/API, versioned release or update history was found. Regional band structure omits Ghana line assignments, exemptions, special levies and tariff remedies.',
    references: ['https://gra.gov.gh/customs/customs-tariffs-and-levies/', 'https://gra.gov.gh/customs/icums/'],
    unblocked_by: 'A supported ICUMS/GRA tariff export/API containing complete national line treatment, effective dates, overlays and historical versions.',
  },
  CI_CUSTOMS_ECOWAS_ENRICHED: {
    jurisdiction: 'CI', country_codes: ['CI'],
    authority: 'Côte d’Ivoire Directorate General of Customs — ECOWAS CET enriched with national duties and taxes',
    reason: 'source_insufficient',
    determination: 'Customs publishes a deterministic 566-page PDF containing 6,381 ten-digit lines and national tax/protection columns, updated 27 March 2026. No exhaustive reconciliation of tariff-affecting circulars from 28 March through 15 September 2026 was proved, so the otherwise strong PDF cannot be represented as current.',
    references: ['https://apps.douanes.ci/info/tec', 'https://www.douanes.ci/sites/default/files/tec/le_tec_cedeao_enrichi_des_principaux_droits_et_taxes_relevant_de_la_taxation_nationale_-_27-03-2026.pdf', 'https://apps.douanes.ci/info/textes-reglementaires?page=1'],
    unblocked_by: 'A current consolidated PDF or exhaustive post-27-March tariff-circular manifest, followed by qualification of every tax/measure column and precedence rule.',
  },
  SN_CUSTOMS_ECOWAS_TARIFF: {
    jurisdiction: 'SN', country_codes: ['SN'],
    authority: 'Senegal Directorate General of Customs — ECOWAS CET and national duties and taxes',
    reason: 'source_insufficient',
    determination: 'Official documents explain the ECOWAS bands and Senegal national VAT/community levies, but no September 2026 consolidated commodity-line release or exhaustive change history was found. Regional rows do not prove Senegal exemptions, safeguards or product-level national taxes.',
    references: ['https://www.douanes.sn/ndn71/', 'https://www.douanes.sn/ndn722/'],
    unblocked_by: 'A dated current national line schedule with every levy, exemption and tariff-affecting update, plus an immutable acquisition and replay contract.',
  },
  TZ_EAC_CET_NATIONAL: {
    jurisdiction: 'TZ', country_codes: ['TZ'],
    authority: 'Tanzania Revenue Authority / East African Community — CET national execution',
    reason: 'individual_investigation_required',
    determination: 'The EAC CET baseline is public and ministers adopted 2026/27 fiscal measures for implementation from 1 July 2026, but a complete current Tanzania replay was not established. Annual partner-state stays, remissions and sensitive-line measures prevent regional rates from being published as national execution.',
    references: ['https://www.eac.int/press-releases/142-customs/3544-eac-ministers-adopt-measures-to-strengthen-regional-trade-and-industrialization'],
    unblocked_by: 'Build and qualify a complete EAC Gazette baseline/amendment engine and every Tanzania-specific stay, remission, levy and expiry through the query date.',
  },
  UG_URA_EAC_CET: {
    jurisdiction: 'UG', country_codes: ['UG'],
    authority: 'Uganda Revenue Authority / East African Community — CET national execution',
    reason: 'individual_investigation_required',
    determination: 'URA publishes the EAC CET 2022 baseline, but current partner-state textile, manufacturing, remission and other measures require an ordered national/EAC Gazette replay. The regional baseline alone is not Uganda execution and no India preference is established.',
    references: ['https://ura.go.ug/en/download/common-external-tariff-2022-version/0/', 'https://ura.go.ug/en/international-trade-taxes/'],
    unblocked_by: 'Qualify the EAC amendment engine and an exhaustive Uganda 2026/27 national and partner-state overlay set with effectivity and expiry.',
  },
  RW_RRA_EAC_CET: {
    jurisdiction: 'RW', country_codes: ['RW'],
    authority: 'Rwanda Revenue Authority / East African Community — CET national execution',
    reason: 'individual_investigation_required',
    determination: 'RRA provides a strong dated EAC CET PDF and Gazette archive, but its visible current index stops at May 2026 although the 2026/27 measures were due from 1 July. Rwanda-specific stays and remissions also prevent blind cross-member reuse.',
    references: ['https://www.rra.gov.rw/fileadmin/user_upload/COMMON_EXTERNAL_TARIFF__Updated_June_2025.pdf', 'https://www.rra.gov.rw/en/customs-services/eac-gazette'],
    unblocked_by: 'Obtain the complete July-to-current 2026 Gazette set and prove ordered Rwanda-specific override, condition and expiry semantics.',
  },
  ZM_ZRA_TARIFF_2026: {
    jurisdiction: 'ZM', country_codes: ['ZM'],
    authority: 'Zambia Revenue Authority — Customs and Excise Tariff 2026',
    reason: 'individual_investigation_required',
    determination: 'ZRA publishes a stable January 2026 national tariff PDF, but later statutory instruments change executable rates. SI 65/2026, for example, conditionally suspended specified wheat duty from 1 to 30 September for named permit holders. A baseline-only parser would publish the wrong rate.',
    references: ['https://www.zra.org.zm/wp-content/uploads/2026/02/National-Tariff-Book-JANUARY-2026-1.pdf', 'https://www.zra.org.zm/suspension-of-import-duty-on-wheat/'],
    unblocked_by: 'Prove a complete 2026 statutory-instrument manifest and precedence engine, including conditional importers, temporary measures, typed formulas and expiries.',
  },
  BW_BURS_SACU_TARIFF: {
    jurisdiction: 'BW', country_codes: ['BW'],
    authority: 'Botswana Unified Revenue Service / SACU — Customs and Excise Tariff',
    reason: 'individual_investigation_required',
    determination: 'BURS publishes 2026 tariff volumes and Botswana applies the SACU/SARS tariff structure, but the complete cross-authority Schedule 1/2/3/4 amendment pack and Botswana national VAT, exemption, rebate and administrative overlay have not been qualified. SARS changes continue through September 2026.',
    references: ['https://www.burs.org.bw/index.php/customsexcisemain/customs-and-exercise-downloads', 'https://www.burs.org.bw/?Itemid=213&id=58&option=com_content&view=article', 'https://www.sars.gov.za/legal-counsel/secondary-legislation/tariff-amendments/tariff-amendments-2026/'],
    unblocked_by: 'Qualify the full current SARS multi-schedule amendment chain and a complete authoritative Botswana national overlay with reusable release artifacts.',
  },
  NA_NAMRA_SACU_TARIFF: {
    jurisdiction: 'NA', country_codes: ['NA'],
    authority: 'Namibia Revenue Agency / SACU — eTariff and Customs and Excise Tariff',
    reason: 'individual_investigation_required',
    determination: 'NamRA confirms SACU CET use through an eTariff portal whose presentation is supplied by Customs Connect, but no supported bulk/history contract or clean official-data/software-rights split was found. The complete current SARS schedules and Namibia VAT, exemptions, rebates and controls still require a national overlay.',
    references: ['https://www.namra.org.na/documents/cms/uploaded/namra-etariff-pocket-guide-11eaf6db86.pdf', 'https://www.sars.gov.za/legal-counsel/primary-legislation/schedules-to-the-customs-and-excise-act-1964/', 'https://www.sars.gov.za/legal-counsel/secondary-legislation/tariff-amendments/tariff-amendments-2026/'],
    unblocked_by: 'Obtain a supported NamRA national export or qualify the complete SARS schedules plus authoritative Namibia overlay, with the official-data and third-party-software rights split resolved.',
  },
  AE_DUBAI_CUSTOMS: {
    jurisdiction: 'AE',
    country_codes: ['AE'],
    authority: 'Dubai Customs / Dubai Pulse — Customs Agreements, Commodity and Tariff',
    reason: 'individual_investigation_required',
    determination: 'Dubai Customs publishes the GCC 12-digit Integrated Customs Tariff v4 and the Dubai Pulse tariff dataset gives a plausible open-data route. Activation still requires dataset-specific licence attachment, the complete UAE 2026 national amendment state, UAE–India CEPA concessions and rules of origin, and current GCC/national trade remedies including producer-specific ceramic duties. GCC structure is not UAE execution.',
    references: ['https://www.dubaicustoms.gov.ae/en/PoliciesAndNotices/Documents/IntegratedCustomsTariffv4.pdf', 'https://www.dubaipulse.gov.ae/data/dubai-customs-customs-agreements-commodity-and-tariff'],
    unblocked_by: 'Qualify a current national release under attached dataset terms and join UAE–India CEPA/RoO with every current GCC and national tariff-affecting remedy and amendment.',
  },
  BR_SISCOMEX: {
    jurisdiction: 'BR',
    country_codes: ['BR'],
    authority: 'Receita Federal / Portal Único de Comércio Exterior (Siscomex)',
    reason: 'credential_not_provisioned',
    determination: 'CAMEX publishes a consolidated XLSX of Annexes I–X, updated 8 September 2026, covering TEC and Brazilian national exception and temporary lists. Portal Único documents the TTCE batch API and daily chapter hashes, but real calls require an Authorization JWT and X-CSRF-Token that are not provisioned. The public nomenclature JSON contains codes rather than complete treatments. India-origin PTA treatment, quotas and trade remedies remain part of the required current join.',
    references: ['https://www.gov.br/mdic/pt-br/assuntos/camex/se-camex/strat/tarifas/vigentes', 'https://api-docs.portalunico.siscomex.gov.br/pages/exemplos/ttce/documentacao-adicional-api-consulta-lote/', 'https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json'],
    unblocked_by: 'Provision supported Portal Único TTCE credentials and qualify the full treatment/history contract, including remedies, quotas and India-origin treatment; or prove an equivalent complete public artifact manifest.',
  },
  WTO: {
    jurisdiction: 'WTO',
    country_codes: [],
    authority: 'World Trade Organization — Tariff & Trade data, ePing SPS/TBT, Quantitative Restrictions',
    reason: 'license_pending',
    determination:
      'The WTO offers a free developer API covering applied and preferential tariffs, plus ePing and QR APIs. Its terms place conditions on bulk download and onward re-dissemination, which is exactly what a customer-facing product does. No approval is recorded in this repository, so WTO is deliberately not a ClearTrade dependency and no WTO data is ingested. Legal uncertainty must not be shipped as a technical success.',
    references: ['https://apiportal.wto.org/'],
    unblocked_by: 'A recorded approval of WTO use rights for re-dissemination in a customer-facing product, after which WTO becomes a corroboration source rather than a primary one.',
  },
});

export function unconfiguredSourceForCountry(countryCode: string): UnconfiguredSource | null {
  const iso2 = countryCode.trim().toUpperCase();
  return Object.values(UNCONFIGURED_MARKET_ACCESS_SOURCES).find((source) => source.country_codes.includes(iso2)) ?? null;
}
