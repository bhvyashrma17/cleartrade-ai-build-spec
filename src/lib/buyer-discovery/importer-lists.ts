/**
 * Official importer lists for Real Buyer Discovery (D-033, docs/38 §2): the sources, and readers that
 * turn each publisher's file into one entry per importer.
 *
 * HMRC — "Importer details" (UK Trade Info bulk data sets), one ZIP per month holding one tab-separated
 * text file with no header: period (YYYYMM), line number, trader name, five address lines, postcode,
 * then up to 50 eight-digit commodity codes. A trader with more codes continues on further lines with
 * the next line number. Where fewer than three traders import a code in the month, HMRC publishes the
 * two-digit chapter instead (and chapter 99 where even that would disclose). Businesses can opt out,
 * so the list is not every importer. Open Government Licence v3.0.
 *
 * Nothing here interprets a row beyond the publisher's own fields: names are kept as published, an
 * address is cleaned only of stray quotes and punctuation, and a town is the last address line that
 * is not a county.
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { ukRegionFor } from './uk-regions';

export type ImporterListSourceKey = 'uk_hmrc_importers' | 'ca_cid_major_importers';

export interface ImporterListSource {
  key: ImporterListSourceKey;
  country_code: string;
  label: string;
  /** For sentences: "HMRC's importer list". */
  short_label: string;
  publisher: string;
  licence: string;
  parser_version: string;
  /** Where the lists are published. */
  url: string;
  /** What one release covers, for sentences: "Aug 2026" or "2023". */
  period_kind: 'month' | 'year';
}

export const IMPORTER_LIST_SOURCES: Readonly<Record<ImporterListSourceKey, ImporterListSource>> = {
  uk_hmrc_importers: {
    key: 'uk_hmrc_importers', country_code: 'GB', label: 'HMRC importer details (UK Trade Info)', short_label: 'HMRC importer list', publisher: 'HMRC',
    licence: 'OGL-UK-3.0', parser_version: 'hmrc-importers-v1', url: 'https://www.uktradeinfo.com/trade-data/latest-bulk-datasets/', period_kind: 'month',
  },
  ca_cid_major_importers: {
    key: 'ca_cid_major_importers', country_code: 'CA', label: 'Canadian Importers Database (ISED, from CBSA data)', short_label: 'Canadian Importers Database', publisher: 'Innovation, Science and Economic Development Canada',
    licence: 'OGL-Canada-2.0', parser_version: 'ised-cid-v1', url: 'https://ised-isde.canada.ca/site/canadian-importers-database/en', period_kind: 'year',
  },
};

export function importerListSourceFor(countryCode: string): ImporterListSource | null {
  return Object.values(IMPORTER_LIST_SOURCES).find((source) => source.country_code === countryCode.toUpperCase()) ?? null;
}

export interface ImporterEntryInput {
  entity_key: string;
  name: string;
  address_lines: string[];
  town: string | null;
  postcode: string | null;
  region_code: string | null;
  region_name: string | null;
  hs_codes: string[];
  hs6_codes: string[];
  origin_hs6: string[];
  notes: string[];
}

export interface ParsedImporterList {
  period: string;
  entries: ImporterEntryInput[];
  validation: Record<string, unknown>;
}

export interface SourceFile {
  name: string;
  bytes: Buffer;
}

export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-08" → "Aug 2026"; a year stays as it is. */
export const periodLabel = (period: string) => (/^\d{4}-\d{2}$/.test(period) ? `${MONTHS[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}` : period);

/** One identity for a set of files: the sha256 of their sorted "name sha256 size" lines. */
export function fileManifest(files: SourceFile[]) {
  const items = files.map((file) => ({ name: file.name, sha256: sha256(file.bytes), bytes: file.bytes.length })).sort((a, b) => a.name.localeCompare(b.name));
  return { items, sha256: sha256(items.map((item) => `${item.name} ${item.sha256} ${item.bytes}`).join('\n')), bytes: items.reduce((sum, item) => sum + item.bytes, 0) };
}

