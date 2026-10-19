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
import { fetchUkMarketAccess, UK_TARIFF_DESTINATIONS } from '@/lib/market-access/uk-tariff';
import { fetchUsMarketAccess, US_HTS_DESTINATIONS } from '@/lib/market-access/us-hts';
import { unconfiguredSourceForCountry } from '@/lib/market-access/unconfigured-sources';
import { EU_TARIC_DESTINATIONS, fetchEuTaricMarketAccess } from '@/lib/market-access/taric/service';
import { fetchCanadaMarketAccess } from '@/lib/market-access/providers/canada-service';
import { fetchTaiwanMarketAccess } from '@/lib/market-access/providers/taiwan-service';
import { fetchGeorgiaMarketAccess } from '@/lib/market-access/providers/geo-service';
import { fetchNzMarketAccess } from '@/lib/market-access/providers/nz-service';
import { fetchAustraliaMarketAccess } from '@/lib/market-access/providers/australia-service';
import { fetchJapanMarketAccess } from '@/lib/market-access/providers/japan-service';
import { fetchNorwayMarketAccess } from '@/lib/market-access/providers/norway-service';
import { fetchKoreaMarketAccess } from '@/lib/market-access/providers/korea-service';
import { fetchIsraelMarketAccess } from '@/lib/market-access/providers/israel-service';
import { fetchPeruMarketAccess } from '@/lib/market-access/providers/peru-service';
import { fetchIcelandMarketAccess } from '@/lib/market-access/providers/iceland-service';
import { fetchOmanMarketAccess } from '@/lib/market-access/providers/oman-service';
import { fetchAlbaniaMarketAccess, fetchBhutanMarketAccess, fetchMauritiusMarketAccess, fetchNepalMarketAccess, fetchSriLankaMarketAccess } from '@/lib/market-access/providers/green-wave-service';
import { fetchIndonesiaMarketAccess } from '@/lib/market-access/providers/indonesia-service';
import { fetchSaudiMarketAccess } from '@/lib/market-access/providers/saudi-service';
import { fetchQatarMarketAccess } from '@/lib/market-access/providers/qatar-service';
import { fetchKuwaitMarketAccess } from '@/lib/market-access/providers/kuwait-service';
import { fetchUzbekistanMarketAccess } from '@/lib/market-access/providers/uzbekistan-service';
import { fetchVietnamMarketAccess } from '@/lib/market-access/providers/vietnam-service';
import { fetchMoroccoMarketAccess } from '@/lib/market-access/providers/morocco-service';
import { fetchTunisiaMarketAccess } from '@/lib/market-access/providers/tunisia-service';
import { fetchSingaporeMarketAccess } from '@/lib/market-access/providers/singapore-service';
import { CUSTOMS_UNION_SOURCES, type CustomsUnionKey } from '@/lib/market-access/providers/customs-union-sources';
import { TARIFF_SCHEDULE_SOURCES, type TariffScheduleKey } from '@/lib/market-access/providers/tariff-schedule-sources';
import { fetchTariffScheduleMarketAccess } from '@/lib/market-access/providers/tariff-schedule-service';
import { fetchCustomsUnionMarketAccess } from '@/lib/market-access/providers/customs-union-service';

export interface MarketAccessAdapterRequest {
  hs6: string;
  /** Always the exact destination being ingested, even for a source that covers a whole bloc. */
  destination_country: string;
  origin_country?: string;
  producer_or_exporter?: string;
  now?: Date;
}

/** What every Market Access source is wrapped to look like at the routing boundary. */
export interface MarketAccessAdapter {
  readonly provider_key: string;
  /**
   * How the source dates its evidence, which decides what `now` may be passed:
   * - `live_fetch` — an online API that stamps `retrieved_at` with `now` (UK, US). It must be
   *   called at real time; passing an earlier clock would backdate the retrieval.
   * - `retained_release` — resolves a retained authority release, uses `now` only as the date the
   *   tariff is resolved at, and stamps the release's own retrieval time.
   */
  readonly retrieval: 'live_fetch' | 'retained_release';
  fetch(request: MarketAccessAdapterRequest): Promise<MarketAccessIngestResult>;
}

const UK_ADAPTER: MarketAccessAdapter = {
  provider_key: 'uk_tariff',
  retrieval: 'live_fetch',
  fetch: (request) => fetchUkMarketAccess(request.hs6, { now: request.now, destination_country: request.destination_country }),
};

const US_ADAPTER: MarketAccessAdapter = {
  provider_key: 'us_hts',
  retrieval: 'live_fetch',
  fetch: (request) => fetchUsMarketAccess(request.hs6, { now: request.now, destination_country: request.destination_country }),
};

const EU_TARIC_ADAPTER: MarketAccessAdapter = {
  provider_key: 'eu_taric',
  retrieval: 'retained_release',
  fetch: (request) => fetchEuTaricMarketAccess(request.hs6, {
    now: request.now,
    destination_country: request.destination_country,
    origin_country: request.origin_country,
  }),
};

