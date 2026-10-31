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
 *   0. the hourly membership sweep, the nightly authority-window refresh and the daily data
 *      freshness check (each self-throttled)
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
import { claimNextJob, closeOrphanedAttempts, reclaimStaleJobs, runClaimedJob } from '../src/lib/jobs';
import { reconcileV5Runs } from '../src/lib/job-handlers/demand-discovery-v5';
import { prisma } from '../src/lib/prisma';
import {hostname} from 'node:os';
import {log,reportError} from '../src/lib/observability';
import {validateRuntimeEnvironment} from '../src/lib/runtime-config';
import {expireLapsedMemberships} from '../src/lib/billing/subscription-service';
import {runDueAuthorityRefreshes} from '../src/lib/market-access/providers/singapore-refresh';
import {loadInputFreshness, needsAttention} from '../src/lib/demand-discovery-v5/input-freshness';

let shuttingDown = false;
let activeJobId: string | null = null;

/**
 * Membership lapse sweep, run from the worker loop rather than left to an external cron.
 *
 * `subscription-service.ts` documents this as the control that makes a MISSED webhook
 * safe: Razorpay does not guarantee delivery, so "we were never told they stopped paying"
 * must not mean "they keep paid access forever". A correctness guarantee that depends on
 * someone remembering to configure a scheduler is not a guarantee — the worker already
 * runs continuously in every environment that processes jobs at all, so the sweep lives
 * where it will actually run. `npm run memberships:expire` remains for one-off ops use.
 *
 * Hourly is ample: entitlement carries a multi-hour renewal grace window, so sweeping more
 * often could not revoke access any sooner than the grace period allows.
 */
const MEMBERSHIP_SWEEP_INTERVAL_MS = Number(process.env.MEMBERSHIP_SWEEP_INTERVAL_MS ?? 3_600_000);
let lastMembershipSweepAt = 0;

async function sweepLapsedMemberships(): Promise<void> {
  if (Date.now() - lastMembershipSweepAt < MEMBERSHIP_SWEEP_INTERVAL_MS) return;
  lastMembershipSweepAt = Date.now();
  const { downgraded } = await expireLapsedMemberships({ correlationId: `worker-membership-sweep:${instanceId}` });
  if (downgraded.length > 0) log('info', 'memberships_expired', { count: downgraded.length });
}

/**
 * D-029: official tariffs an authority lets us fetch only in a window (Singapore Statutes Online,
 * 03:00–07:00 Singapore Time) are saved here, inside it, so runs at any hour read the saved copy.
 * Outside the window this reads nothing; inside it, `singapore-refresh.ts` decides from the switch
 * (`market_access.authority_refresh`, off by default) and tonight's attempts whether to fetch.
 * A refresh failure is recorded and reported, never allowed to stop the job loop.
 */
const AUTHORITY_REFRESH_SWEEP_INTERVAL_MS = Number(process.env.AUTHORITY_REFRESH_SWEEP_INTERVAL_MS ?? 600_000);
let lastAuthorityRefreshAt = 0;

async function sweepAuthorityRefresh(): Promise<void> {
  if (Date.now() - lastAuthorityRefreshAt < AUTHORITY_REFRESH_SWEEP_INTERVAL_MS) return;
  lastAuthorityRefreshAt = Date.now();
  try {
    const { singapore } = await runDueAuthorityRefreshes({ correlation_id: `worker-authority-refresh:${instanceId}:${new Date().toISOString().slice(0, 10)}` });
    if (singapore.status !== 'not_due') log(singapore.status === 'failed' ? 'warn' : 'info', 'authority_refresh', { source: 'SG_SSO_CUSTOMS_DUTIES', status: singapore.status, release_id: singapore.release_id ?? undefined, reason: singapore.reason ?? undefined });
  } catch (error) {
    reportError(error, { event_scope: 'worker_authority_refresh' });
  }
}
/**
 * docs/36 §7a: once a day, log every Demand Discovery input that is overdue or missing, so a stale
 * dataset shows in the logs as well as on the ops pages (the Control Tower's "Stale data inputs").
 * It reads only, and a failure is reported, never allowed to stop the job loop.
 */
const INPUT_FRESHNESS_SWEEP_INTERVAL_MS = Number(process.env.INPUT_FRESHNESS_SWEEP_INTERVAL_MS ?? 86_400_000);
let lastInputFreshnessAt = 0;

async function sweepInputFreshness(): Promise<void> {
  if (Date.now() - lastInputFreshnessAt < INPUT_FRESHNESS_SWEEP_INTERVAL_MS) return;
  lastInputFreshnessAt = Date.now();
  try {
    const stale = (await loadInputFreshness()).filter(needsAttention);
    for (const row of stale) log('warn', 'input_freshness', { input: row.key, status: row.status, due_at: row.due_at ?? undefined, refresh: row.refresh });
    log('info', 'input_freshness_checked', { needs_attention: stale.length });
  } catch (error) {
    reportError(error, { event_scope: 'worker_input_freshness' });
  }
}
/**
 * E-039: attempts and v5 runs left `processing` under a job that had already ended, from before the
 * stale reclaim closed them, are settled here. New cases no longer arise, so every 10 minutes is ample.
 */