const COUNTIES = new Set([
  'AVON', 'BEDS', 'BEDFORDSHIRE', 'BERKS', 'BERKSHIRE', 'BUCKS', 'BUCKINGHAMSHIRE', 'CAMBS', 'CAMBRIDGESHIRE', 'CHESHIRE', 'CLEVELAND', 'CORNWALL', 'CUMBRIA',
  'DERBYSHIRE', 'DEVON', 'DORSET', 'DURHAM', 'CO DURHAM', 'COUNTY DURHAM', 'EAST SUSSEX', 'E SUSSEX', 'ESSEX', 'GLOS', 'GLOUCESTERSHIRE', 'GREATER LONDON',
  'GREATER MANCHESTER', 'HANTS', 'HAMPSHIRE', 'HEREFORDSHIRE', 'HERTS', 'HERTFORDSHIRE', 'ISLE OF WIGHT', 'KENT', 'LANCS', 'LANCASHIRE', 'LEICS',
  'LEICESTERSHIRE', 'LINCS', 'LINCOLNSHIRE', 'MERSEYSIDE', 'MIDDX', 'MIDDLESEX', 'NORFOLK', 'NORTHANTS', 'NORTHAMPTONSHIRE', 'NORTHUMBERLAND',
  'NORTH YORKSHIRE', 'N YORKSHIRE', 'NOTTS', 'NOTTINGHAMSHIRE', 'OXON', 'OXFORDSHIRE', 'RUTLAND', 'SHROPSHIRE', 'SALOP', 'SOMERSET', 'SOUTH YORKSHIRE',
  'S YORKSHIRE', 'STAFFS', 'STAFFORDSHIRE', 'SUFFOLK', 'SURREY', 'TYNE AND WEAR', 'TYNE & WEAR', 'WARKS', 'WARWICKSHIRE', 'WEST MIDLANDS', 'W MIDLANDS',
  'WEST SUSSEX', 'W SUSSEX', 'WEST YORKSHIRE', 'W YORKSHIRE', 'WILTS', 'WILTSHIRE', 'WORCS', 'WORCESTERSHIRE', 'EAST YORKSHIRE', 'NORTH HUMBERSIDE',
  'SOUTH HUMBERSIDE', 'HUMBERSIDE', 'SOUTH GLAMORGAN', 'MID GLAMORGAN', 'WEST GLAMORGAN', 'GWENT', 'DYFED', 'POWYS', 'GWYNEDD', 'CLWYD', 'CO ANTRIM',
  'COUNTY ANTRIM', 'CO DOWN', 'COUNTY DOWN', 'CO ARMAGH', 'CO TYRONE', 'CO LONDONDERRY', 'CO FERMANAGH', 'LANARKSHIRE', 'RENFREWSHIRE', 'FIFE', 'LOTHIAN',
  'MIDLOTHIAN', 'WEST LOTHIAN', 'EAST LOTHIAN', 'ABERDEENSHIRE', 'AYRSHIRE', 'STIRLINGSHIRE', 'DUNBARTONSHIRE', 'PERTHSHIRE', 'ANGUS', 'MORAY',
  'INVERNESS-SHIRE', 'ROSS-SHIRE', 'ARGYLL', 'DUMFRIESSHIRE', 'BORDERS', 'SCOTLAND', 'WALES', 'ENGLAND', 'UNITED KINGDOM', 'UK', 'GB',
]);

