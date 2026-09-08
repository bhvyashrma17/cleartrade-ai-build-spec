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
