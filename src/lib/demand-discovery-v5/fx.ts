/**
 * The exchange rates one v5 run needs: US dollars per one unit of a currency on the run date,
 * derived from published ECB reference rates (`src/lib/fx/ecb.ts`). Used for the exporter's own
 * price and for specific duties quoted per kilogram or tonne.
 *
 * A run reads what the environment has stored first. When no single published day within the
 * lookback carries every leg a rate needs, and `fetch_missing` allows it, the run fetches the
 * missing ECB series over exactly that window, stores them (`ingestEcbSeries`: immutable, raw
 * response kept) and derives again. Nothing else loads ECB rates into an environment, so without
 * this a price outside US dollars could never be compared (E-018).
 *
 * A fetch that fails never fails the run: the rate is unavailable, the metric that needed it says
 * why, and the run is marked degraded. An ECB 404 means the ECB publishes no series for that
 * currency — a fact about the source, recorded as unavailable rather than as a failure.
 */
import { appEnvironment } from '@/lib/evidence-environment';
import { deriveFxRate, ECB_BASE_CURRENCY, ecbSeriesKey, ingestEcbSeries } from '@/lib/fx/ecb';
import { prisma } from '@/lib/prisma';

export interface FxFetchRecord {
  currency: string;
  series_key: string;
  /** `stored`: the series was fetched and kept; `unavailable`: the ECB publishes no such series; `failed`: the fetch did not complete. */
  status: 'stored' | 'unavailable' | 'failed';
  http_status: number | null;
  snapshot_id: string | null;
  observations: number;
  window: { start_date: string; end_date: string };
  reason: string | null;
}

export interface UsdRate {
  rate: number | null;
  frozen: Record<string, unknown> | null;
}

type Ingest = typeof ingestEcbSeries;

const day = (value: Date) => value.toISOString().slice(0, 10);

export function createUsdRateResolver(args: { as_of: Date; lookback_days: number; fetch_missing: boolean; ingest?: Ingest }) {
  const ingest = args.ingest ?? ingestEcbSeries;
  const earliest = new Date(args.as_of.getTime() - args.lookback_days * 86_400_000);
  const window = { start_date: day(earliest), end_date: day(args.as_of) };
  const rates = new Map<string, Promise<UsdRate>>();
  const fetches = new Map<string, Promise<FxFetchRecord>>();

  async function derive(code: string) {
    const observations = await prisma.authoritativeFxObservation.findMany({
      where: { environment: appEnvironment(), base_currency: ECB_BASE_CURRENCY, quote_currency: { in: [code, 'USD'] }, observation_date: { gte: earliest, lte: args.as_of } },
      select: { id: true, provider: true, series_key: true, base_currency: true, quote_currency: true, rate: true, observation_date: true, retrieved_at: true },
    });
    return deriveFxRate({ base_currency: code, quote_currency: 'USD', as_of_date: window.end_date, max_lookback_days: args.lookback_days, observations });
  }

  /** One fetch per series per run, shared by every rate that needs it (USD is a leg of all of them). */
  function fetchSeries(currency: string): Promise<FxFetchRecord> {
    let pending = fetches.get(currency);
    if (!pending) {
      pending = (async (): Promise<FxFetchRecord> => {
        const base = { currency, series_key: ecbSeriesKey(currency), window };
        try {
          const result = await ingest(currency, { start_date: window.start_date, end_date: window.end_date });
          if (result.status === 'available') {
            return { ...base, status: 'stored', http_status: result.http_status, snapshot_id: result.snapshot?.id ?? null, observations: result.observations.length, reason: result.observations.length ? null : 'The ECB published no rate in this window.' };
          }
          return { ...base, status: result.http_status === 404 ? 'unavailable' : 'failed', http_status: result.http_status, snapshot_id: null, observations: 0, reason: result.reason };
        } catch (error) {
          return { ...base, status: 'failed', http_status: null, snapshot_id: null, observations: 0, reason: error instanceof Error ? error.message : 'The ECB request failed.' };
        }
      })();
      fetches.set(currency, pending);
    }
    return pending;
  }

  async function resolve(code: string): Promise<UsdRate> {
    let derived = await derive(code);
    if (derived.status === 'unavailable' && args.fetch_missing) {
      // EUR is the denominator of every ECB series, so it is never fetched; every other leg is.
      const legs = [code, 'USD'].filter((currency) => currency !== ECB_BASE_CURRENCY);
      await Promise.all(legs.map(fetchSeries));
      derived = await derive(code);
    }
    if (derived.status === 'unavailable') return { rate: null, frozen: { currency: code, status: 'unavailable', reason: derived.reason } };
    return { rate: derived.rate.rate, frozen: { currency: code, ...derived.rate } };
  }

  return {
    /** USD per one unit of `currency` on the run date, or null with the reason frozen. */
    usd(currency: string | null): Promise<UsdRate> {
      if (!currency) return Promise.resolve({ rate: null, frozen: null });
      const code = currency.trim().toUpperCase();
      if (code === 'USD') return Promise.resolve({ rate: 1, frozen: { currency: 'USD', rate: 1, derivation: 'identity' } });
      // A malformed code on a product form is not a provider failure: no fetch, no degraded run.
      if (!/^[A-Z]{3}$/.test(code)) return Promise.resolve({ rate: null, frozen: { currency: code, status: 'unavailable', reason: `"${currency}" is not an ISO 4217 currency code.` } });
      let pending = rates.get(code);
      if (!pending) {
        pending = resolve(code);
        rates.set(code, pending);
      }
      return pending;
    },
    /** Every ECB fetch this run made, in currency order. */
    async fetches(): Promise<FxFetchRecord[]> {
      const records = await Promise.all([...fetches.values()]);
      return records.sort((left, right) => left.currency.localeCompare(right.currency));
    },
  };
}

export type UsdRateResolver = ReturnType<typeof createUsdRateResolver>;
