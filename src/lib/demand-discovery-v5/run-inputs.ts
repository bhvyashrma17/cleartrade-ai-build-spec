/**
 * Everything a v5 run reads, gathered once and frozen (docs/36 §7).
 *
 * The scoring engine (`assess.ts`) is pure; this module is where the database, object storage and
 * Comtrade meet it. It reads the newest ready BACI releases, runs the HS-revision test, reads the
 * active reference datasets, looks up official tariffs and fetches missing ECB rates when the config
 * allows, makes the batched Comtrade calls the config allows, derives the exporter's figures, and
 * records every identity it read — release ids, checksums, evidence ids —
 * so a finished run can say exactly what it was computed from.
 *
 * Missing reference data never fails a run: its metric is unavailable and the run says so.
 * A missing BACI release does, because without trade data nothing can be ranked.
 */
import { EvidenceOrigin, MarketAccessRuleType } from '@prisma/client';
import { comtradeReporterRegistry } from '@/lib/comtrade/reporter-registry';
import { selectTariffFactsOnly } from '@/lib/country-truth/fact-selection';
import { getConfig, type DemandDiscoveryV5Config } from '@/lib/config';
import { buildCountryScreeningUniverse } from '@/lib/country-screening/universe';
import type { DocumentStorage } from '@/lib/document-storage';
import { prerequisitesNotMet } from '@/lib/errors';
import { allowedEvidenceOrigins } from '@/lib/evidence-environment';
import { CUSTOMS_UNION_PROVIDERS } from '@/lib/market-access/providers/customs-union-sources';
import { tariffScheduleBasisFor } from '@/lib/market-access/providers/tariff-schedule-sources';
import { parseDutyExpression } from '@/lib/market-access/tariff-semantics';
import { prisma } from '@/lib/prisma';
import { ecgcRatingRowSchema } from '@/lib/reference-datasets/ecgc';
import { capitalRowSchema } from '@/lib/reference-datasets/geodist';
import { comtradeAvailabilityRowSchema, indiaTradeAgreementRowSchema, wdiRowSchema } from '@/lib/reference-datasets/parsers';
import { ECGC_COUNTRY_RISK_KEY, GEO_CEPII_KEY } from '@/lib/reference-datasets/registry';
import { CAPITALS_SUPPLEMENT_KEY, capitalSupplementRowSchema } from '@/lib/reference-datasets/capitals-supplement';
import { CURRENCY_PEGS_KEY, currencyPegRowSchema } from '@/lib/reference-datasets/currency-pegs';
import { SANCTIONS_PROGRAMMES_KEY, sanctionsFlagsByMarket, sanctionsProgrammeRowSchema } from '@/lib/reference-datasets/sanctions-programmes';
import { activeReferenceRows } from '@/lib/reference-datasets/service';
import { BACI_PROVIDER, type BaciHsRevision } from '@/lib/trade-datasets/baci';
import { latestReadyTradeDatasetRelease, readProductFlows } from '@/lib/trade-datasets/service';
import type { AssessMarketsInput } from './assess';
import { baciFlowsToTradeFlows } from './baci-flows';
import { runBatchedComtradeQuery, v5ComtradeAccess, type ComtradeStepResult } from './comtrade-step';
import { comtradePartnerIdentity, fallbackMarketSeries, newestYearInputs, type ReportedYears } from './comtrade-inputs';
import { dutyInputs, tariffSector, type SectorTariff } from './duty-inputs';
import { exporterUsdPerKg, exporterYearlyKg } from './exporter-inputs';
import { createUsdRateResolver, type UsdRate } from './fx';
import { logisticsEstimates } from './logistics-fallback';
import { resolveOfficialDuty, storedDuty, type OfficialDutyResolution } from './official-duty';
import { policyHash } from './policy';
import { acquireV5Tariffs, summarizeTariffOutcomes } from './tariff-step';
import { coordinateInputs, ecgcInputs } from './reference-inputs';
import { testHsRevision, worldTotals, type HsRevisionTest } from './hs-revision';
import { splitByAge } from './world-bank';
import type { TradeFlowInput } from './series';

