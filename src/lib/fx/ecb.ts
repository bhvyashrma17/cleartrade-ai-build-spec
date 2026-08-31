/**
 * European Central Bank euro foreign-exchange reference rates, via the official SDMX REST API.
 *
 * Source: https://data-api.ecb.europa.eu/service/data/EXR/{key}. The ECB permits free reuse,
 * including commercial reuse, of its published statistics with attribution — which is carried in
 * `ECB_ATTRIBUTION` and stored on every snapshot rather than left to a UI to remember.
 *
 * Two properties do all the work here:
 *
 *  - A rate belongs to a DATE, not to the moment we asked. The observation date is stored and is
 *    what freshness and the assessment clock are judged against.
 *  - ECB quotes foreign currency per ONE euro. Every non-euro pair is therefore a derived cross
 *    rate, and a derived rate keeps provenance to BOTH source observations. Inverting or chaining
 *    without recording which leg was which is how a 1.16 becomes a 0.86.
 */
import { createHash } from 'node:crypto';
import { EvidenceCompletenessStatus, EvidenceOrigin, Prisma } from '@prisma/client';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';

const BASE = 'https://data-api.ecb.europa.eu/service/data/EXR';
export const ECB_AUTHORITY = 'European Central Bank';
export const ECB_DATASET = 'ECB euro foreign exchange reference rates (EXR)';
export const ECB_ATTRIBUTION = 'Source: European Central Bank. ECB euro foreign exchange reference rates.';
export const ECB_PARSER_VERSION = 'ecb-sdmx-exr-v1';
export const ECB_NORMALIZATION_VERSION = 'ecb-fx-normalization-v1';
export const ECB_PROVIDER = 'ecb_sdmx';
/** The euro is the denominator of every published EXR series. */
export const ECB_BASE_CURRENCY = 'EUR';

export const ecbSeriesKey = (currency: string) => `D.${currency.toUpperCase()}.EUR.SP00.A`;

export interface EcbObservation {
  series_key: string;
  base_currency: string;
  quote_currency: string;
  rate: string;
  observation_date: string;
  observation_status: string;
}

interface CsvRow { [column: string]: string }

function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(',');
  return lines.slice(1).map((line) => {
    // Field values may be quoted and contain commas (series titles do).
    const values: string[] = [];
    let current = '';
    let quoted = false;
    for (const char of line) {
      if (char === '"') { quoted = !quoted; continue; }
      if (char === ',' && !quoted) { values.push(current); current = ''; continue; }
      current += char;
    }
    values.push(current);
    return Object.fromEntries(header.map((column, index) => [column, values[index] ?? '']));
  });
}

export function parseEcbCsv(text: string): EcbObservation[] {
  return parseCsv(text)
    .map((row) => ({
      series_key: row.KEY ?? '',
      base_currency: (row.CURRENCY_DENOM ?? '').toUpperCase(),
      quote_currency: (row.CURRENCY ?? '').toUpperCase(),
      rate: row.OBS_VALUE ?? '',
      observation_date: row.TIME_PERIOD ?? '',
      observation_status: row.OBS_STATUS ?? '',
    }))
    // A published series can carry a dated row with no value (a closing day). It is not a rate,
    // and it must not be silently carried forward as one.
    .filter((row) => row.observation_date && row.rate.trim() !== '' && Number.isFinite(Number(row.rate)) && Number(row.rate) > 0)
    .sort((left, right) => left.observation_date.localeCompare(right.observation_date));
}

export interface EcbFetchOptions {
  /** Inclusive window end. Never later than the assessment clock. */
  end_date: string;
  /** Inclusive window start; the walk-back horizon for a non-publication day. */
  start_date: string;
  now?: Date;
}

/**
 * Fetch and persist one currency's published series over a window.
 *
 * The whole window is stored, not just the row we happened to need, so a later assessment with a
 * different clock reads real published history instead of re-fetching and possibly seeing a
 * revised series.
 */
