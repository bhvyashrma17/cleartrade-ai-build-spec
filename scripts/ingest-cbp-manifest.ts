import { EvidenceOrigin, JobStatus, JobType } from '@prisma/client';
import { registerAllJobHandlers } from '@/lib/job-handlers';
import { claimNextJob, enqueueJob, runClaimedJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

function arg(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

async function main() {
  const file_path = arg('file');
  const license_file_path = arg('license');
  const evidence_origin=arg('origin') as EvidenceOrigin|undefined;
  if (!file_path || !license_file_path || !evidence_origin || !Object.values(EvidenceOrigin).includes(evidence_origin)) throw new Error('Usage: npm run ingest:cbp -- --file=/absolute/records.ndjson --license=/absolute/license.json --origin=imported_real [--resume=run_id]');
  registerAllJobHandlers();
  const ingest_run_id = arg('resume');
  const job = await enqueueJob({
    type: JobType.cbp_manifest_ingest,
    payload: { file_path, license_file_path,evidence_origin, ...(ingest_run_id ? { ingest_run_id } : {}) },
    dedupe_key: `cbp_manifest:${ingest_run_id ?? `${file_path}:${Date.now()}`}`,
  });
  while (await prisma.job.count({ where: { type: JobType.cbp_manifest_ingest, status: JobStatus.queued } })) {
    const claimed = await claimNextJob([JobType.cbp_manifest_ingest]);
    if (!claimed) continue;
    await runClaimedJob(claimed);
  }
  console.log(JSON.stringify(await prisma.job.findUnique({ where: { id: job.id }, select: { id: true, status: true, result: true } }), null, 2));
}

main().finally(() => prisma.$disconnect());
