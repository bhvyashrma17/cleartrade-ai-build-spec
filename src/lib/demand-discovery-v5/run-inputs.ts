/**
 * Everything a v5 run reads, gathered once and frozen (docs/36 §7).
 *
 * The scoring engine (`assess.ts`) is pure; this module is where the database, object storage and
 * Comtrade meet it. It reads the newest ready BACI releases, runs the HS-revision test, reads the
 * active reference datasets, makes the batched Comtrade calls the config allows, derives the
 * exporter's figures, and records every identity it read — release ids, checksums, evidence ids —
 * so a finished run can say exactly what it was computed from.
 *
 * Missing reference data never fails a run: its metric is unavailable and the run says so.
 * A missing BACI release does, because without trade data nothing can be ranked.
 */
import { EvidenceOrigin } from '@prisma/client';
import { comtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { getConfig, type DemandDiscoveryV5Config } from '@/lib/config';
import { buildCountryScreeningUniverse } from '@/lib/country-screening/universe';
import type { DocumentStorage } from '@/lib/document-storage';
import { prerequisitesNotMet } from '@/lib/errors';
import { appEnvironment } from '@/lib/evidence-environment';
import { deriveFxRate } from '@/lib/fx/ecb';
import { prisma } from '@/lib/prisma';
import { comtradeAvailabilityRowSchema, indiaTradeAgreementRowSchema, wdiRowSchema } from '@/lib/reference-datasets/parsers';
import { activeReferenceRows } from '@/lib/reference-datasets/service';
import { BACI_PROVIDER, type BaciHsRevision } from '@/lib/trade-datasets/baci';
import { latestReadyTradeDatasetRelease, readProductFlows } from '@/lib/trade-datasets/service';
import type { AssessMarketsInput } from './assess';
import { baciFlowsToTradeFlows } from './baci-flows';
import { runBatchedComtradeQuery, v5ComtradeAccess, type ComtradeStepResult } from './comtrade-step';
import { comtradePartnerIdentity, fallbackMarketSeries, newestYearInputs, type ReportedYears } from './comtrade-inputs';
import { dutyInputs, type SectorTariff } from './duty-inputs';
import { exporterUsdPerKg, exporterYearlyKg } from './exporter-inputs';
import { policyHash } from './policy';
import { testHsRevision, worldTotals, type HsRevisionTest } from './hs-revision';
import type { TradeFlowInput } from './series';

export const V5_INPUTS_SCHEMA_VERSION = 'demand-discovery-v5-inputs-v1';

/** The product facts a run needs, frozen into the run's snapshot at enqueue. */
export interface V5ProductFacts {
  price_target_amount: number | null;
  price_target_currency: string | null;
  price_target_quantity_unit: string | null;
  price_target_incoterm: string | null;
  unit_net_weight_value: number | null;
  unit_net_weight_unit: string | null;
  capacity_value: number | null;
  capacity_unit: string | null;
  capacity_period: string | null;
}

export interface LoadedRunInputs {
  input: AssessMarketsInput;
  frozen: Record<string, unknown>;
  evidence_origins: EvidenceOrigin[];
  /** Plain-language gaps for the job result: what the run could not use, and why. */
  notes: string[];
  /** An attempted provider step failed; the run completes as `partial`. */
  degraded: boolean;
}

export const noTradeRelease = () => prerequisitesNotMet(
  [{ object_type: 'trade_dataset_release', object_id: 'cepii_baci', reason: 'No CEPII BACI release is ready in this environment; import one with scripts/import-trade-dataset-release.ts.' }],
  'Markets cannot be ranked yet: the trade dataset is not imported in this environment.',
);

async function baciRelease(revision: BaciHsRevision, hs6: string, storage?: DocumentStorage) {
  const release = await latestReadyTradeDatasetRelease(BACI_PROVIDER, revision);
  if (!release) return null;
  const [read, countries] = await Promise.all([
    readProductFlows({ release_id: release.id, hs6, storage }),
    prisma.tradeDatasetCountry.findMany({ where: { release_id: release.id }, select: { provider_code: true, iso2: true } }),
  ]);
  const converted = baciFlowsToTradeFlows(read.flows, countries);
  return {
    release, read, converted,
    frozen: {
      release_id: release.id, dataset_version: release.dataset_version, hs_revision: release.hs_revision, archive_sha256: release.archive_sha256,
      manifest_sha256: release.manifest_sha256, first_year: release.first_year, last_year: release.last_year, licence: release.licence,
      partitions: read.partitions.map((partition) => ({ year: partition.year, sha256: partition.sha256 })), dropped_self_flows: converted.dropped_self_flows,
    },
  };
}

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);

