/**
 * CEPII BACI archive conventions (docs/36 §2, §3.1).
 *
 * Source facts, from CEPII's BACI page and `DescriptionBACI.html` (read 13 Oct 2026): one CSV per
 * year named `BACI_HS{rev}_Y{year}_V{version}.csv` with the six variables `t,i,j,k,v,q`; `v` is in
 * thousands of current USD and `q` in metric tons; only strictly positive flows are recorded;
 * `k` is the HS6 code and must be read as text to keep its leading zeros; `i` and `j` are BACI's
 * numeric country codes, inherited from UN Comtrade, mapped to ISO codes by the archive's own
 * country file. Taiwan is code 490 ("Asia, nes").
 *
 * Parsing is strict. A row that does not match these facts fails the import with its line number;
 * nothing is skipped or repaired silently.
 */

export const BACI_PROVIDER = 'cepii_baci';
export const BACI_LICENCE = 'etalab-2.0';
export const BACI_PARSER_VERSION = 'cepii-baci-parser-v1';
export const BACI_DATA_HEADER = ['t', 'i', 'j', 'k', 'v', 'q'] as const;
/** Quantity tokens that mean "not reported" rather than zero. */
const MISSING_QUANTITY = new Set(['', 'NA', 'NaN']);

export type BaciHsRevision = 'HS92' | 'HS96' | 'HS02' | 'HS07' | 'HS12' | 'HS17' | 'HS22';
export const BACI_HS_REVISIONS: readonly BaciHsRevision[] = ['HS92', 'HS96', 'HS02', 'HS07', 'HS12', 'HS17', 'HS22'];

export type BaciMember =
  | { kind: 'data'; name: string; hs_revision: BaciHsRevision; year: number; version: string }
  | { kind: 'countries'; name: string; version: string }
  | { kind: 'products'; name: string; hs_revision: BaciHsRevision; version: string }
  | { kind: 'other'; name: string };

export class BaciFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BaciFormatError';
  }
}

/** One reconciled flow: exporter `i` to importer `j`, product `k`, year `t`. */
export interface BaciFlow {
  year: number;
  exporter: string;
  importer: string;
  product: string;
  /** Thousands of current USD, as published. */
  value_kusd: number;
  /** Metric tons, or null when the source left it unreported. */
  quantity_t: number | null;
}

export interface BaciCountry {
  provider_code: string;
  name: string;
  iso2: string | null;
  iso3: string | null;
}

function baseName(name: string) {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  return slash >= 0 ? name.slice(slash + 1) : name;
}

export function classifyBaciMember(name: string): BaciMember {
  const file = baseName(name);
  const data = /^BACI_(HS\d{2})_Y(\d{4})_V(\d{6})\.csv$/.exec(file);
  if (data && (BACI_HS_REVISIONS as readonly string[]).includes(data[1])) {
    return { kind: 'data', name, hs_revision: data[1] as BaciHsRevision, year: Number(data[2]), version: `V${data[3]}` };
  }
  const countries = /^country_codes_V(\d{6})\.csv$/.exec(file);
  if (countries) return { kind: 'countries', name, version: `V${countries[1]}` };
  const products = /^product_codes_(HS\d{2})_V(\d{6})\.csv$/.exec(file);
  if (products && (BACI_HS_REVISIONS as readonly string[]).includes(products[1])) {
    return { kind: 'products', name, hs_revision: products[1] as BaciHsRevision, version: `V${products[2]}` };
  }
  return { kind: 'other', name };
}

