/**
 * Market Access ingest, routed by destination.
 *
 * Every destination resolves to exactly one of three outcomes, and the third is a first-class
 * result rather than an error: an authoritative machine source, an authoritative source that
 * publishes no interface we may rely on, or nothing at all. A destination in the second group
 * returns a structured determination naming why — it never falls through to a guess, a scrape,
 * or another country's schedule.
 *
 * Routing is one declared table, not a map plus a special case. EU TARIC covers 27 destinations
 * from a single release and previously needed its own branch because it does not fit the same
 * call shape as the UK/US fetchers (it takes the destination as an argument rather than being
 * baked into the function); `MarketAccessAdapter` is the common shape every source is wrapped to
 * fit, so a new destination — inside or outside an existing bloc — is one more table entry.
 */
import { JobStatus } from '@prisma/client';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { persistMarketAccessIngest, type MarketAccessIngestResult } from '@/lib/market-access/contract';
import { fetchUkMarketAccess } from '@/lib/market-access/uk-tariff';
import { fetchUsMarketAccess } from '@/lib/market-access/us-hts';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { EU_TARIC_DESTINATIONS, fetchEuTaricMarketAccess } from '@/lib/market-access/taric/service';
import { fetchCanadaMarketAccess } from '@/lib/market-access/providers/canada-service';
import { fetchNzMarketAccess } from '@/lib/market-access/providers/nz-service';
import { fetchAustraliaMarketAccess } from '@/lib/market-access/providers/australia-service';
import { fetchJapanMarketAccess } from '@/lib/market-access/providers/japan-service';

export interface MarketAccessAdapterRequest {
  hs6: string;
  /** Always the exact destination being ingested, even for a source that covers a whole bloc. */
  destination_country: string;
  origin_country?: string;
  now?: Date;
}

/** What every Market Access source is wrapped to look like at the routing boundary. */
export interface MarketAccessAdapter {
  readonly provider_key: string;
  fetch(request: MarketAccessAdapterRequest): Promise<MarketAccessIngestResult>;
}

const UK_ADAPTER: MarketAccessAdapter = {
  provider_key: 'uk_tariff',
  fetch: (request) => fetchUkMarketAccess(request.hs6, { now: request.now }),
};

const US_ADAPTER: MarketAccessAdapter = {
  provider_key: 'us_hts',
  fetch: (request) => fetchUsMarketAccess(request.hs6, { now: request.now }),
};

const EU_TARIC_ADAPTER: MarketAccessAdapter = {
  provider_key: 'eu_taric',
  fetch: (request) => fetchEuTaricMarketAccess(request.hs6, {
    now: request.now,
    destination_country: request.destination_country,
    origin_country: request.origin_country,
  }),
};

const CANADA_ADAPTER: MarketAccessAdapter = {
  provider_key: 'canada_cbsa_customs_tariff',
  fetch: (request) => fetchCanadaMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const NZ_ADAPTER: MarketAccessAdapter = {
  provider_key: 'nz_customs_cusmod',
  fetch: (request) => fetchNzMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const AUSTRALIA_ADAPTER: MarketAccessAdapter = {
  provider_key: 'au_abf_working_tariff',
  fetch: (request) => fetchAustraliaMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const JAPAN_ADAPTER: MarketAccessAdapter = {
  provider_key: 'japan_customs_tariff_schedule',
  fetch: (request) => fetchJapanMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

/**
 * Every destination with an official, documented, machine-readable tariff interface, built once
 * from each source's own destination list rather than duplicating that list here. Two sources
 * claiming the same destination would silently overwrite one another in this object — there is
 * no such overlap today, and this is where a future one would first become visible.
 */
export const DESTINATION_ADAPTERS: Readonly<Record<string, MarketAccessAdapter>> = Object.freeze({
  GB: UK_ADAPTER,
  US: US_ADAPTER,
  CA: CANADA_ADAPTER,
  NZ: NZ_ADAPTER,
  JP: JAPAN_ADAPTER,
  AU: AUSTRALIA_ADAPTER,
  ...Object.fromEntries(EU_TARIC_DESTINATIONS.map((code) => [code, EU_TARIC_ADAPTER] as const)),
});

export async function runMarketAccessIngest(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as { country_code?: string; hs_code?: string };
  const country = (payload.country_code ?? '').trim().toUpperCase();
  const hs6 = (payload.hs_code ?? '').trim();
  if (!/^[A-Z]{2}$/.test(country)) return { status: JobStatus.failed, result: { error: 'Market access ingest requires an ISO alpha-2 destination.' } };
  if (!/^\d{6}$/.test(hs6)) return { status: JobStatus.failed, result: { error: 'Market access ingest requires an exact HS6.' } };

  const adapter = DESTINATION_ADAPTERS[country];
  if (!adapter) {
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

  const result = await adapter.fetch({ hs6, destination_country: country });
  const snapshot = await persistMarketAccessIngest(result, { source_run_id: ctx.job_id });
  return {
    status: JobStatus.completed,
    result: {
      country_code: country, hs_code: hs6, snapshot_id: snapshot.id,
      provider_state: 'authoritative_public',
      provider: result.provider, source_authority: result.source_authority,
      source_dataset_version: result.source_dataset_version,
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
