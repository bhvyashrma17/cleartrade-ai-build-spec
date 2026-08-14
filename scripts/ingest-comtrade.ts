/**
 * Trigger a Comtrade ingest for one HS chapter, then drain it — following the same
 * enqueue-and-run-via-the-real-job-system shape as `scripts/worker.ts --once`, scoped to
 * just this job type so the script exits once its own work is done rather than draining
 * whatever else happens to be queued.
 *
 * Batch/scheduled use only — never called from a user-facing request.
 *
 *   npm run ingest:comtrade -- --chapter=09
 *   npm run ingest:comtrade -- --chapter=09 --reporter=699 --partner=0 --year=2024 --flow=export
 */

import { IngestStatus, JobStatus, JobType, TradeDataSource } from '@prisma/client';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, enqueueJob, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';
import { getConfig } from '../src/lib/config';

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg?.slice(flag.length + 3);
}

async function main() {
  const requestedChapter = argValue('chapter');
  const all = process.argv.includes('--all');
  if (!requestedChapter && !all) {
    console.error('Usage: npm run ingest:comtrade -- --all | --chapter=09 [--reporter=699] [--partner=0] [--year=2024] [--flow=export|import]');
    process.exitCode = 1;
    return;
  }

  registerAllJobHandlers();
  const policy = await getConfig('comtrade.policy');
  const chapters = requestedChapter ? [requestedChapter] : policy.chapter_priority;
  if (!chapters?.length) throw new Error('comtrade.policy.chapter_priority is empty; refusing an unordered full ingest.');
  for (const chapter of chapters) {
    const basePayload = { hs_chapter: chapter, ...(argValue('reporter') ? { reporter: argValue('reporter') } : {}), ...(argValue('partner') ? { partner: argValue('partner') } : {}), ...(argValue('year') ? { year: Number(argValue('year')) } : {}), ...(argValue('flow') ? { flow_direction: argValue('flow') } : {}) };
    const year = Number(argValue('year') ?? new Date().getFullYear() - 1);
    const prior = await prisma.ingestRun.findFirst({ where: { source: TradeDataSource.comtrade, status: { in: [IngestStatus.running, IngestStatus.partial, IngestStatus.throttled] }, params: { path: ['hs_chapter'], equals: chapter }, AND: [{ params: { path: ['year'], equals: year } }] }, orderBy: { started_at: 'desc' } });
    if (prior?.retry_after && prior.retry_after > new Date()) { console.log(`Chapter ${chapter} paused until ${prior.retry_after.toISOString()} after throttling.`); break; }
    const payload = { ...basePayload, ...(prior ? { ingest_run_id: prior.id } : {}) };
    const job = await enqueueJob({ type: JobType.comtrade_ingest, payload, dedupe_key: `comtrade_ingest:${chapter}:${year}` });
    console.log(`${prior ? 'Resuming' : 'Starting'} chapter ${chapter} in job ${job.id}${prior ? ` (run ${prior.id})` : ''}`);
    while (true) {
      const claimed = await claimNextJob([JobType.comtrade_ingest]);
      if (claimed) await runClaimedJob({ id: claimed.id, type: claimed.type, attempt_no: claimed.attempt_no, payload: claimed.payload, exporter_org_id: claimed.exporter_org_id, target_id: claimed.target_id, correlation_id: claimed.correlation_id });
      const queued = await prisma.job.count({ where: { type: JobType.comtrade_ingest, status: JobStatus.queued } });
      if (queued === 0) break;
    }
    const finished = await prisma.job.findUnique({ where: { id: job.id } });
    console.log(JSON.stringify({ chapter, job_status: finished?.status, result: finished?.result }, null, 2));
    const result = finished?.result as { throttled?: boolean } | null;
    if (result?.throttled) break;
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
