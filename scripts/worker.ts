/**
 * Background job worker.
 *
 *   npm run worker
 *
 * Deliberately a plain Node process polling Postgres — no Redis, no SQS, no broker to
 * install before the app runs (docs/09 §3 asks for durable job state, not for a
 * particular transport). Running more than one instance is safe: jobs are claimed with a
 * conditional UPDATE, so two workers cannot take the same row.
 *
 * Loop, per tick:
 *   1. reclaim jobs abandoned by a crashed worker
 *   2. claim one job and run it
 *   3. if nothing was claimable, sleep for the configured interval
 *
 * Shutdown is graceful: SIGINT/SIGTERM stops the loop *after* the job in flight finishes,
 * so a deploy does not strand work mid-execution. A hard kill is still safe — the job is
 * left in `processing` and reclaimed by the stale sweep.
 */

import { getConfig } from '../src/lib/config';
import { registerAllJobHandlers } from '../src/lib/job-handlers';
import { claimNextJob, reclaimStaleJobs, runClaimedJob } from '../src/lib/jobs';
import { prisma } from '../src/lib/prisma';

let shuttingDown = false;
let activeJobId: string | null = null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick(): Promise<boolean> {
  const reclaimed = await reclaimStaleJobs();
  if (reclaimed.requeued || reclaimed.failed) {
    console.log(`[worker] reclaimed ${reclaimed.requeued} stale, failed ${reclaimed.failed} exhausted`);
  }

  const job = await claimNextJob();
  if (!job) return false;

  activeJobId = job.id;
  const startedAt = Date.now();
  console.log(`[worker] ${job.type} ${job.id} attempt ${job.attempt_no} — start`);

  await runClaimedJob({
    id: job.id,
    type: job.type,
    attempt_no: job.attempt_no,
    payload: job.payload,
    exporter_org_id: job.exporter_org_id,
    target_id: job.target_id,
    correlation_id: job.correlation_id,
  });

  const finished = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true } });
  console.log(
    `[worker] ${job.type} ${job.id} — ${finished?.status ?? 'unknown'} in ${Date.now() - startedAt}ms`,
  );
  activeJobId = null;
  return true;
}

async function main() {
  registerAllJobHandlers();
  const policy = await getConfig('jobs.policy');
  console.log(
    `[worker] started · poll ${policy.worker_poll_interval_ms}ms · stale after ${policy.stale_after_seconds}s`,
  );

  // `--once` drains the queue and exits: used by tests and by a one-shot CI run, so a
  // suite never has to sleep-and-hope that a daemon picked the job up.
  const once = process.argv.includes('--once');

  while (!shuttingDown) {
    let didWork = false;
    try {
      didWork = await tick();
    } catch (error) {
      // A failure in the loop itself (not in a handler — those are recorded on the job)
      // must not kill the worker; back off and continue.
      console.error('[worker] tick failed:', error);
      await sleep(policy.worker_poll_interval_ms);
    }
    if (once && !didWork) break;
    if (!didWork && !shuttingDown) await sleep(policy.worker_poll_interval_ms);
  }

  console.log('[worker] stopped');
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1); // second signal: give up waiting
    shuttingDown = true;
    console.log(
      activeJobId
        ? `[worker] ${signal} — finishing job ${activeJobId} then exiting (again to force)`
        : `[worker] ${signal} — exiting`,
    );
  });
}

main()
  .catch((error) => {
    console.error('[worker] fatal:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
