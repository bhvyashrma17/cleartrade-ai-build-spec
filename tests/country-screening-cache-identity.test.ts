/**
 * Cache identity for Phase 1F.
 *
 * A prior production-quality bug in this codebase came from a semantic normalization change that
 * did not invalidate cached observations. These tests exist so that class of bug cannot recur
 * through the reporter registry: a change in who we ask must change what we consider an answer,
 * while a change that leaves the question identical must still reuse the evidence we already
 * paid for.
 */
import { createHash, randomUUID } from 'node:crypto';
import { getNumericCodes } from 'i18n-iso-countries';
import { EvidenceOrigin, OrgTier, Prisma, ProductClassificationMethod, ProductClassificationStatus, TradeSourceMode, UserRole } from '@prisma/client';
import { afterAll, describe, expect, test } from 'vitest';
import { canonicalComtradeRequest, comtradeRequestFingerprint } from '../src/lib/comtrade/request';
import { COMTRADE_NORMALIZATION_VERSION, COMTRADE_PARSER_VERSION } from '../src/lib/comtrade/normalization';
import { comtradeReporterRegistry, type ComtradeReporterRegistry } from '../src/lib/comtrade/reporter-registry';
import { CONFIG_DEFAULTS, type CountryScreeningPolicy } from '../src/lib/config';
import { buildCountryEvidencePlan } from '../src/lib/country-evidence/planner';
import { buildCountryScreeningPlan, screeningComtradeRequest } from '../src/lib/country-screening/planner';
import { createGlobalCountryScreeningRun, resolveGlobalCountryScreeningRun } from '../src/lib/country-screening/service';
import { prisma } from '../src/lib/prisma';

const AS_OF = new Date('2026-08-26T00:00:00Z');
const PERIOD = 2025;
let hsCounter = 0;
let HS6 = '090111';

async function activateScreeningPolicy(keep: string[], overrides: Partial<CountryScreeningPolicy> = {}) {
  const defaults = CONFIG_DEFAULTS['country_screening.policy'];
  const excluded = Object.fromEntries(Object.values(getNumericCodes()).filter(iso2 => !keep.includes(iso2)).map(iso2 => [iso2, 'no_resident_population']));
  const value = { ...defaults, ...overrides, excluded_iso2_codes: { ...defaults.excluded_iso2_codes, ...excluded } };
  await activateConfig('country_screening.policy', value);
  return value;
}

async function confirmedClassification() {
  HS6 = String(70_000 + ++hsCounter).padStart(6, '0');
  const marker = `cache-identity-${randomUUID()}`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid } });
  const user = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Screener', role: UserRole.agent, exporter_org_id: org.id } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Rice', evidence_origin: EvidenceOrigin.fixture } });
  const now = new Date();
  await prisma.product.update({ where: { id: product.id }, data: { hs_code: HS6, hs_code_source: 'exporter_supplied', hs_nomenclature: 'HS', hs_nomenclature_version: 'HS2022', hs_classification_method: ProductClassificationMethod.exporter_supplied, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: .99, hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: user.id, hs_confirmed_at: now, hs_classification_revision: 1 } });
  return prisma.productClassification.create({ data: { product_id: product.id, revision: 1, hs6_code: HS6, nomenclature: 'HS', nomenclature_version: 'HS2022', method: ProductClassificationMethod.exporter_supplied, product_facts_snapshot: { schema_version: 'test' }, evidence: { source: 'test' }, rationale: 'Test', source_references: [], confidence: .99, status: ProductClassificationStatus.confirmed, proposed_by_id: user.id, confirmed_by_id: user.id, confirmed_at: now } });
}

