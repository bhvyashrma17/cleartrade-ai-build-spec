/**
 * WP2 — Customs Atlas tariff acquisition inside the deep Country Truth run (docs/35 E-004).
 *
 * Before this, the deep run only READ market-access snapshots that someone had ingested earlier, so
 * whether a market had tariff evidence depended on an operator having run `ingest:market-access` for
 * that destination and HS6 before the screen. This acquires it for the run's own shortlist.
 *
 * Three rules shape it:
 *
 *   1. **The deep job owns it, inline.** Each destination's Atlas adapter runs inside the deep job
 *      rather than as a child `market_access_ingest` job: the worker claims one job at a time, so a
 *      deep job waiting on children it cannot run would deadlock the only worker.
 *   2. **Never backdate a retrieval.** A `retained_release` adapter resolves a retained authority
 *      release at `resolution_clock` and stamps the release's own retrieval time, so it may be given
 *      an earlier clock. A `live_fetch` adapter (UK, US) stamps `retrieved_at` with whatever `now` it
 *      is given, so it is always called at real time.
 *   3. **Missing is a recorded outcome, never zero.** A destination without a source, with an
 *      unconfigured source, whose adapter fails, or whose live fetch times out is recorded with its
 *      reason and the run continues. Its market access stays unavailable — with that reason — in the
 *      assessment. Tariff evidence is a gate requirement (docs/34), not a run requirement.
 *      A retained-release source with no release imported yet is `no_release`, not `failed`: nothing
 *      was attempted that could fail (D-029 — Singapore's release is saved in its nightly window).
 *
 * Every finished destination is handed to `onOutcome` immediately so the caller can checkpoint it;
 * a retried run passes those outcomes back in `completed` and they are not acquired again.
 */
import type { CountryTruthMarketAccessOrchestrationPolicy } from '@/lib/config';
import { DESTINATION_ADAPTERS, type MarketAccessAdapter } from '@/lib/job-handlers/market-access';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { log } from '@/lib/observability';

export type TariffAcquisitionOutcomeKind =
  | 'acquired'
  | 'unconfigured_source'
  | 'no_source'
  | 'no_release'
  /** The connected source does not cover this product for this market (Andorra outside HS 25–97). */
  | 'not_covered'
  | 'failed'
  | 'timed_out'
  | 'skipped_over_cap';

export interface TariffAcquisitionOutcome {
  country_code: string;
  outcome: TariffAcquisitionOutcomeKind;
  provider_key: string | null;
  retrieval: MarketAccessAdapter['retrieval'] | null;
  snapshot_id: string | null;
  /** False when an identical release ingest already existed and was reused. */
  snapshot_created_by_run: boolean | null;
  retrieved_at: string | null;
  source_version: string | null;
  authority_release_id: string | null;
  classification_resolution: string | null;
  tariff_coverage: boolean | null;
  reason: string | null;
  elapsed_ms: number;
}

type AdapterResolver = (countryCode: string) => MarketAccessAdapter | undefined;
let resolverOverride: AdapterResolver | null = null;

/** Test seam, in the manner of `setComtradeClient`: route destinations to in-process doubles. */
export function setTariffAdapterResolverForTesting(resolver: AdapterResolver | null) {
  resolverOverride = resolver;
}

function resolveAdapter(countryCode: string): MarketAccessAdapter | undefined {
  return resolverOverride ? resolverOverride(countryCode) : DESTINATION_ADAPTERS[countryCode];
}

/** The Customs Atlas adapter that would serve `countryCode`, or undefined when none is connected (honours the test seam). */
export function tariffAdapterFor(countryCode: string): MarketAccessAdapter | undefined {
  return resolveAdapter(countryCode.trim().toUpperCase());
}

