/**
 * D-033 (docs/38): US regional demand from the Census Bureau's international trade API.
 *
 * Two monthly datasets say where in the US a product arrives: imports by destination state
 * (`intltrade/imports/statehs`) and by port (`intltrade/imports/porths`), each per HS6 and per
 * origin country, with the total value and the containerised-vessel, vessel and air values and
 * shipping weights. For one HS6 we ask each dataset twice — India (Census country code 5330) and all
 * countries ("-") — from 15 months back, and keep the 12 newest calendar months.
 *
 * The API needs a key (`CENSUS_API_KEY`). It travels only as a query parameter of the request and is
 * never stored, logged or put in an error message. Census's terms ask every product that uses the
 * API to carry `CENSUS_ATTRIBUTION`.
 */

export const CENSUS_API_BASE = 'https://api.census.gov/data/timeseries/intltrade/imports';
export const CENSUS_INDIA_CODE = '5330';
export const CENSUS_ALL_COUNTRIES = '-';
export const CENSUS_ATTRIBUTION = 'This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.';
export const US_REGIONAL_SOURCE = {
  key: 'us_census_intltrade',
  label: 'U.S. Census Bureau, monthly imports by state and by port',
  url: 'https://www.census.gov/foreign-trade/data/',
} as const;

export type CensusDataset = 'statehs' | 'porths';
const VALUE_FIELDS = ['GEN_VAL_MO', 'CNT_VAL_MO', 'CNT_WGT_MO', 'VES_VAL_MO', 'VES_WGT_MO', 'AIR_VAL_MO', 'AIR_WGT_MO'] as const;
type ValueField = (typeof VALUE_FIELDS)[number];

export interface CensusRow {
  area: string;
  area_name: string | null;
  month: string;
  values: Record<ValueField, number>;
}

/** The key is missing, invalid or not yet activated: nothing can be read until it is fixed. */
export class CensusKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CensusKeyError';
  }
}

export const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico',
  NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', PR: 'Puerto Rico', VI: 'U.S. Virgin Islands', GU: 'Guam', AS: 'American Samoa',
  MP: 'Northern Mariana Islands', XX: 'State not identified',
};

/** "NEW YORK, NY" → "New York, NY": words title-cased, a trailing two-letter state code kept as it is. */
const titleCase = (value: string) => {
  const words = value.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase()).replace(/\bOf\b/g, 'of').replace(/\bAnd\b/g, 'and');
  return words.replace(/, ([A-Za-z]{2})$/, (_, code: string) => `, ${code.toUpperCase()}`);
};

/** First month to ask for: the month 15 months before `now`, so 12 full months are present after the publication lag. */
export function censusFromMonth(now: Date): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 15, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The request URL. `key` is added last so `withoutKey` can show the same URL safely. */
export function censusQueryUrl(args: { dataset: CensusDataset; hs6: string; country: string; from: string; key: string | null }): string {
  if (!/^\d{6}$/.test(args.hs6)) throw new Error(`Census queries take a six-digit HS code, not ${args.hs6}.`);
  const area = args.dataset === 'statehs' ? ['STATE'] : ['PORT', 'PORT_NAME'];
  const params = new URLSearchParams({
    get: [...area, ...VALUE_FIELDS, 'YEAR', 'MONTH'].join(','),
    I_COMMODITY: args.hs6,
    CTY_CODE: args.country,
    time: `from ${args.from}`,
  });
  if (args.key) params.set('key', args.key);
  return `${CENSUS_API_BASE}/${args.dataset}?${params.toString()}`;
}

/** The same URL without its key, for provenance and messages. */
export function withoutKey(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('key');
  return parsed.toString();
}

