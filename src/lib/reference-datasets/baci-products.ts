/**
 * CEPII BACI's product list for HS 2022 (`product_codes_HS22_V<version>.csv` in the BACI archive): every
 * six-digit code with its description. The product code finder searches it (E-043). Published with
 * BACI under the Etalab Open Licence 2.0: commercial reuse with credit to CEPII (docs/36 §2).
 */
import { z } from 'zod';
import { splitCsvLine } from '@/lib/trade-datasets/baci';
import { ReferenceDatasetFormatError } from './parsers';

export const BACI_PRODUCT_CODES_KEY = 'cepii:product-codes:HS22';
export const BACI_PRODUCT_CODES_PARSER_VERSION = 'cepii-baci-product-codes-csv-parser-v1';
/** HS 2022 has about 5,600 subheadings; a file far short of that is not the full list. */
const MINIMUM_CODES = 4_000;

export const hsCodeRowSchema = z.object({ hs6: z.string().regex(/^\d{6}$/), description: z.string().min(1) });
export type HsCodeRow = z.infer<typeof hsCodeRowSchema>;

export function parseBaciProductCodes(bytes: Buffer): { rows: HsCodeRow[]; rows_read: number } {
  const lines = bytes.toString('utf8').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new ReferenceDatasetFormatError('The product list is empty.');
  const header = splitCsvLine(lines[0]!).map((field) => field.trim().toLowerCase());
  const codeAt = header.indexOf('code');
  const descriptionAt = header.indexOf('description');
  if (codeAt < 0 || descriptionAt < 0) throw new ReferenceDatasetFormatError(`Expected the columns code and description, found ${header.join(', ')}.`);
  const seen = new Set<string>();
  const rows: HsCodeRow[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const fields = splitCsvLine(line);
    const raw = (fields[codeAt] ?? '').trim();
    // A spreadsheet round trip drops the leading zero of chapters 01–09.
    const hs6 = /^\d{5}$/.test(raw) ? `0${raw}` : raw;
    const description = (fields[descriptionAt] ?? '').trim();
    if (!/^\d{6}$/.test(hs6)) throw new ReferenceDatasetFormatError(`Line ${index + 2}: "${raw}" is not a six-digit code.`);
    if (!description) throw new ReferenceDatasetFormatError(`Line ${index + 2}: code ${hs6} has no description.`);
    if (seen.has(hs6)) throw new ReferenceDatasetFormatError(`Line ${index + 2}: code ${hs6} appears twice.`);
    seen.add(hs6);
    rows.push({ hs6, description });
  }
  if (rows.length < MINIMUM_CODES) throw new ReferenceDatasetFormatError(`Only ${rows.length} codes: this is not the full HS 2022 product list.`);
  return { rows: rows.sort((a, b) => a.hs6.localeCompare(b.hs6)), rows_read: lines.length - 1 };
}
