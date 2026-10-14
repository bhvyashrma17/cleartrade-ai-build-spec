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
 */
import { acquireTariffEvidence, tariffAdapterFor, tariffClockFor, type TariffAcquisitionOutcome } from '@/lib/country-truth/tariff-acquisition';

export const V5_TARIFF_ACQUISITION_POLICY_VERSION = 'demand-discovery-v5-tariff-acquisition-v1';

export interface V5TariffStep {
  outcomes: TariffAcquisitionOutcome[];
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
}): Promise<V5TariffStep> {
  const groups = new Map<string, string[]>();
  for (const market of [...new Set(args.markets.map((code) => code.trim().toUpperCase()))].sort()) {
    const adapter = tariffAdapterFor(market);
    if (!adapter) continue;
    groups.set(adapter.provider_key, [...(groups.get(adapter.provider_key) ?? []), market]);
  }
  const outcomes: TariffAcquisitionOutcome[] = [];
  for (const [, destinations] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    outcomes.push(...await acquireTariffEvidence({
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
  outcomes.sort((left, right) => left.country_code.localeCompare(right.country_code));
  return { outcomes, tariff_clock: tariffClockFor(args.resolution_clock, outcomes, (args.now ?? (() => new Date()))()) };
}