/** Customs Atlas provider of a duty line an agent recorded by hand (`manual-authoritative.ts`). Runs no longer read it (D-037). */
const AGENT_RECORDED_PROVIDER = 'authoritative_manual';

// v3 (17 Oct 2026): adds `logistics_estimate` and the LSCI reference (D-025).
// v4 (18 Oct 2026): each official duty records its `basis` and, for a scored preference, the
// `standard` rate it replaced (D-026).
export const V5_INPUTS_SCHEMA_VERSION = 'demand-discovery-v5-inputs-v4';

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
    provider_codes_without_iso: countries.filter((country) => !country.iso2).map((country) => country.provider_code),
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

/**
 * Customs Atlas evidence for the product's exact HS6 in every market that has any, resolved to the
 * official duty on Indian goods (`official-duty.ts`) under the deep assessment's admission rules.
 * Reads stored evidence; with `tariff_acquisition` on, the run has just looked the product up in every
 * market with a Customs Atlas source (`tariff-step.ts`), and `as_of` is the tariff clock.
 *
 * A line an agent recorded by hand (`authoritative_manual`, D-024) is not read: duty comes only from
 * official sources the system reads itself, or a labelled estimate (owner, 30 Oct 2026, D-037).
 */
async function officialDuties(args: { markets: readonly string[]; hs6: string; as_of: Date; exporter_org_id: string; hs_revision: string; minimum_confidence: number; usd: (currency: string) => Promise<UsdRate>; score_india_preference?: boolean }) {
  const origins = allowedEvidenceOrigins();
  const snapshots = await prisma.marketAccessEvidenceSnapshot.findMany({
    where: { country_code: { in: [...args.markets] }, OR: [{ hs_code_scope: args.hs6 }, { hs6_code: args.hs6 }], retrieved_at: { lte: args.as_of }, evidence_origin: { in: origins }, provider: { not: AGENT_RECORDED_PROVIDER } },
    select: { id: true, country_code: true, provider: true, source_dataset: true, classification_resolution: true, evidence_origin: true },
    orderBy: { id: 'asc' },
  });
  const evidence = snapshots.length
    ? await prisma.marketAccessEvidence.findMany({
        where: {
          snapshot_id: { in: snapshots.map((snapshot) => snapshot.id) },
          rule_type: { in: [MarketAccessRuleType.destination_tariff, MarketAccessRuleType.preferential_tariff_india] },
          evidence_origin: { in: origins },
          retrieved_at: { lte: args.as_of },
        },
        orderBy: { id: 'asc' },
      })
    : [];
  const currencies = new Set<string>();
  for (const row of evidence) {
    // The pack's own reading first: a duty published in words ("0,03 евро за 1 кг", "1 元 / 千克") has its
    // currency there, not in anything the shared expression parser can read.
    const parsed = storedDuty(row) ?? parseDutyExpression(row.duty_expression);
    if (parsed.kind === 'specific' && parsed.specific_currency) currencies.add(parsed.specific_currency);
  }
  const fx = new Map<string, UsdRate>();
  for (const currency of [...currencies].sort()) fx.set(currency, await args.usd(currency));

  const resolutions = new Map<string, OfficialDutyResolution>();
  const used = new Set<EvidenceOrigin>();
  for (const market of [...new Set(snapshots.map((snapshot) => snapshot.country_code))].sort()) {
    const marketSnapshots = snapshots.filter((snapshot) => snapshot.country_code === market);
    const ids = new Set(marketSnapshots.map((snapshot) => snapshot.id));
    const rows = evidence.filter((row) => ids.has(row.snapshot_id));
    const selected = selectTariffFactsOnly({
      scope: { exporter_org_id: args.exporter_org_id, country_code: market, hs6: args.hs6, hs_revision: args.hs_revision, as_of_date: args.as_of.toISOString(), origin_country_code: 'IN' },
      snapshots: marketSnapshots,
      evidence: rows,
    });
    let resolution = resolveOfficialDuty({ as_of: args.as_of, tariffs: selected.tariffs, rows: new Map(rows.map((row) => [row.id, row])), minimum_confidence: args.minimum_confidence, usd_per_unit: (currency) => fx.get(currency)?.rate ?? null, score_india_preference: args.score_india_preference ?? false });
    if (resolution.status === 'none' && marketSnapshots.some((snapshot) => snapshot.classification_resolution === 'classification_refinement_required')) {
      resolution = { status: 'none', reason: "This HS6 splits into national lines with different duties in this market; the official duty needs the product's declarable line." };
    }
    if (resolution.status !== 'none') {
      for (const snapshot of marketSnapshots) if (resolution.snapshot_ids.includes(snapshot.id)) used.add(snapshot.evidence_origin);
      const snapshotIds = resolution.snapshot_ids;
      // D-028: a customs union's common external tariff says so, and scores below a national tariff.
      const union = marketSnapshots.map((snapshot) => (snapshotIds.includes(snapshot.id) ? CUSTOMS_UNION_PROVIDERS.get(snapshot.provider) : undefined)).find(Boolean);
      if (union) resolution = { ...resolution, common_tariff: { union: union.key, label: union.label } };
      // D-030: a retained schedule is either a union's common tariff (D-028) or the market's own tariff
      // read without trade remedies (D-031); each says so and scores accordingly.
      const schedule = marketSnapshots.map((snapshot) => (snapshotIds.includes(snapshot.id) ? tariffScheduleBasisFor(snapshot.provider, market) : null)).find(Boolean);
      if (schedule?.basis === 'common_tariff') resolution = { ...resolution, common_tariff: { union: schedule.key, label: schedule.label } };
      if (schedule?.basis === 'national_schedule') resolution = { ...resolution, schedule_read: { schedule: schedule.key, label: schedule.label } };
    }
    resolutions.set(market, resolution);
  }
  const frozenMarkets = Object.fromEntries([...resolutions].map(([market, resolution]) => [market, resolution.status === 'none'
    ? resolution
    : {
        status: resolution.status, source: resolution.source, national_line: resolution.national_line, fact_ids: resolution.fact_ids, snapshot_ids: resolution.snapshot_ids, preference: resolution.preference,
        basis: resolution.basis, ...(resolution.standard ? { standard: resolution.standard } : {}),
        ...(resolution.recorded_by_agent ? { recorded_by_agent: true } : {}),
        ...(resolution.common_tariff ? { common_tariff: resolution.common_tariff } : {}),
        ...(resolution.schedule_read ? { schedule_read: resolution.schedule_read } : {}),
        ...(resolution.status === 'percent' ? { duty_percent: resolution.duty_percent } : resolution.status === 'specific' ? { usd_per_kg: resolution.usd_per_kg, expression: resolution.expression, fx: resolution.fx } : { reason: resolution.reason, expression: resolution.expression }),
      }]));
  return {
    resolutions,
    origins: [...used],
    official_count: [...resolutions.values()].filter((resolution) => resolution.status === 'percent' || resolution.status === 'specific').length,
    frozen: { status: 'read', minimum_confidence: args.minimum_confidence, hs_revision: args.hs_revision, markets: frozenMarkets, fx: Object.fromEntries([...fx].map(([currency, rate]) => [currency, rate.frozen])) },
  };
}