export async function ingestEcbSeries(currency: string, options: EcbFetchOptions) {
  const upper = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(upper)) throw new Error('An ECB series requires an ISO 4217 currency code.');
  if (upper === ECB_BASE_CURRENCY) throw new Error('The ECB publishes no EUR/EUR series; the euro is the denominator.');
  const seriesKey = ecbSeriesKey(upper);
  const url = `${BASE}/${seriesKey}?startPeriod=${options.start_date}&endPeriod=${options.end_date}&format=csvdata`;
  const requestedAt = options.now ?? new Date();
  const response = await fetch(url, { headers: { accept: 'text/csv' } });
  const text = await response.text();
  const retrievedAt = new Date();
  if (!response.ok) {
    // 404 from the SDMX service means the series does not exist — the ECB does not publish this
    // currency. That is a fact about the source, reported as unavailability, not an outage.
    return { status: 'unavailable' as const, currency: upper, series_key: seriesKey, http_status: response.status, reason: response.status === 404 ? `The ECB publishes no reference-rate series for ${upper}.` : `ECB SDMX returned ${response.status}.`, snapshot: null, observations: [] as EcbObservation[] };
  }
  const observations = parseEcbCsv(text);
  const checksum = createHash('sha256').update(text).digest('hex');
  const environment = appEnvironment();

  const snapshot = await prisma.authoritativeFxSnapshot.create({
    data: {
      provider: ECB_PROVIDER, source_authority: ECB_AUTHORITY, source_dataset: ECB_DATASET,
      source_dataset_version: response.headers.get('last-modified') ?? null,
      series_key: seriesKey, request_reference: url, requested_at: requestedAt, retrieved_at: retrievedAt,
      http_status: response.status, raw_response_checksum: checksum, raw_response_text: text,
      parser_version: ECB_PARSER_VERSION, normalization_version: ECB_NORMALIZATION_VERSION,
      environment, evidence_origin: EvidenceOrigin.public_real,
      completeness: observations.length ? EvidenceCompletenessStatus.COMPLETE : EvidenceCompletenessStatus.PARTIAL,
      status: observations.length ? 'accepted' : 'partial',
    },
  });

  if (observations.length) {
    await prisma.authoritativeFxObservation.createMany({
      data: observations.map((observation) => ({
        snapshot_id: snapshot.id, provider: ECB_PROVIDER, series_key: seriesKey,
        base_currency: ECB_BASE_CURRENCY, quote_currency: observation.quote_currency,
        rate: new Prisma.Decimal(observation.rate),
        observation_date: new Date(`${observation.observation_date}T00:00:00.000Z`),
        observation_status: observation.observation_status || 'A',
        normalization_version: ECB_NORMALIZATION_VERSION, parser_version: ECB_PARSER_VERSION,
        environment, evidence_origin: EvidenceOrigin.public_real, retrieved_at: retrievedAt,
      })),
      // The same published day retrieved twice is the same fact. Skipping keeps the observation
      // immutable rather than producing a rival row.
      skipDuplicates: true,
    });
  }
  return { status: 'available' as const, currency: upper, series_key: seriesKey, http_status: response.status, reason: null, snapshot, observations };
}

export interface FxObservationRow {
  id: string;
  provider: string;
  series_key: string;
  base_currency: string;
  quote_currency: string;
  rate: Prisma.Decimal | string | number;
  observation_date: Date;
  retrieved_at: Date;
}

export interface DerivedFxRate {
  base_currency: string;
  quote_currency: string;
  /** Units of quote per ONE base. */
  rate: number;
  observation_date: string;
  derivation: 'published' | 'cross_via_eur';
  /** Every source observation the rate rests on. A cross rate always names both legs. */
  sources: Array<{ observation_id: string; series_key: string; base_currency: string; quote_currency: string; rate: string; observation_date: string; role: 'numerator' | 'denominator' | 'published' }>;
  formula: string;
}

const iso = (value: Date) => value.toISOString().slice(0, 10);
const rateOf = (row: FxObservationRow) => Number(row.rate.toString());

/**
 * Derive `quote per one base` from published EUR-denominated observations.
 *
 * Both legs must carry the SAME observation date. Mixing a Monday numerator with a Friday
 * denominator produces a rate that was never true on any day, and no amount of provenance makes
 * that honest — so it is refused rather than blended.
 */
