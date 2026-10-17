/**
 * Country-level sanctions programmes (D-025, "Sanctions lists"), curated with a source per row.
 *
 * These are programmes against a country as a whole or against parts of its economy — not the lists
 * of named people and firms, which are screened per buyer (`scripts/ingest-sanctions.ts`). India
 * implements UN Security Council sanctions in law; US, EU and UK programmes bind banks, insurers and
 * shipping lines an Indian exporter deals with, so they decide whether a payment can be made.
 *
 * Demand Discovery shows each programme as a flag on the market (`flag`, in plain words). A flag
 * never changes a score; excluding a market outright stays a policy decision
 * (`excluded_markets`, D-016). Programmes change often: the file records the day it was checked,
 * and a new edition replaces it.
 */
import { z } from 'zod';
import { ReferenceDatasetFormatError } from './parsers';

export const SANCTIONS_PROGRAMMES_KEY = 'curated:sanctions-programmes';
export const SANCTIONS_PROGRAMMES_PARSER_VERSION = 'sanctions-programmes-parser-v1';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const sanctionsProgrammeRowSchema = z.object({
  country_code: z.string().regex(/^[A-Z]{2}$/),
  authority: z.enum(['UN', 'US', 'EU', 'UK']),
  programme: z.string().min(3),
  /** `comprehensive`: most trade prohibited; `sectoral`: whole sectors, goods or banks; `arms_embargo`: arms and related goods, with targeted measures; `targeted`: named people and entities only. */
  scope: z.enum(['comprehensive', 'sectoral', 'arms_embargo', 'targeted']),
  /** What an exporter sees on the market, in plain words. */
  flag: z.string().min(10).max(110),
  legal_reference: z.string().min(5),
  source_url: z.string().url().startsWith('https://'),
});
export type SanctionsProgrammeRow = z.infer<typeof sanctionsProgrammeRowSchema>;

const AUTHORITY_ORDER = ['UN', 'US', 'EU', 'UK'] as const;

/** `data/reference/sanctions-programmes-v1.json`. A repeated programme for one market refuses the file. */
export function parseSanctionsProgrammes(bytes: Buffer): { checked_on: string; rows: SanctionsProgrammeRow[] } {
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ReferenceDatasetFormatError('The sanctions programmes file is not JSON.'); }
  const envelope = z.object({ schema_version: z.literal('sanctions-programmes-v1'), checked_on: isoDate, rows: z.array(z.unknown()).min(1) }).safeParse(body);
  if (!envelope.success) throw new ReferenceDatasetFormatError(`Not a sanctions-programmes-v1 file: ${envelope.error.issues[0]?.message ?? 'invalid'}.`);
  const seen = new Set<string>();
  const rows = envelope.data.rows.map((raw, index) => {
    const parsed = sanctionsProgrammeRowSchema.safeParse(raw);
    if (!parsed.success) throw new ReferenceDatasetFormatError(`Sanctions row ${index}: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    const identity = `${parsed.data.country_code}|${parsed.data.authority}|${parsed.data.programme}`;
    if (seen.has(identity)) throw new ReferenceDatasetFormatError(`Sanctions row ${index} repeats ${parsed.data.authority} "${parsed.data.programme}" for ${parsed.data.country_code}.`);
    seen.add(identity);
    return parsed.data;
  });
  rows.sort((a, b) => a.country_code.localeCompare(b.country_code) || AUTHORITY_ORDER.indexOf(a.authority) - AUTHORITY_ORDER.indexOf(b.authority) || a.programme.localeCompare(b.programme));
  return { checked_on: envelope.data.checked_on, rows };
}

/** The flags to show per market, UN first, then US, EU and UK. */
export function sanctionsFlagsByMarket(rows: readonly SanctionsProgrammeRow[]): Map<string, string[]> {
  const flags = new Map<string, string[]>();
  for (const row of rows) {
    const list = flags.get(row.country_code) ?? [];
    list.push(`${row.authority}: ${row.flag}`);
    flags.set(row.country_code, list);
  }
  return flags;
}
