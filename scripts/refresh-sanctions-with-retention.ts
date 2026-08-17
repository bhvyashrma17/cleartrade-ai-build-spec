/**
 * Part D7 — one controlled live refresh of every required dataset, with durable artifact
 * retention MANDATORY.
 *
 * Why this script exists rather than a data backfill: the four snapshots active before this
 * change were retrieved when nothing persisted the raw bytes, so there is no artifact to
 * point them at. Writing an `artifact_ref` onto them would claim a retention that never
 * happened. The only honest way to get retained artifacts is to retrieve the datasets again
 * and let the normal path persist them — which is what this does, through the same
 * lease-guarded refresh the scheduler uses.
 *
 * Retention is forced ON so the fail-closed path (D4) is genuinely exercised: if persistence
 * or post-write verification fails, activation is refused and the incumbent snapshot keeps
 * serving.
 *
 * Prints no raw XML, no credentials, no signed URLs — only counts, digests (abbreviated) and
 * object keys, which by construction carry no sanctions names or secrets.
 */

import { REQUIRED_SANCTIONS_SOURCES } from '../src/lib/sanctions/screening';
import { refreshSanctionsSourceExclusive } from '../src/lib/job-handlers/sanctions';
import { artifactRetentionRequired } from '../src/lib/sanctions/artifact-store';
import { getDocumentStorage } from '../src/lib/document-storage';
import { prisma } from '../src/lib/prisma';
import type { SanctionsSource } from '../src/lib/sanctions/sources';

async function main() {
  process.env.SANCTIONS_REQUIRE_ARTIFACT_RETENTION = 'true';

  const storage = getDocumentStorage();
  console.log(`Retention required: ${artifactRetentionRequired()} · storage provider: ${storage.provider}`);
  if (storage.provider === 'local') {
    console.log(
      'NOTE: this environment uses LOCAL storage. Retention is proven end-to-end here, but this\n' +
        '      is not a validation of the S3 adapter against a real bucket.',
    );
  }
  await storage.healthcheck();

  const run = await prisma.sanctionsIngestRun.create({ data: { evidence_origin: 'public_real' } });
  let failures = 0;

  for (const source of REQUIRED_SANCTIONS_SOURCES as readonly SanctionsSource[]) {
    const started = Date.now();
    const r = await refreshSanctionsSourceExclusive(source, run.id, { owner: 'd7-controlled-refresh' });
    const secs = ((Date.now() - started) / 1000).toFixed(1);

    if (!r.activated) failures += 1;
    console.log(
      [
        '',
        `── ${source} (${secs}s)`,
        `   activated              ${r.activated}`,
        `   completeness           ${r.completeness_status}`,
        `   failure stage/reason   ${r.failure_stage}${r.failure_reason ? ` — ${r.failure_reason}` : ''}`,
        `   http / bytes           ${r.http_status} / ${r.byte_length}`,
        `   retrieved / parsed     ${r.retrieved_count} / ${r.parsed_count} (rejected ${r.rejected_count})`,
        `   authoritative count    ${r.authoritative_record_count ?? 'not declared'}`,
        `   checksum               ${r.checksum ? `${r.checksum.slice(0, 12)}…` : 'none'}`,
        `   artifact retained      ${r.artifact_retained}`,
        `   artifact storage       ${r.artifact_storage_provider ?? 'none'}`,
        `   artifact verification  ${r.artifact_verification ?? 'none'}`,
        `   anomalies              ${r.anomalies.length}`,
      ].join('\n'),
    );
  }

  // --- Post-state ----------------------------------------------------------
  const active = await prisma.sanctionsSourceSnapshot.findMany({
    where: { state: 'active', source: { in: [...REQUIRED_SANCTIONS_SOURCES] } },
    select: { source: true, artifact_ref: true, completeness_status: true, parsed_entity_count: true },
    orderBy: { source: 'asc' },
  });
  console.log('\n── Active snapshots after refresh');
  for (const s of active) {
    console.log(
      `   ${s.source.padEnd(28)} ${s.completeness_status.padEnd(9)} n=${String(s.parsed_entity_count).padEnd(6)} artifact=${s.artifact_ref ?? 'NULL'}`,
    );
  }

  const retained = active.filter((s) => s.artifact_ref).length;
  console.log(`\n${retained}/${REQUIRED_SANCTIONS_SOURCES.length} active snapshots have a retained raw artifact.`);
  await prisma.$disconnect();
  process.exit(failures === 0 && retained === REQUIRED_SANCTIONS_SOURCES.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await prisma.$disconnect();
  process.exit(1);
});
