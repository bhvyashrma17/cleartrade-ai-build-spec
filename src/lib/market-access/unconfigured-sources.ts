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
  KR_DATA_GO_KR: {
    jurisdiction: 'KR',
    country_codes: ['KR'],
    authority: 'Korea Customs Service — 관세청_품목번호별 관세율표 (data.go.kr dataset 15051179)',
    reason: 'credential_not_provisioned',
    determination: 'Rights are cleared: the dataset\'s own data.go.kr catalogue metadata records "공공저작물 : 출처표시 (제1유형)" — KOGL Type 1, the fully permissive tier (commercial use and modification permitted, attribution only) — confirmed against this specific dataset, not inferred from the platform. A real, documented REST API exists at api.odcloud.kr for this dataset. It requires a registered service key (query parameter `serviceKey` or an `Authorization` header); an unauthenticated call returns "인증키는 필수 항목 입니다" (an authentication key is required). No key is configured in this environment. This is an operational gate, not a rights or interface gap.',
    references: ['https://www.data.go.kr/data/15051179/fileData.do', 'https://www.data.go.kr/catalog/15051179/fileData.json'],
    unblocked_by: 'A ClearTrade operator registers for a free data.go.kr account, requests API access to dataset 15051179, and provisions the resulting service key as an environment variable the acquisition layer reads.',
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
