/** Real-source Oman Customs canary. It writes immutable evidence and therefore refuses non-staging. */
import { createHash, randomUUID } from 'node:crypto';
import { JobStatus, JobType, OrgTier, UserRole } from '@prisma/client';
import { acquireOmanAuthorityBundle, OMAN_TARIFF_URL } from '@/lib/market-access/providers/oman-acquisition';
import { OMAN_EXPECTED_PHYSICAL_ROWS, OMAN_EXPECTED_UNIQUE_CODES, readOmanAuthorityBundle } from '@/lib/market-access/providers/oman-bundle';
import { activeOmanRelease, fetchOmanMarketAccess, importOmanRelease, reparseOmanAuthorityRelease } from '@/lib/market-access/providers/oman-service';
import { enqueueJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { validateRuntimeEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const RELEASE = '2026-09-14';
const EXPECTED_TARIFF_SHA256 = 'ea3be328e3d33813dd1b863a0e3b126b2e23edfea4678d6b31061b3a966d8a51';
const EXPECTED_ANTIDUMPING_SHA256 = 'e26afd81913d8180b0ed9869a6117fe9ae9feceeb48e99782ca8a8a7ec0b7c4b';
const EXPECTED_CURRENT_ANTIDUMPING_SHA256 = '6dbc6ad6681ecb59c32d8959d05fe9a3816b78032e541ab0a936be75968a8419';
const EXPECTED_GCC_EXTENSION_SHA256 = '8d259e4e7c558824b3ecf73643ba5f03afbc2bb838e69dbf4514d0f52d0047e9';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function runAcquisition(actor: Principal) {
  const acquisitionProgress = setInterval(() => {
    console.error('[oman-canary] live acquisition still in progress');
  }, 30_000);
  try {
    let firstBytes: Buffer | null = await acquireOmanAuthorityBundle();
    console.error('[oman-canary] first live acquisition complete');
    const firstChecksum = sha256(firstBytes);
    const firstLength = firstBytes.length;
    const now = new Date('2026-09-14T00:00:00.000Z');
    const common = {
      actor,
      release_identifier: RELEASE,
      reference_date: new Date(`${RELEASE}T00:00:00.000Z`),
      retrieved_at: now,
      source_url: OMAN_TARIFF_URL,
      activate: true,
    };
    const imported = await importOmanRelease({ ...common, bytes: firstBytes, correlation_id: randomUUID() });
    const repeated = await importOmanRelease({ ...common, bytes: firstBytes, correlation_id: randomUUID() });
    if (repeated.release.id !== imported.release.id || repeated.created) throw new Error('Repeated Oman authority import was not idempotent.');

    // Do not retain both 33.7 MB composites while decoding the PDF-derived rows. The checksum and
    // byte length prove equality after the first immutable release has authenticated its bytes.
    firstBytes = null;
    const secondBytes = await acquireOmanAuthorityBundle();
    console.error('[oman-canary] second live acquisition complete');
    if (sha256(secondBytes) !== firstChecksum || secondBytes.length !== firstLength) {
      throw new Error('Two acquisitions of unchanged Oman authority sources were not byte-identical.');
    }
    const bundle = await readOmanAuthorityBundle({ bytes: secondBytes, release_identifier: RELEASE });
    const tariff = bundle.files.find((file) => file.name === 'customs-tariff-2026.pdf');
    const antiDumping = bundle.files.find((file) => file.name === 'anti-dumping-tiles.xlsx');
    const antiDumpingCurrent = bundle.files.find((file) => file.name === 'anti-dumping-current.pdf');
    const gccExtension = bundle.files.find((file) => file.name === 'gcc-anti-dumping-extension-55.pdf');
    if (tariff?.sha256 !== EXPECTED_TARIFF_SHA256 || antiDumping?.sha256 !== EXPECTED_ANTIDUMPING_SHA256
      || antiDumpingCurrent?.sha256 !== EXPECTED_CURRENT_ANTIDUMPING_SHA256 || gccExtension?.sha256 !== EXPECTED_GCC_EXTENSION_SHA256
      || bundle.lines.size !== OMAN_EXPECTED_UNIQUE_CODES || bundle.physical_row_count !== OMAN_EXPECTED_PHYSICAL_ROWS) {
      throw new Error('The live Oman release no longer matches the qualified September 2026 controls.');
    }
    if (bundle.lines.get('240110100000')?.general_duty.kind !== 'mixed'
      || bundle.lines.get('690721000907')?.additional_duty?.ad_valorem_rate_percent !== 70.2
      || bundle.lines.get('690723000908')?.additional_duty?.ad_valorem_rate_percent !== 37) {
      throw new Error('The live Oman mixed-duty or anti-dumping parser canary failed.');
    }
    console.log(JSON.stringify({
      phase: 'acquisition',
      deterministic_acquisition: { sha256: firstChecksum, byte_length: firstLength, repeated_byte_identical: true },
      source_controls: { tariff_sha256: tariff.sha256, anti_dumping_workbook_sha256: antiDumping.sha256, anti_dumping_current_sha256: antiDumpingCurrent.sha256, gcc_extension_sha256: gccExtension.sha256, tariff_line_count: bundle.lines.size, physical_row_count: bundle.physical_row_count },
      release: { id: imported.release.id, created: imported.created, repeated_release_id: repeated.release.id, checksum: imported.release.checksum, reader_version: imported.release.reader_version, parser_version: imported.release.parser_version },
    }, null, 2));
  } finally {
    clearInterval(acquisitionProgress);
  }
}

async function runSemantics(actor: Principal) {
  const now = new Date('2026-09-14T00:00:00.000Z');
  const release = await activeOmanRelease();
  if (!release || release.release_identifier !== RELEASE) throw new Error(`No active Oman ${RELEASE} authority release exists for semantic canaries.`);

  const horses = await fetchOmanMarketAccess('010121', { release_id: release.id, now, origin_country: 'IN' });
  const ordinary = await fetchOmanMarketAccess('030569', { release_id: release.id, now, origin_country: 'IN' });
  const tobacco = await fetchOmanMarketAccess('240110', { release_id: release.id, now, origin_country: 'IN' });
  const tiles = await fetchOmanMarketAccess('690721', { release_id: release.id, now, origin_country: 'IN' });
  const prohibited = await fetchOmanMarketAccess('010310', { release_id: release.id, now, origin_country: 'IN' });
  if (horses.india_preference.applicability !== 'potentially_applicable_requires_origin_proof'
    || horses.india_preference.duty?.ad_valorem_rate_percent !== 0) throw new Error('The live Oman CEPA category-A canary failed.');
  if (horses.general_duty?.ad_valorem_rate_percent !== 0) throw new Error('The live Oman legal-zero canary failed.');
  if (ordinary.general_duty?.ad_valorem_rate_percent !== 5
    || ordinary.india_preference.applicability !== 'potentially_applicable_requires_origin_proof') throw new Error('The live Oman ordinary-duty/CEPA-proof canary failed.');
  if (tobacco.general_duty?.kind !== 'mixed' || tobacco.general_duty.ad_valorem_rate_percent !== 100
    || tobacco.general_duty.specific_amount !== 3 || tobacco.general_duty.specific_currency !== 'OMR'
    || tobacco.general_duty.specific_unit !== 'kg gross') throw new Error('The live Oman mixed/minimum-duty canary failed.');
  if (tiles.resolution.resolution !== 'classification_refinement_required'
    || !tiles.lines.some((line) => line.measure_kind === 'additional_duty' && line.duty.ad_valorem_rate_percent === 70.2)
    || !tiles.lines.some((line) => line.measure_kind === 'additional_duty' && line.duty.ad_valorem_rate_percent === 37)
    || !tiles.requirements.some((requirement) => requirement.requirement_code === 'OM_ANTIDUMPING_PRODUCER_EXPORTER_IDENTITY')) {
    throw new Error('The live Oman producer-specific anti-dumping refinement canary failed.');
  }
  if (!prohibited.requirements.some((requirement) => requirement.requirement_code === 'OM_TARIFF_PROHIBITED')) throw new Error('The live Oman prohibited-line canary failed.');

  const snapshotFor = async (hs6: string) => reparseOmanAuthorityRelease({ actor, release_id: release.id, hs6, parser_version: release.parser_version, now, origin_country: 'IN', correlation_id: randomUUID() });
  const zeroSnapshot = await snapshotFor('010121');
  const repeatedSnapshot = await snapshotFor('010121');
  if (zeroSnapshot.id !== repeatedSnapshot.id) throw new Error('Repeated Oman reparse was not idempotent.');
  const mixedSnapshot = await snapshotFor('240110');
  const remedySnapshot = await snapshotFor('690721');
  const prohibitedSnapshot = await snapshotFor('010310');

  const job = await enqueueJob({
    type: JobType.market_access_ingest,
    payload: { country_code: 'OM', hs_code: '030569', origin_country: 'IN' },
    requested_by_id: actor.id,
    dedupe_key: `oman-staging-canary:${release.id}:${randomUUID()}`,
    correlation_id: randomUUID(),
  });
  const deadline = Date.now() + 180_000;
  let completedJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  const terminalStatuses: JobStatus[] = [JobStatus.completed, JobStatus.failed, JobStatus.cancelled];
  while (!terminalStatuses.includes(completedJob.status) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    completedJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
  }
  if (completedJob.status !== JobStatus.completed) throw new Error(`Oman staging worker job ${job.id} did not complete: ${completedJob.status}.`);
  const attempt = await prisma.jobAttempt.findFirstOrThrow({ where: { job_id: job.id }, orderBy: { attempt_no: 'desc' } });
  const jobResult = completedJob.result as { snapshot_id?: string; regulatory_coverage_complete?: boolean } | null;
  if (!jobResult?.snapshot_id || jobResult.regulatory_coverage_complete !== false) throw new Error('Oman staging worker job did not persist the expected partial-regulatory snapshot.');
  const heartbeat = await prisma.workerHeartbeat.findFirst({ orderBy: { last_seen_at: 'desc' } });
  if (!heartbeat || Date.now() - heartbeat.last_seen_at.getTime() > 120_000) throw new Error('No recent staging worker heartbeat exists after the Oman job.');

  console.log(JSON.stringify({
    phase: 'semantics',
    release: { id: release.id, checksum: release.checksum, reader_version: release.reader_version, parser_version: release.parser_version },
    canaries: {
      cepa_category_a: { hs6: '010121', resolution: horses.resolution.resolution, india_preference: horses.india_preference },
      legal_zero: { hs6: '010121', general_duty: horses.general_duty },
      ordinary_ad_valorem_and_cepa_proof: { hs6: '030569', general_duty: ordinary.general_duty, india_preference: ordinary.india_preference },
      mixed_minimum: { hs6: '240110', general_duty: tobacco.general_duty },
      anti_dumping_refinement: { hs6: '690721', resolution: tiles.resolution.resolution, candidate_count: tiles.resolution.candidate_count, rates: tiles.lines.filter((line) => line.measure_kind === 'additional_duty').map((line) => line.duty.ad_valorem_rate_percent), requirement_codes: tiles.requirements.map((item) => item.requirement_code) },
      prohibited: { hs6: '010310', requirement_codes: prohibited.requirements.map((item) => item.requirement_code) },
      idempotent_snapshot: { id: zeroSnapshot.id, repeated_id: repeatedSnapshot.id },
    },
    snapshots: { zero: zeroSnapshot.id, mixed: mixedSnapshot.id, anti_dumping: remedySnapshot.id, prohibited: prohibitedSnapshot.id, worker_ordinary: jobResult.snapshot_id },
    worker: { job_id: job.id, job_status: completedJob.status, attempt_id: attempt.id, attempt_no: attempt.attempt_no, heartbeat_instance_id: heartbeat.instance_id, heartbeat_last_seen_at: heartbeat.last_seen_at },
  }, null, 2));
}

async function main() {
  if (process.env.APP_ENV !== 'staging') throw new Error('REFUSING TO RUN: Oman canaries may persist only in APP_ENV=staging.');
  validateRuntimeEnvironment('worker');
  const configuredActorEmail = process.env.OMAN_CANARY_ACTOR_EMAIL?.trim().toLowerCase();
  const user = configuredActorEmail
    ? await prisma.user.findUnique({ where: { email: configuredActorEmail } })
    : await prisma.user.findFirst({
      where: { role: { in: [UserRole.admin, UserRole.ops_supervisor] } },
      orderBy: { created_at: 'asc' },
    });
  if (!user) throw new Error('Create a staging admin/ops supervisor or configure OMAN_CANARY_ACTOR_EMAIL before running this canary.');
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
  const phase = process.argv[2];
  if (phase === 'acquisition') return runAcquisition(actor);
  if (phase === 'semantics') return runSemantics(actor);
  throw new Error('Usage: canary-oman-authority-pack.ts acquisition|semantics');
}

main().finally(() => prisma.$disconnect());