/** Census answers a JSON array of rows whose first row names the columns; values are strings. */
export function parseCensusRows(body: unknown, dataset: CensusDataset): CensusRow[] {
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[0])) return [];
  const header = (body[0] as unknown[]).map((cell) => String(cell));
  const at = (name: string) => header.indexOf(name);
  const areaAt = at(dataset === 'statehs' ? 'STATE' : 'PORT');
  const nameAt = dataset === 'porths' ? at('PORT_NAME') : -1;
  const yearAt = at('YEAR');
  const monthAt = at('MONTH');
  const timeAt = at('time');
  if (areaAt < 0) throw new Error(`The Census ${dataset} answer has no ${dataset === 'statehs' ? 'STATE' : 'PORT'} column.`);
  const rows: CensusRow[] = [];
  for (const raw of body.slice(1)) {
    if (!Array.isArray(raw)) continue;
    const cell = (index: number) => (index >= 0 && raw[index] != null ? String(raw[index]).trim() : '');
    const month = yearAt >= 0 && monthAt >= 0 && cell(yearAt) && cell(monthAt)
      ? `${cell(yearAt)}-${cell(monthAt).padStart(2, '0')}`
      : cell(timeAt).slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const area = cell(areaAt);
    if (!area) continue;
    const values = Object.fromEntries(VALUE_FIELDS.map((field) => {
      const value = Number(cell(at(field)));
      return [field, Number.isFinite(value) && value > 0 ? value : 0];
    })) as Record<ValueField, number>;
    const portName = nameAt >= 0 ? cell(nameAt) : '';
    rows.push({ area, area_name: dataset === 'statehs' ? US_STATE_NAMES[area] ?? area : portName ? titleCase(portName) : null, month, values });
  }
  return rows;
}

export type CensusFetch = (url: string) => Promise<{ status: number; text(): Promise<string> }>;

