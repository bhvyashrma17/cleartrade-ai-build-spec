/**
 * UK postcode area → ITL1 region (D-033, docs/38 §2). Used to place HMRC importers in a region.
 *
 * A postcode area (the letters before the first digit, e.g. "M" in "M1 1AE") is assigned to the
 * region that holds most of it; a few areas cross a boundary (EN, KT, TW, DA, HP, PE, SY, TD), so a
 * region count is approximate and the market page says so. GY, JE and IM are Crown Dependencies,
 * outside the UK's regions.
 */

export const UK_REGIONS: Record<string, string> = {
  TLC: 'North East',
  TLD: 'North West',
  TLE: 'Yorkshire and The Humber',
  TLF: 'East Midlands',
  TLG: 'West Midlands',
  TLH: 'East of England',
  TLI: 'London',
  TLJ: 'South East',
  TLK: 'South West',
  TLL: 'Wales',
  TLM: 'Scotland',
  TLN: 'Northern Ireland',
  CD: 'Channel Islands and Isle of Man',
};

const AREAS: Record<string, string[]> = {
  TLC: ['DH', 'DL', 'NE', 'SR', 'TS'],
  TLD: ['BB', 'BL', 'CA', 'CH', 'CW', 'FY', 'L', 'LA', 'M', 'OL', 'PR', 'SK', 'WA', 'WN'],
  TLE: ['BD', 'DN', 'HD', 'HG', 'HU', 'HX', 'LS', 'S', 'WF', 'YO'],
  TLF: ['DE', 'LE', 'LN', 'NG', 'NN'],
  TLG: ['B', 'CV', 'DY', 'HR', 'ST', 'SY', 'TF', 'WR', 'WS', 'WV'],
  TLH: ['AL', 'CB', 'CM', 'CO', 'IP', 'LU', 'NR', 'PE', 'SG', 'SS', 'WD'],
  TLI: ['BR', 'CR', 'E', 'EC', 'EN', 'HA', 'IG', 'N', 'NW', 'RM', 'SE', 'SM', 'SW', 'TW', 'UB', 'W', 'WC'],
  TLJ: ['BN', 'CT', 'DA', 'GU', 'HP', 'KT', 'ME', 'MK', 'OX', 'PO', 'RG', 'RH', 'SL', 'SO', 'TN'],
  TLK: ['BA', 'BH', 'BS', 'DT', 'EX', 'GL', 'PL', 'SN', 'SP', 'TA', 'TQ', 'TR'],
  TLL: ['CF', 'LD', 'LL', 'NP', 'SA'],
  TLM: ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'],
  TLN: ['BT'],
  CD: ['GY', 'IM', 'JE'],
};

export const UK_POSTCODE_AREA_REGION: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(AREAS).flatMap(([region, areas]) => areas.map((area) => [area, region])),
);

/** "M1 1AE" → "M"; "SW1V 2QQ" → "SW"; anything unrecognisable → null. */
export function postcodeArea(postcode: string | null | undefined): string | null {
  const match = /^([A-Z]{1,2})\d/.exec((postcode ?? '').trim().toUpperCase());
  return match ? match[1]! : null;
}

export function ukRegionFor(postcode: string | null | undefined): { code: string; name: string } | null {
  const area = postcodeArea(postcode);
  const code = area ? UK_POSTCODE_AREA_REGION[area] : undefined;
  return code ? { code, name: UK_REGIONS[code]! } : null;
}
