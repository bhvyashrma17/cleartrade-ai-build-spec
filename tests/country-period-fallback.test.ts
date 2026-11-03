/**
 * Phase 1G end to end: per-country latest-usable-period selection.
 *
 * The regression target is the UAE. Before Phase 1G a 2025-only screen recorded it as having no
 * usable evidence — not because it lacks demand, but because its statistics office had not filed
 * yet — and that verdict was terminal. These tests prove it now resolves on its own latest year,
 * carries an honest freshness discount, and reaches deep analysis with a window it can satisfy.
 */
import { createHash, randomUUID } from 'node:crypto';
import { getNumericCodes } from 'i18n-iso-countries';
import { EvidenceOrigin, OrgTier, Prisma, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '../src/lib/comtrade';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '../src/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION } from '../src/lib/comtrade/normalization';
import { CONFIG_DEFAULTS, type CountryPeriodSelectionPolicy, type CountryScreeningPolicy } from '../src/lib/config';
import { createGlobalCountryScreeningRun, executeGlobalCountryScreeningRun, planDeepCountryTruthFromScreening, resolveGlobalCountryScreeningRun } from '../src/lib/country-screening/service';
import { prisma } from '../src/lib/prisma';

const AS_OF = new Date('2026-08-27T00:00:00Z');
const PREFERRED = 2025;
let hsCounter = 0;
let HS6 = '100630';

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

async function activateScreeningPolicy(keep: string[], overrides: Partial<CountryScreeningPolicy> = {}, periodOverrides: Partial<CountryPeriodSelectionPolicy> = {}) {
  const defaults = CONFIG_DEFAULTS['country_screening.policy'];
  const excluded = Object.fromEntries(Object.values(getNumericCodes()).filter(iso2 => !keep.includes(iso2)).map(iso2 => [iso2, 'no_resident_population']));
  await activateConfig('country_screening.policy', { ...defaults, ...overrides, excluded_iso2_codes: { ...defaults.excluded_iso2_codes, ...excluded } });
  await activateConfig('country_period_selection.policy', { ...CONFIG_DEFAULTS['country_period_selection.policy'], ...periodOverrides });
  await activateConfig('comtrade.policy', { ...CONFIG_DEFAULTS['comtrade.policy'], request_delay_ms: 0, daily_request_budget: 60 });
}

async function confirmedClassification() {
  HS6 = String(60_000 + ++hsCounter).padStart(6, '0');
  const marker = `fallback-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const user = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Screener', role: UserRole.agent, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Rice', evidence_origin: EvidenceOrigin.fixture } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: HS6, hs_code_source: 'exporter_supplied', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: .99, hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: user.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  return prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: HS6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: { schema_version: 'test' }, evidence: { source: 'test' }, rationale: 'Test', source_references: [], confidence: .99, status: ProductClassificationStatus.confirmed, proposed_by_id: user.id, confirmed_by_id: user.id, confirmed_at: now } });
}

/** Persist one authenticated response for one reporter at one year. `value: null` = zero rows. */
async function seedYear(reporter: string, period: number, value: number | null, options: { suppressed?: boolean; retrieved_at?: Date } = {}) {
  const request = canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: reporter, partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(period), hs_codes: [HS6], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' });
  const rows = value == null && !options.suppressed ? [] : [{ reporterCode: Number(reporter), partnerCode: 0, partner2Code: 0, cmdCode: HS6, refYear: period, period: String(period), flowCode: 'M', freqCode: 'A', primaryValue: options.suppressed ? 'suppressed' : value, customsCode: 'C00', mosCode: '0', clCode: 'H6' }];
  const raw = JSON.stringify({ count: rows.length, data: rows });
  return prisma.sourceEvidence.create({ data: {
    provider: 'un_comtrade', dataset: 'un-comtrade-api', source_origin: EvidenceOrigin.authenticated_real, environment: 'test',
    request_fingerprint: comtradeRequestFingerprint(request), request_parameters: request as unknown as Prisma.InputJsonValue,
    redacted_request: 'comtrade://fallback', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw,
    retrieved_at: options.retrieved_at ?? new Date(), provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted',
    observations: { create: rows.map(() => ({ observation_key: `fb-${randomUUID()}`, reporter_code: reporter, partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(period), ref_year: period, hs_code: HS6, hs_level: 6, hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0', trade_value: options.suppressed || value == null ? null : new Prisma.Decimal(value), trade_value_status: options.suppressed ? 'suppressed' : value === 0 ? 'observed_zero' : 'observed', quantity_status: 'missing', normalization_version: COMTRADE_NORMALIZATION_VERSION, retrieved_at: options.retrieved_at ?? new Date(), source_origin: EvidenceOrigin.authenticated_real })) },
  } });
}

/** Answers only for the (reporter, year) pairs it is given; every other year is a real empty page. */
function yearAwareClient(data: Record<string, Record<number, number>>) {
  const calls = vi.fn();
  return { calls, client: {
    name: 'fallback-fake', identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: `auth-${randomUUID()}`, source_dataset: 'un-comtrade-api', source_dataset_version: 'v1' },
    async resolveChapter() { throw new Error('explicit HS6 must bypass reference data'); },
    async fetchChapter(params: ComtradeFetchParams) {
      calls({ reporter: params.reporter, year: params.year });
      await params.before_physical_request?.();
      const value = data[params.reporter]?.[params.year];
      const rows = value == null ? [] : [{ reporter: params.reporter, partner: '0', partner2: '0', hs_code: params.hs_codes[0]!, year: params.year, period: String(params.year), value, value_status: 'observed' as const, quantity: null, quantity_status: 'missing' as const, unit: null, flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }];
      const raw = JSON.stringify({ count: rows.length, data: rows.map(row => ({ reporterCode: Number(row.reporter), partnerCode: 0, partner2Code: 0, cmdCode: row.hs_code, refYear: row.year, period: row.period, flowCode: 'M', freqCode: 'A', primaryValue: row.value, customsCode: 'C00', mosCode: '0', clCode: 'H6' })) });
      return { rows, request_count: 1, retrieved_at: new Date(), source_dataset_version: 'v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'comtrade://fake', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { truncated: false, rejected_rows: 0 }, quota_metadata: null, retrieved_at: new Date() }] };
    },
  } };
}

const byCountry = (results: Array<{ country_code: string }>) => new Map(results.map(row => [row.country_code, row as never]));

afterEach(() => setComtradeClient(null));
afterAll(async () => { await restoreConfig(); await prisma.$disconnect(); });

describe('the UAE regression', () => {
  test('resolves on its own latest usable year instead of being written off', async () => {
    await activateScreeningPolicy(['AE', 'DE']);
    const classification = await confirmedClassification();
    await seedYear('276', PREFERRED, 9_000_000_000);
    // Exactly the observed shape: 2025 and 2024 answered with no row, 2023 has real demand.
    await seedYear('784', 2025, null);
    await seedYear('784', 2024, null);
    await seedYear('784', 2023, 1_250_000_000);

    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    const results = byCountry(run.results) as Map<string, { screening_status: string; observation_period: number | null; preferred_period: number | null; period_lag: number | null; freshness_state: string; evidence_confidence: Prisma.Decimal | null; import_value: Prisma.Decimal | null; screening_score: Prisma.Decimal | null; selection_score: Prisma.Decimal | null; screening_rank: number | null; shortlisted: boolean; provenance: unknown }>;

    const uae = results.get('AE')!;
    expect(uae).toMatchObject({ screening_status: 'eligible', observation_period: 2023, preferred_period: PREFERRED, period_lag: 2, freshness_state: 'aged', shortlisted: true });
    // The value is EXACTLY what the provider reported for 2023 — never rescaled to look like 2025.
    expect(uae.import_value!.toString()).toBe('1250000000');
    expect(Number(uae.evidence_confidence)).toBe(0.64);
    // Raw demand is undiscounted; only the ordering score carries the freshness penalty.
    expect(Number(uae.selection_score)).toBeCloseTo(Number(uae.screening_score) * 0.64, 5);

    const germany = results.get('DE')!;
    expect(germany).toMatchObject({ observation_period: PREFERRED, period_lag: 0, freshness_state: 'current' });
    expect(Number(germany.evidence_confidence)).toBe(1);
    expect(Number(germany.selection_score)).toBe(Number(germany.screening_score));

    // Germany's larger, current market still outranks the UAE's older one.
    expect(germany.screening_rank).toBe(1);
    expect(uae.screening_rank).toBe(2);

    // The walk is auditable from the row itself.
    const probes = (uae.provenance as { resolution_evidence: { period_probes: Array<{ period: number; outcome: string }> } }).resolution_evidence.period_probes;
    expect(probes.map(row => [row.period, row.outcome])).toEqual([[2025, 'absent'], [2024, 'absent'], [2023, 'observed']]);
  });

  test('hands deep Country Truth a window each market can actually satisfy', async () => {
    await activateScreeningPolicy(['AE', 'DE']);
    const classification = await confirmedClassification();
    await seedYear('276', PREFERRED, 9_000_000_000);
    await seedYear('784', 2025, null);
    await seedYear('784', 2024, null);
    await seedYear('784', 2023, 1_250_000_000);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await resolveGlobalCountryScreeningRun(created.id);

    const plan = await planDeepCountryTruthFromScreening(created.id, { allow_provisional_shortlist: true });
    const windows = plan.reporter_period_windows as Record<string, number[]>;
    // Derived, not hardcoded: each market's window ends at its OWN selected year.
    expect(windows['276']).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(windows['784']).toEqual([2019, 2020, 2021, 2022, 2023]);
    expect(plan.period_set).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025]);

    // Every dimension of the UAE's package is pinned to 2023, so HHI cannot divide one year's
    // suppliers by another year's denominator and India share cannot cross years.
    const uaeItems = plan.items.filter(item => item.reporter_code === '784');
    expect(uaeItems.filter(item => item.purpose === 'WORLD_IMPORT_HISTORY').map(item => item.period).sort()).toEqual([2019, 2020, 2021, 2022, 2023]);
    expect(uaeItems.filter(item => item.purpose === 'INDIA_IMPORT_HISTORY').map(item => item.period).sort()).toEqual([2019, 2020, 2021, 2022, 2023]);
    expect(uaeItems.filter(item => item.purpose === 'LATEST_SUPPLIER_DISTRIBUTION').map(item => item.period)).toEqual([2023]);
    expect(plan.items.filter(item => item.reporter_code === '276' && item.purpose === 'LATEST_SUPPLIER_DISTRIBUTION').map(item => item.period)).toEqual([2025]);
    expect(plan.items).toHaveLength(22);

    // One market's window must never move another market's item identities.
    const germanKeys = plan.items.filter(item => item.reporter_code === '276').map(item => item.item_key).sort();
    const shifted = await prisma.countryEvidencePlan.findUniqueOrThrow({ where: { id: plan.id }, include: { items: true } });
    expect(shifted.items.filter(item => item.reporter_code === '276').map(item => item.item_key).sort()).toEqual(germanKeys);
  });
});

describe('fallback acquisition is incremental, not global', () => {
  test('asks each fallback year only of the markets still unresolved', async () => {
    await activateScreeningPolicy(['AE', 'DE', 'JP']);
    const classification = await confirmedClassification();
    // DE answers at the preferred year; JP only at 2024; AE only at 2023.
    const fake = yearAwareClient({ '276': { 2025: 9e9 }, '392': { 2024: 4e8 }, '784': { 2023: 1.25e9 } });
    setComtradeClient(fake.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    const execution = await executeGlobalCountryScreeningRun(created.id);
    expect(execution.status).toBe('completed');

    const asked = fake.calls.mock.calls.map(call => `${(call[0] as { reporter: string; year: number }).reporter}@${(call[0] as { year: number }).year}`);
    // Wave 0 asks everyone about 2025; wave 1 only the two still unresolved; wave 2 only the one.
    expect(asked.filter(entry => entry.endsWith('@2025')).sort()).toEqual(['276@2025', '392@2025', '784@2025']);
    expect(asked.filter(entry => entry.endsWith('@2024')).sort()).toEqual(['392@2024', '784@2024']);
    expect(asked.filter(entry => entry.endsWith('@2023')).sort()).toEqual(['784@2023']);
    // Germany was answered at 2025 and never asked again — that bound is the whole point.
    expect(asked.filter(entry => entry.startsWith('276@'))).toEqual(['276@2025']);
    // Japan stopped at 2024 rather than walking on to 2023.
    expect(asked.filter(entry => entry.startsWith('392@')).sort()).toEqual(['392@2024', '392@2025']);
    expect(asked).toHaveLength(6);

    const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: created.id }, include: { results: true } });
    const results = byCountry(run.results) as Map<string, { observation_period: number | null; period_lag: number | null; freshness_state: string }>;
    expect(results.get('DE')).toMatchObject({ observation_period: 2025, period_lag: 0, freshness_state: 'current' });
    expect(results.get('JP')).toMatchObject({ observation_period: 2024, period_lag: 1, freshness_state: 'recent' });
    expect(results.get('AE')).toMatchObject({ observation_period: 2023, period_lag: 2, freshness_state: 'aged' });
  });

  test('stops at the lookback rather than searching indefinitely', async () => {
    await activateScreeningPolicy(['AE']);
    const classification = await confirmedClassification();
    const fake = yearAwareClient({ '784': { 2021: 5e8 } }); // only outside the lookback
    setComtradeClient(fake.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await executeGlobalCountryScreeningRun(created.id);
    expect(fake.calls.mock.calls.map(call => (call[0] as { year: number }).year).sort()).toEqual([2023, 2024, 2025]);
    const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: created.id }, include: { results: true } });
    expect(run.results[0]).toMatchObject({ screening_status: 'insufficient_evidence', freshness_state: 'stale', observation_period: null, import_value: null });
  });
});

describe('fallback never manufactures demand', () => {
  test('a measured zero ends the walk instead of hunting for a non-zero year', async () => {
    await activateScreeningPolicy(['AE'], { minimum_import_value_usd: 100_000 });
    const classification = await confirmedClassification();
    await seedYear('784', 2025, 0);
    await seedYear('784', 2023, 9_000_000_000); // a large older year the walk must NOT reach
    const fake = yearAwareClient({});
    setComtradeClient(fake.client);
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.results[0]).toMatchObject({ screening_status: 'below_minimum_demand', observation_period: 2025, period_lag: 0, import_value_status: 'observed_zero' });
    expect(run.results[0]!.import_value!.toString()).toBe('0');
    expect(fake.calls).not.toHaveBeenCalled();
  });

  test('a suppressed year stops the walk and never leaks the withheld value', async () => {
    await activateScreeningPolicy(['AE']);
    const classification = await confirmedClassification();
    await seedYear('784', 2025, null, { suppressed: true });
    await seedYear('784', 2024, 8_000_000_000);
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.results[0]).toMatchObject({ screening_status: 'suppressed', observation_period: null, import_value: null, shortlisted: false });
    expect(JSON.stringify(run.results[0]!.provenance)).not.toContain('8000000000');
  });

  test('a provider failure is never read as absence', async () => {
    await activateScreeningPolicy(['AE']);
    const classification = await confirmedClassification();
    await seedYear('784', 2024, 8_000_000_000);
    const failing = { calls: vi.fn(), client: { name: 'failing', identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: `auth-${randomUUID()}`, source_dataset: 'un-comtrade-api', source_dataset_version: 'v1' }, async resolveChapter() { throw new Error('nope'); }, async fetchChapter(params: ComtradeFetchParams) { failing.calls(params); await params.before_physical_request?.(); throw new Error('provider request failed'); } } };
    setComtradeClient(failing.client);
    const created = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    const execution = await executeGlobalCountryScreeningRun(created.id);
    // 2024 has perfectly good evidence, but our own outage at 2025 must not be treated as the
    // UAE having no 2025 data. The market stays retryable rather than silently falling back.
    expect(execution.status).toBe('partial');
    const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: created.id }, include: { results: true } });
    expect(run.results[0]).toMatchObject({ screening_status: 'failed', observation_period: null });
    expect(failing.calls.mock.calls.map(call => (call[0] as ComtradeFetchParams).year)).toEqual([2025]);
  });
});

describe('identity, immutability and reuse', () => {
  test('a period-policy change opens a new run and reuses compatible raw evidence', async () => {
    await activateScreeningPolicy(['DE']);
    const classification = await confirmedClassification();
    const evidence = await seedYear('276', PREFERRED, 9_000_000_000);
    const first = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);

    await activateScreeningPolicy(['DE'], {}, { max_fallback_lookback_years: 1 });
    const second = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(second.id).not.toBe(first.id);
    expect(second.period_selection_policy_hash).not.toBe(first.period_selection_policy_hash);
    expect(second.max_fallback_lookback_years).toBe(1);
    // Same question about 2025, so the immutable raw evidence is reused rather than re-bought.
    expect(second.results[0]!.source_evidence_id).toBe(evidence.id);
    expect(second.results[0]!.source_evidence_id).toBe(first.results[0]!.source_evidence_id);
  });

  test('closed fallback years are not re-acquired on the preferred period’s freshness clock', async () => {
    await activateScreeningPolicy(['AE']);
    const classification = await confirmedClassification();
    await seedYear('784', 2025, null);
    // Older than the 90-day preferred-period window, well inside the closed-period window.
    // SourceEvidence is immutable, so the age is part of how it is written.
    await seedYear('784', 2024, 7_000_000_000, { retrieved_at: new Date(Date.now() - 200 * 86_400_000) });
    const fake = yearAwareClient({});
    setComtradeClient(fake.client);
    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(run.results[0]).toMatchObject({ screening_status: 'eligible', observation_period: 2024, period_lag: 1 });
    expect(fake.calls).not.toHaveBeenCalled();
  });
});

describe('adversarial regressions', () => {
  test('two plans whose windows differ never collide on a globally unique item key', async () => {
    const { buildCountryEvidencePlan } = await import('../src/lib/country-evidence/planner');
    const base = { product_classification_id: 'c1', hs_code: '100630', hs_revision: 'HS2022', as_of_date: AS_OF, candidate_reporters: ['276', '784'], source_mode: 'authenticated' as const, policy: CONFIG_DEFAULTS['country_evidence.policy'], policy_config_version: 1, preferred_period: PREFERRED };
    const commonWindow = [2021, 2022, 2023, 2024, 2025];
    // Germany's window is identical in both plans; only the UAE's moves. Narrowing item identity
    // to a single reporter made these mint the SAME item_key, and item_key is globally unique —
    // so creating the second plan died on a constraint violation.
    const planB = buildCountryEvidencePlan({ ...base, reporter_period_windows: { '276': commonWindow, '784': [2018, 2019, 2020, 2021, 2022] } });
    const planC = buildCountryEvidencePlan({ ...base, reporter_period_windows: { '276': commonWindow, '784': [2019, 2020, 2021, 2022, 2023] } });
    const planA = buildCountryEvidencePlan(base);
    expect(new Set([planA.plan_key, planB.plan_key, planC.plan_key]).size).toBe(3);
    const keys = [planA, planB, planC].flatMap(plan => plan.items.map(item => item.item_key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('a window-less plan keeps the item identities it had before Phase 1G', async () => {
    const { buildCountryEvidencePlan } = await import('../src/lib/country-evidence/planner');
    const base = { product_classification_id: 'c1', hs_code: '100630', hs_revision: 'HS2022', as_of_date: AS_OF, candidate_reporters: ['276'], source_mode: 'authenticated' as const, policy: CONFIG_DEFAULTS['country_evidence.policy'], policy_config_version: 1 };
    const plan = buildCountryEvidencePlan(base);
    // The pre-1G definition had no window keys at all; supplying none must reproduce it exactly.
    expect(plan.frozen_definition).not.toHaveProperty('reporter_period_windows');
    expect(plan.frozen_definition).not.toHaveProperty('preferred_period');
    expect(plan.period_set).toEqual([2021, 2022, 2023, 2024, 2025]);
    expect(plan.items).toHaveLength(11);
  });

  test('the confidence decay is a real number, not rounded away or cliffed to zero', async () => {
    const { CONFIG_DEFAULTS: defaults } = await import('../src/lib/config');
    const decay = defaults['country_truth.scoring_v4'].confidence.recency_decay_per_year;
    const weight = (lag: number) => Math.round(decay ** lag * 1e4) / 1e4;
    // Integer rounding made 0.8^1..0.8^3 all collapse to 1 (no decay) and 0.8^4 to 0 (zero
    // confidence in a fully-evidenced market).
    expect([weight(0), weight(1), weight(2), weight(3), weight(4)]).toEqual([1, 0.8, 0.64, 0.512, 0.4096]);
    expect(defaults['country_truth.scoring_v4'].confidence.formula_version).toBe('weighted_component_evidence_coverage_and_recency_v5');
  });

  test('a reporter’s lag is its own, not a function of who else was shortlisted', async () => {
    const { buildCountryEvidencePlan } = await import('../src/lib/country-evidence/planner');
    const plan = buildCountryEvidencePlan({ product_classification_id: 'c1', hs_code: '100630', hs_revision: 'HS2022', as_of_date: AS_OF, candidate_reporters: ['512', '784'], source_mode: 'authenticated', policy: CONFIG_DEFAULTS['country_evidence.policy'], policy_config_version: 1, preferred_period: PREFERRED, reporter_period_windows: { '784': [2019, 2020, 2021, 2022, 2023], '512': [2018, 2019, 2020, 2021, 2022] } });
    // Every market here lags. Measuring against the plan's newest reporter would report the UAE
    // as lag 0 simply because nothing fresher was shortlisted.
    expect(plan.frozen_definition.preferred_period).toBe(PREFERRED);
    expect(PREFERRED - 2023).toBe(2);
    expect(PREFERRED - 2022).toBe(3);
  });

  test('a closed year is not re-acquired on the preferred period’s freshness clock', async () => {
    const { buildCountryEvidencePlan } = await import('../src/lib/country-evidence/planner');
    const policy = CONFIG_DEFAULTS['country_evidence.policy'];
    const plan = buildCountryEvidencePlan({ product_classification_id: 'c1', hs_code: '100630', hs_revision: 'HS2022', as_of_date: AS_OF, candidate_reporters: ['784'], source_mode: 'authenticated', policy, policy_config_version: 1, preferred_period: PREFERRED, reporter_period_windows: { '784': [2019, 2020, 2021, 2022, 2023] } });
    // 2023 is closed and can never change; billing it on the 90-day clock would re-buy the same
    // immutable fact every quarter, for exactly the lagging markets this phase exists to serve.
    expect(plan.items.every(item => item.freshness_days === policy.closed_period_freshness_days)).toBe(true);
  });

  test('a provider failure at a fallback year is retried at THAT year, not the preferred one', async () => {
    const { selectCountryPeriod } = await import('../src/lib/country-period-selection');
    const selection = selectCountryPeriod({ preferred_period: PREFERRED, probes: { 2025: 'absent', 2024: 'failed' }, policy: CONFIG_DEFAULTS['country_period_selection.policy'] });
    // Nulling this lost the walk's position: acquisition fell back to the preferred period and
    // re-bought a year already known absent, while the real blocker was never retried.
    expect(selection).toMatchObject({ decision: 'blocked_provider_failure', next_probe_period: 2024, reason: 'provider_failure_at_2024' });
  });

  test('a policy that would turn a measured zero into absence is refused', async () => {
    const { validateCountryPeriodSelectionPolicy } = await import('../src/lib/country-period-selection');
    const policy = CONFIG_DEFAULTS['country_period_selection.policy'];
    // Dropping observed_zero from the usable list reclassifies a real zero as absence, and the
    // walk then finds an older non-zero year — turning a measured zero into demand.
    expect(() => validateCountryPeriodSelectionPolicy({ ...policy, usable_cell_statuses: ['observed'] })).toThrow(/observed zero must be a usable cell status/);
    expect(() => validateCountryPeriodSelectionPolicy({ ...policy, provider_failure_permits_fallback: true })).toThrow(/never permit fallback/);
  });

  test('one unparseable evidence row degrades its own market, not the whole run', async () => {
    await activateScreeningPolicy(['DE', 'AE']);
    const classification = await confirmedClassification();
    await seedYear('276', PREFERRED, 9_000_000_000);
    // Evidence whose raw body cannot be re-derived: re-normalization fails closed on it.
    const request = canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: '784', partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PREFERRED), hs_codes: [HS6], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' });
    const raw = JSON.stringify({ rows: [{ reporter: '784', value: 1 }] });
    await prisma.sourceEvidence.create({ data: { provider: 'un_comtrade', dataset: 'synthetic', source_origin: EvidenceOrigin.authenticated_real, environment: 'test', request_fingerprint: comtradeRequestFingerprint(request), request_parameters: request as unknown as Prisma.InputJsonValue, redacted_request: 'comtrade://synthetic', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw, retrieved_at: new Date(), returned_row_count: 1, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted', observations: { create: [{ observation_key: `bad-${randomUUID()}`, reporter_code: '784', partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PREFERRED), ref_year: PREFERRED, hs_code: HS6, hs_level: 6, hs_revision: 'HS2022', trade_value: new Prisma.Decimal(1), trade_value_status: 'observed', quantity_status: 'missing', normalization_version: 'comtrade-normalization-v1', retrieved_at: new Date(), source_origin: EvidenceOrigin.authenticated_real }] } } });

    const run = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    const results = byCountry(run.results) as Map<string, { screening_status: string }>;
    // Germany still resolves normally; only the UAE is degraded.
    expect(results.get('DE')).toMatchObject({ screening_status: 'eligible' });
    expect(['incompatible', 'pending_fallback']).toContain(results.get('AE')!.screening_status);
  });
});
