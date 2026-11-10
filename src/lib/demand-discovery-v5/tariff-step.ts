/**
 * Official tariffs looked up inside a v5 run (D-020; docs/36 §7.1).
 *
 * Without this a market has an official duty only where that product's tariff was ingested earlier,
 * so a new product's run would estimate every duty. With it, the run asks every market that has a
 * Customs Atlas source for the product's HS6 before reading tariff evidence, through the same
 * acquisition the deep Country Truth run uses (`country-truth/tariff-acquisition.ts`): inline,
 * because the single worker cannot wait on child jobs; retained releases resolved at the run's
 * clock; live sources (UK, US) at real time and bounded by a timeout; every destination's outcome
 * recorded, a failure never zero.
 *
 * Destinations are taken one source at a time, so a release that serves many markets (EU TARIC
 * serves 27) is decoded once while all of them are answered, rather than evicted from the shared
 * bundle cache by another source between two of its members.
 *
 * R-48 (E-064): a look-up that failed or timed out is asked once more, after a short pause, before
 * the run settles for the estimate. On 10 Nov 2026 the first production run after a deploy lost the
 * UK look-up while the worker read retained releases from cold, and a run two minutes later
 * completed. A retried market records both attempts.
 */
import { acquireTariffEvidence, tariffAdapterFor, tariffClockFor, type TariffAcquisitionOutcome } from '@/lib/country-truth/tariff-acquisition';

export const V5_TARIFF_ACQUISITION_POLICY_VERSION = 'demand-discovery-v5-tariff-acquisition-v1';

/** An outcome, with the first attempt's when the look-up was asked twice (R-48). */
export type V5TariffOutcome = TariffAcquisitionOutcome & { attempts?: number; first_attempt?: { outcome: TariffAcquisitionOutcome['outcome']; reason: string | null } };

const retryable = (outcome: TariffAcquisitionOutcome) => outcome.outcome === 'failed' || outcome.outcome === 'timed_out';

export interface V5TariffStep {
  outcomes: V5TariffOutcome[];
  /** The instant tariff evidence is admitted at: no earlier than the run's clock or any acquired retrieval. */
  tariff_clock: Date;
}

export async function acquireV5Tariffs(args: {
  job_id: string;
  hs6: string;
  markets: readonly string[];
  /** The run's clock; retained releases are resolved at it. */
  resolution_clock: Date;
  live_fetch_timeout_ms: number;
  correlation_id?: string;
  now?: () => Date;
  /** The pause before a failed or timed-out look-up is asked again (R-48). 0 in tests. */
  retry_delay_ms?: number;
}): Promise<V5TariffStep> {
  const groups = new Map<string, string[]>();
  for (const market of [...new Set(args.markets.map((code) => code.trim().toUpperCase()))].sort()) {
    const adapter = tariffAdapterFor(market);
    if (!adapter) continue;
    groups.set(adapter.provider_key, [...(groups.get(adapter.provider_key) ?? []), market]);
  }
  const acquire = async (sources: [string, string[]][]) => {
    const found: TariffAcquisitionOutcome[] = [];
    for (const [, destinations] of [...sources].sort(([left], [right]) => left.localeCompare(right))) {
      found.push(...await acquireTariffEvidence({
        job_id: args.job_id,
        hs6: args.hs6,
        destinations,
        resolution_clock: args.resolution_clock,
        policy: { policy_version: V5_TARIFF_ACQUISITION_POLICY_VERSION, enabled: true, origin_country: 'IN', max_destinations: destinations.length, live_fetch_timeout_ms: args.live_fetch_timeout_ms },
        completed: [],
        onOutcome: async () => undefined,
        correlation_id: args.correlation_id,
      }));
    }
    return found;
  };
  const outcomes: V5TariffOutcome[] = await acquire([...groups]);
  // R-48: one more attempt for each look-up that failed or timed out, source by source as before.
  const again = new Map<string, string[]>();
  for (const outcome of outcomes) if (retryable(outcome)) again.set(outcome.provider_key ?? '', [...(again.get(outcome.provider_key ?? '') ?? []), outcome.country_code]);
  if (again.size) {
    const delay = args.retry_delay_ms ?? 3_000;
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    const second = new Map((await acquire([...again])).map((outcome) => [outcome.country_code, outcome]));
    for (const [index, first] of outcomes.entries()) {
      const retried = second.get(first.country_code);
      if (retryable(first) && retried) outcomes[index] = { ...retried, attempts: 2, first_attempt: { outcome: first.outcome, reason: first.reason } };
    }
  }
  outcomes.sort((left, right) => left.country_code.localeCompare(right.country_code));
  return { outcomes, tariff_clock: tariffClockFor(args.resolution_clock, outcomes, (args.now ?? (() => new Date()))()) };
}

const thatMarket = (count: number) => (count === 1 ? "that market's duty is" : "those markets' duties are");

/**
 * What a run says about its tariff look-up, and whether it is degraded. Only a look-up that failed or
 * timed out degrades the run (it completes as `partial`). A source with nothing saved yet (D-029,
 * Singapore before its first nightly copy) and a source that does not cover the product for a market
 * (Andorra outside HS 25–97, where its own tariff applies) are not failures; the duty falls back as for
 * any market without an official rate, and the run says so.
 */
export function summarizeTariffOutcomes(outcomes: readonly TariffAcquisitionOutcome[]): { degraded: boolean; notes: string[] } {
  const notes: string[] = [];
  const failed = outcomes.filter((item) => item.outcome === 'failed' || item.outcome === 'timed_out');
  const twice = failed.every((item) => (item as V5TariffOutcome).attempts === 2);
  if (failed.length) notes.push(`The official tariff look-up failed${twice ? ' twice' : ''} for ${failed.map((item) => item.country_code).join(', ')}, so ${thatMarket(failed.length)} not the official rate this run.`);
  const unsaved = outcomes.filter((item) => item.outcome === 'no_release');
  if (unsaved.length) notes.push(`No official tariff release is saved yet for ${unsaved.map((item) => item.country_code).join(', ')}, so ${thatMarket(unsaved.length)} not the official rate this run.`);
  const uncovered = outcomes.filter((item) => item.outcome === 'not_covered');
  if (uncovered.length) notes.push(`The connected tariff source does not cover this product for ${uncovered.map((item) => item.country_code).join(', ')}, where the market's own tariff applies, so ${thatMarket(uncovered.length)} not the official rate this run.`);
  return { degraded: failed.length > 0, notes };
}
