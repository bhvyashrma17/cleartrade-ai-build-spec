/**
 * Market Access ingest, routed by destination.
 *
 * Every destination resolves to exactly one of three outcomes, and the third is a first-class
 * result rather than an error: an authoritative machine source, an authoritative source that
 * publishes no interface we may rely on, or nothing at all. A destination in the second group
 * returns a structured determination naming why — it never falls through to a guess, a scrape,
 * or another country's schedule.
 */
import { JobStatus } from '@prisma/client';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { fetchUkMarketAccess } from '@/lib/market-access/uk-tariff';
import { fetchUsMarketAccess } from '@/lib/market-access/us-hts';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';

type Fetcher = (hs6: string, options: { now?: Date }) => Promise<Awaited<ReturnType<typeof fetchUkMarketAccess>>>;

/** Destinations with an official, documented, machine-readable tariff interface. */
const AUTOMATED_SOURCES: Readonly<Record<string, Fetcher>> = Object.freeze({
  GB: fetchUkMarketAccess,
  US: fetchUsMarketAccess,
});

export async function runMarketAccessIngest(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as { country_code?: string; hs_code?: string };
  const country = (payload.country_code ?? '').trim().toUpperCase();
  const hs6 = (payload.hs_code ?? '').trim();
  if (!/^[A-Z]{2}$/.test(country)) return { status: JobStatus.failed, result: { error: 'Market access ingest requires an ISO alpha-2 destination.' } };
  if (!/^\d{6}$/.test(hs6)) return { status: JobStatus.failed, result: { error: 'Market access ingest requires an exact HS6.' } };

  const fetcher = AUTOMATED_SOURCES[country];
  if (!fetcher) {
    const unconfigured = unconfiguredSourceForCountry(country);
    if (unconfigured) {
      // Not a failure: the source is known, authoritative and deliberately not automated. The
      // determination travels with the result so the gap is legible without reading code.
      return {
        status: JobStatus.completed,
        result: {
          country_code: country, hs_code: hs6, snapshot_id: null,
          provider_state: 'provider_unconfigured_or_license_pending',
          authority: unconfigured.authority, reason: unconfigured.reason,
          determination: unconfigured.determination, references: unconfigured.references,
          unblocked_by: unconfigured.unblocked_by,
          next_step: 'authoritative_manual_capture',
        },
      };
    }
    return { status: JobStatus.failed, result: { error: `No authoritative market-access source is connected or documented for ${country}.`, country_code: country, hs_code: hs6 } };
  }

  const result = await fetcher(hs6, {});
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: ctx.job_id });
  return {
    status: JobStatus.completed,
    result: {
      country_code: country, hs_code: hs6, snapshot_id: snapshot.id,
      provider_state: 'authoritative_public',
      provider: result.provider, source_authority: result.source_authority,
      classification_resolution: result.resolution.resolution,
      candidate_line_count: result.resolution.candidate_count,
      resolved_national_code: result.resolution.resolved_line?.national_tariff_code ?? null,
      general_duty_expression: result.general_duty?.expression ?? null,
      general_duty_kind: result.general_duty?.kind ?? null,
      india_preference_applicability: result.india_preference.applicability,
      regulatory_coverage_complete: result.regulatory_coverage_complete,
      tariff_line_count: snapshot.tariff_lines.length,
      evidence_count: snapshot.evidence.length,
    },
  };
}