export function deriveFxRate(args: {
  base_currency: string;
  quote_currency: string;
  /** Latest permitted observation date, inclusive. Never later than the assessment clock. */
  as_of_date: string;
  /** How far back a non-publication day may be walked. */
  max_lookback_days: number;
  observations: readonly FxObservationRow[];
}): { status: 'available'; rate: DerivedFxRate } | { status: 'unavailable'; reason: string } {
  const base = args.base_currency.toUpperCase();
  const quote = args.quote_currency.toUpperCase();
  if (base === quote) return { status: 'unavailable', reason: 'A currency pair requires two different currencies.' };

  const horizon = new Date(`${args.as_of_date}T00:00:00.000Z`);
  if (Number.isNaN(horizon.getTime())) return { status: 'unavailable', reason: 'The as-of date is not a valid date.' };
  const earliest = new Date(horizon.getTime() - args.max_lookback_days * 86_400_000);

  // Future observations are excluded outright: a rate published after the assessment clock was
  // not knowable at the moment the assessment claims to describe.
  const usable = args.observations
    .filter((row) => row.observation_date.getTime() <= horizon.getTime() && row.observation_date.getTime() >= earliest.getTime() && Number.isFinite(rateOf(row)) && rateOf(row) > 0)
    .sort((left, right) => right.observation_date.getTime() - left.observation_date.getTime());
  if (!usable.length) return { status: 'unavailable', reason: `No published observation on or before ${args.as_of_date} within ${args.max_lookback_days} days.` };

  const byDate = new Map<string, FxObservationRow[]>();
  for (const row of usable) {
    const day = iso(row.observation_date);
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(row);
  }
  const days = [...byDate.keys()].sort((left, right) => right.localeCompare(left));

  for (const day of days) {
    const rows = byDate.get(day)!;
    const find = (currency: string) => rows.find((row) => row.quote_currency === currency && row.base_currency === ECB_BASE_CURRENCY);

    // Published directly: ECB quotes foreign currency per euro, so EUR->X is a published series.
    if (base === ECB_BASE_CURRENCY) {
      const leg = find(quote);
      if (!leg) continue;
      return { status: 'available', rate: { base_currency: base, quote_currency: quote, rate: rateOf(leg), observation_date: day, derivation: 'published', formula: `${quote} per 1 ${base} = published ${leg.series_key}`, sources: [{ observation_id: leg.id, series_key: leg.series_key, base_currency: leg.base_currency, quote_currency: leg.quote_currency, rate: leg.rate.toString(), observation_date: day, role: 'published' }] } };
    }

    // Cross rate: (quote per EUR) / (base per EUR) = quote per base. Both legs, same day.
    const numerator = quote === ECB_BASE_CURRENCY ? null : find(quote);
    const denominator = find(base);
    if (!denominator) continue;
    if (quote === ECB_BASE_CURRENCY) {
      return { status: 'available', rate: { base_currency: base, quote_currency: quote, rate: 1 / rateOf(denominator), observation_date: day, derivation: 'cross_via_eur', formula: `EUR per 1 ${base} = 1 / (${base} per 1 EUR)`, sources: [{ observation_id: denominator.id, series_key: denominator.series_key, base_currency: denominator.base_currency, quote_currency: denominator.quote_currency, rate: denominator.rate.toString(), observation_date: day, role: 'denominator' }] } };
    }
    if (!numerator) continue;
    return {
      status: 'available',
      rate: {
        base_currency: base, quote_currency: quote,
        rate: rateOf(numerator) / rateOf(denominator),
        observation_date: day, derivation: 'cross_via_eur',
        formula: `${quote} per 1 ${base} = (${quote} per 1 EUR) / (${base} per 1 EUR)`,
        sources: [
          { observation_id: numerator.id, series_key: numerator.series_key, base_currency: numerator.base_currency, quote_currency: numerator.quote_currency, rate: numerator.rate.toString(), observation_date: day, role: 'numerator' },
          { observation_id: denominator.id, series_key: denominator.series_key, base_currency: denominator.base_currency, quote_currency: denominator.quote_currency, rate: denominator.rate.toString(), observation_date: day, role: 'denominator' },
        ],
      },
    };
  }
  return { status: 'unavailable', reason: `No single published day on or before ${args.as_of_date} carries every leg required for ${base}/${quote}.` };
}
