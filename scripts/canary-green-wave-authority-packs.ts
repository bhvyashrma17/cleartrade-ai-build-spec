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
const COUNTRIES: readonly GreenWaveCountry[] = ['NP', 'BT', 'AL', 'MU', 'LK'];
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const roles = (country: GreenWaveCountry) => Object.fromEntries(GREEN_WAVE_CONFIGS[country].artifacts.map((artifact) => [artifact.name, artifact.role]));

const CASES: Record<GreenWaveCountry, { ordinary: string; unusual: string; expected_general: number; expected_unusual_kind: string }> = {
  NP: { ordinary: '010121', unusual: '220300', expected_general: 10, expected_unusual_kind: 'mixed' },
  BT: { ordinary: '010611', unusual: '220600', expected_general: 10, expected_unusual_kind: 'specific' },
  AL: { ordinary: '010121', unusual: '010129', expected_general: 2, expected_unusual_kind: 'unparsed' },
  MU: { ordinary: '010121', unusual: '090230', expected_general: 0, expected_unusual_kind: 'mixed' },
  LK: { ordinary: '030233', unusual: '100191', expected_general: 20, expected_unusual_kind: 'mixed' },
};
// Mauritius was requalified on its 1 October 2026 edition (acquired 11 October); a 15 September
// acquisition date would precede that edition's effective date.
const releaseIdentifier = (country: GreenWaveCountry) => country === 'LK' ? '2026-09-20' : country === 'MU' ? '2026-10-11' : RELEASE;

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
  const releaseIdentifierForCountry = releaseIdentifier(country);
  let first: Buffer | null = await acquireGreenWaveAuthorityBundle(country, { release_identifier: releaseIdentifierForCountry });
  const firstSha256 = sha256(first); const firstByteLength = first.length;
  const common = { actor: principal, bytes: first, release_identifier: releaseIdentifierForCountry, reference_date: new Date(`${config.profile.effective_from}T00:00:00.000Z`),
    retrieved_at: new Date(`${releaseIdentifierForCountry}T00:00:00.000Z`), source_url: config.tariff_url, activate: true };
  const imported = await importGreenWaveRelease(country, { ...common, correlation_id: randomUUID() });
  const repeated = await importGreenWaveRelease(country, { ...common, correlation_id: randomUUID() });
  if (repeated.release.id !== imported.release.id || repeated.created) throw new Error(`${country} repeated authority import was not idempotent.`);
  first = null;
  const second = await acquireGreenWaveAuthorityBundle(country, { release_identifier: releaseIdentifierForCountry });
  if (sha256(second) !== firstSha256 || second.length !== firstByteLength) throw new Error(`${country} unchanged live reacquisition was not byte-identical.`);
  const bundle = await readPdfAuthorityBundle({ bytes: second, release_identifier: releaseIdentifierForCountry, country_code: country, expected_roles: roles(country) });
  const tariff = bundle.files.find((file) => file.url === config.tariff_url);
  if (tariff?.sha256 !== config.tariff_sha256 || bundle.line_count !== config.profile.expected_line_count) throw new Error(`${country} live source controls no longer match qualification.`);
  return { country, deterministic_acquisition: { sha256: firstSha256, byte_length: firstByteLength, repeated_byte_identical: true },
    artifact_manifest: bundle.files,
    tariff: { sha256: tariff.sha256, row_count: bundle.line_count }, release: { id: imported.release.id, checksum: imported.release.checksum,
      reader_version: imported.release.reader_version, parser_version: imported.release.parser_version, created: imported.created } };
}