/** RFC 4180 fields for one line. Throws on an unbalanced quote; there are no multi-line fields here. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
    } else if (char === '"') {
      if (field.length) throw new BaciFormatError(`A quote opens mid-field in: ${line.slice(0, 120)}`);
      quoted = true;
    } else if (char === ',') {
      fields.push(field);
      field = '';
    } else field += char;
  }
  if (quoted) throw new BaciFormatError(`Unbalanced quote in: ${line.slice(0, 120)}`);
  fields.push(field);
  return fields.map((value) => value.trim());
}

export function assertBaciDataHeader(line: string, member: string) {
  const header = splitCsvLine(line.replace(/^﻿/, ''));
  if (header.length !== BACI_DATA_HEADER.length || header.some((column, index) => column !== BACI_DATA_HEADER[index])) {
    throw new BaciFormatError(`${member}: header ${JSON.stringify(header)} is not the documented t,i,j,k,v,q.`);
  }
}

function strictNumber(token: string, field: string, context: string): number {
  if (!/^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(token)) throw new BaciFormatError(`${context}: ${field} "${token}" is not a number.`);
  const value = Number(token);
  if (!Number.isFinite(value)) throw new BaciFormatError(`${context}: ${field} "${token}" is not finite.`);
  return value;
}

/** Parses one data row. `expectedYear` is the year the file name declares. */
export function parseBaciDataLine(line: string, context: string, expectedYear: number): BaciFlow {
  const fields = splitCsvLine(line);
  if (fields.length !== 6) throw new BaciFormatError(`${context}: expected 6 fields, found ${fields.length}.`);
  const [t, i, j, k, v, q] = fields;
  if (!/^\d{4}$/.test(t) || Number(t) !== expectedYear) throw new BaciFormatError(`${context}: year "${t}" does not match the file's ${expectedYear}.`);
  if (!/^\d{1,3}$/.test(i) || !/^\d{1,3}$/.test(j)) throw new BaciFormatError(`${context}: country codes "${i}", "${j}" are not BACI numeric codes.`);
  if (i === j) throw new BaciFormatError(`${context}: exporter and importer are both ${i}.`);
  if (!/^\d{6}$/.test(k)) throw new BaciFormatError(`${context}: product "${k}" is not a six-digit HS code.`);
  const value = strictNumber(v, 'value', context);
  if (value <= 0) throw new BaciFormatError(`${context}: value ${v} is not strictly positive; BACI records only positive flows.`);
  let quantity: number | null = null;
  if (!MISSING_QUANTITY.has(q)) {
    quantity = strictNumber(q, 'quantity', context);
    if (quantity < 0) throw new BaciFormatError(`${context}: quantity ${q} is negative.`);
  }
  return { year: expectedYear, exporter: String(Number(i)), importer: String(Number(j)), product: k, value_kusd: value, quantity_t: quantity };
}

/** The canonical text of a parsed row, as written into partitions. Round-trips through parseBaciDataLine. */
export function formatBaciDataLine(flow: BaciFlow, rawValue: string, rawQuantity: string): string {
  return `${flow.year},${flow.exporter},${flow.importer},${flow.product},${rawValue},${MISSING_QUANTITY.has(rawQuantity) ? '' : rawQuantity}`;
}

/**
 * The country file. Two documented layouts are accepted: the current one
 * (`country_code,country_name,country_iso2,country_iso3`) and the older one
 * (`country_code,country_name_abbreviation,country_name_full,iso_2digit_alpha,iso_3digit_alpha`).
 */
export function parseBaciCountries(text: string, member: string): BaciCountry[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) throw new BaciFormatError(`${member} is empty.`);
  const header = splitCsvLine(lines[0]);
  const at = (names: string[]) => {
    const index = header.findIndex((column) => names.includes(column));
    return index;
  };
  const codeIndex = at(['country_code']);
  const nameIndex = at(['country_name', 'country_name_full']);
  const iso2Index = at(['country_iso2', 'iso_2digit_alpha']);
  const iso3Index = at(['country_iso3', 'iso_3digit_alpha']);
  if ([codeIndex, nameIndex, iso2Index, iso3Index].some((index) => index < 0)) {
    throw new BaciFormatError(`${member}: header ${JSON.stringify(header)} is not a documented BACI country layout.`);
  }
  const seen = new Set<string>();
  return lines.slice(1).map((line, offset) => {
    const fields = splitCsvLine(line);
    const context = `${member} line ${offset + 2}`;
    if (fields.length !== header.length) throw new BaciFormatError(`${context}: expected ${header.length} fields, found ${fields.length}.`);
    const code = fields[codeIndex];
    if (!/^\d{1,3}$/.test(code)) throw new BaciFormatError(`${context}: country code "${code}" is not numeric.`);
    const providerCode = String(Number(code));
    if (seen.has(providerCode)) throw new BaciFormatError(`${context}: duplicate country code ${providerCode}.`);
    seen.add(providerCode);
    const iso2 = fields[iso2Index].toUpperCase();
    const iso3 = fields[iso3Index].toUpperCase();
    return {
      provider_code: providerCode,
      name: fields[nameIndex],
      iso2: /^[A-Z]{2}$/.test(iso2) ? iso2 : null,
      iso3: /^[A-Z]{3}$/.test(iso3) ? iso3 : null,
    };
  });
}

/** Number of product rows in a product-codes file, after checking its header. Descriptions are not stored. */
export function countBaciProducts(text: string, member: string): number {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) throw new BaciFormatError(`${member} is empty.`);
  const header = splitCsvLine(lines[0]);
  if (header[0] !== 'code') throw new BaciFormatError(`${member}: header ${JSON.stringify(header)} does not start with "code".`);
  for (const [offset, line] of lines.slice(1).entries()) {
    const code = splitCsvLine(line)[0];
    if (!/^\d{6}$/.test(code)) throw new BaciFormatError(`${member} line ${offset + 2}: product "${code}" is not six digits.`);
  }
  return lines.length - 1;
}
