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
 *
 * D-025: a currency the ECB does not publish but whose rate is fixed against one it does
 * (`curated:currency-pegs`) is converted through its peg — the anchor's ECB rate on the run date
 * times the published parity — without asking the ECB for a series it does not have. A stored ECB
 * rate, where one exists, always comes first.
 *
 * D-028: a floating currency the ECB does not publish (Sri Lankan rupee, Vietnamese dong…) uses the
 * US Treasury reporting rate (`src/lib/fx/treasury.ts`): quarterly, public domain, the newest one
 * in force on the run date within `treasury.lookback_days`. With fetching allowed, a run that finds
 * none stored fetches the Treasury list once and keeps it. Never used for a currency the ECB quotes.
 */
import { appEnvironment } from '@/lib/evidence-environment';
import { deriveFxRate, ECB_BASE_CURRENCY, ecbSeriesKey, ingestEcbSeries } from '@/lib/fx/ecb';
import { ingestTreasuryRates, TREASURY_BASE_CURRENCY, TREASURY_PROVIDER } from '@/lib/fx/treasury';
import { prisma } from '@/lib/prisma';
import { anchorPerUnit, type CurrencyPegRow } from '@/lib/reference-datasets/currency-pegs';

/**
 * Currencies with an ECB euro reference rate in 2026 (the Bulgarian lev ended with the euro on
 * 1 January 2026; the rouble has been suspended since March 2022). A Treasury rate never stands in
 * for one of these: a missing ECB day is a gap, not a reason to use a quarter-old rate.
 */
export const ECB_REFERENCE_CURRENCIES: ReadonlySet<string> = new Set([
  'AUD', 'BRL', 'CAD', 'CHF', 'CNY', 'CZK', 'DKK', 'GBP', 'HKD', 'HUF', 'IDR', 'ILS', 'INR', 'ISK', 'JPY',
  'KRW', 'MXN', 'MYR', 'NOK', 'NZD', 'PHP', 'PLN', 'RON', 'SEK', 'SGD', 'THB', 'TRY', 'USD', 'ZAR',
]);