async function seedWorldEvidence(reporter: string, value: number) {
  const request = canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: reporter, partner_code: '0', partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), hs_codes: [HS6], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' });
  const raw = JSON.stringify({ count: 1, data: [{ reporterCode: Number(reporter), partnerCode: 0, partner2Code: 0, cmdCode: HS6, refYear: PERIOD, period: String(PERIOD), flowCode: 'M', freqCode: 'A', primaryValue: value, customsCode: 'C00', mosCode: '0', clCode: 'H6' }] });
  return prisma.sourceEvidence.create({ data: {
    provider: 'un_comtrade', dataset: 'comtrade-goods', dataset_version: 'v1', source_origin: EvidenceOrigin.authenticated_real, environment: 'test',
    request_fingerprint: comtradeRequestFingerprint(request), request_parameters: request as unknown as Prisma.InputJsonValue,
    redacted_request: 'comtrade://seeded', http_status: 200, response_checksum: createHash('sha256').update(raw).digest('hex'), raw_response_text: raw,
    retrieved_at: new Date(), provider_row_count: 1, returned_row_count: 1, completeness: 'COMPLETE', parser_version: COMTRADE_PARSER_VERSION, status: 'accepted',
    observations: { create: [{ observation_key: `cache-${randomUUID()}`, reporter_code: reporter, partner_code: '0', partner_is_world: true, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(PERIOD), ref_year: PERIOD, hs_code: HS6, hs_level: 6, hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0', trade_value: new Prisma.Decimal(value), trade_value_status: 'observed', quantity_status: 'missing', normalization_version: COMTRADE_NORMALIZATION_VERSION, retrieved_at: new Date(), source_origin: EvidenceOrigin.authenticated_real }] },
  } });
}

/** The same registry with one country's reporter code moved — a reference refresh, simulated. */
function registryWithReporter(iso2: string, reporterCode: string): ComtradeReporterRegistry {
  const registry = comtradeReporterRegistry();
  return { ...registry, checksum: createHash('sha256').update(`${registry.checksum}:${iso2}:${reporterCode}`).digest('hex'), reporters: registry.reporters.map(row => row.iso2 === iso2 ? { ...row, reporter_code: reporterCode } : row) };
}

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

afterAll(async () => { await restoreConfig(); await prisma.$disconnect(); });

describe('reporter identity is part of the evidence question', () => {
  test('a different reporter code is a different request, so evidence cannot cross over', () => {
    const request = (reporter: string) => comtradeRequestFingerprint(screeningComtradeRequest({ reporter_code: reporter, partner_code: '0', period: PERIOD, hs_code: '100630', hs_revision: 'HS2022', source_mode: 'authenticated' }));
    // Italy under the provider's real code versus the repository alias map's 381.
    expect(request('380')).not.toBe(request('381'));
    expect(request('842')).not.toBe(request('840'));
    expect(request('251')).not.toBe(request('250'));
  });

  test('every divergent reporter still shares its fingerprint with the deep plan', () => {
    for (const reporter of ['251', '380', '579', '757', '842', '276', '784']) {
      const deep = buildCountryEvidencePlan({ product_classification_id: 'c1', hs_code: '100630', hs_revision: 'HS2022', as_of_date: AS_OF, candidate_reporters: [reporter], source_mode: 'authenticated', policy: CONFIG_DEFAULTS['country_evidence.policy'], policy_config_version: 1 });
      const world = deep.items.find(item => item.purpose === 'WORLD_IMPORT_HISTORY' && item.period === deep.latest_common_year)!;
      const deepFingerprint = comtradeRequestFingerprint(canonicalComtradeRequest({ provider: 'un_comtrade', dataset: 'goods-trade', source_mode: 'authenticated', purpose: 'country_truth', reporter_code: world.reporter_code, partner_code: world.partner_code, partner2_code: '0', flow_direction: 'import', frequency: 'A', period: String(world.period), hs_codes: ['100630'], hs_revision: 'HS2022', customs_code: 'C00', mode_of_supply: '0' }));
      expect(comtradeRequestFingerprint(screeningComtradeRequest({ reporter_code: reporter, partner_code: '0', period: deep.latest_common_year, hs_code: '100630', hs_revision: 'HS2022', source_mode: 'authenticated' })), reporter).toBe(deepFingerprint);
    }
  });

  test('moving a reporter code moves the plan identity and every item key', () => {
    const base = { product_classification_id: 'c1', hs_code: '100630', hs_revision: 'HS2022', as_of_date: AS_OF, source_mode: 'authenticated' as const, policy: CONFIG_DEFAULTS['country_screening.policy'], policy_config_version: 1, period_selection_policy: CONFIG_DEFAULTS['country_period_selection.policy'], period_selection_policy_config_version: 1 };
    const before = buildCountryScreeningPlan(base);
    const after = buildCountryScreeningPlan({ ...base, reporter_registry: registryWithReporter('IT', '381') });
    expect(after.run_key).not.toBe(before.run_key);
    expect(after.frozen_definition.reporter_registry_checksum).not.toBe(before.frozen_definition.reporter_registry_checksum);
    // Item keys carry the whole definition, so no per-country key survives the change either.
    expect(after.items.map(item => item.item_key).some(key => before.items.some(item => item.item_key === key))).toBe(false);
  });
});

describe('a registry change cannot silently reuse an incompatible screening result', () => {
  test('opens a new run and refuses the old reporter’s evidence', async () => {
    await activateScreeningPolicy(['IT', 'DE']);
    const classification = await confirmedClassification();
    await seedWorldEvidence('380', 4_000_000_000);
    await seedWorldEvidence('276', 9_000_000_000);

    const current = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    const italy = current.results.find(row => row.country_code === 'IT')!;
    expect(italy).toMatchObject({ reporter_code: '380', screening_status: 'eligible' });

    // A refreshed reference that moves Italy to 381 must not read the 380 evidence as Italy's.
    const moved = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated, reporter_registry: registryWithReporter('IT', '381') });
    expect(moved.id).not.toBe(current.id);
    expect(moved.reporter_registry_checksum).not.toBe(current.reporter_registry_checksum);
    const resolved = await resolveGlobalCountryScreeningRun(moved.id);
    const movedItaly = resolved.results.find(row => row.country_code === 'IT')!;
    expect(movedItaly).toMatchObject({ reporter_code: '381', screening_status: 'pending_fallback', source_evidence_id: null });
    expect(movedItaly.request_fingerprint).not.toBe(italy.request_fingerprint);
    // The original run and its result are untouched history.
    const reloaded = await prisma.countryScreeningResult.findUniqueOrThrow({ where: { id: italy.id } });
    expect(reloaded).toMatchObject({ reporter_code: '380', screening_status: 'eligible', source_evidence_id: italy.source_evidence_id });
  });

  test('a policy change opens a new run but still reuses genuinely compatible raw evidence', async () => {
    await activateScreeningPolicy(['DE', 'JP']);
    const classification = await confirmedClassification();
    await seedWorldEvidence('276', 9_000_000_000);
    await seedWorldEvidence('392', 2_000_000_000);
    const first = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(first.eligible_count).toBe(2);

    // Shortlist size changes what we select, not what a World import observation means.
    await activateScreeningPolicy(['DE', 'JP'], { shortlist_target_size: 1, max_shortlist_size: 1 });
    const second = await resolveGlobalCountryScreeningRun((await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated })).id);
    expect(second.id).not.toBe(first.id);
    expect(second.eligible_count).toBe(2);
    expect(second.shortlist_size).toBe(1);
    // Same question, same evidence: the new run cites the identical immutable rows.
    expect(second.results.map(row => row.source_evidence_id).sort()).toEqual(first.results.map(row => row.source_evidence_id).sort());
    expect(second.results.map(row => row.observation_id).sort()).toEqual(first.results.map(row => row.observation_id).sort());
    expect(second.results.map(row => row.request_fingerprint).sort()).toEqual(first.results.map(row => row.request_fingerprint).sort());
  });

  test('the registry identity is frozen on the run and cannot be edited afterwards', async () => {
    await activateScreeningPolicy(['DE']);
    const classification = await confirmedClassification();
    const run = await createGlobalCountryScreeningRun({ product_classification_id: classification.id, as_of_date: AS_OF, source_mode: TradeSourceMode.authenticated });
    expect(run).toMatchObject({ reporter_registry_version: comtradeReporterRegistry().version, reporter_registry_checksum: comtradeReporterRegistry().checksum });
    await expect(prisma.countryScreeningRun.update({ where: { id: run.id }, data: { reporter_registry_checksum: 'rewritten' } })).rejects.toThrow(/immutable/);
    await expect(prisma.countryScreeningRun.update({ where: { id: run.id }, data: { reporter_registry_version: 'comtrade-reporter-registry-v9' } })).rejects.toThrow(/immutable/);
  });
});