async function referenceMap(key: string) {
  const active = await activeReferenceRows(key, wdiRowSchema);
  return {
    active,
    map: new Map((active?.rows ?? []).map((row) => [row.iso2, { value: row.value, year: row.year } satisfies SectorTariff])),
    frozen: active ? { release_id: active.release_id, version: active.version, rows_sha256: active.rows_sha256 } : null,
  };
}

async function availability(year: number) {
  const active = await activeReferenceRows(`comtrade:availability:${year}`, comtradeAvailabilityRowSchema);
  return { active, codes: new Set((active?.rows ?? []).map((row) => row.reporter_code)) };
}

/** USD per one unit of `currency` on the run date, from published ECB observations, or null. */
async function usdRate(currency: string | null, asOf: Date, lookbackDays: number) {
  if (!currency) return { rate: null, frozen: null };
  const code = currency.trim().toUpperCase();
  if (code === 'USD') return { rate: 1, frozen: { currency: 'USD', rate: 1, derivation: 'identity' } };
  const earliest = new Date(asOf.getTime() - lookbackDays * 86_400_000);
  const observations = await prisma.authoritativeFxObservation.findMany({
    where: { environment: appEnvironment(), base_currency: 'EUR', quote_currency: { in: [code, 'USD'] }, observation_date: { gte: earliest, lte: asOf } },
    select: { id: true, provider: true, series_key: true, base_currency: true, quote_currency: true, rate: true, observation_date: true, retrieved_at: true },
  });
  const derived = deriveFxRate({ base_currency: code, quote_currency: 'USD', as_of_date: asOf.toISOString().slice(0, 10), max_lookback_days: lookbackDays, observations });
  if (derived.status === 'unavailable') return { rate: null, frozen: { currency: code, status: 'unavailable', reason: derived.reason } };
  return { rate: derived.rate.rate, frozen: { currency: code, ...derived.rate } };
}

