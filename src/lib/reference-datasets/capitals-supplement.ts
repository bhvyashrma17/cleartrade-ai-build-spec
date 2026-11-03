/**
 * Capitals CEPII GeoDist (2011) does not list, curated with a source per row (docs/36 §9). GeoDist
 * predates South Sudan, Montenegro's own row, the 2010 dissolution of the Netherlands Antilles and
 * Saint Barthélemy's separate code, and has no Holy See row; without these six the distance fit is
 * unavailable for those markets. Coordinates are facts, read from a named public source.
 */
import { z } from 'zod';
import { ReferenceDatasetFormatError } from './parsers';

export const CAPITALS_SUPPLEMENT_KEY = 'curated:capitals-supplement';
export const CAPITALS_SUPPLEMENT_PARSER_VERSION = 'capitals-supplement-parser-v1';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const capitalSupplementRowSchema = z.object({
  iso2: z.string().regex(/^[A-Z]{2}$/),
  city: z.string().min(2),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  source: z.string().min(10),
  source_url: z.string().url().startsWith('https://'),
});
export type CapitalSupplementRow = z.infer<typeof capitalSupplementRowSchema>;

/** `data/reference/capitals-supplement-v1.json`. A row without a source or a repeated market refuses the file. */
export function parseCapitalsSupplement(bytes: Buffer): { compiled_on: string; rows: CapitalSupplementRow[] } {
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ReferenceDatasetFormatError('The capitals supplement is not JSON.'); }
  const envelope = z.object({ schema_version: z.literal('capitals-supplement-v1'), compiled_on: isoDate, rows: z.array(z.unknown()).min(1) }).safeParse(body);
  if (!envelope.success) throw new ReferenceDatasetFormatError(`Not a capitals-supplement-v1 file: ${envelope.error.issues[0]?.message ?? 'invalid'}.`);
  const seen = new Set<string>();
  const rows = envelope.data.rows.map((raw, index) => {
    const parsed = capitalSupplementRowSchema.safeParse(raw);
    if (!parsed.success) throw new ReferenceDatasetFormatError(`Capital row ${index}: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    if (seen.has(parsed.data.iso2)) throw new ReferenceDatasetFormatError(`Capital row ${index} repeats ${parsed.data.iso2}.`);
    seen.add(parsed.data.iso2);
    return parsed.data;
  });
  rows.sort((a, b) => a.iso2.localeCompare(b.iso2));
  return { compiled_on: envelope.data.compiled_on, rows };
}
