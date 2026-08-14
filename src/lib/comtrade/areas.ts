/**
 * Comtrade area codes → ISO-3166 alpha-2.
 *
 * `TradeFlow.reporter`/`partner` hold Comtrade's own numeric area codes, not ISO country
 * codes — the warehouse stores what the provider returns rather than an unverified
 * translation (see the model comment in prisma/schema.prisma). `MarketAssessment.country_code`
 * is ISO alpha-2, so the translation has to happen somewhere; it happens here, once,
 * explicitly, and only for codes verified against Comtrade's published area list.
 *
 * Comtrade's codes mostly equal the UN M49 / ISO-3166 numeric code, but NOT always — the
 * deviations below are real and are the reason this is a hand-maintained table rather than
 * a computed mapping:
 *
 *   India        699  (ISO numeric 356)
 *   USA          842  (ISO numeric 840)
 *   Switzerland  757  (ISO numeric 756)
 *   France       251  (ISO numeric 250)
 *   Italy        381  (ISO numeric 380)
 *   Norway       579  (ISO numeric 578)
 *
 * **A code absent from this table is not guessed.** `toIso2()` returns null, the scoring
 * engine drops that candidate and reports it in the run's `missing[]`, and the run is marked
 * partial. That is the docs/04 EXP-04-AC02 rule ("never fabricates a value missing from
 * engine output") applied to country identity: an unmappable reporter is a gap we declare,
 * not a country we invent. Extend the table when a new reporter genuinely needs to rank.
 */

/** Comtrade numeric area code → ISO-3166 alpha-2. */
const AREA_TO_ISO2: Record<string, string> = {
  '36': 'AU',
  '40': 'AT',
  '56': 'BE',
  '76': 'BR',
  '124': 'CA',
  '152': 'CL',
  '156': 'CN',
  '170': 'CO',
  '203': 'CZ',
  '208': 'DK',
  '246': 'FI',
  '251': 'FR',
  '276': 'DE',
  '300': 'GR',
  '344': 'HK',
  '360': 'ID',
  '372': 'IE',
  '376': 'IL',
  '381': 'IT',
  '392': 'JP',
  '410': 'KR',
  '458': 'MY',
  '484': 'MX',
  '528': 'NL',
  '554': 'NZ',
  '579': 'NO',
  '604': 'PE',
  '608': 'PH',
  '616': 'PL',
  '620': 'PT',
  '634': 'QA',
  '682': 'SA',
  '699': 'IN',
  '702': 'SG',
  '710': 'ZA',
  '724': 'ES',
  '752': 'SE',
  '757': 'CH',
  '764': 'TH',
  '784': 'AE',
  '792': 'TR',
  '818': 'EG',
  '826': 'GB',
  '842': 'US',
  '704': 'VN',
};

/** Comtrade's "World" aggregate partner — the denominator for share and total-demand maths. */
export const WORLD_PARTNER = '0';
/** Comtrade's reporter code for India. This platform's origin country. */
export const INDIA_REPORTER = '699';

/** ISO alpha-2 for a Comtrade area code, or null when we have no verified mapping. */
export function toIso2(areaCode: string): string | null {
  return AREA_TO_ISO2[areaCode] ?? null;
}

/** Display name lookup is deliberately absent — the UI renders country names from the ISO code. */
export function isMappableArea(areaCode: string): boolean {
  return areaCode in AREA_TO_ISO2;
}