export async function loadRunInputs(args: {
  hs6: string;
  as_of: Date;
  product: V5ProductFacts;
  config: DemandDiscoveryV5Config;
  storage?: DocumentStorage;
}): Promise<LoadedRunInputs> {
  const { config } = args;
  const policy = config.policy;
  const notes: string[] = [];
  let degraded = false;
  const origins = new Set<EvidenceOrigin>();

  // --- markets -------------------------------------------------------------------------------
  const screening = await getConfig('country_screening.policy');
  const registry = comtradeReporterRegistry();
  const universe = buildCountryScreeningUniverse({
    universe_version: screening.universe_version,
    reporter_identity_strategy: screening.reporter_identity_strategy,
    reporter_registry_version: screening.reporter_registry_version,
    excluded_iso2_codes: screening.excluded_iso2_codes,
    exclude_origin_country: screening.exclude_origin_country,
    origin_country_iso2: screening.origin_country_iso2,
    registry,
  });
  const marketReporters = universe.entries.map((entry) => ({ iso2: entry.iso2, reporter_code: entry.reporter_code }));
  const markets = marketReporters.map((entry) => entry.iso2);

  // --- BACI and the HS-revision test (§3.4) ---------------------------------------------------
  const [hs17, hs22] = await Promise.all([baciRelease('HS17', args.hs6, args.storage), baciRelease('HS22', args.hs6, args.storage)]);
  if (!hs17 && !hs22) throw noTradeRelease();
  let revision: HsRevisionTest | { verdict: 'not_tested'; reason: string };
  let chosen = hs22 ?? hs17!;
  let shortHistory = false;
  if (hs17 && hs22) {
    const overlap = range(Math.max(hs17.release.first_year, hs22.release.first_year), Math.min(hs17.release.last_year, hs22.release.last_year));
    revision = testHsRevision({ hs6: args.hs6, older: worldTotals(hs17.converted.flows), newer: worldTotals(hs22.converted.flows), overlap_years: overlap, max_divergence: policy.hs_revision.max_total_divergence });
    chosen = revision.use_older_revision ? hs17 : hs22;
    shortHistory = !revision.use_older_revision;
  } else if (hs22) {
    revision = { verdict: 'not_tested', reason: 'No HS17 release is ready; only the HS22 years are used.' };
    shortHistory = true;
  } else {
    revision = { verdict: 'not_tested', reason: 'No HS22 release is ready; the HS17 code is used without the equivalence test.' };
    notes.push('The HS 2022 dataset is not imported, so the older edition was used without checking the code means the same thing.');
  }
  if (shortHistory) notes.push('This code changed in HS 2022, so growth is measured over the years since 2022 only.');
  origins.add(chosen.release.evidence_origin);
  const baseYears = range(chosen.release.first_year, chosen.release.last_year);
  const latest = chosen.release.last_year;

  // --- reference datasets ---------------------------------------------------------------------
  const [lpi, primary, manufactured, availabilityLatest, availabilityNewest, agreements] = await Promise.all([
    referenceMap('wdi:LP.LPI.OVRL.XQ'), referenceMap('wdi:TM.TAX.TCOM.SM.AR.ZS'), referenceMap('wdi:TM.TAX.MANF.SM.AR.ZS'),
    availability(latest), availability(latest + 1), activeReferenceRows('india:trade-agreements', indiaTradeAgreementRowSchema),
  ]);
  for (const reference of [lpi.active, primary.active, manufactured.active, availabilityLatest.active, availabilityNewest.active, agreements]) if (reference) origins.add(reference.evidence_origin);
  if (!agreements) notes.push("India's trade agreements are not imported, so duty estimates assume no agreement.");
  if (!lpi.active) notes.push('Logistics scores are missing: the World Bank logistics index is not imported.');
  if (!primary.active && !manufactured.active) notes.push('Duty estimates are missing: the World Bank tariff averages are not imported.');
  if (!availabilityLatest.active) notes.push(`Comtrade's ${latest} reporting list is not imported, so every market is treated as estimated from partners' figures.`);
  notes.push('Country risk and distance are not scored yet: the ECGC list and capital coordinates are not imported.');

  const reported: ReportedYears = new Map([[latest, availabilityLatest.codes], [latest + 1, availabilityNewest.codes]]);

  // --- Comtrade: newest year and market-level fallback (§3.3, §5.3) ---------------------------
  const comtradePolicy = await getConfig('comtrade.policy');
  const access = v5ComtradeAccess(comtradePolicy);
  const reporterCodes = marketReporters.map((entry) => entry.reporter_code);
  const partnerIdentity = comtradePartnerIdentity(registry.reporters);
  const frozenComtrade: Record<string, unknown> = {};
  const record = (name: string, step: ComtradeStepResult | { status: 'disabled'; reason: string }) => {
    frozenComtrade[name] = 'evidence_ids' in step
      ? { status: step.status, reason: step.reason, evidence_ids: step.evidence_ids, physical_calls: step.physical_calls, complete: step.complete }
      : step;
    if (step.status === 'used') origins.add(access.source_origin);
    if (step.status === 'failed') degraded = true;
  };

  let newestYear: AssessMarketsInput['newest_year'] = new Map();
  if (!config.comtrade_newest_year) record('newest_year', { status: 'disabled', reason: 'Switched off in demand_discovery.v5 config.' });
  else {
    const step = await runBatchedComtradeQuery({ query: { hs6: args.hs6, flow: 'M', periods: [latest, latest + 1], reporters: 'all', partners: ['0', '699'], max_records: config.comtrade_max_records }, access, comtrade_policy: comtradePolicy, reporter_universe: reporterCodes });
    record('newest_year', step);
    if (step.status === 'used') newestYear = newestYearInputs({ rows: step.rows, base_year: latest, markets: marketReporters, reported });
    else notes.push(step.status === 'failed' ? `The ${latest + 1} figures could not be fetched (${step.reason}); scores use ${latest} data.` : `Scores use ${latest} data: ${step.reason}`);
  }

  const uncovered = marketReporters.filter((entry) => !chosen.converted.markets_covered.has(entry.iso2) && !policy.excluded_markets[entry.iso2]);
  const fallback = new Map<string, { years: number[]; flows: TradeFlowInput[] }>();
  if (uncovered.length) {
    if (!config.comtrade_market_fallback) record('market_fallback', { status: 'disabled', reason: 'Switched off in demand_discovery.v5 config.' });
    else {
      const candidateYears = range(latest - policy.window_years + 1, latest + 1);
      const step = await runBatchedComtradeQuery({ query: { hs6: args.hs6, flow: 'M', periods: candidateYears, reporters: uncovered.map((entry) => entry.reporter_code), partners: 'all', max_records: config.comtrade_max_records }, access, comtrade_policy: comtradePolicy, reporter_universe: uncovered.map((entry) => entry.reporter_code) });
      record('market_fallback', step);
      if (step.status === 'used') {
        const reportedAll: ReportedYears = new Map(candidateYears.map((year) => [year, reported.get(year) ?? new Set<string>()]));
        for (const market of uncovered) {
          const series = fallbackMarketSeries({ rows: step.rows, market, candidate_years: candidateYears, reported: reportedAll, window_years: policy.window_years, partner_identity: partnerIdentity });
          if (series && series.flows.length) fallback.set(market.iso2, { years: series.years, flows: series.flows });
        }
      }
    }
  }

  // --- the exporter's own figures --------------------------------------------------------------
  const fx = await usdRate(args.product.price_target_currency, args.as_of, config.fx_max_lookback_days);
  const price = exporterUsdPerKg(args.product, fx.rate);
  const volume = exporterYearlyKg(args.product);

  const input: AssessMarketsInput = {
    policy,
    markets,
    base: { years: baseYears, flows: chosen.converted.flows, markets_covered: chosen.converted.markets_covered, short_history: shortHistory },
    fallback,
    reported_latest_year: availabilityLatest.codes.size ? new Set(marketReporters.filter((entry) => availabilityLatest.codes.has(entry.reporter_code)).map((entry) => entry.iso2)) : new Set(),
    newest_year: newestYear,
    coordinates: new Map(),
    lpi: new Map([...lpi.map].map(([iso2, row]) => [iso2, row.value])),
    ecgc: new Map(),
    duty: dutyInputs({ markets, hs6: args.hs6, as_of: args.as_of, official: new Map(), primary_tariffs: primary.map, manufactured_tariffs: manufactured.map, agreements: agreements?.rows ?? [], policy }),
    exporter: {
      usd_per_kg: price.value, yearly_kg: volume.value,
      price_reason: price.value == null ? price.reason : null, volume_reason: volume.value == null ? volume.reason : null,
    },
  };

  const frozen = {
    schema_version: V5_INPUTS_SCHEMA_VERSION,
    as_of_date: args.as_of.toISOString(),
    hs6: args.hs6,
    policy_version: policy.policy_version,
    policy_hash: policyHash(policy),
    universe: { version: universe.version, checksum: universe.checksum, size: universe.size },
    baci: { hs17: hs17?.frozen ?? null, hs22: hs22?.frozen ?? null, chosen_release_id: chosen.release.id, revision_test: revision, base_years: baseYears, short_history: shortHistory },
    reference: {
      'wdi:LP.LPI.OVRL.XQ': lpi.frozen, 'wdi:TM.TAX.TCOM.SM.AR.ZS': primary.frozen, 'wdi:TM.TAX.MANF.SM.AR.ZS': manufactured.frozen,
      [`comtrade:availability:${latest}`]: availabilityLatest.active ? { release_id: availabilityLatest.active.release_id, rows_sha256: availabilityLatest.active.rows_sha256 } : null,
      [`comtrade:availability:${latest + 1}`]: availabilityNewest.active ? { release_id: availabilityNewest.active.release_id, rows_sha256: availabilityNewest.active.rows_sha256 } : null,
      ecgc: null, geo_cepii: null,
      'india:trade-agreements': agreements ? { release_id: agreements.release_id, version: agreements.version, rows_sha256: agreements.rows_sha256 } : null,
    },
    comtrade: frozenComtrade,
    fallback_markets: [...fallback.keys()],
    official_duty: { status: 'not_wired', reason: 'Customs Atlas evidence is not read by v5 yet; every duty is the labelled estimate.' },
    exporter: { fx: fx.frozen, usd_per_kg: price, yearly_kg: volume },
  };

  return { input, frozen, evidence_origins: [...origins].sort(), notes, degraded };
}
