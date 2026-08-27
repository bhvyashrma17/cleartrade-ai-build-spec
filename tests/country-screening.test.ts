import { createHash, randomUUID } from 'node:crypto';
import { getNumericCodes } from 'i18n-iso-countries';
import { EvidenceOrigin, OrgTier, Prisma, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams, type ComtradeFlowRow } from '../src/lib/comtrade';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '../src/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION } from '../src/lib/comtrade/normalization';
import { COMTRADE_REPORTER_REGISTRY_VERSION, comtradeReporterRegistry } from '../src/lib/comtrade/reporter-registry';
import { CONFIG_DEFAULTS, type CountryScreeningPolicy } from '../src/lib/config';
import { buildCountryEvidencePlan } from '../src/lib/country-evidence/planner';
import { buildCountryScreeningPlan, screeningComtradeRequest } from '../src/lib/country-screening/planner';
import { createGlobalCountryScreeningRun, estimateGlobalCountryScreeningQuota, executeGlobalCountryScreeningRun, globalCountryScreeningShortlist, planDeepCountryTruthFromScreening, resolveGlobalCountryScreeningRun, screeningShortlistReporters } from '../src/lib/country-screening/service';
import { prisma } from '../src/lib/prisma';

const AS_OF = new Date('2026-08-26T00:00:00Z');
const PERIOD = 2025;

let hsCounter = 0;
/**
 * Every test screens its own HS6.
 *
 * SourceEvidence is immutable and shared, and its identity is the request fingerprint — which
 * includes the commodity. Giving each test a distinct code is therefore the only isolation that
 * does not require deleting evidence rows the platform deliberately refuses to delete.
 */
let HS6 = '090111';

/** Narrow the derived universe to a handful of markets, without inventing a curated list. */
async function activateScreeningPolicy(keep: string[] | null, overrides: Partial<CountryScreeningPolicy> = {}) {
  const excluded = keep == null ? {} : Object.fromEntries(Object.values(getNumericCodes()).filter(iso2 => !keep.includes(iso2)).map(iso2 => [iso2, 'no_resident_population']));
  const value = { ...CONFIG_DEFAULTS['country_screening.policy'], ...overrides, excluded_iso2_codes: { ...CONFIG_DEFAULTS['country_screening.policy'].excluded_iso2_codes, ...excluded, ...(overrides.excluded_iso2_codes ?? {}) } };
  await activateConfig('country_screening.policy', value);
  return value;
}

async function activateComtradeBudget(budget: number) {
  await activateConfig('comtrade.policy', { ...CONFIG_DEFAULTS['comtrade.policy'], request_delay_ms: 0, daily_request_budget: budget });
}

