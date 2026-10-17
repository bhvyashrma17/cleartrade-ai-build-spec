/**
 * Official fixed exchange rates (D-025, "More currencies"), curated with a source per row.
 *
 * The ECB publishes reference rates for about thirty currencies. Many currencies it does not publish
 * are fixed by law or by their central bank against one it does — the Gulf currencies against the US
 * dollar, the CFA francs against the euro, the Nepalese rupee against the Indian rupee. For those,
 * the peg is the official rate, and US dollars per unit follow exactly from the anchor's ECB rate on
 * the same day. A peg is a published fact; each row states the rate as its source states it, either
 * as units of the currency per one unit of the anchor or as anchor per one unit of the currency.
 *
 * `source_kind`: `official` — read on the central bank's or monetary authority's own page;
 * `press_report` — the authority's statement as reported by the press; `reference` — a reference
 * work citing the authority. Floating currencies the ECB does not publish are not here.
 */
import { z } from 'zod';
import { ReferenceDatasetFormatError } from './parsers';

export const CURRENCY_PEGS_KEY = 'curated:currency-pegs';
export const CURRENCY_PEGS_PARSER_VERSION = 'currency-pegs-parser-v1';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const currencyCode = z.string().regex(/^[A-Z]{3}$/);
const positiveDecimal = z.string().regex(/^\d+(\.\d+)?$/).refine((value) => Number(value) > 0, 'must be positive');

export const currencyPegRowSchema = z.object({
  currency: currencyCode,
  anchor: currencyCode,
  /** Units of `currency` per one unit of `anchor`, as published (e.g. SAR 3.75 per USD). */
  units_per_anchor: positiveDecimal.nullable(),
  /** Units of `anchor` per one unit of `currency`, as published (e.g. USD 2.6008 per OMR). */
  anchor_per_unit: positiveDecimal.nullable(),
  authority: z.string().min(3),
  basis: z.string().min(10),
  source_url: z.string().url().startsWith('https://'),
  source_kind: z.enum(['official', 'press_report', 'reference']),
});
export type CurrencyPegRow = z.infer<typeof currencyPegRowSchema>;

/** Units of the anchor per one unit of the currency. */
export function anchorPerUnit(row: Pick<CurrencyPegRow, 'units_per_anchor' | 'anchor_per_unit'>): number {
  return row.anchor_per_unit != null ? Number(row.anchor_per_unit) : 1 / Number(row.units_per_anchor);
}

/** `data/reference/currency-pegs-v1.json`. A repeated currency, a self-anchored row or a row with both or neither rate refuses the file. */
export function parseCurrencyPegs(bytes: Buffer): { compiled_on: string; rows: CurrencyPegRow[] } {
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ReferenceDatasetFormatError('The currency pegs file is not JSON.'); }
  const envelope = z.object({ schema_version: z.literal('currency-pegs-v1'), compiled_on: isoDate, rows: z.array(z.unknown()).min(1) }).safeParse(body);
  if (!envelope.success) throw new ReferenceDatasetFormatError(`Not a currency-pegs-v1 file: ${envelope.error.issues[0]?.message ?? 'invalid'}.`);
  const seen = new Set<string>();
  const rows = envelope.data.rows.map((raw, index) => {
    const parsed = currencyPegRowSchema.safeParse(raw);
    if (!parsed.success) throw new ReferenceDatasetFormatError(`Peg row ${index}: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    const row = parsed.data;
    if (row.currency === row.anchor) throw new ReferenceDatasetFormatError(`Peg row ${index}: ${row.currency} cannot be anchored to itself.`);
    if ((row.units_per_anchor == null) === (row.anchor_per_unit == null)) throw new ReferenceDatasetFormatError(`Peg row ${index}: state the rate one way only (units_per_anchor or anchor_per_unit).`);
    if (seen.has(row.currency)) throw new ReferenceDatasetFormatError(`Peg row ${index} repeats ${row.currency}.`);
    seen.add(row.currency);
    return row;
  });
  // A peg must end at a currency that is not itself pegged here: the anchor is read from the ECB.
  for (const row of rows) if (seen.has(row.anchor)) throw new ReferenceDatasetFormatError(`${row.currency} is anchored to ${row.anchor}, which is itself pegged in this file.`);
  rows.sort((a, b) => a.currency.localeCompare(b.currency));
  return { compiled_on: envelope.data.compiled_on, rows };
}