async function semantics(country: GreenWaveCountry, principal: Principal) {
  const canary = CASES[country];
  const release = await activeGreenWaveRelease(country);
  const releaseIdentifierForCountry = releaseIdentifier(country);
  if (!release || release.release_identifier !== releaseIdentifierForCountry) throw new Error(`No active ${country} ${releaseIdentifierForCountry} release exists.`);
  const now = new Date(`${releaseIdentifierForCountry}T12:00:00.000Z`);
  const ordinary = await fetchGreenWaveMarketAccess(country, canary.ordinary, { release_id: release.id, now, origin_country: 'IN' });
  const unusual = await fetchGreenWaveMarketAccess(country, canary.unusual, { release_id: release.id, now, origin_country: 'IN' });
  if (ordinary.general_duty?.ad_valorem_rate_percent !== canary.expected_general) throw new Error(`${country} ordinary tariff canary failed.`);
  const unusualKinds = new Set(unusual.lines.map((line) => line.duty.kind));
  if (!unusualKinds.has(canary.expected_unusual_kind as never)) throw new Error(`${country} unusual-duty canary failed: ${[...unusualKinds].join(', ')}.`);
  const rawEvidence = ordinary.raw_evidence as { tariff_treatment_complete?: boolean };
  if (ordinary.regulatory_coverage_complete || rawEvidence.tariff_treatment_complete !== true) throw new Error(`${country} tariff/regulatory scope canary failed.`);
  if (country !== 'AL' && ordinary.india_preference.applicability !== 'potentially_applicable_requires_origin_proof') throw new Error(`${country} India origin-proof canary failed.`);
  if (country === 'AL' && ordinary.india_preference.applicability !== 'not_applicable') throw new Error('AL complete programme exclusion canary failed.');
  let sriLanka: Record<string, unknown> | null = null;
  if (country === 'LK') {
    const legalZero = await fetchGreenWaveMarketAccess(country, '010221', { release_id: release.id, now, origin_country: 'IN' });
    if (legalZero.general_duty?.kind !== 'ad_valorem' || legalZero.general_duty.ad_valorem_rate_percent !== 0) throw new Error('LK legal-zero canary failed.');
    const scl = await fetchGreenWaveMarketAccess(country, '100590', { release_id: release.id, now, origin_country: 'IN' });
    if (scl.lines.length !== 1 || scl.lines[0]?.duty.kind !== 'specific' || scl.lines[0]?.duty.specific_amount !== 50
      || scl.lines[0]?.conditions.replaces_all_other_import_levies !== true) throw new Error('LK SCL replacement canary failed.');
    const vehicleAt = async (date: string) => fetchGreenWaveMarketAccess(country, '870210', { release_id: release.id, now: new Date(`${date}T12:00:00.000Z`), origin_country: 'IN' });
    const initial = await vehicleAt('2026-05-17'); const amended = await vehicleAt('2026-05-18'); const extended = await vehicleAt('2026-08-15');
    const surchargeLines = (result: Awaited<ReturnType<typeof vehicleAt>>) => result.lines.filter((line) => line.conditions.customs_import_duty_surcharge === true);
    const assertOnePerLine = (result: Awaited<ReturnType<typeof vehicleAt>>, source: string) => {
      const surcharges = surchargeLines(result); const counts = new Map<string, number>();
      for (const line of surcharges) counts.set(line.national_tariff_code, (counts.get(line.national_tariff_code) ?? 0) + 1);
      if (!surcharges.length || surcharges.some((line) => line.duty.ad_valorem_rate_percent !== 50 || !line.source_reference.includes(source))
        || [...counts.values()].some((count) => count !== 1)) throw new Error(`LK vehicle-surcharge ${source} canary failed or double-stacked.`);
    };
    assertOnePerLine(initial, '2488-56'); assertOnePerLine(amended, '2488-69'); assertOnePerLine(extended, '2501-88');
    const operations = (amended.raw_evidence as { amendment_operations?: unknown }).amendment_operations as Array<{ operation?: string; classification?: string; source_artifact?: string }>;
    if (!operations.some((operation) => operation.source_artifact === 'gazette-2488-69.pdf' && operation.operation === 'AMEND_APPLICABILITY' && operation.classification === 'TARIFF_AFFECTING')) {
      throw new Error('LK Gazette 2488/69 tariff-affecting applicability operation is missing.');
    }
    sriLanka = {
      legal_zero: legalZero.general_duty, scl_replacement: scl.lines[0],
      surcharge_sources: [surchargeLines(initial)[0]?.source_reference, surchargeLines(amended)[0]?.source_reference, surchargeLines(extended)[0]?.source_reference],
      no_double_stacking: true,
    };
  }
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
  const heartbeat = await prisma.workerHeartbeat.findFirst({ orderBy: { last_seen_at: 'desc' } });
  if (!heartbeat || Date.now() - heartbeat.last_seen_at.getTime() > 120_000) throw new Error(`${country} has no current staging worker heartbeat after ingestion.`);
  return { country, release: { id: release.id, checksum: release.checksum }, ordinary: { hs6: canary.ordinary, duty: ordinary.general_duty,
    resolution: ordinary.resolution.resolution, india_preference: ordinary.india_preference.applicability }, unusual: { hs6: canary.unusual, kinds: [...unusualKinds] },
    sri_lanka: sriLanka, historical_replay: { snapshot_id: snapshot.id, repeated_snapshot_id: repeated.id },
    worker: { job_id: job.id, job_status: completed.status, attempt_id: attempt.id, attempt_no: attempt.attempt_no, attempt_status: attempt.status,
      snapshot_id: jobResult.snapshot_id, heartbeat_instance_id: heartbeat.instance_id, heartbeat_last_seen_at: heartbeat.last_seen_at } };
}

async function main() {
  if (process.env.APP_ENV !== 'staging') throw new Error('REFUSING TO RUN: green-wave canaries may persist only in APP_ENV=staging.');
  validateRuntimeEnvironment('worker'); const principal = await actor();
  const phase = process.argv[2]; const requested = process.argv[3]?.toUpperCase();
  const countries = requested ? [requested as GreenWaveCountry] : COUNTRIES;
  if (countries.some((country) => !COUNTRIES.includes(country))) throw new Error('Country must be NP, BT, AL, MU or LK.');
  if (phase !== 'acquisition' && phase !== 'semantics') throw new Error('Usage: canary-green-wave-authority-packs.ts acquisition|semantics [NP|BT|AL|MU|LK]');
  const results: unknown[] = []; let failures = 0;
  for (const country of countries) {
    try { results.push(await (phase === 'acquisition' ? acquire(country, principal) : semantics(country, principal))); }
    catch (error) { failures += 1; results.push({ country, error: error instanceof Error ? error.message : String(error) }); }
  }
  console.log(JSON.stringify(results, null, 2));
  if (failures) throw new Error(`${failures} green-wave ${phase} canary/canaries failed after isolated execution.`);
}

main().finally(() => prisma.$disconnect());
