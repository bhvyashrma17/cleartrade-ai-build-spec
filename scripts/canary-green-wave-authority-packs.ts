/** Real-source green-wave canaries. Writes immutable evidence and refuses every non-staging environment. */
import { createHash, randomUUID } from 'node:crypto';
import { JobStatus, JobType, OrgTier, UserRole } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { validateRuntimeEnvironment } from '@/lib/runtime-config';
import { acquireGreenWaveAuthorityBundle } from '@/lib/market-access/providers/green-wave-acquisition';
import { GREEN_WAVE_CONFIGS, type GreenWaveCountry } from '@/lib/market-access/providers/green-wave-config';
import { activeGreenWaveRelease, fetchGreenWaveMarketAccess, importGreenWaveRelease, reparseGreenWaveAuthorityRelease } from '@/lib/market-access/providers/green-wave-service';
import { readPdfAuthorityBundle } from '@/lib/market-access/providers/pdf-table-family';
import type { Principal } from '@/types';

const RELEASE = '2026-09-15';
const COUNTRIES: readonly GreenWaveCountry[] = ['NP', 'BT', 'AL', 'MU'];
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const roles = (country: GreenWaveCountry) => Object.fromEntries(GREEN_WAVE_CONFIGS[country].artifacts.map((artifact) => [artifact.name, artifact.role]));

const CASES: Record<GreenWaveCountry, { ordinary: string; unusual: string; expected_general: number; expected_unusual_kind: string }> = {
  NP: { ordinary: '010121', unusual: '220300', expected_general: 10, expected_unusual_kind: 'mixed' },
  BT: { ordinary: '010611', unusual: '220600', expected_general: 10, expected_unusual_kind: 'specific' },
  AL: { ordinary: '010121', unusual: '010129', expected_general: 2, expected_unusual_kind: 'unparsed' },
  MU: { ordinary: '010121', unusual: '090230', expected_general: 0, expected_unusual_kind: 'mixed' },
};