export async function loadRunInputs(args: {
  hs6: string;
  as_of: Date;
  product: V5ProductFacts;
  config: DemandDiscoveryV5Config;
  /** The run's tenant and HS revision, which scope the tariff evidence the run may admit. */
  exporter_org_id: string;
  hs_revision: string;
  storage?: DocumentStorage;
  /** The job doing the run: acquired tariff snapshots name it as their source run. */
  job_id?: string;
  correlation_id?: string;
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
  const [lpi, primary, manufactured, lsci, availabilityLatest, availabilityNewest, agreements, ecgc, capitals, capitalsSupplement, currencyPegs, sanctions] = await Promise.all([
    referenceMap('wdi:LP.LPI.OVRL.XQ'), referenceMap('wdi:TM.TAX.TCOM.SM.AR.ZS'), referenceMap('wdi:TM.TAX.MANF.SM.AR.ZS'), referenceMap('wdi:IS.SHP.GCNW.XQ'),
    availability(latest), availability(latest + 1), activeReferenceRows('india:trade-agreements', indiaTradeAgreementRowSchema),
    activeReferenceRows(ECGC_COUNTRY_RISK_KEY, ecgcRatingRowSchema), activeReferenceRows(GEO_CEPII_KEY, capitalRowSchema),
    activeReferenceRows(CAPITALS_SUPPLEMENT_KEY, capitalSupplementRowSchema),
    activeReferenceRows(CURRENCY_PEGS_KEY, currencyPegRowSchema),
    activeReferenceRows(SANCTIONS_PROGRAMMES_KEY, sanctionsProgrammeRowSchema),
  ]);
  for (const reference of [lpi.active, primary.active, manufactured.active, lsci.active, availabilityLatest.active, availabilityNewest.active, agreements, ecgc, capitals, capitalsSupplement, currencyPegs, sanctions]) if (reference) origins.add(reference.evidence_origin);
  if (!agreements) notes.push("India's trade agreements are not imported, so duty estimates assume no agreement.");
  if (!lpi.active) notes.push('Logistics scores are missing: the World Bank logistics index is not imported.');
  if (!primary.active && !manufactured.active) notes.push('Duty estimates are missing: the World Bank tariff averages are not imported.');
  if (!availabilityLatest.active) notes.push(`Comtrade's ${latest} reporting list is not imported, so every market is treated as estimated from partners' figures.`);
  if (!ecgc) notes.push('Country risk is not scored: the ECGC country risk list is not imported.');
  if (!capitals) notes.push('Distance fit is not scored: capital coordinates (CEPII GeoDist) are not imported.');
  if (!sanctions) notes.push('Sanctions programmes are not shown on markets: the curated list is not imported.');
  const coordinates = coordinateInputs({ capitals: capitals?.rows ?? [], provider_codes_without_iso: chosen.provider_codes_without_iso, supplement: capitals ? capitalsSupplement?.rows ?? [] : [] });
  // D-021: World Bank values older than the policy's limit count as missing, and the market says so.
  const [lpiAge, primaryAge, manufacturedAge, lsciAge] = [lpi, primary, manufactured, lsci].map((reference) => splitByAge(reference.map, args.as_of, policy));
  const tooOldIn = (ages: Map<string, number>) => markets.filter((market) => ages.has(market)).length;
  const staleTariffs = tooOldIn((tariffSector(args.hs6, policy) === 'primary' ? primaryAge : manufacturedAge).too_old);
  const staleLogistics = tooOldIn(lpiAge.too_old);
  if (staleLogistics || staleTariffs) {
    const parts = [staleLogistics ? `the logistics score for ${staleLogistics} market${staleLogistics === 1 ? '' : 's'}` : null, staleTariffs ? `the tariff average for ${staleTariffs} market${staleTariffs === 1 ? '' : 's'}` : null].filter(Boolean);
    notes.push(`World Bank figures more than ${policy.world_bank.max_age_years} years old are not used: ${parts.join(' and ')}.`);
  }
  // D-025: where no logistics score is usable, the one shipping connectivity predicts (an estimate).
  const lpiValues = new Map([...lpiAge.fresh].map(([iso2, row]) => [iso2, row.value]));
  const logistics = logisticsEstimates({ markets, lpi: lpiValues, lsci: lsciAge.fresh, policy });
  if (logistics.estimates.size) {
    notes.push(`Logistics for ${logistics.estimates.size} market${logistics.estimates.size === 1 ? '' : 's'} without a World Bank logistics score is estimated from UNCTAD's shipping connectivity index (fitted on ${logistics.fit!.pairs} markets with both).`);
  } else if (lpi.active && !lsci.active) {
    notes.push('Markets without a World Bank logistics score have no logistics estimate: the shipping connectivity index is not imported.');
  }
  // D-025: currencies fixed against one the ECB publishes are converted through their peg.
  const rates = createUsdRateResolver({ as_of: args.as_of, lookback_days: config.fx_max_lookback_days, fetch_missing: config.fx_fetch_missing, pegs: currencyPegs?.rows ?? [], treasury: { enabled: config.fx_treasury_fallback, lookback_days: config.fx_treasury_max_lookback_days } });

  // D-020: ask every market with a Customs Atlas source for this product's tariff before reading
  // tariff evidence. What is acquired is admitted at the tariff clock (no earlier than any retrieval).
  let tariffAsOf = args.as_of;
  let tariffStep: Record<string, unknown> = { status: 'disabled', reason: 'Switched off in demand_discovery.v5 config.' };
  if (config.tariff_acquisition) {
    const step = await acquireV5Tariffs({ job_id: args.job_id ?? `demand_discovery_v5:${args.hs6}`, hs6: args.hs6, markets, resolution_clock: args.as_of, live_fetch_timeout_ms: config.tariff_live_fetch_timeout_ms, correlation_id: args.correlation_id });
    tariffAsOf = step.tariff_clock;
    tariffStep = { status: 'used', resolution_clock: args.as_of.toISOString(), tariff_clock: step.tariff_clock.toISOString(), outcomes: step.outcomes };
    // Only a failed or timed-out look-up degrades the run; a source with nothing saved yet (D-029) or one
    // that does not cover the product for a market is said, not a failure (`summarizeTariffOutcomes`).
    const summary = summarizeTariffOutcomes(step.outcomes);
    if (summary.degraded) degraded = true;
    notes.push(...summary.notes);
  }
  const official = await officialDuties({ markets, hs6: args.hs6, as_of: tariffAsOf, exporter_org_id: args.exporter_org_id, hs_revision: args.hs_revision, minimum_confidence: policy.duty.official_minimum_confidence, usd: rates.usd, score_india_preference: policy.duty.score_india_preference });
  for (const origin of official.origins) origins.add(origin);
  if (!official.official_count) {
    notes.push(config.tariff_acquisition
      ? 'No market with an official tariff source returned a usable duty for this product, so every duty is estimated from tariff averages and trade agreements.'
      : 'No official tariff for this product is stored for any market yet, so every duty is estimated from tariff averages and trade agreements.');
  }

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
      // R-34: the run says why the markets BACI does not cover have no trade figures, as the
      // newest-year step does; a failed step also makes the run partial (through `record`).
      if (step.status !== 'used') {
        const count = `${uncovered.length} market${uncovered.length === 1 ? '' : 's'}`;
        notes.push(step.status === 'failed'
          ? `Comtrade figures for the ${count} BACI does not cover could not be fetched (${step.reason}), so those markets are not scored on trade this run.`
          : `The ${count} BACI does not cover are not scored on trade: ${step.reason}`);
      }
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
  const fx = await rates.usd(args.product.price_target_currency);
  const price = exporterUsdPerKg(args.product, fx.rate);
  const volume = exporterYearlyKg(args.product);
  const fxFetches = await rates.fetches();
  const failedFx = fxFetches.filter((item) => item.status === 'failed');
  if (failedFx.length) {
    degraded = true;
    notes.push(`ECB exchange rates for ${failedFx.map((item) => item.currency).join(', ')} could not be fetched (${failedFx[0]!.reason}); anything priced in them is not compared.`);
  }

  const input: AssessMarketsInput = {
    policy,
    markets,
    base: { years: baseYears, flows: chosen.converted.flows, markets_covered: chosen.converted.markets_covered, short_history: shortHistory },
    fallback,
    reported_latest_year: availabilityLatest.codes.size ? new Set(marketReporters.filter((entry) => availabilityLatest.codes.has(entry.reporter_code)).map((entry) => entry.iso2)) : new Set(),
    newest_year: newestYear,
    coordinates: coordinates.map,
    lpi: lpiValues,
    lpi_too_old: lpiAge.too_old,
    logistics_estimates: logistics.estimates,
    sanctions: sanctionsFlagsByMarket(sanctions?.rows ?? []),
    ecgc: ecgcInputs(ecgc?.rows ?? []),
    duty: dutyInputs({ markets, hs6: args.hs6, as_of: args.as_of, official: official.resolutions, primary_tariffs: primaryAge.fresh, manufactured_tariffs: manufacturedAge.fresh, primary_too_old: primaryAge.too_old, manufactured_too_old: manufacturedAge.too_old, agreements: agreements?.rows ?? [], policy }),
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
      'wdi:LP.LPI.OVRL.XQ': lpi.frozen, 'wdi:TM.TAX.TCOM.SM.AR.ZS': primary.frozen, 'wdi:TM.TAX.MANF.SM.AR.ZS': manufactured.frozen, 'wdi:IS.SHP.GCNW.XQ': lsci.frozen,
      [`comtrade:availability:${latest}`]: availabilityLatest.active ? { release_id: availabilityLatest.active.release_id, rows_sha256: availabilityLatest.active.rows_sha256 } : null,
      [`comtrade:availability:${latest + 1}`]: availabilityNewest.active ? { release_id: availabilityNewest.active.release_id, rows_sha256: availabilityNewest.active.rows_sha256 } : null,
      'india:trade-agreements': agreements ? { release_id: agreements.release_id, version: agreements.version, rows_sha256: agreements.rows_sha256 } : null,
      [ECGC_COUNTRY_RISK_KEY]: ecgc ? { release_id: ecgc.release_id, version: ecgc.version, rows_sha256: ecgc.rows_sha256 } : null,
      [GEO_CEPII_KEY]: capitals ? { release_id: capitals.release_id, version: capitals.version, rows_sha256: capitals.rows_sha256 } : null,
      [CAPITALS_SUPPLEMENT_KEY]: capitalsSupplement ? { release_id: capitalsSupplement.release_id, version: capitalsSupplement.version, rows_sha256: capitalsSupplement.rows_sha256 } : null,
      [CURRENCY_PEGS_KEY]: currencyPegs ? { release_id: currencyPegs.release_id, version: currencyPegs.version, rows_sha256: currencyPegs.rows_sha256 } : null,
      [SANCTIONS_PROGRAMMES_KEY]: sanctions ? { release_id: sanctions.release_id, version: sanctions.version, rows_sha256: sanctions.rows_sha256 } : null,
    },
    provider_coordinates: capitals ? { placed: coordinates.provider_links, unplaced: coordinates.unplaced_provider_codes } : null,
    comtrade: frozenComtrade,
    fallback_markets: [...fallback.keys()],
    tariff_acquisition: tariffStep,
    official_duty: official.frozen,
    exporter: { fx: fx.frozen, usd_per_kg: price, yearly_kg: volume },
    fx_fetches: fxFetches,
    logistics_estimate: { fit: logistics.fit, markets: Object.fromEntries([...logistics.estimates].map(([market, estimate]) => [market, { lsci: estimate.lsci, lsci_year: estimate.lsci_year, predicted_lpi: estimate.predicted_lpi }])) },
    world_bank_too_old: {
      max_age_years: policy.world_bank.max_age_years,
      'wdi:LP.LPI.OVRL.XQ': Object.fromEntries(lpiAge.too_old), 'wdi:TM.TAX.TCOM.SM.AR.ZS': Object.fromEntries(primaryAge.too_old), 'wdi:TM.TAX.MANF.SM.AR.ZS': Object.fromEntries(manufacturedAge.too_old),
      'wdi:IS.SHP.GCNW.XQ': Object.fromEntries(lsciAge.too_old),
    },
  };

  return { input, frozen, evidence_origins: [...origins].sort(), notes, degraded };
}

/** Exposed for tests that read official duties from stored evidence without a whole run. */
export const __test__ = { officialDuties };
