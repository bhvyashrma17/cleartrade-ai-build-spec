/**
 * Parsers for the small reference datasets Demand Discovery v5 reads (docs/36 §2, §3.2).
 *
 * Each parser takes the publisher's bytes exactly as downloaded and returns validated rows, or
 * throws with the reason. Rows are keyed by ISO alpha-2 so every consumer speaks the platform's
 * country identity; publisher aggregates (regions, income groups) have no ISO code and are dropped
 * by construction, never by a hand list.
 */
import { alpha3ToAlpha2 } from 'i18n-iso-countries';
import { z } from 'zod';

export class ReferenceDatasetFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceDatasetFormatError';
  }
}

// ---------------------------------------------------------------------------------------------
// World Bank WDI, API v2 JSON: [metadata, rows]. One indicator per file.
// ---------------------------------------------------------------------------------------------

export const WDI_PARSER_VERSION = 'wdi-api-v2-parser-v1';

export const wdiRowSchema = z.object({
  iso2: z.string().regex(/^[A-Z]{2}$/),
  iso3: z.string().regex(/^[A-Z]{3}$/),
  year: z.number().int().min(1960).max(2100),
  value: z.number().finite(),
});
export type WdiRow = z.infer<typeof wdiRowSchema>;

const wdiApiRow = z.object({
  indicator: z.object({ id: z.string(), value: z.string() }),
  country: z.object({ id: z.string(), value: z.string() }),
  countryiso3code: z.string(),
  date: z.string(),
  value: z.number().nullable(),
});

/** Latest non-null value per country for one indicator. */
export function parseWdiIndicator(bytes: Buffer, indicatorId: string): { rows: WdiRow[]; indicator_name: string; last_updated: string | null } {
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ReferenceDatasetFormatError('The World Bank response is not JSON.'); }
  if (!Array.isArray(body) || body.length < 2 || !Array.isArray(body[1])) {
    const message = Array.isArray(body) && body[0] && typeof body[0] === 'object' ? JSON.stringify(body[0]).slice(0, 300) : 'unexpected shape';
    throw new ReferenceDatasetFormatError(`The World Bank response is not [metadata, rows]: ${message}`);
  }
  const meta = body[0] as Record<string, unknown>;
  if (typeof meta.pages === 'number' && meta.pages > 1) throw new ReferenceDatasetFormatError(`The response has ${meta.pages} pages; request it with per_page large enough for one page.`);
  const latest = new Map<string, WdiRow>();
  let indicatorName = '';
  for (const [index, raw] of (body[1] as unknown[]).entries()) {
    const parsed = wdiApiRow.safeParse(raw);
    if (!parsed.success) throw new ReferenceDatasetFormatError(`World Bank row ${index}: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    const row = parsed.data;
    if (row.indicator.id !== indicatorId) throw new ReferenceDatasetFormatError(`World Bank row ${index} is indicator ${row.indicator.id}, not ${indicatorId}.`);
    indicatorName = row.indicator.value;
    if (row.value == null) continue;
    const iso3 = row.countryiso3code.toUpperCase();
    const iso2 = /^[A-Z]{3}$/.test(iso3) ? alpha3ToAlpha2(iso3) : undefined;
    if (!iso2) continue; // regional and income aggregates carry no ISO identity
    if (!/^\d{4}$/.test(row.date)) throw new ReferenceDatasetFormatError(`World Bank row ${index}: year "${row.date}" is not annual.`);
    const candidate = wdiRowSchema.parse({ iso2, iso3, year: Number(row.date), value: row.value });
    const current = latest.get(iso2);
    if (!current || candidate.year > current.year) latest.set(iso2, candidate);
  }
  if (!latest.size) throw new ReferenceDatasetFormatError(`No country values for ${indicatorId}.`);
  return {
    rows: [...latest.values()].sort((a, b) => a.iso2.localeCompare(b.iso2)),
    indicator_name: indicatorName,
    last_updated: typeof meta.lastupdated === 'string' ? meta.lastupdated : null,
  };
}

// ---------------------------------------------------------------------------------------------
// UN Comtrade data availability, public getDa JSON. One period per file.
// ---------------------------------------------------------------------------------------------

export const COMTRADE_AVAILABILITY_PARSER_VERSION = 'comtrade-getda-parser-v1';

export const comtradeAvailabilityRowSchema = z.object({
  reporter_code: z.string().regex(/^\d+$/),
  reporter_iso3: z.string().nullable(),
  period: z.number().int(),
  classification_code: z.string(),
  total_records: z.number().int().nonnegative(),
  first_released: z.string().nullable(),
  last_released: z.string().nullable(),
});
export type ComtradeAvailabilityRow = z.infer<typeof comtradeAvailabilityRowSchema>;

const getDaRow = z.object({
  typeCode: z.string(), freqCode: z.string(), period: z.union([z.number(), z.string()]), reporterCode: z.union([z.number(), z.string()]),
  reporterISO: z.string().nullable().optional(), classificationCode: z.string(), totalRecords: z.number(),
  firstReleased: z.string().nullable().optional(), lastReleased: z.string().nullable().optional(),
});

export function parseComtradeAvailability(bytes: Buffer, expectedPeriod: number): ComtradeAvailabilityRow[] {
  let body: unknown;
  try { body = JSON.parse(bytes.toString('utf8')); } catch { throw new ReferenceDatasetFormatError('The getDa response is not JSON.'); }
  const envelope = z.object({ count: z.number(), data: z.array(z.unknown()), error: z.string().nullable().optional() }).safeParse(body);
  if (!envelope.success) throw new ReferenceDatasetFormatError('The getDa response has no count and data.');
  if (envelope.data.error) throw new ReferenceDatasetFormatError(`getDa reported an error: ${envelope.data.error}`);
  if (envelope.data.count !== envelope.data.data.length) throw new ReferenceDatasetFormatError(`getDa count ${envelope.data.count} does not match ${envelope.data.data.length} rows.`);
  const seen = new Set<string>();
  return envelope.data.data.map((raw, index) => {
    const parsed = getDaRow.safeParse(raw);
    if (!parsed.success) throw new ReferenceDatasetFormatError(`getDa row ${index}: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    const row = parsed.data;
    if (row.typeCode !== 'C' || row.freqCode !== 'A') throw new ReferenceDatasetFormatError(`getDa row ${index} is ${row.typeCode}/${row.freqCode}, not annual goods.`);
    if (Number(row.period) !== expectedPeriod) throw new ReferenceDatasetFormatError(`getDa row ${index} is period ${row.period}, not ${expectedPeriod}.`);
    const key = `${row.reporterCode}:${row.classificationCode}`;
    if (seen.has(key)) throw new ReferenceDatasetFormatError(`getDa lists reporter ${row.reporterCode} twice for ${row.classificationCode}.`);
    seen.add(key);
    return comtradeAvailabilityRowSchema.parse({
      reporter_code: String(row.reporterCode), reporter_iso3: row.reporterISO ?? null, period: expectedPeriod,
      classification_code: row.classificationCode, total_records: row.totalRecords,
      first_released: row.firstReleased ?? null, last_released: row.lastReleased ?? null,
    });
  }).sort((a, b) => Number(a.reporter_code) - Number(b.reporter_code) || a.classification_code.localeCompare(b.classification_code));
}