async function actor(): Promise<Principal> {
  const email = process.env.GREEN_WAVE_CANARY_ACTOR_EMAIL?.trim().toLowerCase();
  const user = email ? await prisma.user.findUnique({ where: { email } }) : await prisma.user.findFirst({
    where: { role: { in: [UserRole.admin, UserRole.ops_supervisor] } }, orderBy: { created_at: 'asc' },
  });
  if (!user) throw new Error('Create a staging admin/ops supervisor or set GREEN_WAVE_CANARY_ACTOR_EMAIL.');
  return { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
}

async function acquire(country: GreenWaveCountry, principal: Principal) {
  const config = GREEN_WAVE_CONFIGS[country];
  const first = await acquireGreenWaveAuthorityBundle(country, { release_identifier: RELEASE });
  const second = await acquireGreenWaveAuthorityBundle(country, { release_identifier: RELEASE });
  if (!first.equals(second)) throw new Error(`${country} unchanged live reacquisition was not byte-identical.`);
  const bundle = await readPdfAuthorityBundle({ bytes: first, release_identifier: RELEASE, country_code: country, expected_roles: roles(country) });
  const tariff = bundle.files.find((file) => file.url === config.tariff_url);
  if (tariff?.sha256 !== config.tariff_sha256 || bundle.line_count !== config.profile.expected_line_count) throw new Error(`${country} live source controls no longer match qualification.`);
  const common = { actor: principal, bytes: first, release_identifier: RELEASE, reference_date: new Date(`${config.profile.effective_from}T00:00:00.000Z`),
    retrieved_at: new Date(`${RELEASE}T00:00:00.000Z`), source_url: config.tariff_url, activate: true };
  const imported = await importGreenWaveRelease(country, { ...common, correlation_id: randomUUID() });
  const repeated = await importGreenWaveRelease(country, { ...common, correlation_id: randomUUID() });
  if (repeated.release.id !== imported.release.id || repeated.created) throw new Error(`${country} repeated authority import was not idempotent.`);
  return { country, deterministic_acquisition: { sha256: sha256(first), byte_length: first.length, repeated_byte_identical: true },
    tariff: { sha256: tariff.sha256, row_count: bundle.line_count }, release: { id: imported.release.id, checksum: imported.release.checksum,
      reader_version: imported.release.reader_version, parser_version: imported.release.parser_version, created: imported.created } };
}

async function semantics(country: GreenWaveCountry, principal: Principal) {
  const canary = CASES[country];
  const release = await activeGreenWaveRelease(country);
  if (!release || release.release_identifier !== RELEASE) throw new Error(`No active ${country} ${RELEASE} release exists.`);
  const now = new Date(`${RELEASE}T12:00:00.000Z`);
  const ordinary = await fetchGreenWaveMarketAccess(country, canary.ordinary, { release_id: release.id, now, origin_country: 'IN' });
  const unusual = await fetchGreenWaveMarketAccess(country, canary.unusual, { release_id: release.id, now, origin_country: 'IN' });
  if (ordinary.general_duty?.ad_valorem_rate_percent !== canary.expected_general) throw new Error(`${country} ordinary tariff canary failed.`);
  const unusualKinds = new Set(unusual.lines.map((line) => line.duty.kind));
  if (!unusualKinds.has(canary.expected_unusual_kind as never)) throw new Error(`${country} unusual-duty canary failed: ${[...unusualKinds].join(', ')}.`);
  const rawEvidence = ordinary.raw_evidence as { tariff_treatment_complete?: boolean };
  if (ordinary.regulatory_coverage_complete || rawEvidence.tariff_treatment_complete !== true) throw new Error(`${country} tariff/regulatory scope canary failed.`);
  if (country !== 'AL' && ordinary.india_preference.applicability !== 'potentially_applicable_requires_origin_proof') throw new Error(`${country} India origin-proof canary failed.`);
  if (country === 'AL' && ordinary.india_preference.applicability !== 'not_applicable') throw new Error('AL complete programme exclusion canary failed.');
  const snapshot = await reparseGreenWaveAuthorityRelease({ actor: principal, country, release_id: release.id, hs6: canary.ordinary,
    parser_version: release.parser_version, now, origin_country: 'IN', correlation_id: randomUUID() });
  const repeated = await reparseGreenWaveAuthorityRelease({ actor: principal, country, release_id: release.id, hs6: canary.ordinary,
    parser_version: release.parser_version, now, origin_country: 'IN', correlation_id: randomUUID() });
  if (snapshot.id !== repeated.id) throw new Error(`${country} repeated historical reparse was not idempotent.`);
  const job = await enqueueJob({ type: JobType.market_access_ingest, payload: { country_code: country, hs_code: canary.ordinary, origin_country: 'IN' },
    requested_by_id: principal.id, dedupe_key: `green-wave:${country}:${release.id}:${randomUUID()}`, correlation_id: randomUUID() });
  const terminalStatuses: JobStatus[] = [JobStatus.completed, JobStatus.failed, JobStatus.cancelled];
  const deadline = Date.now() + 180_000; let completed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  while (!terminalStatuses.includes(completed.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000)); completed = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  }
  if (completed.status !== JobStatus.completed) throw new Error(`${country} worker job ${job.id} ended ${completed.status}.`);
  const attempt = await prisma.jobAttempt.findFirstOrThrow({ where: { job_id: job.id }, orderBy: { attempt_no: 'desc' } });
  const jobResult = completed.result as { snapshot_id?: string; regulatory_coverage_complete?: boolean } | null;
  if (!jobResult?.snapshot_id || jobResult.regulatory_coverage_complete !== false) throw new Error(`${country} worker persistence canary failed.`);
  return { country, release: { id: release.id, checksum: release.checksum }, ordinary: { hs6: canary.ordinary, duty: ordinary.general_duty,
    resolution: ordinary.resolution.resolution, india_preference: ordinary.india_preference.applicability }, unusual: { hs6: canary.unusual, kinds: [...unusualKinds] },
    historical_replay: { snapshot_id: snapshot.id, repeated_snapshot_id: repeated.id }, worker: { job_id: job.id, attempt_id: attempt.id, snapshot_id: jobResult.snapshot_id } };
}

async function main() {
  if (process.env.APP_ENV !== 'staging') throw new Error('REFUSING TO RUN: green-wave canaries may persist only in APP_ENV=staging.');
  validateRuntimeEnvironment('worker'); const principal = await actor();
  const phase = process.argv[2]; const requested = process.argv[3]?.toUpperCase();
  const countries = requested ? [requested as GreenWaveCountry] : COUNTRIES;
  if (countries.some((country) => !COUNTRIES.includes(country))) throw new Error('Country must be NP, BT, AL or MU.');
  if (phase !== 'acquisition' && phase !== 'semantics') throw new Error('Usage: canary-green-wave-authority-packs.ts acquisition|semantics [NP|BT|AL|MU]');
  const results: unknown[] = []; let failures = 0;
  for (const country of countries) {
    try { results.push(await (phase === 'acquisition' ? acquire(country, principal) : semantics(country, principal))); }
    catch (error) { failures += 1; results.push({ country, error: error instanceof Error ? error.message : String(error) }); }
  }
  console.log(JSON.stringify(results, null, 2));
  if (failures) throw new Error(`${failures} green-wave ${phase} canary/canaries failed after isolated execution.`);
}

main().finally(() => prisma.$disconnect());