/** One dataset for one origin. HTTP 204 (no rows) is an empty answer, not an error. */
export async function fetchCensusRows(args: { dataset: CensusDataset; hs6: string; country: string; from: string; key: string; fetchImpl: CensusFetch }): Promise<CensusRow[]> {
  const url = censusQueryUrl({ ...args });
  let response: Awaited<ReturnType<CensusFetch>>;
  try {
    response = await args.fetchImpl(url);
  } catch (error) {
    throw new Error(`The Census Bureau could not be reached for ${args.dataset} (${error instanceof Error ? error.message : String(error)}).`);
  }
  if (response.status === 204) return [];
  const text = await response.text();
  const isJsonArray = text.trimStart().startsWith('[');
  if (response.status !== 200 || !isJsonArray) {
    // A refused key comes back as an HTML or plain-text page, sometimes with HTTP 200.
    if (/key/i.test(text) && /(invalid|missing|valid key|not activated|inactive)/i.test(text)) {
      throw new CensusKeyError('The Census Bureau refused the API key (missing, invalid or not yet activated). Check CENSUS_API_KEY.');
    }
    throw new Error(`The Census Bureau answered HTTP ${response.status} for ${args.dataset}: ${text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)}`);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`The Census Bureau's ${args.dataset} answer was not JSON: ${text.replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  return parseCensusRows(body, args.dataset);
}

/** The 12 calendar months ending at the newest month present, oldest first. Empty when nothing is present. */
export function windowMonths(rows: CensusRow[], months = 12): string[] {
  const newest = rows.reduce<string | null>((latest, row) => (latest === null || row.month > latest ? row.month : latest), null);
  if (!newest) return [];
  const [year, month] = newest.split('-').map(Number) as [number, number];
  return Array.from({ length: months }, (_, index) => {
    const date = new Date(Date.UTC(year, month - 1 - (months - 1 - index), 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

export interface RegionalArea {
  code: string;
  name: string;
  india_value_usd: number;
  /** All origins; null when the all-countries figures could not be read. */
  world_value_usd: number | null;
  india_share_percent: number | null;
  /** India's shipments in containers on vessels: value and shipping weight. */
  container_value_usd: number;
  container_weight_kg: number;
  air_value_usd: number;
  /** Months of the 12 in which India shipped anything here. */
  india_months: number;
}

export interface RegionalView {
  kind: 'state' | 'port';
  title: string;
  areas: RegionalArea[];
  /** Everything after the top areas, summed, so the table still adds up. */
  others: { count: number; india_value_usd: number; world_value_usd: number | null } | null;
}

export interface RegionalDemandResultV1 {
  version: 1;
  country_code: string;
  hs6: string;
  source: { key: string; label: string; url: string; attribution: string; retrieved_at: string; requests: string[] };
  period: { from: string; to: string; months: number; label: string };
  totals: { india_value_usd: number; world_value_usd: number | null; india_share_percent: number | null; container_share_percent: number | null; air_share_percent: number | null };
  views: RegionalView[];
  notes: string[];
}

const round2 = (value: number) => Math.round(value * 100) / 100;
const share = (part: number, whole: number | null) => (whole && whole > 0 ? round2((part / whole) * 100) : null);
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

function aggregate(india: CensusRow[], world: CensusRow[] | null, window: Set<string>): RegionalArea[] {
  const byArea = new Map<string, RegionalArea & { months: Set<string> }>();
  const entry = (row: CensusRow) => {
    let found = byArea.get(row.area);
    if (!found) {
      found = { code: row.area, name: row.area_name ?? row.area, india_value_usd: 0, world_value_usd: world ? 0 : null, india_share_percent: null, container_value_usd: 0, container_weight_kg: 0, air_value_usd: 0, india_months: 0, months: new Set() };
      byArea.set(row.area, found);
    }
    if (row.area_name && found.name === found.code) found.name = row.area_name;
    return found;
  };
  for (const row of india) {
    if (!window.has(row.month) || row.area === '-') continue;
    const area = entry(row);
    area.india_value_usd += row.values.GEN_VAL_MO;
    area.container_value_usd += row.values.CNT_VAL_MO;
    area.container_weight_kg += row.values.CNT_WGT_MO;
    area.air_value_usd += row.values.AIR_VAL_MO;
    if (row.values.GEN_VAL_MO > 0) area.months.add(row.month);
  }
  for (const row of world ?? []) {
    if (!window.has(row.month) || row.area === '-') continue;
    const area = entry(row);
    area.world_value_usd = (area.world_value_usd ?? 0) + row.values.GEN_VAL_MO;
  }
  return [...byArea.values()].map(({ months, ...area }) => ({
    ...area,
    india_value_usd: round2(area.india_value_usd),
    world_value_usd: area.world_value_usd === null ? null : round2(area.world_value_usd),
    india_share_percent: share(area.india_value_usd, area.world_value_usd),
    container_value_usd: round2(area.container_value_usd),
    container_weight_kg: Math.round(area.container_weight_kg),
    air_value_usd: round2(area.air_value_usd),
    india_months: months.size,
  }));
}

function view(kind: RegionalView['kind'], title: string, areas: RegionalArea[], top: number): RegionalView {
  const sorted = areas
    .filter((area) => area.india_value_usd > 0 || (area.world_value_usd ?? 0) > 0)
    .sort((a, b) => b.india_value_usd - a.india_value_usd || (b.world_value_usd ?? 0) - (a.world_value_usd ?? 0) || a.code.localeCompare(b.code));
  const rest = sorted.slice(top);
  const worldKnown = sorted.every((area) => area.world_value_usd !== null);
  return {
    kind, title, areas: sorted.slice(0, top),
    others: rest.length ? { count: rest.length, india_value_usd: round2(rest.reduce((sum, area) => sum + area.india_value_usd, 0)), world_value_usd: worldKnown ? round2(rest.reduce((sum, area) => sum + (area.world_value_usd ?? 0), 0)) : null } : null,
  };
}

/** States and ports for one HS6 from the four Census answers. `world` is null where the all-countries request failed. */
export function buildUsRegionalResult(args: {
  hs6: string;
  india: { state: CensusRow[]; port: CensusRow[] };
  world: { state: CensusRow[] | null; port: CensusRow[] | null };
  retrieved_at: Date;
  requests: string[];
  top?: number;
}): RegionalDemandResultV1 | null {
  const top = args.top ?? 15;
  const months = windowMonths([...args.india.state, ...args.india.port, ...(args.world.state ?? []), ...(args.world.port ?? [])]);
  if (months.length === 0) return null;
  const window = new Set(months);
  const states = aggregate(args.india.state, args.world.state, window);
  const ports = aggregate(args.india.port, args.world.port, window);
  const indiaTotal = states.reduce((sum, area) => sum + area.india_value_usd, 0);
  const worldTotal = args.world.state ? states.reduce((sum, area) => sum + (area.world_value_usd ?? 0), 0) : null;
  const containerTotal = states.reduce((sum, area) => sum + area.container_value_usd, 0);
  const airTotal = states.reduce((sum, area) => sum + area.air_value_usd, 0);
  const notes = [
    'States are the destination state recorded on the import entry; ports are where the goods entered the United States.',
    'Values are customs values in US dollars (general imports). Container figures are shipments in containers by vessel; weights are shipping weights.',
  ];
  if (!args.world.state || !args.world.port) notes.push('The all-countries figures could not be read, so India’s share is not shown where they are missing.');
  if (indiaTotal === 0) notes.push('The Census Bureau recorded no imports of this product from India in these 12 months.');
  return {
    version: 1,
    country_code: 'US',
    hs6: args.hs6,
    source: { key: US_REGIONAL_SOURCE.key, label: US_REGIONAL_SOURCE.label, url: US_REGIONAL_SOURCE.url, attribution: CENSUS_ATTRIBUTION, retrieved_at: args.retrieved_at.toISOString(), requests: args.requests },
    period: { from: months[0]!, to: months[months.length - 1]!, months: months.length, label: `${monthLabel(months[0]!)} – ${monthLabel(months[months.length - 1]!)}` },
    totals: {
      india_value_usd: round2(indiaTotal),
      world_value_usd: worldTotal === null ? null : round2(worldTotal),
      india_share_percent: share(indiaTotal, worldTotal),
      container_share_percent: share(containerTotal, indiaTotal),
      air_share_percent: share(airTotal, indiaTotal),
    },
    views: [view('state', 'Destination states', states, top), view('port', 'Ports of entry', ports, top)],
    notes,
  };
}

/** Ask all four questions for one HS6 and build the result. Throws CensusKeyError for a key problem. */
export async function readUsRegionalDemand(args: { hs6: string; key: string; now: Date; fetchImpl: CensusFetch }): Promise<{ result: RegionalDemandResultV1 | null; requests: string[] }> {
  const from = censusFromMonth(args.now);
  const ask = (dataset: CensusDataset, country: string) => fetchCensusRows({ dataset, hs6: args.hs6, country, from, key: args.key, fetchImpl: args.fetchImpl });
  const requests = (['statehs', 'porths'] as const).flatMap((dataset) => [CENSUS_INDIA_CODE, CENSUS_ALL_COUNTRIES].map((country) => withoutKey(censusQueryUrl({ dataset, hs6: args.hs6, country, from, key: null }))));
  const indiaState = await ask('statehs', CENSUS_INDIA_CODE);
  const indiaPort = await ask('porths', CENSUS_INDIA_CODE);
  // The all-countries answers only add shares; a failure there is noted, not fatal. A key problem still is.
  const optional = async (dataset: CensusDataset) => {
    try {
      return await ask(dataset, CENSUS_ALL_COUNTRIES);
    } catch (error) {
      if (error instanceof CensusKeyError) throw error;
      return null;
    }
  };
  const worldState = await optional('statehs');
  const worldPort = await optional('porths');
  const result = buildUsRegionalResult({ hs6: args.hs6, india: { state: indiaState, port: indiaPort }, world: { state: worldState, port: worldPort }, retrieved_at: args.now, requests });
  return { result, requests };
}