export interface FxFetchRecord {
  currency: string;
  series_key: string;
  /** Absent for an ECB series; `us_treasury` for the one Treasury list a run may fetch (`currency` is then `ALL`). */
  provider?: 'us_treasury';
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

export function createUsdRateResolver(args: {
  as_of: Date; lookback_days: number; fetch_missing: boolean; ingest?: Ingest; pegs?: readonly CurrencyPegRow[];
  /** D-028: the Treasury fallback for floating currencies the ECB does not publish. */
  treasury?: { enabled: boolean; lookback_days: number; ingest?: typeof ingestTreasuryRates };
}) {
  const ingest = args.ingest ?? ingestEcbSeries;
  const pegs = new Map((args.pegs ?? []).map((peg) => [peg.currency, peg] as const));
  const earliest = new Date(args.as_of.getTime() - args.lookback_days * 86_400_000);
  const window = { start_date: day(earliest), end_date: day(args.as_of) };
  const rates = new Map<string, Promise<UsdRate>>();
  const fetches = new Map<string, Promise<FxFetchRecord>>();
  const treasuryEarliest = new Date(args.as_of.getTime() - (args.treasury?.lookback_days ?? 0) * 86_400_000);
  let treasuryFetch: Promise<FxFetchRecord> | null = null;

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

  /** USD per unit through a published peg: the anchor's own rate times the parity. */
  async function viaPeg(code: string, peg: CurrencyPegRow): Promise<UsdRate> {
    const anchor = await usdOf(peg.anchor);
    const parity = { anchor: peg.anchor, units_per_anchor: peg.units_per_anchor, anchor_per_unit: peg.anchor_per_unit, authority: peg.authority, source_url: peg.source_url, source_kind: peg.source_kind };
    if (anchor.rate == null) {
      const why = typeof anchor.frozen?.reason === 'string' ? anchor.frozen.reason : 'no rate';
      return { rate: null, frozen: { currency: code, status: 'unavailable', reason: `${code} is fixed to ${peg.anchor}, and the ${peg.anchor} rate is unavailable: ${why}`, peg: parity } };
    }
    const rate = anchor.rate * anchorPerUnit(peg);
    return { rate, frozen: { currency: code, rate, derivation: 'peg', formula: `USD per 1 ${code} = (USD per 1 ${peg.anchor}) × (${peg.anchor} per 1 ${code})`, peg: parity, anchor_rate: anchor.frozen } };
  }

  /** The newest stored Treasury rate in force on the run date within the Treasury lookback. */
  async function storedTreasury(code: string) {
    const [row] = await prisma.authoritativeFxObservation.findMany({
      where: { environment: appEnvironment(), provider: TREASURY_PROVIDER, base_currency: TREASURY_BASE_CURRENCY, quote_currency: code, observation_date: { gte: treasuryEarliest, lte: args.as_of } },
      select: { id: true, series_key: true, rate: true, observation_date: true, observation_status: true },
      orderBy: [{ observation_date: 'desc' }, { series_key: 'asc' }],
      take: 1,
    });
    return row ?? null;
  }

  /** One Treasury fetch per run, shared by every currency that needs it. */
  function fetchTreasury(): Promise<FxFetchRecord> {
    if (!treasuryFetch) {
      const treasuryWindow = { start_date: day(treasuryEarliest), end_date: day(args.as_of) };
      const base = { currency: 'ALL', series_key: 'rates_of_exchange', provider: 'us_treasury' as const, window: treasuryWindow };
      treasuryFetch = (async (): Promise<FxFetchRecord> => {
        try {
          const result = await (args.treasury?.ingest ?? ingestTreasuryRates)({ since: treasuryWindow.start_date });
          const unrecognised = result.unrecognised.length ? `Unrecognised descriptions skipped: ${result.unrecognised.join(', ')}.` : null;
          return { ...base, status: result.status === 'stored' ? 'stored' : 'failed', http_status: result.http_status, snapshot_id: result.snapshot_ids[0] ?? null, observations: result.observations, reason: result.reason ?? unrecognised };
        } catch (error) {
          return { ...base, status: 'failed', http_status: null, snapshot_id: null, observations: 0, reason: error instanceof Error ? error.message : 'The Treasury request failed.' };
        }
      })();
    }
    return treasuryFetch;
  }

  /** USD per unit from the Treasury's foreign-currency-per-dollar rate, or null when none is held. */
  async function viaTreasury(code: string): Promise<UsdRate | null> {
    let row = await storedTreasury(code);
    if (!row && args.fetch_missing) {
      await fetchTreasury();
      row = await storedTreasury(code);
    }
    const unitsPerUsd = row ? Number(row.rate.toString()) : NaN;
    if (!row || !(unitsPerUsd > 0)) return null;
    const rate = 1 / unitsPerUsd;
    return {
      rate,
      frozen: {
        currency: code, rate, derivation: 'treasury_reporting_rate', observation_date: day(row.observation_date),
        formula: `USD per 1 ${code} = 1 / (${code} per 1 USD, US Treasury reporting rate)`,
        source: { provider: TREASURY_PROVIDER, observation_id: row.id, series_key: row.series_key, units_per_usd: row.rate.toString(), status: row.observation_status },
      },
    };
  }

  async function resolve(code: string): Promise<UsdRate> {
    let derived = await derive(code);
    const peg = pegs.get(code);
    if (derived.status === 'unavailable' && peg) return viaPeg(code, peg);
    let ecbLacksSeries = !ECB_REFERENCE_CURRENCIES.has(code);
    if (derived.status === 'unavailable' && args.fetch_missing) {
      // EUR is the denominator of every ECB series, so it is never fetched; every other leg is.
      const legs = [code, 'USD'].filter((currency) => currency !== ECB_BASE_CURRENCY);
      const records = await Promise.all(legs.map(fetchSeries));
      if (records.find((record) => record.currency === code)?.status === 'unavailable') ecbLacksSeries = true;
      derived = await derive(code);
    }
    if (derived.status === 'unavailable' && ecbLacksSeries && args.treasury?.enabled) {
      const treasury = await viaTreasury(code);
      if (treasury) return treasury;
      return { rate: null, frozen: { currency: code, status: 'unavailable', reason: `${derived.reason} No US Treasury reporting rate for ${code} is held within ${args.treasury.lookback_days} days either.` } };
    }
    if (derived.status === 'unavailable') return { rate: null, frozen: { currency: code, status: 'unavailable', reason: derived.reason } };
    return { rate: derived.rate.rate, frozen: { currency: code, ...derived.rate } };
  }

  function usdOf(currency: string | null): Promise<UsdRate> {
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
  }

  return {
    /** USD per one unit of `currency` on the run date, or null with the reason frozen. */
    usd: usdOf,
    /** Every ECB fetch this run made, and its Treasury fetch if it made one, in currency order. */
    async fetches(): Promise<FxFetchRecord[]> {
      const records = await Promise.all([...fetches.values(), ...(treasuryFetch ? [treasuryFetch] : [])]);
      return records.sort((left, right) => left.currency.localeCompare(right.currency));
    },
  };
}

export type UsdRateResolver = ReturnType<typeof createUsdRateResolver>;
