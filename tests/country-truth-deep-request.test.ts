import { createHash, randomUUID } from 'node:crypto';
import { getNumericCodes } from 'i18n-iso-countries';
import { EvidenceOrigin, OrgTier, Prisma, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import type { Principal } from '../src/types';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '../src/lib/comtrade';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '../src/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION } from '../src/lib/comtrade/normalization';
import { CONFIG_DEFAULTS, type CountryScreeningPolicy } from '../src/lib/config';
import { createGlobalCountryScreeningRun, executeGlobalCountryScreeningRun } from '../src/lib/country-screening/service';
import { requestDeepCountryTruthFromScreening } from '../src/lib/country-truth-deep-request';
import { prisma } from '../src/lib/prisma';

/**
 * Gap B. The pilot request surface can only name Germany, UAE or USA, so a Phase 1G shortlist had
 * no production route into Deep Country Truth. These tests pin the replacement, and above all
 * that the caller supplies a RUN, never a market list.
 */

const AS_OF = new Date('2026-08-26T00:00:00Z');
const PERIOD = 2025;
let hsCounter = 0;
let HS6 = '091111';
const activated: string[] = [];

async function activateConfig(key: string, value: unknown) {
  const latest = await prisma.configSetting.findFirst({ where: { key }, orderBy: { version: 'desc' }, select: { version: true } });
  const row = await prisma.configSetting.create({ data: { key, version: (latest?.version ?? 0) + 1, value: value as Prisma.InputJsonValue, is_active: true } });
  activated.push(row.id);
  return row;
}

async function activateScreeningPolicy(keep: string[], overrides: Partial<CountryScreeningPolicy> = {}) {
  const excluded = Object.fromEntries(Object.values(getNumericCodes()).filter((iso2) => !keep.includes(iso2)).map((iso2) => [iso2, 'no_resident_population']));
  const base = CONFIG_DEFAULTS['country_screening.policy'];
  await activateConfig('country_screening.policy', { ...base, ...overrides, excluded_iso2_codes: { ...base.excluded_iso2_codes, ...excluded } });
}

async function orgWithConfirmedProduct(role: UserRole = UserRole.agent) {
  HS6 = String(91_000 + ++hsCounter).padStart(6, '0');
  const marker = `deep-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const actor = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role } });
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: actor.id, status: 'active' } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Basmati', evidence_origin: EvidenceOrigin.fixture } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: HS6, hs_code_source: 'exporter_supplied', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: 0.99, hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: actor.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  const classification = await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: HS6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: { schema_version: 'test' }, evidence: { source: 'test' }, rationale: 'Test classification', source_references: [], confidence: 0.99, status: ProductClassificationStatus.confirmed, proposed_by_id: actor.id, confirmed_by_id: actor.id, confirmed_at: now } });
  return { org, actor, product, classification, hs6: HS6 };
}

async function seedWorldEvidence(reporter: string, value: number, hs6: string) {
  const request = canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: reporter, partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), hs_codes: [hs6], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' });
  const raw = JSON.stringify({ count: 1, data: [{ reporterCode: Number(reporter), partnerCode: 0, cmdCode: hs6, refYear: PERIOD, primaryValue: value }] });
  await prisma.sourceEvidence.create({
    data: {
      provider: 'un_comtrade', dataset: 'goods-trade', dataset_version: 'v1', source_origin: EvidenceOrigin.authenticated_real, environment: 'test',
      request_fingerprint: comtradeRequestFingerprint(request), request_parameters: request as unknown as Prisma.InputJsonValue,
      redacted_request: 'comtrade://seed', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw,
      retrieved_at: new Date(AS_OF.getTime() - 86_400_000), provider_row_count: 1, returned_row_count: 1, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted',
      observations: { create: [{ observation_key: `deep-${randomUUID()}`, reporter_code: reporter, partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), ref_year: PERIOD, hs_code: hs6, hs_level: 6, hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0', trade_value: value, trade_value_status: 'observed', quantity_status: 'missing', normalization_version: COMTRADE_NORMALIZATION_VERSION, retrieved_at: new Date(AS_OF.getTime() - 86_400_000), source_origin: EvidenceOrigin.authenticated_real }] },
    },
  });
}

/** A completed screen over three markets, entirely from evidence already in the database. */
async function completedScreen(fixture: Awaited<ReturnType<typeof orgWithConfirmedProduct>>) {
  await activateScreeningPolicy(['DE', 'US', 'JP']);
  for (const [reporter, value] of [['276', 9e9], ['842', 7e9], ['392', 2e9]] as const) await seedWorldEvidence(reporter, value, fixture.hs6);
  const run = await createGlobalCountryScreeningRun({ product_classification_id: fixture.classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
  const executed = await executeGlobalCountryScreeningRun(run.id);
  expect(executed.status).toBe('completed');
  return prisma.countryScreeningRun.findUniqueOrThrow({ where: { id: run.id } });
}

const principal = (fixture: Awaited<ReturnType<typeof orgWithConfirmedProduct>>): Principal => ({ id: fixture.actor.id, email: fixture.actor.email, name: fixture.actor.name ?? 'Agent', role: fixture.actor.role, exporter_org_id: null, tier: OrgTier.paid });

beforeEach(() => setComtradeClient({
  name: 'deep-request-null-client',
  identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: `auth-${randomUUID()}`, source_dataset: 'goods-trade', source_dataset_version: 'v1' },
  async resolveChapter() { throw new Error('not used'); },
  async fetchChapter(_params: ComtradeFetchParams) { throw new Error('the deep request path must not contact a provider'); },
}));
afterEach(async () => {
  setComtradeClient(null);
  if (activated.length) await prisma.configSetting.updateMany({ where: { id: { in: activated.splice(0) } }, data: { is_active: false } });
});
afterAll(() => prisma.$disconnect());

describe('Screening run to Deep Country Truth', () => {
  test('accepts a completed run and derives every market from the frozen shortlist', async () => {
    const fixture = await orgWithConfirmedProduct();
    const run = await completedScreen(fixture);

    const result = await requestDeepCountryTruthFromScreening({ actor: principal(fixture), exporter_org_id: fixture.org.id, product_id: fixture.product.id, screening_run_id: run.id, correlation_id: randomUUID() });
    expect(result.created).toBe(true);
    expect(result.payload.candidates.map((item) => item.reporter_code).sort()).toEqual(['276', '392', '842']);
    // Country identity came from the checked-in reporter registry, not from an alias table.
    expect(result.payload.candidates.map((item) => item.country_code).sort()).toEqual(['DE', 'JP', 'US']);
    expect(result.payload.provenance).toMatchObject({ screening_run_id: run.id, screening_run_key: run.run_key, shortlist_size: 3, country_evidence_plan_key: result.plan.plan_key });
    expect(result.payload.hs6).toBe(fixture.hs6);
    // The scoring clock is the screen's as-of date, which is what makes the job bind to this plan.
    expect(result.payload.requested_at).toBe(result.plan.as_of_date.toISOString());

    // "Which frozen global screening result produced this Deep Country Truth run?" is answerable
    // from the persisted plan, not only from the job payload.
    const plan = await prisma.countryEvidencePlan.findUniqueOrThrow({ where: { id: result.plan.id } });
    expect(plan.screening_run_id).toBe(run.id);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: result.job.id } });
    expect(job.target_id).toBe(fixture.classification.id);
    expect(job.exporter_org_id).toBe(fixture.org.id);
  });

  test('refuses a screening run that has not completed', async () => {
    const fixture = await orgWithConfirmedProduct();
    await activateScreeningPolicy(['DE', 'US']);
    for (const [reporter, value] of [['276', 9e9], ['842', 7e9]] as const) await seedWorldEvidence(reporter, value, fixture.hs6);
    const planned = await createGlobalCountryScreeningRun({ product_classification_id: fixture.classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    expect(planned.status).toBe('planned');

    await expect(requestDeepCountryTruthFromScreening({ actor: principal(fixture), exporter_org_id: fixture.org.id, product_id: fixture.product.id, screening_run_id: planned.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [expect.objectContaining({ code: 'screening_incomplete' })] });
    expect(await prisma.job.count({ where: { type: 'country_truth_discovery', exporter_org_id: fixture.org.id } })).toBe(0);
  });

  test('refuses another tenant and another tenant\'s product', async () => {
    const owner = await orgWithConfirmedProduct();
    const run = await completedScreen(owner);
    const intruder = await orgWithConfirmedProduct();

    // Wrong tenant: an agent of another org may not request against this org.
    await expect(requestDeepCountryTruthFromScreening({ actor: principal(intruder), exporter_org_id: owner.org.id, product_id: owner.product.id, screening_run_id: run.id, correlation_id: randomUUID() })).rejects.toBeTruthy();
    // Wrong product: the run belongs to a different classification, so its shortlist may not be
    // reused for another product even inside the correct tenant.
    await expect(requestDeepCountryTruthFromScreening({ actor: principal(intruder), exporter_org_id: intruder.org.id, product_id: intruder.product.id, screening_run_id: run.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', fields: [expect.objectContaining({ code: 'classification_mismatch' })] });
    expect(await prisma.job.count({ where: { exporter_org_id: intruder.org.id, type: 'country_truth_discovery' } })).toBe(0);
  });

  test('a repeated request returns the same in-flight job', async () => {
    const fixture = await orgWithConfirmedProduct();
    const run = await completedScreen(fixture);
    const first = await requestDeepCountryTruthFromScreening({ actor: principal(fixture), exporter_org_id: fixture.org.id, product_id: fixture.product.id, screening_run_id: run.id, correlation_id: randomUUID() });
    const second = await requestDeepCountryTruthFromScreening({ actor: principal(fixture), exporter_org_id: fixture.org.id, product_id: fixture.product.id, screening_run_id: run.id, correlation_id: randomUUID() });
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(await prisma.job.count({ where: { type: 'country_truth_discovery', exporter_org_id: fixture.org.id } })).toBe(1);
  });

  test('a shortlist edited after the deep request cannot change the frozen job', async () => {
    const fixture = await orgWithConfirmedProduct();
    const run = await completedScreen(fixture);
    const requested = await requestDeepCountryTruthFromScreening({ actor: principal(fixture), exporter_org_id: fixture.org.id, product_id: fixture.product.id, screening_run_id: run.id, correlation_id: randomUUID() });
    const frozenReporters = requested.payload.candidates.map((item) => item.reporter_code).sort();

    // The frozen shortlist cannot be edited at all once its run completes: the database refuses
    // it, so there is no state in which a deep request could disagree with its own screen.
    await expect(prisma.countryScreeningResult.updateMany({ where: { run_id: run.id, reporter_code: '392' }, data: { shortlisted: false } }))
      .rejects.toThrow(/immutable once their run completes/);

    const job = await prisma.job.findUniqueOrThrow({ where: { id: requested.job.id } });
    const stored = job.payload as unknown as { candidates: Array<{ reporter_code: string }>; provenance: { shortlist_reporters: string[] } };
    expect(stored.candidates.map((item) => item.reporter_code).sort()).toEqual(frozenReporters);
    expect([...stored.provenance.shortlist_reporters].sort()).toEqual(frozenReporters);
  });

  test('refuses a shortlist larger than policy allows', async () => {
    const fixture = await orgWithConfirmedProduct();
    await activateScreeningPolicy(['DE', 'US', 'JP'], { max_shortlist_size: 3, shortlist_target_size: 3 });
    for (const [reporter, value] of [['276', 9e9], ['842', 7e9], ['392', 2e9]] as const) await seedWorldEvidence(reporter, value, fixture.hs6);
    const run = await createGlobalCountryScreeningRun({ product_classification_id: fixture.classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    await executeGlobalCountryScreeningRun(run.id);
    // Re-activate a policy whose ceiling the frozen shortlist now exceeds.
    await activateScreeningPolicy(['DE', 'US', 'JP'], { max_shortlist_size: 1, shortlist_target_size: 1 });

    await expect(requestDeepCountryTruthFromScreening({ actor: principal(fixture), exporter_org_id: fixture.org.id, product_id: fixture.product.id, screening_run_id: run.id, correlation_id: randomUUID() }))
      .rejects.toMatchObject({ fields: [expect.objectContaining({ code: 'shortlist_too_large' })] });
  });

  test('the pilot alias surface still refuses a non-pilot country', async () => {
    const { mapCountryTruthCandidates } = await import('../src/lib/country-truth-discovery-request');
    expect(mapCountryTruthCandidates(['Germany', 'USA']).map((item) => item.reporter_code)).toEqual(['276', '842']);
    expect(() => mapCountryTruthCandidates(['Japan'])).toThrow();
  });
});
