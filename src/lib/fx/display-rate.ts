/**
 * Today's rupee rate for display (owner decision 14 Oct 2026, D-023). Rupee figures shown beside
 * dollar figures follow the newest ECB reference rate, so they change from day to day; stored run
 * values stay in US dollars and nothing here is written into a run.
 *
 * The rate is the ECB's INR and USD reference rates crossed on the same published day
 * (`deriveFxRate`). When the newest stored day is older than the newest day the ECB could have
 * published, both series are fetched over the last week and stored like every other ECB
 * observation (`ingestEcbSeries`) — at most once an hour per process, so a page view never waits on
 * a fetch more than that. A failed fetch leaves the newest stored rate, or none.
 */
import { appEnvironment } from '@/lib/evidence-environment';
import { deriveFxRate, ECB_BASE_CURRENCY, ingestEcbSeries } from '@/lib/fx/ecb';
import { prisma } from '@/lib/prisma';

export interface DisplayRate {
  /** Rupees per one US dollar. */
  inr_per_usd: number;
  /** The ECB publication day the rate belongs to (YYYY-MM-DD). */
  observation_date: string;
  source: 'ECB';
}

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 7;
const REFETCH_AFTER_MS = 60 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;

let lastFetchAttempt = 0;
let cached: { at: number; value: DisplayRate | null } | null = null;

const iso = (value: Date) => value.toISOString().slice(0, 10);

/**
 * The newest day the ECB could have published by `now`: reference rates appear around 16:00 CET on
 * business days, so before 15:00 UTC it is the previous weekday. TARGET holidays are not modelled;
 * on one, the hourly refetch simply finds nothing newer.
 */
export function expectedNewestEcbDay(now: Date): string {
  let day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() < 15) day = new Date(day.getTime() - DAY_MS);
  while (day.getUTCDay() === 0 || day.getUTCDay() === 6) day = new Date(day.getTime() - DAY_MS);
  return iso(day);
}

async function derive(now: Date): Promise<DisplayRate | null> {
  const observations = await prisma.authoritativeFxObservation.findMany({
    where: { environment: appEnvironment(), base_currency: ECB_BASE_CURRENCY, quote_currency: { in: ['INR', 'USD'] }, observation_date: { gte: new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS), lte: now } },
    select: { id: true, provider: true, series_key: true, base_currency: true, quote_currency: true, rate: true, observation_date: true, retrieved_at: true },
  });
  const result = deriveFxRate({ base_currency: 'USD', quote_currency: 'INR', as_of_date: iso(now), max_lookback_days: LOOKBACK_DAYS, observations });
  return result.status === 'available' ? { inr_per_usd: result.rate.rate, observation_date: result.rate.observation_date, source: 'ECB' } : null;
}

/** Rupees per US dollar at the newest ECB rate, or null when none can be had. Never throws. */
export async function todayInrPerUsd(now: Date = new Date(), options: { ingest?: typeof ingestEcbSeries } = {}): Promise<DisplayRate | null> {
  try {
    if (cached && now.getTime() - cached.at < CACHE_MS) return cached.value;
    let rate = await derive(now);
    const stale = !rate || rate.observation_date < expectedNewestEcbDay(now);
    if (stale && now.getTime() - lastFetchAttempt >= REFETCH_AFTER_MS) {
      lastFetchAttempt = now.getTime();
      const window = { start_date: iso(new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS)), end_date: iso(now) };
      const ingest = options.ingest ?? ingestEcbSeries;
      await Promise.all(['INR', 'USD'].map((currency) => ingest(currency, window).catch(() => null)));
      rate = await derive(now);
    }
    cached = { at: now.getTime(), value: rate };
    return rate;
  } catch {
    return null;
  }
}

/** Test seam: forget the cached rate and the last fetch attempt. */
export function resetDisplayRateForTesting() {
  cached = null;
  lastFetchAttempt = 0;
}
