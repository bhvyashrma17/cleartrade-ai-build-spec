import { createHash, randomUUID } from 'node:crypto';
import {
  AuthorityReleaseChange,
  EvidenceOrigin,
  JobStatus,
  MarketAccessRuleType,
  OrgTier,
  Prisma,
  ProductClassificationMethod,
  ProductClassificationStatus,
  UserRole,
} from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { setComtradeClient, type ComtradeFetchParams } from '@/lib/comtrade';
import { CONFIG_DEFAULTS, marketAccessOrchestrationPolicyProblems } from '@/lib/config';
import { requestCountryTruthDiscovery } from '@/lib/country-truth-discovery-request';
import { COUNTRY_TRUTH_TARIFF_CLOCK_VERSION } from '@/lib/country-truth/fact-snapshot-service';
import { calculateMarketAccessV2 } from '@/lib/country-truth/phase-1h-calculations';
import { acquireTariffEvidence, setTariffAdapterResolverForTesting, tariffClockFor, type TariffAcquisitionOutcome } from '@/lib/country-truth/tariff-acquisition';
import { runCountryTruthDiscovery } from '@/lib/job-handlers/country-truth-discovery';
import type { MarketAccessAdapter, MarketAccessAdapterRequest } from '@/lib/job-handlers/market-access';
import type { MarketAccessIngestResult } from '@/lib/market-access/contract';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/**
 * WP2 (docs/35 E-004): the deep Country Truth run acquires tariff evidence for its own shortlist,
 * and tariff evidence is admitted on the run's own clock (owner decision D-004). Every provider here
 * is an in-process double: no test reaches a network.
 */

const REQUESTED_AT = new Date('2026-08-24T00:00:00.000Z');
const RELEASE_RETRIEVED_AT = new Date('2026-08-01T00:00:00.000Z');
/** A collision-free HS6 band for this file — see country-truth-discovery-handler.test.ts. */
let hsCounter = 0;
const nextHs6 = () => String(940_000 + (hsCounter += 1)).padStart(6, '0');
const activated: string[] = [];

async function enableOrchestration(overrides: Record<string, unknown> = {}) {
  const key = 'country_truth.market_access_orchestration';
  const latest = await prisma.configSetting.findFirst({ where: { key }, orderBy: { version: 'desc' }, select: { version: true } });
  const value = { ...CONFIG_DEFAULTS[key], enabled: true, live_fetch_timeout_ms: 1_000, ...overrides };
  const row = await prisma.configSetting.create({ data: { key, version: (latest?.version ?? 0) + 1, value: value as Prisma.InputJsonValue, is_active: true } });
  activated.push(row.id);
}

/**
 * Removed rather than deactivated: the config route numbers a new version from the ACTIVE row, so
 * inactive leftovers in the shared test schema would collide with a later file's first version.
 */
async function disableOrchestration() {
  if (activated.length) await prisma.configSetting.deleteMany({ where: { id: { in: activated.splice(0) } } });
}