const CANADA_ADAPTER: MarketAccessAdapter = {
  provider_key: 'canada_cbsa_customs_tariff',
  retrieval: 'retained_release',
  fetch: (request) => fetchCanadaMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const NZ_ADAPTER: MarketAccessAdapter = {
  provider_key: 'nz_customs_cusmod',
  retrieval: 'retained_release',
  fetch: (request) => fetchNzMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const AUSTRALIA_ADAPTER: MarketAccessAdapter = {
  provider_key: 'au_abf_working_tariff',
  retrieval: 'retained_release',
  fetch: (request) => fetchAustraliaMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const NORWAY_ADAPTER: MarketAccessAdapter = {
  provider_key: 'no_tolletaten_customs_tariff',
  retrieval: 'retained_release',
  fetch: (request) => fetchNorwayMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const JAPAN_ADAPTER: MarketAccessAdapter = {
  provider_key: 'japan_customs_tariff_schedule',
  retrieval: 'retained_release',
  fetch: (request) => fetchJapanMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const TAIWAN_ADAPTER: MarketAccessAdapter = {
  provider_key: 'tw_customs_import_duty',
  retrieval: 'retained_release',
  fetch: (request) => fetchTaiwanMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const GEORGIA_ADAPTER: MarketAccessAdapter = {
  provider_key: 'ge_matsne_tax_code_article_197',
  retrieval: 'retained_release',
  fetch: (request) => fetchGeorgiaMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const KOREA_ADAPTER: MarketAccessAdapter = {
  provider_key: 'kr_kcs_customs_tariff',
  retrieval: 'retained_release',
  fetch: (request) => fetchKoreaMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const ISRAEL_ADAPTER: MarketAccessAdapter = {
  provider_key: 'il_tax_authority_customs_book',
  retrieval: 'retained_release',
  fetch: (request) => fetchIsraelMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const PERU_ADAPTER: MarketAccessAdapter = {
  provider_key: 'pe_sunat_customs_tariff',
  retrieval: 'retained_release',
  fetch: (request) => fetchPeruMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const ICELAND_ADAPTER: MarketAccessAdapter = {
  provider_key: 'is_skatturinn_tollskrarlyklar',
  retrieval: 'retained_release',
  fetch: (request) => fetchIcelandMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const OMAN_ADAPTER: MarketAccessAdapter = {
  provider_key: 'om_rop_customs_tariff',
  retrieval: 'retained_release',
  fetch: (request) => fetchOmanMarketAccess(request.hs6, {
    now: request.now,
    origin_country: request.origin_country,
  }),
};

const NEPAL_ADAPTER: MarketAccessAdapter = { provider_key: 'np_customs_tariff_pdf', retrieval: 'retained_release', fetch: (request) => fetchNepalMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const BHUTAN_ADAPTER: MarketAccessAdapter = { provider_key: 'bt_drc_tariff_pdf', retrieval: 'retained_release', fetch: (request) => fetchBhutanMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const ALBANIA_ADAPTER: MarketAccessAdapter = { provider_key: 'al_customs_nomenclature_archive', retrieval: 'retained_release', fetch: (request) => fetchAlbaniaMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const MAURITIUS_ADAPTER: MarketAccessAdapter = { provider_key: 'mu_mra_integrated_tariff', retrieval: 'retained_release', fetch: (request) => fetchMauritiusMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const LK_ADAPTER: MarketAccessAdapter = { provider_key: 'lk_customs_tariff', retrieval: 'retained_release', fetch: (request) => fetchSriLankaMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const INDONESIA_ADAPTER: MarketAccessAdapter = { provider_key: 'id_kemenkeu_btki', retrieval: 'retained_release', fetch: (request) => fetchIndonesiaMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country, producer_or_exporter: request.producer_or_exporter }) };
const SAUDI_ADAPTER: MarketAccessAdapter = { provider_key: 'sa_zatca_integrated_tariff', retrieval: 'retained_release', fetch: (request) => fetchSaudiMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const QATAR_ADAPTER: MarketAccessAdapter = { provider_key: 'qa_customs_integrated_tariff', retrieval: 'retained_release', fetch: (request) => fetchQatarMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const KUWAIT_ADAPTER: MarketAccessAdapter = { provider_key: 'kw_customs_integrated_tariff', retrieval: 'retained_release', fetch: (request) => fetchKuwaitMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const UZBEKISTAN_ADAPTER: MarketAccessAdapter = { provider_key: 'uz_lex_customs_tariff', retrieval: 'retained_release', fetch: (request) => fetchUzbekistanMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const VIETNAM_ADAPTER: MarketAccessAdapter = { provider_key: 'vn_congbao_tariff', retrieval: 'retained_release', fetch: (request) => fetchVietnamMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const MOROCCO_ADAPTER: MarketAccessAdapter = { provider_key: 'ma_adii_tariff', retrieval: 'retained_release', fetch: (request) => fetchMoroccoMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
const TUNISIA_ADAPTER: MarketAccessAdapter = { provider_key: 'tn_douane_tarifweb', retrieval: 'retained_release', fetch: (request) => fetchTunisiaMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };
/**
 * D-029: Singapore Statutes Online may be fetched automatically only from 03:00 to 07:00 Singapore
 * Time, so runs read the release the worker saves in that window (`singapore-refresh.ts`). Until the
 * first one passes qualification there is none, and the run records `no_release`, never a zero.
 */
/**
 * D-028: a customs union's common external tariff serves every member that applies it as its own,
 * from one retained release per union (`customs-union-service.ts`), labelled as a common tariff.
 */
const customsUnionAdapter = (union: CustomsUnionKey): MarketAccessAdapter => ({
  provider_key: CUSTOMS_UNION_SOURCES[union].provider, retrieval: 'retained_release',
  fetch: (request) => fetchCustomsUnionMarketAccess(union, request.destination_country, request.hs6, { now: request.now, origin_country: request.origin_country }),
});
const CUSTOMS_UNION_ADAPTERS = Object.fromEntries(Object.values(CUSTOMS_UNION_SOURCES).flatMap((source) => {
  const adapter = customsUnionAdapter(source.key);
  return source.members.map((code) => [code, adapter] as const);
}));

/**
 * D-030: retained tariff schedules — a market's own national tariff (China, Brazil) or its customs
 * union's common tariff (GCC for the UAE and Bahrain, Mercosur for Argentina, Paraguay and Uruguay),
 * one release per official publication (`tariff-schedule-service.ts`).
 */
const tariffScheduleAdapter = (key: TariffScheduleKey): MarketAccessAdapter => ({
  provider_key: TARIFF_SCHEDULE_SOURCES[key].provider, retrieval: 'retained_release',
  fetch: (request) => fetchTariffScheduleMarketAccess(key, request.destination_country, request.hs6, { now: request.now, origin_country: request.origin_country }),
});
const TARIFF_SCHEDULE_ADAPTERS = Object.fromEntries(Object.values(TARIFF_SCHEDULE_SOURCES).flatMap((source) => {
  const adapter = tariffScheduleAdapter(source.key);
  return Object.keys(source.countries).map((code) => [code, adapter] as const);
}));

const SINGAPORE_ADAPTER: MarketAccessAdapter = { provider_key: 'sg_sso_customs_duties_order', retrieval: 'retained_release', fetch: (request) => fetchSingaporeMarketAccess(request.hs6, { now: request.now, origin_country: request.origin_country }) };

/**
 * Every destination with an official, documented, machine-readable tariff interface, built once
 * from each source's own destination list rather than duplicating that list here. Two sources
 * claiming the same destination would silently overwrite one another in this object — there is
 * no such overlap today, and this is where a future one would first become visible.
 */
export const DESTINATION_ADAPTERS: Readonly<Record<string, MarketAccessAdapter>> = Object.freeze({
  CA: CANADA_ADAPTER,
  NZ: NZ_ADAPTER,
  JP: JAPAN_ADAPTER,
  AU: AUSTRALIA_ADAPTER,
  NO: NORWAY_ADAPTER,
  KR: KOREA_ADAPTER,
  TW: TAIWAN_ADAPTER,
  GE: GEORGIA_ADAPTER,
  IL: ISRAEL_ADAPTER,
  PE: PERU_ADAPTER,
  IS: ICELAND_ADAPTER,
  LK: LK_ADAPTER,
  OM: OMAN_ADAPTER,
  NP: NEPAL_ADAPTER,
  BT: BHUTAN_ADAPTER,
  AL: ALBANIA_ADAPTER,
  MU: MAURITIUS_ADAPTER,
  ID: INDONESIA_ADAPTER,
  SA: SAUDI_ADAPTER,
  QA: QATAR_ADAPTER,
  KW: KUWAIT_ADAPTER,
  UZ: UZBEKISTAN_ADAPTER,
  VN: VIETNAM_ADAPTER,
  MA: MOROCCO_ADAPTER,
  TN: TUNISIA_ADAPTER,
  SG: SINGAPORE_ADAPTER,
  ...CUSTOMS_UNION_ADAPTERS,
  ...TARIFF_SCHEDULE_ADAPTERS,
  ...Object.fromEntries(UK_TARIFF_DESTINATIONS.map((code) => [code, UK_ADAPTER] as const)),
  ...Object.fromEntries(US_HTS_DESTINATIONS.map((code) => [code, US_ADAPTER] as const)),
  ...Object.fromEntries(EU_TARIC_DESTINATIONS.map((code) => [code, EU_TARIC_ADAPTER] as const)),
});

export async function runMarketAccessIngest(ctx: JobContext): Promise<JobOutcome> {
  const payload = ctx.payload as { country_code?: string; hs_code?: string; origin_country?: string; producer_or_exporter?: string };
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

  const result = await adapter.fetch({ hs6, destination_country: country, origin_country: payload.origin_country, producer_or_exporter: payload.producer_or_exporter });
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
