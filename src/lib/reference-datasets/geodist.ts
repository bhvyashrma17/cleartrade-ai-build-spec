/**
 * CEPII GeoDist `geo_cepii`: one row per country and main city, with each country's capital
 * flagged (docs/36 §2, §4 metric 8). Mayer & Zignago (2011), CEPII Working Paper 2011-25;
 * Etalab Open Licence 2.0.
 *
 * CEPII publishes the table as Stata (`geo_cepii.dta`) and Excel (`geo_cepii.xls`) files. The
 * parser reads it as a UTF-8 CSV export of the .dta with its 34 columns and header row unchanged;
 * the import records the .dta's own URL and sha256 next to the CSV's (data/reference/manifest.json).
 *
 * The table dates from 2011, so a few rows carry ISO codes withdrawn since. Each is mapped to the
 * successor ISO 3166-3 names whose capital is the same city — checked against the row's own city —
 * and countries created later (South Sudan, Montenegro, and Bonaire and Sint Maarten as separate
 * territories) have no row: their distance metric is unavailable rather than borrowed from a
 * neighbour. Namibia's alpha-2 is the literal text "NA" and is read as such.
 */
import { alpha3ToAlpha2, isValid } from 'i18n-iso-countries';
import { z } from 'zod';
import { BaciFormatError, splitCsvLine } from '@/lib/trade-datasets/baci';
import { ReferenceDatasetFormatError } from './parsers';

export const GEO_CEPII_PARSER_VERSION = 'cepii-geo-cepii-csv-parser-v1';

export const capitalRowSchema = z.object({
  /** Current ISO 3166-1 alpha-2. */
  iso2: z.string().regex(/^[A-Z]{2}$/),
  /** The table's own codes, kept for provenance ("ZR", "ZAR" for the DR Congo row). */
  published_iso2: z.string(),
  published_iso3: z.string(),
  /** The table's numeric country code (UN Comtrade numbering: India 699, Taiwan 490). */
  cnum: z.string().regex(/^\d{1,3}$/),
  country: z.string().min(2),
  city: z.string().min(1),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
});
export type CapitalRow = z.infer<typeof capitalRowSchema>;

/**
 * Withdrawn ISO 3166-1 codes in the 2011 table and the successor that kept the same capital city
 * (ISO 3166-3 transition codes in brackets).
 */
export const GEO_CEPII_WITHDRAWN_CODES: Readonly<Record<string, { iso2: string; city: string; transition: string }>> = {
  AN: { iso2: 'CW', city: 'Willemstad', transition: 'ANHH: Netherlands Antilles split into Bonaire, Curaçao and Sint Maarten (2010)' },
  TP: { iso2: 'TL', city: 'Dili', transition: 'TPTL: East Timor renamed Timor-Leste (2002)' },
  YU: { iso2: 'RS', city: 'Belgrade', transition: 'YUCS, then CSXX: Serbia and Montenegro split into Serbia and Montenegro (2006)' },
  ZR: { iso2: 'CD', city: 'Kinshasa', transition: 'ZRCD: Zaire renamed Democratic Republic of the Congo (1997)' },
};

const REQUIRED_COLUMNS = ['iso2', 'iso3', 'cnum', 'country', 'city_en', 'lat', 'lon', 'cap'] as const;
const NUMBER = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

export interface ParsedGeoCepii {
  rows: CapitalRow[];
  rows_read: number;
  successors: { published_iso2: string; iso2: string; city: string; transition: string }[];
}