/** Strip the quotes and stray punctuation HMRC's rows carry: `"""GHYLL VIEW FARM"""`, `'COLANOL HOUSE'`, `- SKELTON GRANGE ROAD`. */
export function cleanAddressLine(value: string): string {
  let text = value.trim();
  for (let i = 0; i < 3; i += 1) text = text.replace(/^["']+|["']+$/g, '').trim();
  return text.replace(/^[-.,;:\s]+/, '').replace(/[,;\s]+$/, '').replace(/\s{2,}/g, ' ').trim();
}

export function townFrom(lines: string[]): string | null {
  const filled = lines.filter(Boolean);
  for (let i = filled.length - 1; i >= 0; i -= 1) {
    const line = filled[i]!;
    if (!COUNTIES.has(line.toUpperCase()) && !/^NR\.? /i.test(line)) return line;
    if (/^NR\.? /i.test(line)) return line.replace(/^NR\.? /i, '');
  }
  return null;
}

const LEGAL_SUFFIXES = new Set(['LLC', 'INC', 'LTD', 'LIMITED', 'CORP', 'CORPORATION', 'CO', 'COMPANY', 'GMBH', 'PLC', 'LP', 'LLP', 'SA', 'BV', 'ULC', 'LTEE', 'LTÉE']);

/** The same normalisation buyer entity resolution uses (buyer-intelligence.ts), kept here so the readers stay pure. */
export function normalizeImporterName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).filter((token) => !LEGAL_SUFFIXES.has(token)).join(' ');
}

const entityKey = (name: string, postcode: string | null) => `${normalizeImporterName(name) || name.trim().toUpperCase()}|${(postcode ?? '').replace(/\s+/g, '').toUpperCase()}`;

function hs6Of(codes: string[]): string[] {
  return [...new Set(codes.filter((code) => /^\d{6,}$/.test(code)).map((code) => code.slice(0, 6)))].sort();
}

async function textOf(file: SourceFile, member: RegExp): Promise<string> {
  const isZip = file.bytes.length > 3 && file.bytes[0] === 0x50 && file.bytes[1] === 0x4b;
  if (!isZip) return file.bytes.toString('latin1');
  const zip = await JSZip.loadAsync(file.bytes);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir && member.test(name));
  if (names.length !== 1) throw new Error(`${file.name} should hold one ${member} file; it holds ${names.length}.`);
  return Buffer.from(await zip.files[names[0]!]!.async('uint8array')).toString('latin1');
}

/** HMRC's monthly importer details, ZIP or the text file inside it. */
export async function parseHmrcImporterFile(file: SourceFile): Promise<ParsedImporterList> {
  const text = await textOf(file, /\.txt$/i);
  const byKey = new Map<string, ImporterEntryInput & { codes: Set<string> }>();
  const periods = new Set<string>();
  let lines = 0;
  let skipped = 0;
  let suppressedOnly = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    lines += 1;
    const fields = raw.split('\t');
    const period = fields[0]?.trim() ?? '';
    const name = fields[2]?.trim() ?? '';
    if (!/^\d{6}$/.test(period) || !name || fields.length < 10) {
      skipped += 1;
      continue;
    }
    periods.add(period);
    const address = fields.slice(3, 8).map(cleanAddressLine);
    const postcode = cleanAddressLine(fields[8] ?? '').toUpperCase() || null;
    const codes = fields.slice(9).map((code) => code.trim()).filter((code) => /^\d{2}$|^\d{8}$/.test(code));
    const key = entityKey(name, postcode);
    let entry = byKey.get(key);
    if (!entry) {
      const region = ukRegionFor(postcode);
      entry = {
        entity_key: key, name, address_lines: address.filter(Boolean), town: townFrom(address), postcode, region_code: region?.code ?? null, region_name: region?.name ?? null,
        hs_codes: [], hs6_codes: [], origin_hs6: [], notes: [], codes: new Set(),
      };
      byKey.set(key, entry);
    }
    for (const code of codes) entry.codes.add(code);
  }
  if (periods.size !== 1) throw new Error(`${file.name}: expected one period, found ${periods.size} (${[...periods].slice(0, 3).join(', ')}).`);
  const period = [...periods][0]!;
  const entries = [...byKey.values()].map(({ codes, ...entry }) => {
    const hsCodes = [...codes].sort();
    if (hsCodes.every((code) => code.length === 2)) suppressedOnly += 1;
    return { ...entry, hs_codes: hsCodes, hs6_codes: hs6Of(hsCodes) };
  });
  return {
    period: `${period.slice(0, 4)}-${period.slice(4)}`,
    entries,
    validation: { lines, skipped_lines: skipped, importers: entries.length, importers_with_only_chapter_codes: suppressedOnly, without_region: entries.filter((entry) => !entry.region_code).length },
  };
}
