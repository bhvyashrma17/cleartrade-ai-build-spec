import { createHash, randomUUID } from 'node:crypto';
import { getNumericCodes } from 'i18n-iso-countries';
import { EvidenceOrigin, JobType, OrgTier, Prisma, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '../src/lib/comtrade';
import { CONFIG_DEFAULTS } from '../src/lib/config';
import { enqueueGlobalCountryScreening, runGlobalCountryScreening } from '../src/lib/job-handlers/country-screening';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, getJobHandler, runClaimedJob } from '../src/lib/jobs';
import { isCostedJobType } from '../src/lib/billing/costed-work';
import { prisma } from '../src/lib/prisma';

const AS_OF = new Date('2026-08-26T00:00:00.000Z');
let hsCounter = 0;

async function activateScreeningPolicy(keep: string[], overrides: Record<string, unknown> = {}) {
  const excluded = Object.fromEntries(Object.values(getNumericCodes()).filter(iso2 => !keep.includes(iso2)).map(iso2 => [iso2, 'no_resident_population']));
  const defaults = CONFIG_DEFAULTS['country_screening.policy'];
  await activateConfig('country_screening.policy', { ...defaults, ...overrides, excluded_iso2_codes: { ...defaults.excluded_iso2_codes, ...excluded } });
  await activateConfig('comtrade.policy', { ...CONFIG_DEFAULTS['comtrade.policy'], request_delay_ms: 0, daily_request_budget: 40 });
}

async function fixture() {
  const marker = `screening-job-${randomUUID()}`, hs6 = String(80_000 + ++hsCounter).padStart(6, '0');
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Basmati rice', evidence_origin: EvidenceOrigin.authenticated_real } });
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: hs6, hs_code_source: 'manually_verified', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.manually_verified, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: .99, hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: agent.id, hs_confirmed_at: AS_OF, hs_classification_revision: 1 } });
  const classification = await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: hs6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.manually_verified, product_facts_snapshot: { name: product.name }, evidence: { source: 'test' }, rationale: 'Confirmed pilot classification.', source_references: [], confidence: .99, status: ProductClassificationStatus.confirmed, proposed_by_id: agent.id, confirmed_by_id: agent.id, confirmed_at: AS_OF } });
  const { job, payload } = await enqueueGlobalCountryScreening({ exporter_org_id: org.id, product_id: product.id, product_classification_id: classification.id, hs6, hs_revision: 'HS2022', source_mode: TradeSourceMode.authenticated, requested_by_agent_id: agent.id, requested_at: AS_OF, correlation_id: randomUUID() });
  return { org, agent, product, classification, hs6, job, payload };
}

function authenticatedClient(valuesByReporter: Record<string, number>) {
  const calls = vi.fn();
  return { calls, client: {
    name: 'screening-job-fake', identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: `auth-${randomUUID()}`, source_dataset: 'un-comtrade-api', source_dataset_version: 'mock-v1' },
    async resolveChapter() { throw new Error('Explicit HS6 must bypass reference data.'); },
    async fetchChapter(params: ComtradeFetchParams) {
      calls(params);
      await params.before_physical_request?.();
      const value = valuesByReporter[params.reporter];
      const rows = value == null ? [] : [{ reporter: params.reporter, partner: '0', partner2: '0', hs_code: params.hs_codes[0]!, year: params.year, period: String(params.year), value, value_status: 'observed' as const, quantity: null, quantity_status: 'missing' as const, unit: null, flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }];
      const raw = JSON.stringify({ count: rows.length, data: rows });
      return { rows, request_count: 1, retrieved_at: new Date(), source_dataset_version: 'mock-v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'https://comtradeapi.un.org/redacted', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { truncated: false, rejected_rows: 0 }, quota_metadata: null, retrieved_at: new Date() }] };
    },
  } };
}

const context = (f: Awaited<ReturnType<typeof fixture>>) => ({ job_id: f.job.id, attempt_no: 1, payload: f.job.payload, exporter_org_id: f.org.id, target_id: f.classification.id, correlation_id: f.job.correlation_id, reportProgress: async () => undefined });

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