/** Deterministic authenticated Comtrade double — the same shape the handler tests use. */
function comtradeClient() {
  return {
    name: 'tariff-acquisition-comtrade',
    identity: { provider: 'un_comtrade' as const, mode: 'authenticated' as const, authenticated: true, credential_fingerprint: `wp2-${randomUUID()}`, source_dataset: 'un-comtrade-api', source_dataset_version: 'mock-v1' },
    async resolveChapter() { throw new Error('Explicit HS6 must bypass reference data.'); },
    async fetchChapter(params: ComtradeFetchParams) {
      const values = params.partner === 'all' ? [['156', 60], ['699', 40]] : params.partner === '699' ? [['699', 40]] : [['0', 100]];
      const rows = values.map(([partner, value]) => ({ reporter: params.reporter, partner: String(partner), partner2: '0', hs_code: params.hs_codes[0], year: params.year, period: String(params.year), value: Number(value), value_status: 'observed' as const, quantity: 10, quantity_status: 'observed' as const, unit: 'kg', net_weight: 10, flow_code: 'M', frequency: 'A', customs_code: 'C00', mode_of_supply: '0' }));
      const raw = JSON.stringify({ count: rows.length, data: rows });
      const retrieved = new Date('2026-08-24T01:00:00.000Z');
      return { rows, request_count: 1, retrieved_at: retrieved, source_dataset_version: 'mock-v1', evidence_pages: [{ http_status: 200, raw_response_text: raw, response_checksum: createHash('sha256').update(raw).digest('hex'), redacted_request: 'https://comtradeapi.un.org/redacted', provider_row_count: rows.length, returned_row_count: rows.length, completeness: 'COMPLETE' as const, completeness_metadata: { provider_count: rows.length, response_rows: rows.length, accepted_rows: rows.length, rejected_rows: 0, truncated: false, pagination_supported: false, parser_version: 'comtrade-parser-v2' }, quota_metadata: null, retrieved_at: retrieved }] };
    },
  };
}

function adValorem(rate: number) {
  return { kind: 'ad_valorem' as const, ad_valorem_rate_percent: rate, specific_amount: null, specific_currency: null, specific_unit: null, specific_unit_quantity: null, expression: `${rate}%`, note: null };
}

/** A result shaped exactly as a Customs Atlas adapter returns one: one exact line, explicit non-applicable India preference. */
function tariffResult(args: {
  country: string; hs6: string; provider: string; code_system: MarketAccessIngestResult['national_code_system'];
  retrieved_at: Date; rate: number; effective_from: Date | null; release_id?: string; request_identity?: string;
  requirements?: MarketAccessIngestResult['requirements'];
}): MarketAccessIngestResult {
  const line = { national_tariff_code: `${args.hs6}0000`, description: 'Fixture line', declarable: true, effective_from: args.effective_from, effective_to: null, general_duty: adValorem(args.rate), control_codes: [], preference_area_ids: [] };
  return {
    jurisdiction: args.country, country_code: args.country, hs6: args.hs6, hs_revision: 'HS2022', provider: args.provider,
    source_authority: `${args.country} fixture authority`, source_dataset: 'fixture', source_dataset_version: 'fixture-v1',
    source_reference: `https://example.test/${args.country}/${args.hs6}`, national_code_system: args.code_system, parser_version: 'fixture-v1',
    ...(args.release_id ? { source_release_id: args.release_id, request_identity: args.request_identity ?? null } : {}),
    retrieved_at: args.retrieved_at, evidence_class: 'authoritative_public', recorded_by_id: null,
    resolution: { resolution: 'exact', resolved_line: line, candidates: [line], candidate_count: 1, differences: [], reason: 'fixture' },
    general_duty: adValorem(args.rate),
    india_preference: { applicability: 'not_applicable', duty: null, geographic_area_id: null, basis: 'fixture: no India preference' },
    lines: [], requirements: args.requirements ?? [], regulatory_coverage_complete: false, raw_evidence: { fixture: true },
  };
}

