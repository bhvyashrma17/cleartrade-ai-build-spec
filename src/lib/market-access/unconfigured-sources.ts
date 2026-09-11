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
  /**
   * Rights are cleared and a documented machine interface exists, but it requires a registered
   * service credential ClearTrade has not provisioned. Distinct from `license_pending`: nothing
   * here is legally uncertain, and distinct from `no_documented_machine_interface`: the interface
   * is real and documented. This is an operational gate, not a research one — provisioning the
   * credential is the entire remaining blocker.
   */
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
    reason: 'license_pending',
    determination: 'Prior Customs Atlas research recorded that commercial reuse of Tares requires written permission from BAZG. This pass looked for primary evidence that would overturn that and found none: BAZG publishes Tares free of charge for consultation, but no dataset-level statement granting commercial reuse, redistribution or derived SaaS display of the tariff data was located, and no machine-readable Tares dataset with attached reuse terms was found on the federal open-data portal. A prior restriction is not downgraded merely because the tariff remains publicly viewable.',
    references: ['https://www.bazg.admin.ch/en/customs-tariff-tares-services-companies', 'https://www.bazg.admin.ch/en/introduction-to-customs-tariff-tares'],
    unblocked_by: 'Written permission from BAZG covering commercial use, automated retrieval, caching and derived customer-facing display of Tares data, or publication of Tares as an openly licensed dataset.',
  },
  SG_CUSTOMS_STCCED: {
    jurisdiction: 'SG',
    country_codes: ['SG'],
    authority: 'Singapore Customs — Singapore Trade Classification, Customs and Excise Duties (STCCED)',
    reason: 'no_documented_machine_interface',
    determination: 'Unresolved at dataset level, and deliberately not upgraded. Singapore operates a strong general Open Data Licence, but that licence attaches to datasets published on data.gov.sg, and a search of the data.gov.sg dataset API for tariff content did not surface an STCCED or customs-duty dataset. The tariff itself is served through Singapore Customs\' interactive Tariff Finder, which publishes no documented bulk file or API. Consuming that interface would mean driving a private endpoint, which this project declines to do. The general portal licence therefore cannot be transferred onto a dataset that is not published under it.',
    references: ['https://www.customs.gov.sg/', 'https://data.gov.sg/'],
    unblocked_by: 'Publication of STCCED (or the customs duty schedule) as a documented dataset or API under the Singapore Open Data Licence, or an equivalent dataset-specific reuse statement from Singapore Customs.',
  },
  TH_CUSTOMS: {
    jurisdiction: 'TH',
    country_codes: ['TH'],
    authority: 'Thai Customs Department — integrated tariff / ASEAN Harmonised Tariff Nomenclature schedules',
    reason: 'no_documented_machine_interface',
    determination: 'Not established in this pass, and stopped rather than guessed. Thailand\'s national open-data portal (data.go.th) refused automated retrieval outright (HTTP 403) to a plainly identified client, so no dataset-level licence or machine interface for the customs tariff could be confirmed from primary evidence. Defeating that block would be circumventing an access control rather than acquiring an authorised source. No determination is claimed about Thailand\'s underlying reuse rights, which remain unresearched rather than refused.',
    references: ['https://data.go.th/', 'https://www.customs.go.th/'],
    unblocked_by: 'A reachable, documented Thai Customs tariff dataset or API with dataset-specific reuse terms, or an authorised access path to data.go.th.',
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
    references: ['https://www.gub.uy/ministerio-economia-finanzas/politicas-y-gestion/nomenclatura-aranceles-uruguay', 'https://www.gub.uy/ministerio-economia-finanzas/sites/ministerio-economia-finanzas/files/2025-05/Arancel%20Nacional_Febrero%202025%20-final.xlsx'],
    unblocked_by: 'MEF confirmation that the national open-data licence covers the exact current workbook for commercial derivatives, immutable retention and customer display, plus a 2026 release or complete amendment manifest and the operative national India-PTA instruments.',
  },
  NG_NCS_CET: {
    jurisdiction: 'NG',
    country_codes: ['NG'],
    authority: 'Nigeria Customs Service — Nigeria Customs Tariff / ECOWAS CET',
    reason: 'source_insufficient',
    determination: 'Nigeria Copyright Act 2022 sections 2(5) and 3 exclude mere data and official legislative or administrative texts from protection, so the legal tariff facts and official instruments are reusable with provenance; any original selection/arrangement or site software remains excluded. The source gate still fails because NCS did not yield an authoritative populated full-tariff release carrying Nigeria\'s national levies, prohibitions, derogations and amendment dates. The regional ECOWAS base cannot stand in for national execution.',
    references: ['https://customs.gov.ng/cet-tariff', 'https://cet.customs.gov.ng/', 'https://api.customs.gov.ng/api/pages/cet-tariff'],
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
  NP_CUSTOMS_INTEGRATED_TARIFF: {
    jurisdiction: 'NP',
    country_codes: ['NP'],
    authority: 'Nepal Department of Customs — Integrated Customs Tariff',
    reason: 'license_pending',
    determination: 'The Department of Customs publishes a current, large integrated tariff PDF, but no applicable reuse terms were found for translation, normalization, immutable historical storage or commercial customer display. The schedule contains customs duty alongside other taxes and concessions, while India–Nepal or SAFTA treatment still requires an exact national beneficiary instrument and origin proof. Public download does not resolve those rights or preference semantics.',
    references: ['https://customs.gov.np/content/46/integrated-tariff-rate/', 'https://customs.gov.np/content/50/custom-tariff-rate/'],
    unblocked_by: 'Department of Customs or Ministry of Finance permission for commercial transformation, translation, retention and derived display, plus the current tariff artifact and authoritative India-origin rate and rules-of-origin instruments.',
  },
  AL_CUSTOMS_2026_NOMENCLATURE: {
    jurisdiction: 'AL',
    country_codes: ['AL'],
    authority: 'Albanian Customs — Combined Nomenclature of Goods 2026',
    reason: 'individual_investigation_required',
    determination: 'Rights are cleared for the controlling material: Albania Law 35/2016 Art. 12(1)(b),(dh) excludes official creations/collections that inform the public and simple data or facts. Customs publishes the official 2026 national nomenclature PDF, enacted by VKM 789 of 24 December 2025 and effective 1 January 2026, and the published preference-programme list excludes India. Activation remains withheld because the 961-page annex, rate-note hierarchy, quota/suspension overlays and amendment state have not yet been converted into a deterministic fail-closed parser. EU-CN alignment remains classification alignment only.',
    references: ['https://dogana.gov.al/dokument/6715/nomenklatura-2026', 'https://www.kryeministria.al/newsroom/vendime-te-miratuara-ne-mbledhjen-e-keshillit-te-ministrave-date-24-dhjetor-2025/', 'https://www.wipo.int/wipolex/en/text/410069', 'https://dogana.gov.al/d/169/182/249/266/tarifat-preferenciale-dhe-kuotat-tarifore'],
    unblocked_by: 'A reviewed deterministic parser for the complete VKM 789 annex and its 2026 amendment, quota and suspension chain, with row-count controls and exact rate-note precedence proven on the real PDF.',
  },
  CR_COMEX_NATIONAL_TARIFF: {
    jurisdiction: 'CR',
    country_codes: ['CR'],
    authority: 'Costa Rica Ministry of Foreign Trade — National Customs Tariff',
    reason: 'source_insufficient',
    determination: 'COMEX publishes a rich national XLSX, but the identified edition is dated 11 May 2022 and no authoritative current release or complete change manifest was found. The workbook also has no attached commercial reuse grant. A four-year-old SAC-based table cannot execute September 2026 treatment, and its many agreement columns cannot be projected forward or used to infer India eligibility.',
    references: ['https://portaldecomercio.comex.go.cr/enlaces/derechos-y-cargas/derechos-y-cargas-aduaneros/', 'https://portaldecomercio.comex.go.cr/media/ar1iswz4/arancel-actualizado-11-mayo-2022.xlsx'],
    unblocked_by: 'A current COMEX national workbook or authoritative change manifest, with file-specific commercial reuse terms and a current field/programme dictionary tied to Costa Rica\'s national SAC execution.',
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
    determination: 'JCA publishes a current Integrated Tariff effective 1 May 2026. Jamaica Copyright Act section 13B places Acts and subsidiary legislation under Crown copyright and the identified automatic reproduction exception is non-commercial, so commercial normalization and retained paid display remain unlicensed. CARICOM treatment, national taxes, suspensions and derogations must remain distinct, and the agreement material does not establish an India preference.',
    references: ['https://jca.gov.jm/e-services/integrated-tariff-search/', 'https://jca.gov.jm/business/trade-agreements/'],
    unblocked_by: 'Written JCA permission for periodic acquisition, normalization, immutable historical retention and paid derived/customer display, with required attribution and third-party/CARICOM/WCO exclusions documented.',
  },
  PA_ANA_INTERACTIVE_TARIFF: {
    jurisdiction: 'PA',
    country_codes: ['PA'],
    authority: 'Panama National Customs Authority — Interactive National Tariff',
    reason: 'source_insufficient',
    determination: 'Panama Law 64/2012 Art. 13 excludes official legislative and administrative texts when faithfully reproduced with source attribution, clearing the legal instruments themselves. The 12-digit interactive tariff has no supported bulk/history contract, and the June 2026 Gazette contains Cabinet Decrees 7 and 8 changing tariff treatment and a rice quota. A 2025 compilation therefore cannot reproduce the September 2026 state and undocumented browser endpoints are not an acceptable substitute.',
    references: ['https://aranceles.ana.gob.pa/', 'https://aranceles-api.ana.gob.pa/', 'https://aranceles.ana.gob.pa/assets/documentos_aduanas/manual/Manual%20Herramienta%20Arancel%20Interactivo_Dic2020_V1.pdf'],
    unblocked_by: 'A supported complete export or reproducible official baseline-plus-Gazette pipeline with field dictionary and every effective amendment through the query date, preserving faithful text and source attribution.',
  },
  TN_CUSTOMS_TARIFWEB: {
    jurisdiction: 'TN',
    country_codes: ['TN'],
    authority: 'Tunisian Customs — Tarif Web 2026',
    reason: 'source_insufficient',
    determination: 'Tunisia Law 94-36, as amended, Art. 1 excludes official texts from copyright. Tarifweb2026 nevertheless self-identifies its underlying update as 17 June 2025 and the sixth nomenclature while Finance Law 2026 changes rates through 2028. No supported bulk/history contract or reconciled 2026 amendment state was established. National 10-character classification, conventional/autonomous duties and separate tax or regulatory measures cannot safely be reconstructed from the label alone.',
    references: ['https://www.douane.gov.tn/tarifweb2026/', 'https://www.douane.gov.tn/consultation-tarifweb/', 'https://www.douane.gov.tn/tarif-douanier/'],
    unblocked_by: 'A supported complete extraction or official baseline-plus-amendment chain that reconciles Tarifweb\'s stated 2025 update with Finance Law 2026, including field/code definitions and rate precedence.',
  },
  DO_DGA_CUSTOMS_TARIFF: {
    jurisdiction: 'DO',
    country_codes: ['DO'],
    authority: 'Dominican Republic Directorate General of Customs — National Customs Tariff',
    reason: 'source_insufficient',
    determination: 'Dominican Law 65-00 Art. 41 permits faithful, sourced reproduction of official texts unless expressly prohibited, so the legal tariff instruments are reusable on those conditions. DGA identifies the Seventh Amendment 2022 tariff through an embedded publication, but a complete current executable artifact and every subsequent amendment were not reliably acquired. A landing page or flipbook identifier is not a reproducible national release, and no India preference evidence was established.',
    references: ['https://www.aduanas.gob.do/de-interes/consultas/', 'https://www.aduanas.gob.do/consultas/arancel-de-aduanas-7ma-enmienda-2022/', 'https://www.aduanas.gob.do/media/rupaj0fj/aviso-entrada-en-vigor-enmienda.pdf'],
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
    determination: 'DIAN\'s normative tariff index is current through 31 August 2026 and exposes the decree/amendment path, but no complete anonymous national export or reproducible documented payload with a field dictionary was established. An index and a user manual prove authority and current instruments; they do not provide executable rows or demonstrate that every national exception and effective date was applied. NANDINA cannot substitute for Colombia\'s national execution or India eligibility.',
    references: ['https://www.dian.gov.co/aduanas/Paginas/Inicio.aspx', 'https://www.dian.gov.co/atencionciudadano/LMDP/Cumplimiento-Obligaciones-Aduaneras-y-Cambiarias/Operacion-Aduanera/Manuales/MN-COA-0021.pdf'],
    unblocked_by: 'A complete current DIAN tariff export or documented public API payload with field dictionary, reconciled to the current normative index, plus the controlling reuse/official-text basis and any operative India-origin preference instrument.',
  },
  MK_CUSTOMS_2026_TARIFF: {
    jurisdiction: 'MK',
    country_codes: ['MK'],
    authority: 'North Macedonia Customs Administration — Customs Tariff 2026',
    reason: 'individual_investigation_required',
    determination: 'North Macedonia copyright law Art. 16 excludes official legal and administrative texts and simple facts. Customs identifies Official Gazette 261/25 as the 2026 national tariff decision, but the authority download route presents an expired TLS certificate and the complete annex/amendment chain has not yet passed deterministic real-file qualification. EU-CN alignment is nomenclature alignment only. Specific or compound duties, quotas and dates cannot be normalized until that controlled acquisition/parser path is proven.',
    references: ['https://customs.gov.mk/carinska-tarifa.nspx', 'https://customs.gov.mk/content/documents/zakon_za_carinska_tarifa.pdf'],
    unblocked_by: 'A stable authenticated acquisition of the complete Gazette 261/25 annex and every current amendment, followed by real-file schema, row-count and rate-semantic qualification.',
  },
  ME_CUSTOMS_TARICG: {
    jurisdiction: 'ME',
    country_codes: ['ME'],
    authority: 'Montenegro Revenue and Customs Administration — TARICG',
    reason: 'individual_investigation_required',
    determination: 'Montenegro publishes an official 2026 national tariff decree in addition to TARICG, so the interactive application is not the sole legal route. The complete decree annex and later measures have not yet been acquired and qualified as an executable chain, while TARICG exposes no supported export/API or history mechanism and credits ZZI software. Ownership of the software presentation and reuse of any extracted database structure remain unresolved; EU-CN alignment does not create EU or India tariff treatment.',
    references: ['https://taric.carina.co.me/TariCG/', 'https://www.gov.me/dokumenta'],
    unblocked_by: 'Acquire and qualify the complete official 2026 decree annex and every later measure, or obtain a supported TARICG export with dictionary/history and terms separating official tariff facts from ZZI software.',
  },
  TT_CUSTOMS_CET: {
    jurisdiction: 'TT',
    country_codes: ['TT'],
    authority: 'Trinidad and Tobago Customs and Excise Division / Ministry of Finance — CET',
    reason: 'source_insufficient',
    determination: 'Copyright Act section 7(1)(b) excludes official texts and simple facts, clearing faithful use of the legal tariff material while leaving any original compilation arrangement separate. The Ministry of Trade publishes the complete First Schedule in Legal Notice 218/2024, effective 1 January 2025, and Gazette notices 494/495 of December 2025 vary or suspend treatment into 2026–27. The source gate remains incomplete because no authoritative index proved that those are every later national amendment/suspension through September 2026. CARICOM CET cannot fill that gap.',
    references: ['https://tradeind.gov.tt/wp-content/uploads/2025/04/Legal-Notice-No.-218-Customs-Common-External-Tariff-Order-2024.pdf', 'https://www.customs.gov.tt/importing/notices-to-importers', 'https://printery.gov.tt/'],
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
  AE_DUBAI_CUSTOMS: {
    jurisdiction: 'AE',
    country_codes: ['AE'],
    authority: 'Dubai Customs / Dubai Pulse — Customs Agreements, Commodity and Tariff',
    reason: 'license_pending',
    determination: 'The UAE Federal Open Data License is commercially permissive at platform level, but the committed registry did not verify that the specific customs-tariff dataset carries that licence. Platform openness is not dataset permission.',
    references: ['https://www.dubaipulse.gov.ae/data/dubai-customs-customs-agreements-commodity-and-tariff'],
    unblocked_by: 'Dataset-specific licence confirmation for automated retrieval, raw retention and customer display.',
  },
  BR_SISCOMEX: {
    jurisdiction: 'BR',
    country_codes: ['BR'],
    authority: 'Receita Federal / Portal Único de Comércio Exterior (Siscomex)',
    reason: 'license_pending',
    determination: 'The committed registry did not confirm the Portal Único tariff API scope, authentication model or reuse rights. Brazil also requires authoritative LETEC/national-exception semantics; a TEC-only implementation would be unsafe.',
    references: ['https://www.gov.br/siscomex/'],
    unblocked_by: 'Confirmed API contract and reuse rights plus an authority-backed national override/LETEC source.',
  },
  SA_ZATCA: {
    jurisdiction: 'SA',
    country_codes: ['SA'],
    authority: 'Zakat, Tax and Customs Authority (ZATCA) — Saudi Integrated Customs Tariff',
    reason: 'no_documented_machine_interface',
    determination:
      'ZATCA publishes the GCC 12-digit Integrated Customs Tariff through a public inquiry page. No public API contract is documented for it. The page is driven by private browser endpoints, which are out of scope: they are undocumented, unversioned and not offered for programmatic use.',
    references: ['https://zatca.gov.sa/'],
    unblocked_by: 'A documented ZATCA tariff API, or continued use of the authoritative-manual path with a named reviewer.',
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