const TIMED_OUT = Symbol('timed_out');

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T | typeof TIMED_OUT> {
  // A live fetch cannot be cancelled. Once abandoned, its eventual rejection must not surface as
  // an unhandled rejection, and its eventual result is simply never persisted.
  work.catch(() => undefined);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([work, new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** One line, bounded: an operator-readable reason that cannot carry a stack or a response body. */
function safeReason(error: unknown): string {
  // A validation error's own message is generic ("Some details need attention…"); its fields say what.
  const details = validationFields(error).map((field) => field.message).filter((message): message is string => !!message);
  const text = details.length ? details.join('; ') : error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 300) || 'Adapter failed without a message.';
}

function validationFields(error: unknown): { field?: string; code?: string; message?: string }[] {
  const fields = (error as { fields?: unknown } | null)?.fields;
  return Array.isArray(fields) ? fields as { field?: string; code?: string; message?: string }[] : [];
}

function outcome(
  countryCode: string,
  kind: TariffAcquisitionOutcomeKind,
  startedAt: number,
  fields: Partial<Omit<TariffAcquisitionOutcome, 'country_code' | 'outcome' | 'elapsed_ms'>> = {},
): TariffAcquisitionOutcome {
  return {
    country_code: countryCode,
    outcome: kind,
    provider_key: null,
    retrieval: null,
    snapshot_id: null,
    snapshot_created_by_run: null,
    retrieved_at: null,
    source_version: null,
    authority_release_id: null,
    classification_resolution: null,
    tariff_coverage: null,
    reason: null,
    ...fields,
    elapsed_ms: Math.max(0, Date.now() - startedAt),
  };
}

export interface TariffAcquisitionArgs {
  job_id: string;
  hs6: string;
  /** ISO alpha-2 destinations — the run's frozen shortlist. */
  destinations: readonly string[];
  /** The instant retained releases are resolved at; frozen by the caller so a retry resolves identically. */
  resolution_clock: Date;
  policy: CountryTruthMarketAccessOrchestrationPolicy;
  /** Outcomes already checkpointed by an earlier attempt; those destinations are not acquired again. */
  completed: readonly TariffAcquisitionOutcome[];
  onOutcome: (outcomes: TariffAcquisitionOutcome[]) => Promise<void>;
  correlation_id?: string;
}

async function acquireOne(countryCode: string, args: TariffAcquisitionArgs): Promise<TariffAcquisitionOutcome> {
  const startedAt = Date.now();
  const adapter = resolveAdapter(countryCode);
  if (!adapter) {
    const unconfigured = unconfiguredSourceForCountry(countryCode);
    return unconfigured
      ? outcome(countryCode, 'unconfigured_source', startedAt, { reason: `${unconfigured.authority}: ${unconfigured.reason}. ${unconfigured.determination}`.slice(0, 300) })
      : outcome(countryCode, 'no_source', startedAt, { reason: 'No authoritative market-access source is connected or documented for this destination.' });
  }
  const identity = { provider_key: adapter.provider_key, retrieval: adapter.retrieval };
  try {
    const request = {
      hs6: args.hs6,
      destination_country: countryCode,
      origin_country: args.policy.origin_country,
      ...(adapter.retrieval === 'retained_release' ? { now: args.resolution_clock } : {}),
    };
    const fetched = adapter.retrieval === 'live_fetch'
      ? await withTimeout(adapter.fetch(request), args.policy.live_fetch_timeout_ms)
      : await adapter.fetch(request);
    if (fetched === TIMED_OUT) {
      return outcome(countryCode, 'timed_out', startedAt, { ...identity, reason: `Live fetch exceeded ${args.policy.live_fetch_timeout_ms} ms; nothing was persisted.` });
    }
    if (fetched.country_code.toUpperCase() !== countryCode || fetched.hs6 !== args.hs6) {
      return outcome(countryCode, 'failed', startedAt, { ...identity, reason: `Adapter answered for ${fetched.country_code}/${fetched.hs6}, not ${countryCode}/${args.hs6}; nothing was persisted.` });
    }
    const snapshot = await persistMarketAccessIngest(fetched, { source_run_id: args.job_id });
    return outcome(countryCode, 'acquired', startedAt, {
      ...identity,
      snapshot_id: snapshot.id,
      snapshot_created_by_run: snapshot.source_run_id === args.job_id,
      retrieved_at: snapshot.retrieved_at.toISOString(),
      source_version: snapshot.source_version,
      authority_release_id: snapshot.authority_release_id,
      classification_resolution: snapshot.classification_resolution,
      tariff_coverage: snapshot.tariff_coverage,
    });
  } catch (error) {
    const missing = adapter.retrieval === 'retained_release' ? noReleaseImported(error) : null;
    if (missing) return outcome(countryCode, 'no_release', startedAt, { ...identity, reason: safeReason(missing) });
    // A source that serves this market for part of the tariff only refuses the rest by design; the
    // market's own tariff applies there, so this is not a failure of the run.
    if (validationFields(error).some((field) => field.code === 'outside_customs_union')) return outcome(countryCode, 'not_covered', startedAt, { ...identity, reason: safeReason(error) });
    return outcome(countryCode, 'failed', startedAt, { ...identity, reason: safeReason(error) });
  }
}

/** Every retained-release service reports "nothing imported and activated yet" the same way; its message, or null. */
function noReleaseImported(error: unknown): string | null {
  const field = validationFields(error).find((item) => item.field === 'release' && item.code === 'missing');
  return field ? field.message || 'No official release has been imported and activated.' : null;
}

const byCountry = (outcomes: Iterable<TariffAcquisitionOutcome>) =>
  [...outcomes].sort((left, right) => left.country_code.localeCompare(right.country_code));

/** Acquire tariff evidence for every destination, in a deterministic order, checkpointing as it goes. */
export async function acquireTariffEvidence(args: TariffAcquisitionArgs): Promise<TariffAcquisitionOutcome[]> {
  const outcomes = new Map(args.completed.map((item) => [item.country_code, item] as const));
  const destinations = [...new Set(args.destinations.map((code) => code.trim().toUpperCase()))].sort();
  for (const [index, countryCode] of destinations.entries()) {
    if (outcomes.has(countryCode)) continue;
    const result = index >= args.policy.max_destinations
      ? outcome(countryCode, 'skipped_over_cap', Date.now(), { reason: `Shortlist exceeds the orchestration cap of ${args.policy.max_destinations} destinations.` })
      : await acquireOne(countryCode, args);
    outcomes.set(countryCode, result);
    log(result.outcome === 'acquired' ? 'info' : 'warn', 'country_truth_tariff_acquisition', {
      job_id: args.job_id,
      correlation_id: args.correlation_id,
      country_code: countryCode,
      hs6: args.hs6,
      outcome: result.outcome,
      provider_key: result.provider_key ?? undefined,
      snapshot_id: result.snapshot_id ?? undefined,
      snapshot_created_by_run: result.snapshot_created_by_run ?? undefined,
      elapsed_ms: result.elapsed_ms,
      reason: result.reason ?? undefined,
    });
    await args.onOutcome(byCountry(outcomes.values()));
  }
  return byCountry(outcomes.values());
}

/**
 * The run's tariff clock: no earlier than the trade clock, than the end of acquisition, or than any
 * acquired retrieval. Everything this run acquired is therefore admissible at it.
 */
export function tariffClockFor(tradeClock: Date, outcomes: readonly TariffAcquisitionOutcome[], now: Date = new Date()): Date {
  const retrievals = outcomes.flatMap((item) => (item.retrieved_at ? [Date.parse(item.retrieved_at)] : [])).filter(Number.isFinite);
  return new Date(Math.max(tradeClock.getTime(), now.getTime(), ...retrievals));
}
