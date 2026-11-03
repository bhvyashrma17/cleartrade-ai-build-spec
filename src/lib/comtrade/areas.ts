import { numericToAlpha2 } from 'i18n-iso-countries';

/**
 * Current supplier responses use UN M49 numeric identities. The dependency vendors the
 * complete ISO-3166 numeric table (the country/area entries in M49); regional and economic
 * aggregate M49 codes have no ISO identity and therefore remain deliberately unmappable.
 *
 * Comtrade also retains historical codes for several reporters. These are aliases, not
 * replacements for current M49 codes: current Italy code 380 resolves through M49 while
 * legacy code 381 remains supported separately.
 *
 * Source: UN Statistics Division, Standard country or area codes for statistical use (M49),
 * https://unstats.un.org/unsd/methodology/m49/overview/ (snapshot dependency 7.14.0).
 */
export const COMTRADE_LEGACY_AREA_TO_ISO2: Readonly<Record<string, string>> = {
  '251': 'FR',
  '381': 'IT',
  '579': 'NO',
  '699': 'IN',
  '757': 'CH',
  '842': 'US',
};

/** Comtrade's "World" aggregate partner — the denominator for share and total-demand maths. */
export const WORLD_PARTNER = '0';
/** Comtrade's historical reporter code for India. This platform's origin country. */
export const INDIA_REPORTER = '699';

function normalizedNumericCode(areaCode: string): string | null {
  if (!/^\d{1,3}$/.test(areaCode)) return null;
  return String(Number(areaCode));
}

/** ISO alpha-2 for a current M49 country/area or an explicit Comtrade legacy alias. */
export function toIso2(areaCode: string): string | null {
  const normalized = normalizedNumericCode(areaCode);
  if (normalized == null || normalized === WORLD_PARTNER) return null;
  return COMTRADE_LEGACY_AREA_TO_ISO2[normalized] ?? numericToAlpha2(normalized) ?? null;
}

/** True only when the provider identity resolves to an ISO country/area identity. */
export function isMappableArea(areaCode: string): boolean {
  return toIso2(areaCode) != null;
}