describe('country_screening job', () => {
  test('is registered, costed, and screens the world from a confirmed product alone', async () => {
    registerAllJobHandlers();
    expect(getJobHandler(JobType.country_screening)).toBe(runGlobalCountryScreening);
    expect(isCostedJobType(JobType.country_screening)).toBe(true);
    await activateScreeningPolicy(['DE', 'US', 'VN', 'JP'], { shortlist_target_size: 2, max_shortlist_size: 2 });
    const f = await fixture();
    // The request carries no candidate countries at all — that is the Phase 1F point.
    expect(f.payload).not.toHaveProperty('candidates');
    const provider = authenticatedClient({ '276': 9e9, '842': 7e9, '704': 4e9, '392': 2e9 });
    setComtradeClient(provider.client);

    const claimed = await claimNextJob([JobType.country_screening]);
    expect(claimed?.id).toBe(f.job.id);
    await runClaimedJob(claimed!);

    const finished = await prisma.job.findUniqueOrThrow({ where: { id: f.job.id } });
    const result = finished.result as Record<string, unknown>;
    expect(finished.status).toBe('completed');
    expect(provider.calls).toHaveBeenCalledTimes(4);
    expect(result).toMatchObject({ schema_version: 'global-country-screening-result-v1', screening_status: 'completed', universe_size: 4, preferred_period: 2025, max_fallback_lookback_years: 2, eligible_count: 4, shortlist_size: 2, shortlist_reporters: ['276', '842'], physical_calls: 4 });
    expect(finished).toMatchObject({ progress_stage: 'completed', progress: 100, checkpoint: expect.objectContaining({ shortlist_reporters: ['276', '842'] }) });
    const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: String(result.screening_run_id) } });
    expect(run).toMatchObject({ status: 'completed', source_mode: TradeSourceMode.authenticated, hs_code: f.hs6, universe_size: 4 });
    expect((finished.checkpoint as { screening_run_id?: string }).screening_run_id).toBe(run.id);
    // Stage A ends at the shortlist: no deep plan is created here.
    expect(await prisma.countryEvidencePlan.count({ where: { product_classification_id: f.classification.id } })).toBe(0);
  });

  test('a duplicate execution reattaches to the frozen run and spends nothing', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    const f = await fixture(), provider = authenticatedClient({ '276': 9e9, '842': 7e9 });
    setComtradeClient(provider.client);
    const first = await runGlobalCountryScreening(context(f));
    const second = await runGlobalCountryScreening({ ...context(f), attempt_no: 2 });
    expect(provider.calls).toHaveBeenCalledTimes(2);
    expect((second.result as Record<string, unknown>).screening_run_id).toBe((first.result as Record<string, unknown>).screening_run_id);
    expect(second.result).toMatchObject({ physical_calls: 0, total_physical_calls: 2 });
    expect(second.status).toBe('completed');
    expect(await prisma.countryScreeningRun.count({ where: { product_classification_id: f.classification.id } })).toBe(1);
  });

  test('refuses to run when the screening policy has moved under the frozen payload', async () => {
    await activateScreeningPolicy(['DE', 'US']);
    const f = await fixture();
    setComtradeClient(authenticatedClient({ '276': 9e9, '842': 7e9 }).client);
    await activateScreeningPolicy(['DE', 'US'], { shortlist_target_size: 7 });
    await expect(runGlobalCountryScreening(context(f))).rejects.toThrow(/policy identity no longer matches/);
    expect(await prisma.countryScreeningRun.count({ where: { product_classification_id: f.classification.id } })).toBe(0);
  });

  test('refuses a payload that does not match its own Job row', async () => {
    await activateScreeningPolicy(['DE']);
    const f = await fixture();
    await expect(runGlobalCountryScreening({ ...context(f), target_id: 'someone-elses-classification' })).rejects.toThrow(/identity does not match/);
    const other = await prisma.user.create({ data: { email: `outsider-${randomUUID()}@example.test`, name: 'Outsider', role: UserRole.exporter_owner } });
    await prisma.job.update({ where: { id: f.job.id }, data: { requested_by_id: other.id } });
    await expect(runGlobalCountryScreening(context(f))).rejects.toThrow(/identity does not match/);
  });

  test('an equivalent screen already in flight is not enqueued twice', async () => {
    await activateScreeningPolicy(['DE']);
    const f = await fixture();
    await expect(enqueueGlobalCountryScreening({ exporter_org_id: f.org.id, product_id: f.product.id, product_classification_id: f.classification.id, hs6: f.hs6, hs_revision: 'HS2022', source_mode: TradeSourceMode.authenticated, requested_by_agent_id: f.agent.id, requested_at: AS_OF })).rejects.toThrow(/JOB_ALREADY_RUNNING|already running/i);
    expect(await prisma.job.count({ where: { type: JobType.country_screening, target_id: f.classification.id } })).toBe(1);
  });

  test('a free tenant cannot spend provider budget on a global screen', async () => {
    await activateScreeningPolicy(['DE']);
    const f = await fixture();
    await prisma.exporterOrg.update({ where: { id: f.org.id }, data: { tier: OrgTier.free } });
    await expect(enqueueGlobalCountryScreening({ exporter_org_id: f.org.id, product_id: f.product.id, product_classification_id: f.classification.id, hs6: f.hs6, hs_revision: 'HS2022', source_mode: TradeSourceMode.authenticated, requested_by_agent_id: f.agent.id, requested_at: new Date('2026-08-27T00:00:00.000Z') })).rejects.toThrow();
  });

  test('two concurrent executions of the same job converge on one run and one result set', async () => {
    await activateScreeningPolicy(['DE', 'US', 'JP']);
    const f = await fixture(), provider = authenticatedClient({ '276': 9e9, '842': 7e9, '392': 2e9 });
    setComtradeClient(provider.client);
    // The queue's atomic claim already makes this unreachable in production; the assertion is
    // that the persistence layer does not depend on that guarantee for its own integrity.
    const outcomes = await Promise.all([runGlobalCountryScreening(context(f)), runGlobalCountryScreening({ ...context(f), attempt_no: 2 })]);
    const runIds = outcomes.map(outcome => (outcome.result as Record<string, unknown>).screening_run_id);
    expect(new Set(runIds).size).toBe(1);
    expect(await prisma.countryScreeningRun.count({ where: { product_classification_id: f.classification.id } })).toBe(1);
    expect(await prisma.countryScreeningResult.count({ where: { run_id: String(runIds[0]) } })).toBe(3);
    const run = await prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: String(runIds[0]) }, include: { results: true } });
    expect(run.results.filter(row => row.screening_status === 'eligible')).toHaveLength(3);
    expect(new Set(run.results.map(row => row.reporter_code)).size).toBe(3);
  });
});