export function parseGeoCepiiCsv(bytes: Buffer): ParsedGeoCepii {
  const lines = bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length);
  if (lines.length < 2) throw new ReferenceDatasetFormatError('The geo_cepii file has no rows.');
  const split = (line: string, context: string) => {
    try { return splitCsvLine(line); } catch (error) { throw new ReferenceDatasetFormatError(`${context}: ${error instanceof BaciFormatError ? error.message : String(error)}`); }
  };
  const header = split(lines[0], 'header');
  const column = Object.fromEntries(REQUIRED_COLUMNS.map((name) => [name, header.indexOf(name)])) as Record<(typeof REQUIRED_COLUMNS)[number], number>;
  const missing = REQUIRED_COLUMNS.filter((name) => column[name] < 0);
  if (missing.length) throw new ReferenceDatasetFormatError(`The header lacks ${missing.join(', ')}: this is not geo_cepii.`);

  const capitals = new Map<string, CapitalRow>();
  const countries = new Set<string>();
  const successors: ParsedGeoCepii['successors'] = [];
  for (const [offset, line] of lines.slice(1).entries()) {
    const context = `line ${offset + 2}`;
    const fields = split(line, context);
    if (fields.length !== header.length) throw new ReferenceDatasetFormatError(`${context}: expected ${header.length} fields, found ${fields.length}.`);
    const publishedIso2 = fields[column.iso2];
    const publishedIso3 = fields[column.iso3];
    if (!/^[A-Z]{2}$/.test(publishedIso2) || !/^[A-Z]{3}$/.test(publishedIso3)) throw new ReferenceDatasetFormatError(`${context}: country codes "${publishedIso2}", "${publishedIso3}" are not alpha-2 and alpha-3.`);
    countries.add(publishedIso3);
    const cap = fields[column.cap];
    if (!NUMBER.test(cap)) throw new ReferenceDatasetFormatError(`${context}: cap "${cap}" is not a number.`);
    if (Number(cap) !== 1) continue;
    if (capitals.has(publishedIso3)) throw new ReferenceDatasetFormatError(`${context}: ${publishedIso3} has a second capital row.`);

    const city = fields[column.city_en];
    let iso2 = publishedIso2;
    if (!isValid(publishedIso2)) {
      const successor = GEO_CEPII_WITHDRAWN_CODES[publishedIso2];
      if (!successor) throw new ReferenceDatasetFormatError(`${context}: ${publishedIso2} is not a current ISO 3166-1 code and has no successor listed in GEO_CEPII_WITHDRAWN_CODES.`);
      if (successor.city !== city) throw new ReferenceDatasetFormatError(`${context}: ${publishedIso2}'s capital is "${city}", not ${successor.iso2}'s capital ${successor.city}; the successor mapping does not hold.`);
      iso2 = successor.iso2;
      successors.push({ published_iso2: publishedIso2, iso2, city, transition: successor.transition });
    } else {
      const pair = alpha3ToAlpha2(publishedIso3);
      if (pair && pair !== publishedIso2) throw new ReferenceDatasetFormatError(`${context}: alpha-2 ${publishedIso2} and alpha-3 ${publishedIso3} name different countries.`);
    }
    const lat = fields[column.lat];
    const lon = fields[column.lon];
    if (!NUMBER.test(lat) || !NUMBER.test(lon)) throw new ReferenceDatasetFormatError(`${context}: coordinates "${lat}", "${lon}" are not numbers.`);
    const parsed = capitalRowSchema.safeParse({
      iso2, published_iso2: publishedIso2, published_iso3: publishedIso3, cnum: fields[column.cnum], country: fields[column.country], city, lat: Number(lat), lon: Number(lon),
    });
    if (!parsed.success) throw new ReferenceDatasetFormatError(`${context}: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    capitals.set(publishedIso3, parsed.data);
  }

  const noCapital = [...countries].filter((iso3) => !capitals.has(iso3));
  if (noCapital.length) throw new ReferenceDatasetFormatError(`No capital row for ${noCapital.join(', ')}.`);
  const byIso2 = new Map<string, CapitalRow>();
  for (const row of capitals.values()) {
    const previous = byIso2.get(row.iso2);
    if (previous) throw new ReferenceDatasetFormatError(`${previous.published_iso2} and ${row.published_iso2} both resolve to ${row.iso2}.`);
    byIso2.set(row.iso2, row);
  }
  return {
    rows: [...byIso2.values()].sort((a, b) => a.iso2.localeCompare(b.iso2)),
    rows_read: lines.length - 1,
    successors: successors.sort((a, b) => a.iso2.localeCompare(b.iso2)),
  };
}