const ORPHAN_SWEEP_INTERVAL_MS = Number(process.env.ORPHAN_SWEEP_INTERVAL_MS ?? 600_000);
let lastOrphanSweepAt = 0;

async function sweepOrphanedWork(): Promise<void> {
  if (Date.now() - lastOrphanSweepAt < ORPHAN_SWEEP_INTERVAL_MS) return;
  lastOrphanSweepAt = Date.now();
  try {
    const attempts = await closeOrphanedAttempts();
    const runs = await reconcileV5Runs();
    if (attempts || runs) log('warn', 'orphaned_work_settled', { attempts, runs });
  } catch (error) {
    reportError(error, { event_scope: 'worker_orphan_sweep' });
  }
}
const instanceId=process.env.WORKER_INSTANCE_ID??`${hostname()}-${process.pid}`,heartbeatId=`worker:${instanceId}`;
let consecutiveFailures=0;
async function heartbeat(status='ready',lastError?:string){await prisma.workerHeartbeat.upsert({where:{id:heartbeatId},create:{id:heartbeatId,instance_id:instanceId,status,active_job_id:activeJobId,last_seen_at:new Date(),last_error:lastError?.slice(0,1000),last_error_at:lastError?new Date():null,consecutive_failures:consecutiveFailures},update:{status,active_job_id:activeJobId,last_seen_at:new Date(),last_error:lastError?.slice(0,1000),last_error_at:lastError?new Date():undefined,consecutive_failures:consecutiveFailures}});}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tick(): Promise<boolean> {
  // Before claiming work, not after: a tick that finds a job returns early below, so a
  // busy worker would otherwise never reach the sweep at all.
  await sweepLapsedMemberships();
  await sweepAuthorityRefresh();
  await sweepInputFreshness();
  await sweepOrphanedWork();

  const reclaimed = await reclaimStaleJobs();
  if (reclaimed.requeued || reclaimed.failed) {
    log('warn','worker_stale_jobs_reclaimed',{requeued:reclaimed.requeued,failed:reclaimed.failed});
  }

  const job = await claimNextJob();
  if (!job) return false;

  activeJobId = job.id;
  const startedAt = Date.now();
  log('info','job_started',{job_id:job.id,job_type:job.type,attempt:job.attempt_no,org_id:job.exporter_org_id??undefined});

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
  const status=finished?.status??'unknown';log(status==='failed'?'error':'info','job_finished',{job_id:job.id,job_type:job.type,status,duration_ms:Date.now()-startedAt});
  if(status==='failed')await heartbeat('degraded',`Job ${job.id} failed.`);else await heartbeat('ready');
  activeJobId = null;
  return true;
}

async function main() {
  log('info','platform_worker_starting',{instance_id:instanceId});
  validateRuntimeEnvironment('worker');
  registerAllJobHandlers();
  const policy = await getConfig('jobs.policy');
  await heartbeat('ready');
  log('info','worker_started',{instance_id:instanceId,poll_interval_ms:policy.worker_poll_interval_ms,stale_after_seconds:policy.stale_after_seconds});
  const heartbeatTimer=setInterval(()=>void heartbeat(activeJobId?'busy':'ready').catch(error=>reportError(error,{event_scope:'worker_heartbeat'})),Number(process.env.WORKER_HEARTBEAT_INTERVAL_MS??15000));heartbeatTimer.unref();

  // `--once` drains the queue and exits: used by tests and by a one-shot CI run, so a
  // suite never has to sleep-and-hope that a daemon picked the job up.
  const once = process.argv.includes('--once');

  while (!shuttingDown) {
    let didWork = false;
    try {
      didWork = await tick();
      consecutiveFailures=0;
    } catch (error) {
      // A failure in the loop itself (not in a handler — those are recorded on the job)
      // must not kill the worker; back off and continue.
      consecutiveFailures++;reportError(error,{event_scope:'worker_tick',consecutive_failures:consecutiveFailures});
      await heartbeat('degraded',error instanceof Error?error.message:String(error)).catch(()=>undefined);
      if(consecutiveFailures>=Number(process.env.WORKER_MAX_CONSECUTIVE_FAILURES??5))throw error;
      await sleep(policy.worker_poll_interval_ms);
    }
    if (once && !didWork) break;
    if (!didWork && !shuttingDown) await sleep(policy.worker_poll_interval_ms);
  }

  clearInterval(heartbeatTimer);await heartbeat('stopping').catch(()=>undefined);log('info','worker_stopped',{instance_id:instanceId});
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) process.exit(1); // second signal: give up waiting
    shuttingDown = true;
    log('info','worker_shutdown_requested',{signal,job_id:activeJobId??undefined});
  });
}

main()
  .catch((error) => {
    reportError(error,{event_scope:'worker_fatal'});
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