async function confirmedClassification(revision = 'HS2022') {
  HS6 = String(90_000 + ++hsCounter).padStart(6, '0');
  const marker = `screening-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const user = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Screener', role: UserRole.agent, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Coffee', evidence_origin: EvidenceOrigin.fixture } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: HS6, hs_code_source: 'exporter_supplied', hs_nomenclature: 'HS', hs_nomenclature_version: revision, hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: .99, hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: user.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  const classification = await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: HS6, nomenclature: 'HS', nomenclature_version: revision, method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: { schema_version: 'test' }, evidence: { source: 'test' }, rationale: 'Test classification', source_references: [], confidence: .99, status: ProductClassificationStatus.confirmed, proposed_by_id: user.id, confirmed_by_id: user.id, confirmed_at: now } });
  return { classification, org, user, product };
}

function worldRequest(reporter: string, options: { hs_revision?: string; source_mode?: 'authenticated' | 'fixture' | 'mock'; period?: number } = {}) {
  return canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: options.source_mode ?? 'authenticated', purpose: 'country_truth', reporter_code: reporter, partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(options.period ?? PERIOD), hs_codes: [HS6], hs_revision: options.hs_revision ?? 'HS2022', customs_code: 'C00', mode_of_supply: '0' });
}

/** Persist one immutable provider response exactly as the ingest path would have written it. */
async function seedWorldEvidence(options: {
  reporter: string; source_mode?: 'authenticated' | 'fixture' | 'mock'; origin?: EvidenceOrigin;
  value?: number | null; value_status?: string; omit_world_row?: boolean; hs_revision?: string;
  retrieved_at?: Date; parser_version?: string; normalization_version?: string;
  completeness?: 'COMPLETE' | 'PARTIAL'; status?: string;
}) {
  const sourceMode = options.source_mode ?? 'authenticated';
  const origin = options.origin ?? (sourceMode === 'authenticated' ? EvidenceOrigin.authenticated_real : sourceMode === 'fixture' ? EvidenceOrigin.fixture : EvidenceOrigin.mock);
  const revision = options.hs_revision ?? 'HS2022';
  const request = worldRequest(options.reporter, { hs_revision: revision, source_mode: sourceMode });
  const rows = options.omit_world_row ? [] : [{ partner: '0', value: options.value ?? null, status: options.value_status ?? 'observed' }];
  // Provider-shaped, because re-normalization genuinely re-parses this body.
  const raw = JSON.stringify({ count: rows.length, data: rows.map(row => ({ reporterCode: Number(options.reporter), partnerCode: Number(row.partner), partner2Code: 0, cmdCode: HS6, refYear: PERIOD, period: String(PERIOD), flowCode: 'M', freqCode: 'A', primaryValue: row.status === 'suppressed' ? 'suppressed' : row.value, customsCode: 'C00', mosCode: '0', clCode: revision === 'HS2022' ? 'H6' : 'H5' })) });
  return prisma.sourceEvidence.create({
    data: {
      provider: 'un_comtrade', dataset: 'comtrade-goods', dataset_version: 'v1', source_origin: origin, environment: 'test',
      request_fingerprint: comtradeRequestFingerprint(request), request_parameters: request as unknown as Prisma.InputJsonValue,
      redacted_request: 'comtrade://seeded', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'),
      raw_response_text: raw, retrieved_at: options.retrieved_at ?? new Date(), provider_row_count: rows.length, returned_row_count: rows.length,
      completeness: options.completeness ?? 'COMPLETE', parser_version: options.parser_version ?? COMTRADE_PARSER_VERSION,
      status: options.status ?? 'accepted',
      observations: { create: rows.map(row => ({
        observation_key: `seed-${randomUUID()}`, reporter_code: options.reporter, partner_code: row.partner, partner_is_world: true,
        partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), ref_year: PERIOD, hs_code: HS6, hs_level: 6,
        hs_revision: revision, customs_code: 'C00', mode_of_supply: '0',
        trade_value: row.value == null ? null : new Prisma.Decimal(row.value), trade_value_status: row.status,
        quantity_status: 'missing', normalization_version: options.normalization_version ?? COMTRADE_NORMALIZATION_VERSION,
        retrieved_at: options.retrieved_at ?? new Date(), source_origin: origin,
      })) },
    },
  });
}

function authenticatedClient(valuesByReporter: Record<string, number | 'error'>, fingerprint = `auth-${randomUUID()}`) {
  const calls = vi.fn();
  return { calls, client: {
    name: 'screening-authenticated-fake',
    identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: fingerprint, source_dataset: 'comtrade-goods', source_dataset_version: 'v1' },
    async resolveChapter() { throw new Error('explicit HS6 must bypass the reference endpoint'); },
    async fetchChapter(params: ComtradeFetchParams) {
      calls(params);
      await params.before_physical_request?.();
      const configured = valuesByReporter[params.reporter];
      if (configured === 'error') throw new Error('provider request failed');
      const rows: ComtradeFlowRow[] = configured == null ? [] : [{ reporter: params.reporter, partner: '0', partner2: '0', hs_code: HS6, year: params.year, period: String(params.year), value: configured, value_status: 'observed', quantity: null, quantity_status: 'missing', unit: null, flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }];
      const raw = JSON.stringify({ count: rows.length, data: rows });
      return { rows, request_count: 1, retrieved_at: new Date(), source_dataset_version: 'v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'comtrade://fake', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { truncated: false, rejected_rows: 0 }, quota_metadata: null, retrieved_at: new Date() }] };
    },
  } };
}

const statuses = (results: Array<{ country_code: string; screening_status: string }>) => Object.fromEntries(results.map(row => [row.country_code, row.screening_status]));

/**
 * Config rows this file activated.
 *
 * Suites share one schema, and `getConfig` reads the newest ACTIVE row for a key. A screening
 * test that leaves a two-request Comtrade budget behind silently starves whichever suite runs
 * next — which is indistinguishable from a real regression at the point you read the failure.
 * Deactivating on the way out restores whatever was authoritative before.
 */
const activatedConfigRows: string[] = [];

async function activateConfig(key: string, value: unknown) {
  const latest = await prisma.configSetting.findFirst({ where: { key }, orderBy: { version: 'desc' }, select: { version: true } });
  const row = await prisma.configSetting.create({ data: { key, version: (latest?.version ?? 0) + 1, value: value as Prisma.InputJsonValue, is_active: true } });
  activatedConfigRows.push(row.id);
  return row;
}

async function restoreConfig() {
  if (activatedConfigRows.length) await prisma.configSetting.updateMany({ where: { id: { in: activatedConfigRows } }, data: { is_active: false } });
  activatedConfigRows.length = 0;
}

afterEach(() => setComtradeClient(null));
afterAll(async () => { await restoreConfig(); await prisma.$disconnect(); });

describe('Stage A reuses the deep Country Truth evidence architecture', () => {
  test('screens on exactly the request the deep plan already asks for', () => {
    const HS6 = '090111', policy = CONFIG_DEFAULTS['country_screening.policy'];
    const screening = buildCountryScreeningPlan({ product_classification_id: 'c1', hs_code: HS6, hs_revision: 'HS2022', as_of_date: AS_OF, source_mode: 'authenticated', policy, policy_config_version: 1, period_selection_policy: CONFIG_DEFAULTS['country_period_selection.policy'], period_selection_policy_config_version: 1 });
    const deep = buildCountryEvidencePlan({ product_classification_id: 'c1', hs_code: HS6, hs_revision: 'HS2022', as_of_date: AS_OF, candidate_reporters: ['276'], source_mode: 'authenticated', policy: CONFIG_DEFAULTS['country_evidence.policy'], policy_config_version: 1 });
    const deepWorld = deep.items.find(item => item.purpose === 'WORLD_IMPORT_HISTORY' && item.period === deep.latest_common_year)!;
    expect(screening.screening_period).toBe(deep.latest_common_year);
    // Byte-identical request identity: a screen warms the deep plan's cache and vice versa.
    expect(comtradeRequestFingerprint(screeningComtradeRequest({ reporter_code: '276', partner_code: '0', period: screening.screening_period, hs_code: HS6, hs_revision: 'HS2022', source_mode: 'authenticated' })))
      .toBe(comtradeRequestFingerprint(canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: deepWorld.reporter_code, partner_code: deepWorld.partner_code, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(deepWorld.period), hs_codes: [HS6], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' })));
  });
});

describe('screening preserves Country Truth evidence semantics', () => {
  test('keeps missing, suppressed, unavailable, incompatible and observed zero distinct', async () => {
    await activateScreeningPolicy(['DE', 'US', 'AE', 'JP', 'BR', 'CN']);
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 9_000_000_000 });
    await seedWorldEvidence({ reporter: '842', value: 0, value_status: 'observed_zero' });
    await seedWorldEvidence({ reporter: '784', omit_world_row: true });
    await seedWorldEvidence({ reporter: '392', value: null, value_status: 'suppressed' });
    await seedWorldEvidence({ reporter: '76', hs_revision: 'HS2017' });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);

    // BR's only evidence is under a different HS revision, so the walk steps past it and asks
    // for an older year; CN has never been probed at all. Both are acquirable, neither is zero.
    expect(statuses(run.results)).toEqual({ DE: 'eligible', US: 'below_minimum_demand', AE: 'pending_fallback', JP: 'suppressed', BR: 'pending_fallback', CN: 'pending_fallback' });
    const byCountry = new Map(run.results.map(row => [row.country_code, row]));
    // An observed zero is a real fact and keeps its value; nothing else is rewritten as zero.
    expect(byCountry.get('US')).toMatchObject({ import_value_status: 'observed_zero', observation_period: PERIOD });
    expect(byCountry.get('US')!.import_value?.toString()).toBe('0');
    for (const code of ['AE', 'JP', 'BR', 'CN']) expect(byCountry.get(code)!.import_value, code).toBeNull();
    expect(byCountry.get('JP')).toMatchObject({ import_value_status: 'suppressed' });
    // The UAE shape: 2025 answered with no World row, so the walk moved on to 2024.
    const aeProbes = (byCountry.get('AE')!.provenance as { resolution_evidence: { period_probes: Array<{ period: number; outcome: string; absence_is_not_zero?: boolean }> } }).resolution_evidence.period_probes;
    expect(aeProbes[0]).toMatchObject({ period: PERIOD, outcome: 'absent', absence_is_not_zero: true });
    expect(byCountry.get('AE')).toMatchObject({ next_probe_period: PERIOD - 1, preferred_period: PERIOD });
    const brProbes = (byCountry.get('BR')!.provenance as { resolution_evidence: { period_probes: Array<{ period: number; outcome: string }> } }).resolution_evidence.period_probes;
    expect(brProbes[0]).toMatchObject({ period: PERIOD, outcome: 'incompatible' });
    // Only the eligible market is ranked at all.
    expect(byCountry.get('DE')).toMatchObject({ screening_rank: 1, shortlisted: true, decision_reason: 'shortlisted_top_screening_rank', period_lag: 0, freshness_state: 'current' });
    expect(Number(byCountry.get('DE')!.evidence_confidence)).toBe(1);
    expect(run.results.filter(row => row.screening_rank != null)).toHaveLength(1);
    expect(byCountry.get('US')).toMatchObject({ screening_rank: null, screening_score: null, shortlisted: false, decision_reason: 'not_shortlisted_below_minimum_demand' });
  });

  test('an incomplete provider response is insufficient evidence, never a zero', async () => {
    await activateScreeningPolicy(['DE']);
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 5_000_000_000, completeness: 'PARTIAL', status: 'partial' });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    // An incomplete response is not an answer about the market, so it stays acquirable.
    expect(run.results[0]).toMatchObject({ screening_status: 'pending_fallback', import_value: null, next_probe_period: PERIOD });
  });

  test('evidence older than the freshness requirement is stale, not usable', async () => {
    await activateScreeningPolicy(['DE']);
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 5_000_000_000, retrieved_at: new Date(Date.now() - 200 * 86_400_000) });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.results[0]).toMatchObject({ screening_status: 'stale', import_value: null, next_probe_period: PERIOD });
  });

  test('fixture and preview evidence can never satisfy an authenticated screen', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 9_000_000_000, source_mode: 'fixture' });
    await seedWorldEvidence({ reporter: '842', value: 8_000_000_000, origin: EvidenceOrigin.preview });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(statuses(run.results)).toEqual({ DE: 'pending_fallback', US: 'pending_fallback' });
    expect(run.results.every(row => row.source_evidence_id === null)).toBe(true);
    expect(run.results.every(row => row.next_probe_period === PERIOD)).toBe(true);
  });

  test('evidence parsed by a superseded parser is not reusable', async () => {
    await activateScreeningPolicy(['DE']);
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 9_000_000_000, parser_version: 'comtrade-parser-v1' });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.results[0]).toMatchObject({ screening_status: 'pending_fallback' });
  });

  test('normalization-v1 rows are re-normalized to v2 and only v2 is ever cited', async () => {
    await activateScreeningPolicy(['DE']);
    const { classification } = await confirmedClassification();
    const evidence = await seedWorldEvidence({ reporter: '276', value: 9_000_000_000, normalization_version: 'comtrade-normalization-v1' });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.results[0]).toMatchObject({ screening_status: 'eligible', source_evidence_id: evidence.id, period_lag: 0 });
    const cited = await prisma.normalizedTradeObservation.findUniqueOrThrow({ where: { id: run.results[0]!.observation_id! } });
    expect(cited.normalization_version).toBe(COMTRADE_NORMALIZATION_VERSION);
    // The historical v1 row is retained as the parser's own output, never rewritten.
    expect(await prisma.normalizedTradeObservation.count({ where: { source_evidence_id: evidence.id, normalization_version: 'comtrade-normalization-v1' } })).toBe(1);
  });
});

describe('screening rank, shortlist and provenance', () => {
  test('shortlists the top markets by demand, none of them the pilot three', async () => {
    await activateScreeningPolicy(['VN', 'MX', 'NG', 'KE', 'CL'], { shortlist_target_size: 3, max_shortlist_size: 3 });
    const { classification } = await confirmedClassification();
    for (const [reporter, value] of [['704', 4_000_000_000], ['484', 900_000_000], ['566', 120_000_000], ['404', 30_000_000], ['152', 5_000_000]] as const) await seedWorldEvidence({ reporter, value });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);

    const ranked = run.results.filter(row => row.screening_rank != null).sort((a, b) => a.screening_rank! - b.screening_rank!);
    expect(ranked.map(row => row.country_code)).toEqual(['VN', 'MX', 'NG', 'KE', 'CL']);
    expect(run.results.filter(row => row.shortlisted).map(row => row.country_code).sort()).toEqual(['MX', 'NG', 'VN']);
    expect(await screeningShortlistReporters(run.id)).toEqual(['704', '484', '566']);
    expect(ranked.map(row => Number(row.screening_score))).toEqual([...ranked.map(row => Number(row.screening_score))].sort((a, b) => b - a));
    expect(ranked[3]).toMatchObject({ shortlisted: false, decision_reason: 'not_shortlisted_rank_4_beyond_target_3' });
  });

  test('ships a shorter list rather than padding it when few markets qualify', async () => {
    await activateScreeningPolicy(['VN', 'MX', 'NG'], { shortlist_target_size: 20 });
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '704', value: 4_000_000_000 });
    await seedWorldEvidence({ reporter: '484', value: 900_000_000 });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.shortlist_size).toBe(2);
    expect(await screeningShortlistReporters(run.id)).toEqual(['704', '484']);
  });

  test('freezes the universe, the policy identity and every result to its evidence', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    const { classification } = await confirmedClassification();
    const evidence = await seedWorldEvidence({ reporter: '276', value: 9_000_000_000 });
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    const run = await resolveGlobalCountryScreeningRun(created.id);
    expect(run).toMatchObject({ universe_size: 2, screening_period: PERIOD, normalization_version: COMTRADE_NORMALIZATION_VERSION, parser_version: COMTRADE_PARSER_VERSION, policy_version: 'country-screening-policy-v2', period_selection_policy_version: 'country-period-selection-policy-v1', max_fallback_lookback_years: 2 });
    const snapshot = run.universe_snapshot as { checksum: string; entries: Array<{ iso2: string; reporter_code: string }>; exclusions: unknown[] };
    expect(snapshot.checksum).toBe(run.universe_checksum);
    expect(snapshot.entries.map(entry => `${entry.reporter_code}:${entry.iso2}`)).toEqual(['276:DE', '842:US']);
    const german = run.results.find(row => row.country_code === 'DE')!;
    // Freshness now describes how old the DATA is, not how old the retrieval was.
    expect(german).toMatchObject({ source_evidence_id: evidence.id, observation_period: PERIOD, freshness_state: 'current', period_lag: 0, import_value_status: 'observed' });
    expect(german.observation_id).toBeTruthy();
    expect(german.provenance).toMatchObject({ universe_checksum: run.universe_checksum, normalization_version: COMTRADE_NORMALIZATION_VERSION, screening_algorithm_version: 'country-screening-rank-v2', period_selection_policy_version: 'country-period-selection-policy-v1', selected_period: PERIOD, period_lag: 0 });
    // The definition is not editable, whatever a later caller believes.
    await expect(prisma.countryScreeningRun.update({ where: { id: run.id }, data: { hs_code: '090121' } })).rejects.toThrow(/immutable/);
    await expect(prisma.countryScreeningResult.update({ where: { id: german.id }, data: { reporter_code: '999' } })).rejects.toThrow(/immutable/);
  });
});

describe('quota-aware planning and execution', () => {
  test('estimates the screen, reuses cached markets and spends one call per uncached market', async () => {
    await activateScreeningPolicy(['DE', 'US', 'JP']);
    await activateComtradeBudget(50);
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 9_000_000_000 });
    const fake = authenticatedClient({ '842': 7_000_000_000, '392': 2_000_000_000 });
    setComtradeClient(fake.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await resolveGlobalCountryScreeningRun(created.id);

    const estimate = await estimateGlobalCountryScreeningQuota(created.id);
    expect(estimate).toMatchObject({ total_countries_considered: 3, evidence_reusable: 1, requires_acquisition: 2, no_acquisition_required: 1, estimated_logical_requests: 2, estimated_physical_calls: 2, available_quota: 50, can_execute_full_screen: true, remaining_if_partial: 0 });

    const execution = await executeGlobalCountryScreeningRun(created.id);
    expect(execution).toMatchObject({ status: 'completed', physical_calls: 2, eligible_count: 3, shortlist_size: 3 });
    // Germany was already covered: it costs nothing to screen it again.
    expect(fake.calls).toHaveBeenCalledTimes(2);
    expect(fake.calls.mock.calls.map(call => (call[0] as ComtradeFetchParams).reporter).sort()).toEqual(['392', '842']);
    expect(await screeningShortlistReporters(created.id)).toEqual(['276', '842', '392']);
  });

  test('defers on insufficient quota without corrupting the run, and resumes when budget returns', async () => {
    await activateScreeningPolicy(['DE', 'US', 'JP', 'CN']);
    await activateComtradeBudget(2);
    const { classification } = await confirmedClassification();
    const fake = authenticatedClient({ '276': 9e9, '842': 7e9, '392': 2e9, '156': 1e9 });
    setComtradeClient(fake.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });

    const refused = await executeGlobalCountryScreeningRun(created.id);
    expect(refused.status).toBe('deferred_quota');
    expect(refused.quota).toMatchObject({ requires_acquisition: 4, estimated_physical_calls: 4, available_quota: 2, can_execute_full_screen: false, remaining_if_partial: 2 });
    expect(fake.calls).not.toHaveBeenCalled();
    const deferredRun = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: created.id }, include: { results: true } });
    expect(deferredRun.results.every(row => row.screening_status === 'deferred_quota' && row.attempts === 0 && row.screening_rank === null)).toBe(true);
    expect(deferredRun.results).toHaveLength(4);

    const partial = await executeGlobalCountryScreeningRun(created.id, { allow_partial_execution: true });
    expect(partial.status).toBe('deferred_quota');
    expect(partial.physical_calls).toBe(2);
    expect(fake.calls).toHaveBeenCalledTimes(2);
    const midRun = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: created.id }, include: { results: true } });
    expect(midRun.results.filter(row => row.screening_status === 'eligible')).toHaveLength(2);
    expect(midRun.results.filter(row => row.screening_status === 'deferred_quota')).toHaveLength(2);

    await activateComtradeBudget(20);
    const resumed = await executeGlobalCountryScreeningRun(created.id);
    expect(resumed).toMatchObject({ status: 'completed', eligible_count: 4, shortlist_size: 4 });
    // Only the two markets that were still missing were acquired on resume.
    expect(fake.calls).toHaveBeenCalledTimes(4);
    expect(resumed).toMatchObject({ physical_calls: 2, total_physical_calls: 4 });
  });

  test('a provider failure keeps the run open instead of freezing an unattempted market', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    await activateComtradeBudget(20);
    const { classification } = await confirmedClassification();
    const failing = authenticatedClient({ '276': 9e9, '842': 'error' });
    setComtradeClient(failing.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    const first = await executeGlobalCountryScreeningRun(created.id);
    expect(first.status).toBe('partial');
    const failed = await prisma.countryScreeningResult.findFirstOrThrow({ where: { run_id: created.id, country_code: 'US' } });
    expect(failed).toMatchObject({ screening_status: 'failed', attempts: 1, shortlisted: false });
    expect(failed.error).toContain('provider request failed');

    setComtradeClient(null);
    const recovering = authenticatedClient({ '842': 7e9 }, failing.client.identity.credential_fingerprint);
    setComtradeClient(recovering.client);
    const second = await executeGlobalCountryScreeningRun(created.id);
    expect(second.status).toBe('completed');
    // Germany's evidence was already good; only the failed market was retried.
    expect(recovering.calls).toHaveBeenCalledTimes(1);
    expect(second.eligible_count).toBe(2);
  });
});

describe('resumability and idempotency', () => {
  test('re-requesting the same screen returns the same frozen run', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    const { classification } = await confirmedClassification();
    const args = { product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated };
    const first = await createGlobalCountryScreeningRun(args), second = await createGlobalCountryScreeningRun(args);
    expect(second.id).toBe(first.id);
    expect(second.run_key).toBe(first.run_key);
    expect(await prisma.countryScreeningResult.count({ where: { run_id: first.id } })).toBe(2);
  });

  test('a completed run is immutable and a duplicate execution costs nothing', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    await activateComtradeBudget(20);
    const { classification } = await confirmedClassification();
    const fake = authenticatedClient({ '276': 9e9, '842': 7e9 });
    setComtradeClient(fake.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    const first = await executeGlobalCountryScreeningRun(created.id);
    expect(first.status).toBe('completed');
    expect(fake.calls).toHaveBeenCalledTimes(2);

    const rerun = await executeGlobalCountryScreeningRun(created.id);
    expect(rerun).toMatchObject({ status: 'completed', physical_calls: 0, total_physical_calls: 2, shortlist_size: 2 });
    expect(fake.calls).toHaveBeenCalledTimes(2);
    expect(await prisma.countryScreeningResult.count({ where: { run_id: created.id } })).toBe(2);
    // A completed run is history: even its execution counters are frozen.
    await expect(prisma.countryScreeningRun.update({ where: { id: created.id }, data: { status: 'partial' } })).rejects.toThrow(/immutable/);
    await expect(prisma.countryScreeningResult.updateMany({ where: { run_id: created.id }, data: { shortlisted: false } })).rejects.toThrow(/immutable/);
    // A resolve against a completed run is a read, never a rewrite.
    const resolved = await resolveGlobalCountryScreeningRun(created.id);
    expect(resolved.status).toBe('completed');
  });

  test('a policy change opens a new run rather than rewriting the frozen one', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    const { classification } = await confirmedClassification();
    const first = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await activateScreeningPolicy(['DE', 'US'], { shortlist_target_size: 5 });
    const second = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    expect(second.id).not.toBe(first.id);
    expect(second.policy_hash).not.toBe(first.policy_hash);
    const reloadedFirst = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: first.id } });
    expect(reloadedFirst.shortlist_target_size).toBe(20);
  });
});

describe('deep Country Truth handoff', () => {
  test('the shortlist becomes the existing Country Evidence Planner candidate set', async () => {
    await activateScreeningPolicy(['VN', 'MX', 'NG', 'DE'], { shortlist_target_size: 3, max_shortlist_size: 3 });
    const { classification } = await confirmedClassification();
    for (const [reporter, value] of [['704', 4e9], ['484', 9e8], ['566', 1.2e8], ['276', 1e6]] as const) await seedWorldEvidence({ reporter, value });
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await resolveGlobalCountryScreeningRun(created.id);

    const shortlist = await globalCountryScreeningShortlist(created.id);
    // Exactly the candidate shape `country-truth-discovery-job-v1` already accepts — no manual
    // reporter entry anywhere between screening and deep analysis.
    expect(shortlist.map(candidate => ({ country_code: candidate.country_code, reporter_code: candidate.reporter_code }))).toEqual([
      { country_code: 'VN', reporter_code: '704' }, { country_code: 'MX', reporter_code: '484' }, { country_code: 'NG', reporter_code: '566' },
    ]);
    expect(shortlist.every(candidate => candidate.country_name.length > 1 && candidate.source_evidence_id && candidate.observation_period === PERIOD)).toBe(true);

    const plan = await planDeepCountryTruthFromScreening(created.id, { allow_provisional_shortlist: true });
    expect([...plan.candidate_reporters].sort()).toEqual(['484', '566', '704']);
    expect(plan.hs_code).toBe(HS6);
    expect(plan.source_mode).toBe(TradeSourceMode.authenticated);
    // The deep plan is the existing one: five-year histories, India shares and supplier
    // distributions, none of which Stage A ever requested.
    expect(new Set(plan.items.map(item => item.purpose))).toEqual(new Set(['WORLD_IMPORT_HISTORY', 'INDIA_IMPORT_HISTORY', 'LATEST_SUPPLIER_DISTRIBUTION']));
    expect(plan.items).toHaveLength(33);
    expect(await prisma.countryEvidencePlan.count({ where: { product_classification_id: classification.id } })).toBe(1);
  });

  test('refuses to spend deep quota on a shortlist that is still moving', async () => {
    await activateScreeningPolicy(['DE', 'US'], { shortlist_target_size: 1, max_shortlist_size: 1 });
    await activateComtradeBudget(1);
    const { classification } = await confirmedClassification();
    setComtradeClient(authenticatedClient({ '276': 9e9, '842': 7e9 }).client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    const partial = await executeGlobalCountryScreeningRun(created.id, { allow_partial_execution: true });
    expect(partial.status).toBe('deferred_quota');
    await expect(planDeepCountryTruthFromScreening(created.id)).rejects.toThrow(/needs a completed screen/);
    // An operator may still choose to proceed on what is known so far, explicitly.
    const plan = await planDeepCountryTruthFromScreening(created.id, { allow_provisional_shortlist: true });
    expect(plan.candidate_reporters).toEqual(['276']);
  });

  test('refuses to hand an empty shortlist to the deep pipeline', async () => {
    await activateScreeningPolicy(['DE']);
    const { classification } = await confirmedClassification();
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await resolveGlobalCountryScreeningRun(created.id);
    await expect(planDeepCountryTruthFromScreening(created.id, { allow_provisional_shortlist: true })).rejects.toThrow(/shortlisted no markets/);
  });
});

describe('the real global universe', () => {
  test('plans and resolves every screening market without touching a provider', async () => {
    await activateScreeningPolicy(null);
    const { classification } = await confirmedClassification();
    const fake = authenticatedClient({});
    setComtradeClient(fake.client);
    await seedWorldEvidence({ reporter: '276', value: 9e9 });
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    expect(created.universe_size).toBe(218);
    expect(created.estimated_call_cost).toBe(218);
    expect(created).toMatchObject({ reporter_registry_version: COMTRADE_REPORTER_REGISTRY_VERSION, reporter_registry_checksum: comtradeReporterRegistry().checksum });
    const run = await resolveGlobalCountryScreeningRun(created.id);
    expect(run.results).toHaveLength(218);
    expect(run.eligible_count).toBe(1);
    // Every market carries a live provider reporter; the 23 ISO countries without one were
    // excluded by name rather than left to resolve as markets with no demand.
    const snapshot = created.universe_snapshot as { exclusions: Array<{ reason: string }>; unmatched_reporters: unknown[] };
    expect(snapshot.exclusions.filter(row => row.reason === 'no_provider_reporter_identity')).toHaveLength(23);
    expect(snapshot.unmatched_reporters).toEqual([{ reporter_code: '699', iso2: 'IN', reason: 'excluded_by_policy' }]);
    const estimate = await estimateGlobalCountryScreeningQuota(created.id);
    expect(estimate).toMatchObject({ total_countries_considered: 218, requires_acquisition: 217, estimated_physical_calls: 217, evidence_reusable: 1 });
    expect(fake.calls).not.toHaveBeenCalled();
  }, 60_000);
});

describe('adversarial: the run refuses to be corrupted', () => {
  test('a concurrent duplicate creation returns one run, never two or an error', async () => {
    await activateScreeningPolicy(['DE', 'US', 'JP']);
    const { classification } = await confirmedClassification();
    const args = { product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated };
    // Racing the unique run key is exactly what a retried job or a duplicated worker does.
    const runs = await Promise.all([createGlobalCountryScreeningRun(args), createGlobalCountryScreeningRun(args), createGlobalCountryScreeningRun(args)]);
    expect(new Set(runs.map(run => run.id)).size).toBe(1);
    expect(await prisma.countryScreeningRun.count({ where: { product_classification_id: classification.id } })).toBe(1);
    expect(await prisma.countryScreeningResult.count({ where: { run_id: runs[0]!.id } })).toBe(3);
  });

  test('an arithmetically invalid policy cannot create a run at all', async () => {
    const { classification } = await confirmedClassification();
    for (const broken of [
      { shortlist_target_size: 25, max_shortlist_size: 5 },
      { minimum_import_value_usd: -1 },
      { latest_period_freshness_days: 0 },
      { demand_signal: { method: 'world_import_value_log10_v1' as const, floor_usd: 0, ceiling_usd: 10 } },
      { demand_signal: { method: 'world_import_value_log10_v1' as const, floor_usd: 1_000, ceiling_usd: 100 } },
    ]) {
      await activateScreeningPolicy(['DE'], broken as Partial<CountryScreeningPolicy>);
      await expect(createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated }), JSON.stringify(broken)).rejects.toThrow();
    }
    // Nothing half-written survives a refused policy.
    expect(await prisma.countryScreeningRun.count({ where: { product_classification_id: classification.id } })).toBe(0);
  });

  test('an observed zero ranks below every real market but is never dropped', async () => {
    await activateScreeningPolicy(['DE', 'US', 'JP'], { minimum_import_value_usd: 0 });
    const { classification } = await confirmedClassification();
    await seedWorldEvidence({ reporter: '276', value: 9_000_000_000 });
    await seedWorldEvidence({ reporter: '842', value: 0, value_status: 'observed_zero' });
    await seedWorldEvidence({ reporter: '392', value: null, value_status: 'suppressed' });
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    const byCountry = new Map(run.results.map(row => [row.country_code, row]));
    // A zero minimum makes an observed zero eligible; it still scores at the floor and ranks last.
    expect(byCountry.get('US')).toMatchObject({ screening_status: 'eligible', screening_rank: 2, import_value_status: 'observed_zero' });
    expect(Number(byCountry.get('US')!.screening_score)).toBe(0);
    expect(byCountry.get('US')!.import_value?.toString()).toBe('0');
    // Suppressed is still not a zero, whatever the minimum is.
    expect(byCountry.get('JP')).toMatchObject({ screening_status: 'suppressed', screening_rank: null, import_value: null });
  });

  test('a completed run refuses acquisition, resolution and mutation from every direction', async () => {
    await activateScreeningPolicy(['DE']);
    await activateComtradeBudget(20);
    const { classification } = await confirmedClassification();
    const fake = authenticatedClient({ '276': 9e9 });
    setComtradeClient(fake.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    expect((await executeGlobalCountryScreeningRun(created.id)).status).toBe('completed');
    // Re-entering by any door is a read.
    await Promise.all([executeGlobalCountryScreeningRun(created.id), resolveGlobalCountryScreeningRun(created.id), executeGlobalCountryScreeningRun(created.id, { allow_partial_execution: true })]);
    expect(fake.calls).toHaveBeenCalledTimes(1);
    const frozen = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: created.id }, include: { results: true } });
    expect(frozen).toMatchObject({ status: 'completed', physical_call_count: 1, eligible_count: 1, shortlist_size: 1 });
    expect(frozen.results[0]).toMatchObject({ screening_status: 'eligible', shortlisted: true });
    await expect(prisma.countryScreeningResult.update({ where: { id: frozen.results[0]!.id }, data: { screening_score: new Prisma.Decimal(1) } })).rejects.toThrow(/immutable/);
    await expect(prisma.countryScreeningRun.delete({ where: { id: created.id } })).rejects.toThrow(/never deleted/);
  });

  test('an exhausted market stops being retried instead of looping forever', async () => {
    await activateScreeningPolicy(['DE', 'US'], { max_acquisition_attempts_per_country: 1 });
    await activateComtradeBudget(20);
    const { classification } = await confirmedClassification();
    const failing = authenticatedClient({ '276': 9e9, '842': 'error' });
    setComtradeClient(failing.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });

    // The budget is one attempt per candidate period, because a fallback walk legitimately
    // spends one attempt per year it inspects. Each execution retries the failing market once.
    let status = (await executeGlobalCountryScreeningRun(created.id)).status;
    expect(status).toBe('partial');
    for (let attempt = 0; attempt < 3 && status !== 'completed'; attempt++) status = (await executeGlobalCountryScreeningRun(created.id)).status;

    // Once the budget is spent the run closes instead of retrying forever.
    expect(status).toBe('completed');
    const failed = await prisma.countryScreeningResult.findFirstOrThrow({ where: { run_id: created.id, country_code: 'US' } });
    expect(failed).toMatchObject({ screening_status: 'failed', shortlisted: false });
    expect(failed.attempts).toBeGreaterThanOrEqual(3);
    expect((await estimateGlobalCountryScreeningQuota(created.id)).acquisition_attempts_exhausted).toBe(1);
  });
});
