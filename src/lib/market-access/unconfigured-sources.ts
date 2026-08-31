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
  | 'license_pending';

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

export const UNCONFIGURED_MARKET_ACCESS_SOURCES: Readonly<Record<string, UnconfiguredSource>> = Object.freeze({
  EU_TARIC: {
    jurisdiction: 'EU',
    // Germany applies the EU common customs tariff; there is no German national tariff schedule.
    country_codes: ['DE', 'FR', 'NL', 'IT', 'ES', 'BE', 'PL', 'SE', 'DK', 'FI', 'IE', 'AT', 'PT', 'CZ', 'GR', 'HU', 'RO', 'SK', 'BG', 'HR', 'SI', 'LT', 'LV', 'EE', 'LU', 'CY', 'MT'],
    authority: 'European Commission — TARIC (Integrated Tariff of the European Union)',
    reason: 'bulk_distribution_only',
    determination:
      'The Commission publishes TARIC through an interactive consultation site and a free bulk raw-data distribution on CIRCABC. It documents no public REST interface for measure lookup. The interactive site is explicitly out of scope: driving it would mean depending on undocumented private endpoints that carry no stability or availability commitment.',
    references: [
      'https://taxation-customs.ec.europa.eu/customs/common-customs-tariff-cct/tariff-classification-goods/eu-customs-tariff-taric_en',
      'https://ec.europa.eu/taxation_customs/dds2/taric/taric_consultation.jsp',
    ],
    unblocked_by: 'Ingesting the CIRCABC TARIC bulk distribution as a versioned dataset snapshot, or obtaining access to a documented Commission measure API.',
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