async function fixture(countries: string[]) {
  const marker = `wp2-${randomUUID()}`;
  const hs6 = nextHs6();
  const itcHs = `${hs6}12`;
  const org = await prisma.exporterOrg.create({ data: { display_name: marker, tier: OrgTier.paid, country: 'IN' } });
  const agent = await prisma.user.create({ data: { email: `${marker}@example.test`, name: 'Agent', role: UserRole.agent } });
  await prisma.agentAssignment.create({ data: { exporter_org_id: org.id, agent_user_id: agent.id, status: 'active' } });
  const product = await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Basmati rice', evidence_origin: EvidenceOrigin.authenticated_real } });
  await prisma.product.update({ where: { id: product.id }, data: { itc_hs_code: itcHs, hs_code: hs6, hs_code_source: 'manually_verified', hs_nomenclature: 'ITC-HS', hs_nomenclature_version: '2022', hs_classification_method: ProductClassificationMethod.manually_verified, hs_classification_status: ProductClassificationStatus.confirmed, hs_classification_confidence: new Prisma.Decimal('0.99'), hs_classification_evidence: { source: 'test' }, hs_confirmed_by_id: agent.id, hs_confirmed_at: REQUESTED_AT, hs_classification_revision: 1 } });
  const classification = await prisma.productClassification.create({ data: { product_id: product.id, revision: 1, itc_hs_code: itcHs, hs6_code: hs6, nomenclature: 'ITC-HS', nomenclature_version: '2022', method: ProductClassificationMethod.manually_verified, product_facts_snapshot: { name: product.name }, evidence: { source: 'test' }, rationale: 'Confirmed pilot classification.', source_references: [], confidence: new Prisma.Decimal('0.99'), status: ProductClassificationStatus.confirmed, proposed_by_id: agent.id, confirmed_by_id: agent.id, confirmed_at: REQUESTED_AT } });
  const actor: Principal = { id: agent.id, email: agent.email, name: agent.name, role: UserRole.agent, exporter_org_id: null, tier: OrgTier.paid };
  const release = await prisma.authorityRelease.create({
    data: {
      label: `Fixture release ${marker}`, source_family: 'FIXTURE', authority: 'Fixture authority', destination_scope: ['DE'], source_url: 'https://example.test/release',
      release_identifier: marker, reference_date: RELEASE_RETRIEVED_AT, source_distribution: 'fixture', retrieved_at: RELEASE_RETRIEVED_AT, source_format: 'json',
      checksum: createHash('sha256').update(marker).digest('hex'), size_bytes: 1, artifact_object_key: `fixtures/${marker}`, file_manifest: [], reader_version: 'fixture-v1',
      parser_version: 'fixture-v1', validation: {}, change_classification: AuthorityReleaseChange.NEW_RELEASE, change_basis: {}, imported_by_id: agent.id,
    },
  });
  const requested = await requestCountryTruthDiscovery({ actor, exporter_org_id: org.id, product_id: product.id, candidate_countries: countries, correlation_id: randomUUID(), requested_at: REQUESTED_AT });
  // Driven directly, not through the queue: a queued job could be claimed by another test file.
  const job = await prisma.job.update({ where: { id: requested.job.id }, data: { status: JobStatus.processing } });
  return { org, agent, actor, product, classification, hs6, release, job, payload: requested.payload };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
const context = (f: Fixture, attempt = 1) => ({ job_id: f.job.id, attempt_no: attempt, payload: f.job.payload, exporter_org_id: f.org.id, target_id: f.classification.id, correlation_id: f.job.correlation_id, reportProgress: async () => undefined });

/** Germany: a retained release, retrieved before the screen. USA: a live API, stamped at real time, with no line dates. */
function adapters(f: Fixture, options: { failGermany?: boolean; hangUs?: boolean } = {}) {
  const calls: Record<string, MarketAccessAdapterRequest[]> = { DE: [], US: [] };
  const germany: MarketAccessAdapter = {
    provider_key: 'fixture_release', retrieval: 'retained_release',
    async fetch(request) {
      calls.DE.push(request);
      if (options.failGermany) throw new Error('Fixture release could not be read.\nsecond line');
      return tariffResult({ country: 'DE', hs6: f.hs6, provider: 'eu_taric', code_system: 'EU_TARIC', retrieved_at: RELEASE_RETRIEVED_AT, rate: 5, effective_from: new Date('2026-01-01T00:00:00.000Z'), release_id: f.release.id, request_identity: `origin=IN;as_of=${request.now?.toISOString().slice(0, 10)}` });
    },
  };
  const unitedStates: MarketAccessAdapter = {
    provider_key: 'fixture_live', retrieval: 'live_fetch',
    async fetch(request) {
      calls.US.push(request);
      if (options.hangUs) return new Promise<MarketAccessIngestResult>(() => undefined);
      return tariffResult({
        country: 'US', hs6: f.hs6, provider: 'usitc_hts', code_system: 'US_HTS', retrieved_at: new Date(), rate: 3, effective_from: null,
        requirements: [{ rule_type: MarketAccessRuleType.import_restriction, requirement_code: 'US-FIXTURE-PERMIT', requirement_description: 'Fixture permit', requirement_obtainable: true, national_tariff_code: `${f.hs6}0000`, effective_from: new Date('2026-01-01T00:00:00.000Z'), effective_to: null, source_reference: 'https://example.test/us/permit', raw: {} }],
      });
    },
  };
  setTariffAdapterResolverForTesting((country) => (country === 'DE' ? germany : country === 'US' ? unitedStates : undefined));
  return calls;
}

const jobResult = async (f: Fixture) => (await prisma.job.findUniqueOrThrow({ where: { id: f.job.id } }));

beforeEach(() => setComtradeClient(comtradeClient()));
afterEach(async () => {
  setComtradeClient(null);
  setTariffAdapterResolverForTesting(null);
  await disableOrchestration();
});
afterAll(() => prisma.$disconnect());

describe('tariff acquisition policy and clock', () => {
  test('the default policy is valid and off; malformed policies are named', () => {
    const defaults = CONFIG_DEFAULTS['country_truth.market_access_orchestration'];
    expect(defaults.enabled).toBe(false);
    expect(marketAccessOrchestrationPolicyProblems(defaults)).toEqual([]);
    expect(marketAccessOrchestrationPolicyProblems({ ...defaults, enabled: 'yes', origin_country: 'US', live_fetch_timeout_ms: 10 })).toEqual([
      'enabled must be true or false.', 'origin_country must be IN.', 'live_fetch_timeout_ms must be a whole number from 1000 to 300000.',
    ]);
    expect(marketAccessOrchestrationPolicyProblems(null)).toEqual(['The policy must be an object.']);
  });

  test('the tariff clock is never before the trade clock, the end of acquisition or any acquired retrieval', () => {
    const outcome = (retrieved: string | null) => ({ retrieved_at: retrieved } as TariffAcquisitionOutcome);
    const trade = new Date('2026-08-24T00:00:00.000Z');
    expect(tariffClockFor(trade, [outcome('2026-09-01T00:00:00.000Z'), outcome(null)], new Date('2026-08-30T00:00:00.000Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(tariffClockFor(trade, [], new Date('2026-08-30T00:00:00.000Z')).toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(tariffClockFor(trade, [], new Date('2026-08-01T00:00:00.000Z')).toISOString()).toBe(trade.toISOString());
  });

  test('destinations are normalised and ordered, checkpointed ones are carried, and the cap is recorded per destination', async () => {
    setTariffAdapterResolverForTesting(() => undefined);
    const policy = { ...CONFIG_DEFAULTS['country_truth.market_access_orchestration'], enabled: true, max_destinations: 2 };
    const done: TariffAcquisitionOutcome = { country_code: 'DE', outcome: 'acquired', provider_key: 'fixture_release', retrieval: 'retained_release', snapshot_id: 'snapshot-de', snapshot_created_by_run: true, retrieved_at: RELEASE_RETRIEVED_AT.toISOString(), source_version: null, authority_release_id: null, classification_resolution: 'exact', tariff_coverage: true, reason: null, elapsed_ms: 0 };
    const checkpoints: string[][] = [];
    const outcomes = await acquireTariffEvidence({ job_id: 'job', hs6: '100630', destinations: ['us', 'DE', ' de ', 'AE'], resolution_clock: REQUESTED_AT, policy, completed: [done], onOutcome: async (items) => { checkpoints.push(items.map((item) => item.country_code)); } });
    expect(outcomes.map((item) => [item.country_code, item.outcome])).toEqual([['AE', expect.stringMatching(/^(unconfigured_source|no_source)$/)], ['DE', 'acquired'], ['US', 'skipped_over_cap']]);
    expect(outcomes[1]).toBe(done);
    expect(outcomes[2].reason).toMatch(/cap of 2/);
    // Every newly finished destination is checkpointed at once; the carried one is never re-reported.
    expect(checkpoints).toEqual([['AE', 'DE'], ['AE', 'DE', 'US']]);
  });

  test('a tariff scope must describe the same question at a later-or-equal clock', () => {
    const scope = { exporter_org_id: 'org', country_code: 'US', hs6: '100630', hs_revision: 'HS2022', as_of_date: '2026-08-24T00:00:00.000Z' };
    const policy = CONFIG_DEFAULTS['country_truth.phase_1h'].market_access;
    expect(() => calculateMarketAccessV2({ scope, tariffs: [], requirements: [], tariff_scope: { ...scope, as_of_date: '2026-08-23T00:00:00.000Z' } }, policy)).toThrow(/must not precede/);
    expect(() => calculateMarketAccessV2({ scope, tariffs: [], requirements: [], tariff_scope: { ...scope, country_code: 'GB', as_of_date: '2026-09-01T00:00:00.000Z' } }, policy)).toThrow(/must match/);
    const later = calculateMarketAccessV2({ scope, tariffs: [], requirements: [], tariff_scope: { ...scope, as_of_date: '2026-09-01T00:00:00.000Z' } }, policy);
    expect(later.provenance.details).toMatchObject({ tariff_as_of_date: '2026-09-01T00:00:00.000Z' });
    expect(calculateMarketAccessV2({ scope, tariffs: [], requirements: [] }, policy).provenance.details).not.toHaveProperty('tariff_as_of_date');
  });
});

describe('Deep Country Truth tariff acquisition', () => {
  test('with the switch off, nothing is acquired and the payload and manifests are single-clock', async () => {
    const f = await fixture(['Germany', 'USA']);
    const calls = adapters(f);
    expect(Object.keys(f.payload.policies).sort()).toEqual(['country_evidence', 'country_trade_metrics', 'country_truth_phase_1h', 'country_truth_scoring']);
    const outcome = await runCountryTruthDiscovery(context(f));
    expect([JobStatus.completed, JobStatus.partial]).toContain(outcome.status);
    expect(calls.DE).toHaveLength(0);
    expect(calls.US).toHaveLength(0);
    expect(outcome.result).not.toHaveProperty('tariff_acquisition');
    const snapshots = await prisma.countryTruthFactSnapshot.findMany({ where: { product_id: f.product.id } });
    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots) {
      expect((snapshot.facts_payload as { scope: Record<string, unknown> }).scope).not.toHaveProperty('tariff_as_of_date');
      expect(snapshot.selection_policy_snapshot).not.toHaveProperty('tariff_clock');
    }
  });

  test('with the switch on, release-backed and live tariffs acquired by the run are cited under its tariff clock', async () => {
    await enableOrchestration();
    const f = await fixture(['Germany', 'USA']);
    expect(f.payload.policies.market_access_orchestration).toMatchObject({ policy_version: 'market-access-orchestration-v1', snapshot: { enabled: true } });
    const calls = adapters(f);
    const before = Date.now();
    const outcome = await runCountryTruthDiscovery(context(f));
    expect([JobStatus.completed, JobStatus.partial]).toContain(outcome.status);
    const result = outcome.result as unknown as { tariff_acquisition: { tariff_as_of: string; outcome_counts: Record<string, number>; snapshot_ids: string[]; outcomes: TariffAcquisitionOutcome[] }; assessment_ids: string[] };
    expect(result.tariff_acquisition.outcome_counts).toEqual({ acquired: 2 });

    // A retained release resolves at the frozen resolution instant; a live API is never given a clock.
    const checkpoint = (await jobResult(f)).checkpoint as { tariff_resolution_at: string; tariff_as_of: string };
    expect(calls.DE).toHaveLength(1);
    expect(calls.DE[0].now?.toISOString()).toBe(checkpoint.tariff_resolution_at);
    expect(calls.US).toHaveLength(1);
    expect(calls.US[0]).not.toHaveProperty('now');
    expect(calls.US[0]).toMatchObject({ origin_country: 'IN', destination_country: 'US' });

    const tariffClock = result.tariff_acquisition.tariff_as_of;
    expect(checkpoint.tariff_as_of).toBe(tariffClock);
    expect(Date.parse(tariffClock)).toBeGreaterThanOrEqual(before);
    const snapshots = await prisma.marketAccessEvidenceSnapshot.findMany({ where: { id: { in: result.tariff_acquisition.snapshot_ids } } });
    expect(snapshots.map((row) => [row.country_code, row.source_run_id]).sort()).toEqual([['DE', f.job.id], ['US', f.job.id]]);
    const germanySnapshot = snapshots.find((row) => row.country_code === 'DE')!;
    const usSnapshot = snapshots.find((row) => row.country_code === 'US')!;
    expect(germanySnapshot.authority_release_id).toBe(f.release.id);
    expect(usSnapshot.retrieved_at.getTime()).toBeGreaterThan(REQUESTED_AT.getTime());

    const manifests = await prisma.countryTruthFactSnapshot.findMany({ where: { product_id: f.product.id } });
    for (const manifest of manifests) {
      expect((manifest.facts_payload as { scope: Record<string, unknown> }).scope).toMatchObject({ as_of_date: REQUESTED_AT.toISOString(), tariff_as_of_date: tariffClock, tariff_clock_version: COUNTRY_TRUTH_TARIFF_CLOCK_VERSION });
      expect(manifest.selection_policy_snapshot).toMatchObject({ tariff_clock: { tariff_as_of_date: tariffClock } });
    }
    // The live US requirement was retrieved after the trade clock: tariffs ride the tariff clock,
    // requirements do not.
    const usManifest = manifests.find((row) => row.country_code === 'US')!;
    const usPayload = usManifest.facts_payload as { facts: { market_access: { requirements: unknown[] } }; rejected_rows: Array<{ source: string; row_id: string; reason: string }> };
    const usRequirement = await prisma.marketAccessEvidence.findFirstOrThrow({ where: { snapshot_id: usSnapshot.id, rule_type: MarketAccessRuleType.import_restriction } });
    expect(usPayload.facts.market_access.requirements).toEqual([]);
    expect(usPayload.rejected_rows).toContainEqual({ source: 'market_access_evidence', row_id: usRequirement.id, reason: 'retrieved_after_assessment_clock' });

    const assessments = await prisma.marketAssessment.findMany({ where: { id: { in: result.assessment_ids } } });
    for (const assessment of assessments) {
      const provenance = assessment.field_provenance as { market_access: { available: boolean; provenance: { used_fact_ids: string[]; details: Record<string, unknown> } }; overall_score: { country_truth_fact_snapshot: Record<string, unknown> } };
      expect(provenance.market_access.available).toBe(true);
      expect(provenance.market_access.provenance.details).toMatchObject({ tariff_as_of_date: tariffClock, tariff_basis: 'ordinary_after_explicit_non_applicability' });
      expect(provenance.overall_score.country_truth_fact_snapshot).toMatchObject({ tariff_as_of_date: tariffClock });
      const tariffEvidenceIds = provenance.market_access.provenance.used_fact_ids.filter((id) => id.startsWith('market_access_tariff:')).map((id) => id.slice('market_access_tariff:'.length));
      const cited = await prisma.marketAccessEvidence.findMany({ where: { id: { in: tariffEvidenceIds } }, select: { snapshot_id: true } });
      expect(cited.length).toBe(2);
      expect(new Set(cited.map((row) => row.snapshot_id))).toEqual(new Set([assessment.country_code === 'DE' ? germanySnapshot.id : usSnapshot.id]));
    }

    // The worker closes the job with this outcome before the next request is made.
    await prisma.job.update({ where: { id: f.job.id }, data: { status: outcome.status, completed_at: new Date(), result: outcome.result } });

    // The converse: a switch-off run at the same screen clock never admits the SAME live US tariff
    // rows. Single-clock reads bound every market-access query by the screen clock (as before WP2), so
    // the live snapshot is not even loaded; the separate tariff clock is what admitted it. The German
    // release, retrieved before the screen, stays admissible — acquisition never backdated it.
    await disableOrchestration();
    const off = await requestCountryTruthDiscovery({ actor: f.actor, exporter_org_id: f.org.id, product_id: f.product.id, candidate_countries: ['Germany', 'USA'], correlation_id: randomUUID(), requested_at: REQUESTED_AT });
    expect(off.job.id).not.toBe(f.job.id);
    expect(off.payload.policies).not.toHaveProperty('market_access_orchestration');
    const offJob = await prisma.job.update({ where: { id: off.job.id }, data: { status: JobStatus.processing } });
    const offOutcome = await runCountryTruthDiscovery({ ...context(f), job_id: offJob.id, payload: offJob.payload, correlation_id: offJob.correlation_id });
    expect(calls.US).toHaveLength(1);
    expect(offOutcome.result).not.toHaveProperty('tariff_acquisition');
    const offResult = offOutcome.result as unknown as { country_truth_fact_snapshot_ids: string[]; assessment_ids: string[] };
    const offManifests = await prisma.countryTruthFactSnapshot.findMany({ where: { id: { in: offResult.country_truth_fact_snapshot_ids } } });
    const offTariffs = (country: string) => (offManifests.find((row) => row.country_code === country)!.facts_payload as { facts: { market_access: { tariffs: unknown[] } } }).facts.market_access.tariffs;
    expect(offTariffs('US')).toEqual([]);
    expect(offTariffs('DE').length).toBeGreaterThan(0);
    const offAssessments = await prisma.marketAssessment.findMany({ where: { id: { in: offResult.assessment_ids } } });
    const offMarketAccess = (country: string) => (offAssessments.find((row) => row.country_code === country)!.field_provenance as { market_access: { available: boolean; provenance: { used_fact_ids: string[] } | null } }).market_access;
    expect(offMarketAccess('US').available).toBe(false);
    expect(offMarketAccess('DE').available).toBe(true);
    const offGermanCited = await prisma.marketAccessEvidence.findMany({ where: { id: { in: offMarketAccess('DE').provenance!.used_fact_ids.filter((id) => id.startsWith('market_access_tariff:')).map((id) => id.slice('market_access_tariff:'.length)) } }, select: { snapshot_id: true } });
    expect(new Set(offGermanCited.map((row) => row.snapshot_id))).toEqual(new Set([germanySnapshot.id]));
  }, 60_000);

  test('a failing adapter, a live timeout and a missing source are recorded and the run still completes', async () => {
    await enableOrchestration();
    const f = await fixture(['Germany', 'USA', 'UAE']);
    adapters(f, { failGermany: true, hangUs: true });
    const outcome = await runCountryTruthDiscovery(context(f));
    expect([JobStatus.completed, JobStatus.partial]).toContain(outcome.status);
    const outcomes = (outcome.result as unknown as { tariff_acquisition: { outcomes: TariffAcquisitionOutcome[] } }).tariff_acquisition.outcomes;
    const byCountry = Object.fromEntries(outcomes.map((item) => [item.country_code, item]));
    expect(byCountry.DE).toMatchObject({ outcome: 'failed', provider_key: 'fixture_release', snapshot_id: null, reason: 'Fixture release could not be read. second line' });
    expect(byCountry.US).toMatchObject({ outcome: 'timed_out', retrieval: 'live_fetch', snapshot_id: null });
    expect(['unconfigured_source', 'no_source']).toContain(byCountry.AE.outcome);
    expect(byCountry.AE.reason).toBeTruthy();
    const assessments = await prisma.marketAssessment.findMany({ where: { id: { in: (outcome.result as { assessment_ids: string[] }).assessment_ids } } });
    expect(assessments).toHaveLength(3);
    for (const assessment of assessments) {
      expect(assessment.market_access_score).toBeNull();
      expect((assessment.field_provenance as { market_access: { available: boolean; exclusion_reason: string | null } }).market_access).toMatchObject({ available: false, exclusion_reason: expect.any(String) });
    }
  }, 60_000);

  test('a retry reuses checkpointed outcomes and clocks, and a partial checkpoint resumes only the rest', async () => {
    await enableOrchestration();
    const f = await fixture(['Germany', 'USA']);
    const calls = adapters(f);
    const first = await runCountryTruthDiscovery(context(f));
    const second = await runCountryTruthDiscovery(context(f, 2));
    expect(calls.DE).toHaveLength(1);
    expect(calls.US).toHaveLength(1);
    const a = first.result as Record<string, unknown>;
    const b = second.result as Record<string, unknown>;
    expect(b.country_truth_fact_snapshot_ids).toEqual(a.country_truth_fact_snapshot_ids);
    expect(b.assessment_ids).toEqual(a.assessment_ids);
    expect(b.tariff_acquisition).toEqual(a.tariff_acquisition);

    // An attempt that died after Germany was checkpointed resumes with the United States only, at the
    // same resolution instant, and the German snapshot that attempt persisted is the one the run cites.
    const g = await fixture(['Germany', 'USA']);
    const resumedCalls = adapters(g);
    const resolutionAt = new Date('2026-09-02T00:00:00.000Z');
    const policy = g.payload.policies.market_access_orchestration!.snapshot;
    const [germany] = await acquireTariffEvidence({ job_id: g.job.id, hs6: g.hs6, destinations: ['DE'], resolution_clock: resolutionAt, policy, completed: [], onOutcome: async () => undefined });
    expect(germany).toMatchObject({ country_code: 'DE', outcome: 'acquired', snapshot_created_by_run: true });
    await prisma.job.update({ where: { id: g.job.id }, data: { checkpoint: { schema_version: 'country-truth-discovery-checkpoint-v3', tariff_resolution_at: resolutionAt.toISOString(), tariff_acquisitions: [germany] } as unknown as Prisma.InputJsonValue } });
    resumedCalls.DE.length = 0;
    const resumed = await runCountryTruthDiscovery(context(g));
    expect(resumedCalls.DE).toHaveLength(0);
    expect(resumedCalls.US).toHaveLength(1);
    const resumedResult = resumed.result as unknown as { tariff_acquisition: { outcomes: TariffAcquisitionOutcome[] }; assessment_ids: string[] };
    expect(resumedResult.tariff_acquisition.outcomes.map((item) => [item.country_code, item.outcome])).toEqual([['DE', 'acquired'], ['US', 'acquired']]);
    expect(resumedResult.tariff_acquisition.outcomes[0].snapshot_id).toBe(germany.snapshot_id);
    const germanAssessment = await prisma.marketAssessment.findFirstOrThrow({ where: { id: { in: resumedResult.assessment_ids }, country_code: 'DE' } });
    const usedFactIds = (germanAssessment.field_provenance as { market_access: { provenance: { used_fact_ids: string[] } } }).market_access.provenance.used_fact_ids;
    const cited = await prisma.marketAccessEvidence.findMany({ where: { id: { in: usedFactIds.filter((id) => id.startsWith('market_access_tariff:')).map((id) => id.slice('market_access_tariff:'.length)) } }, select: { snapshot_id: true } });
    expect(new Set(cited.map((row) => row.snapshot_id))).toEqual(new Set([germany.snapshot_id]));
  }, 60_000);
});
