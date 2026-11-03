/**
 * DB-backed background jobs (docs/09 §3).
 *
 * "Treat them as jobs — never hold a browser request open." Everything long-running —
 * discovery, document generation, exports — is enqueued here and polled via
 * GET /api/v1/jobs/:id.
 *
 * Postgres *is* the queue. There is no Redis/SQS dependency: `Job` rows are claimed with
 * a conditional UPDATE, which is atomic in the database, so two workers racing for the
 * same row cannot both win. That keeps a dev environment to `npm run dev` + `npm run
 * worker` and keeps job state in the same transactional store as the data it produces —
 * a job can write its result and mark itself complete atomically, which an external
 * broker cannot offer.
 *
 * Four requirements from docs/09 §3 shape the design, and each is load-bearing:
 *
 *   1. **Durable** — state lives in a row, not in worker memory, so it survives a
 *      refresh, a redeploy, and a login on another device.
 *   2. **Not duplicated** — `dedupe_key` is UNIQUE and is *cleared on terminal states*,
 *      so it constrains only in-flight work. Re-running the same search tomorrow is
 *      allowed; double-submitting it right now is not.
 *   3. **Retry never overwrites history** — every attempt is its own `JobAttempt` row.
 *      A successful result is never mutated by a later retry.
 *   4. **Recoverable** — a job stranded in `processing` by a crashed worker is reclaimed
 *      after `stale_after_seconds` rather than being stuck forever.
 */

import { JobStatus, JobType, OrgTier, Prisma } from '@prisma/client';
import { getConfig } from '@/lib/config';
import { jobAlreadyRunning, newCorrelationId, upgradeRequired } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import { isCostedJobType, MIN_TIER_FOR_COSTED_WORK, tierMayCauseCostedWork } from '@/lib/billing/costed-work';

/** Statuses from which no further work happens. */
export const TERMINAL_STATUSES: JobStatus[] = [
  JobStatus.completed,
  JobStatus.partial,
  JobStatus.failed,
  JobStatus.cancelled,
];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The two statuses that mean "the work ran". `partial` is a success with gaps, not a
 * failure — docs/09 §3 requires the UI to render the records that did come back and mark
 * the ones that did not.
 */
export type OutcomeStatus = Extract<JobStatus, 'completed' | 'partial' | 'failed'>;

// ---------------------------------------------------------------------------
// Enqueue
// ---------------------------------------------------------------------------

export interface EnqueueArgs {
  type: JobType;
  payload: Prisma.InputJsonValue;
  exporter_org_id?: string | null;
  requested_by_id?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  /**
   * Identifies "the same work". While a job holding this key is in flight, another
   * enqueue with the same key throws JOB_ALREADY_RUNNING instead of creating a duplicate.
   * Cleared when the job reaches a terminal state so the same work can be run again later.
   */
  dedupe_key?: string | null;
  /** Client-supplied idempotency key (docs/09 §1). Returns the existing job rather than throwing. */
  idempotency_key?: string | null;
  max_attempts?: number;
  correlation_id?: string;
}

/**
 * Refuse costed work for a tenant that has not paid for it.
 *
 * Reads the tier from the DATABASE, not from `args`, and not from a session claim. A JWT
 * carries a tier that was true when it was minted; a membership that lapsed an hour ago
 * still has valid sessions in flight, and those sessions must not be able to spend. This
 * is one indexed primary-key read on a path that is already about to do several writes.
 *
 * A null `exporter_org_id` is platform-scheduled work with no tenant behind it and is
 * allowed through — see the module comment.
 */
async function assertTenantMayCauseCostedWork(args: EnqueueArgs): Promise<void> {
  if (!isCostedJobType(args.type)) return;
  if (!args.exporter_org_id) return;

  const org = await prisma.exporterOrg.findUnique({
    where: { id: args.exporter_org_id },
    select: { tier: true },
  });
  // A job for an org that no longer exists is refused rather than run: fail closed.
  const tier = org?.tier ?? OrgTier.guest;
  if (tierMayCauseCostedWork(tier)) return;

  throw upgradeRequired(
    MIN_TIER_FOR_COSTED_WORK,
    'This runs on live trade data and is part of the Premium plan. Free accounts get the sample instead.',
  );
}

/**
 * Create a job, or refuse if an equivalent one is already in flight.
 *
 * The dedupe check is not a read-then-write: it relies on the UNIQUE constraint, so two
 * concurrent identical submissions cannot both pass. The pre-check exists only to give
 * the friendly answer in the common case; P2002 recovery below is what actually enforces
 * it under a race.
 */
export async function enqueueJob(args: EnqueueArgs) {
  const policy = await getConfig('jobs.policy');
  const correlationId = args.correlation_id ?? newCorrelationId();

  // Last shared checkpoint before provider budget is committed. The route's `assertCan`
  // should already have caught this; that it runs again here is the point — see
  // `src/lib/billing/costed-work.ts` for why a per-route promise is not enough to protect
  // a per-job cost.
  await assertTenantMayCauseCostedWork(args);

  // An idempotency key means "if you already did this, hand me back the same job".
  if (args.idempotency_key) {
    const existing = await prisma.job.findUnique({ where: { idempotency_key: args.idempotency_key } });
    if (existing) return existing;
  }

  if (args.dedupe_key) {
    const inFlight = await prisma.job.findUnique({ where: { dedupe_key: args.dedupe_key } });
    if (inFlight && !isTerminal(inFlight.status)) throw jobAlreadyRunning(inFlight.id);
  }

  try {
    return await prisma.job.create({
      data: {
        type: args.type,
        status: JobStatus.queued,
        payload: args.payload,
        exporter_org_id: args.exporter_org_id ?? null,
        requested_by_id: args.requested_by_id ?? null,
        target_type: args.target_type ?? null,
        target_id: args.target_id ?? null,
        dedupe_key: args.dedupe_key ?? null,
        idempotency_key: args.idempotency_key ?? null,
        max_attempts: args.max_attempts ?? policy.max_attempts,
        correlation_id: correlationId,
      },
    });
  } catch (error) {
    // Lost the race: someone inserted the same dedupe/idempotency key between our check
    // and our insert. Resolve it to the same answer the pre-check would have given.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      if (args.idempotency_key) {
        const existing = await prisma.job.findUnique({ where: { idempotency_key: args.idempotency_key } });
        if (existing) return existing;
      }
      if (args.dedupe_key) {
        const existing = await prisma.job.findUnique({ where: { dedupe_key: args.dedupe_key } });
        if (existing) throw jobAlreadyRunning(existing.id);
      }
    }
    throw error;
  }
}

/**
 * The in-flight job holding this dedupe key, if any.
 *
 * Callers use this to answer "is this already running?" *before* doing expensive or
 * irreversible setup — creating rows, or charging a guest's search quota. `enqueueJob`
 * enforces the same rule, but by then the caller has already committed that work.
 */
export async function findInFlightJob(dedupeKey: string) {
  const job = await prisma.job.findUnique({ where: { dedupe_key: dedupeKey } });
  return job && !isTerminal(job.status) ? job : null;
}

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

/**
 * Atomically claim one runnable job, or return null.
 *
 * The `where` clause re-asserts `status: queued` inside the UPDATE. That is the entire
 * concurrency control: Postgres serialises the row update, so of two workers that both
 * saw the row as queued, exactly one gets `count === 1` and the other gets 0 and moves on.
 * Selecting first and updating unconditionally would let both run the same job.
 */
export async function claimNextJob(types?: JobType[]) {
  const candidates = await prisma.job.findMany({
    where: {
      status: JobStatus.queued,
      run_after: { lte: new Date() },
      ...(types?.length ? { type: { in: types } } : {}),
    },
    orderBy: { run_after: 'asc' },
    select: { id: true },
    take: 10,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.job.updateMany({
      where: { id: candidate.id, status: JobStatus.queued },
      data: { status: JobStatus.processing, started_at: new Date(), progress: 0 },
    });
    if (claimed.count === 1) {
      const job = await prisma.job.findUnique({ where: { id: candidate.id } });
      if (!job) continue;

      // Each execution is its own attempt row — this is what makes a retry additive
      // rather than destructive.
      const attemptNo = job.attempts + 1;
      await prisma.$transaction([
        prisma.job.update({ where: { id: job.id }, data: { attempts: attemptNo } }),
        prisma.jobAttempt.create({
          data: { job_id: job.id, attempt_no: attemptNo, status: JobStatus.processing },
        }),
      ]);
      return { ...job, attempts: attemptNo, attempt_no: attemptNo };
    }
  }
  return null;
}

/**
 * Return jobs abandoned mid-flight to the queue.
 *
 * A worker that is killed between claiming and finishing leaves a row in `processing`
 * with nothing running. Without this the job is stuck forever and the user's UI spins
 * indefinitely — docs/09 §3 requires durable state, which means recoverable state.
 *
 * Jobs past their attempt ceiling are failed rather than requeued, so a job that reliably
 * kills its worker cannot loop.
 */
export async function reclaimStaleJobs(): Promise<{ requeued: number; failed: number }> {
  const policy = await getConfig('jobs.policy');
  const cutoff = new Date(Date.now() - policy.stale_after_seconds * 1000);

  const stale = await prisma.job.findMany({
    where: { status: JobStatus.processing, started_at: { lt: cutoff } },
    select: { id: true, type: true, target_id: true, attempts: true, max_attempts: true },
  });
  if (stale.length === 0) return { requeued: 0, failed: 0 };

  const retryable = stale.filter((j) => j.attempts < j.max_attempts).map((j) => j.id);
  const exhausted = stale.filter((j) => j.attempts >= j.max_attempts).map((j) => j.id);

  const [requeued, failed] = await prisma.$transaction([
    // The attempt that was running ends with it, or it stays `processing` forever (E-039).
    prisma.jobAttempt.updateMany({
      where: { job_id: { in: stale.map((j) => j.id) }, status: JobStatus.processing },
      data: { status: JobStatus.failed, error_code: 'WORKER_TIMEOUT', error_message: STOPPED_ATTEMPT_MESSAGE, finished_at: new Date() },
    }),
    prisma.job.updateMany({
      where: { id: { in: retryable }, status: JobStatus.processing },
      data: {
        status: JobStatus.queued,
        started_at: null,
        run_after: new Date(Date.now() + policy.retry_backoff_seconds * 1000),
      },
    }),
    prisma.job.updateMany({
      where: { id: { in: exhausted }, status: JobStatus.processing },
      data: {
        status: JobStatus.failed,
        error_code: 'WORKER_TIMEOUT',
        error_message: 'This did not finish in time. You can try again.',
        completed_at: new Date(),
        // Terminal — release the dedupe key so the work can be requested again.
        dedupe_key: null,
      },
    }),
  ]).then(([, requeuedJobs, failedJobs]) => [requeuedJobs, failedJobs] as const);

  for (const job of stale) await runEndHook(job, job.attempts >= job.max_attempts ? 'failed' : 'requeued');
  return { requeued: requeued.count, failed: failed.count };
}

const STOPPED_ATTEMPT_MESSAGE = 'The worker stopped before this attempt finished.';

/**
 * Attempts left `processing` under a job that is no longer running: the stale reclaim did not close
 * them before E-039. Closed as stopped; returns how many. The worker sweeps for these.
 */
export async function closeOrphanedAttempts(): Promise<number> {
  const closed = await prisma.jobAttempt.updateMany({
    where: { status: JobStatus.processing, job: { status: { not: JobStatus.processing } } },
    data: { status: JobStatus.failed, error_code: 'WORKER_TIMEOUT', error_message: STOPPED_ATTEMPT_MESSAGE, finished_at: new Date() },
  });
  return closed.count;
}

// ---------------------------------------------------------------------------
// End hooks
// ---------------------------------------------------------------------------

/**
 * What a job type does when the queue, not its handler, ends an attempt: a stale reclaim (the worker
 * stopped mid-attempt) or a failure. A v5 run, for one, must follow its job instead of staying
 * `processing` (E-039). A hook's own failure is logged and never stops the queue's bookkeeping.
 */
export type JobEndHook = (job: { id: string; type: JobType; target_id: string | null }, outcome: 'requeued' | 'failed') => Promise<void>;

const END_HOOKS = new Map<JobType, JobEndHook>();

export function registerJobEndHook(type: JobType, hook: JobEndHook) {
  END_HOOKS.set(type, hook);
}

async function runEndHook(job: { id: string; type: JobType; target_id: string | null }, outcome: 'requeued' | 'failed') {
  const hook = END_HOOKS.get(job.type);
  if (!hook) return;
  try {
    await hook(job, outcome);
  } catch (error) {
    console.error(`[job ${job.id}] end hook (${outcome}) failed:`, error);
  }
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

async function closeAttempt(
  jobId: string,
  attemptNo: number,
  status: JobStatus,
  data: { result?: Prisma.InputJsonValue; error_code?: string; error_message?: string },
) {
  await prisma.jobAttempt.updateMany({
    where: { job_id: jobId, attempt_no: attemptNo },
    data: { status, finished_at: new Date(), ...data },
  });
}

/**
 * Mark a job finished.
 *
 * `dedupe_key` is nulled on every terminal state. The column is UNIQUE, so leaving it set
 * would permanently block the same work from ever being requested again — the constraint
 * is meant to prevent *concurrent* duplicates, not to be a historical ledger.
 */
export async function completeJob(
  jobId: string,
  attemptNo: number,
  result: Prisma.InputJsonValue,
  status: OutcomeStatus = JobStatus.completed,
) {
  await closeAttempt(jobId, attemptNo, status, { result });
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status,
      result,
      progress: 100,
      progress_stage: 'completed',
      completed_at: new Date(),
      error_code: status === JobStatus.failed ? 'INGEST_FAILED' : null,
      error_message: status === JobStatus.failed ? 'The domain ingest failed. Inspect the linked IngestRun.' : null,
      dedupe_key: null,
    },
  });
}

/**
 * Record a failed attempt: requeue with backoff if attempts remain, otherwise fail.
 *
 * The attempt row keeps its own error, so the history of *why* each try failed survives
 * even after a later attempt succeeds.
 */
export async function failJobAttempt(
  jobId: string,
  attemptNo: number,
  errorCode: string,
  errorMessage: string,
) {
  const policy = await getConfig('jobs.policy');
  await closeAttempt(jobId, attemptNo, JobStatus.failed, {
    error_code: errorCode,
    error_message: errorMessage,
  });

  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, max_attempts: true },
  });
  if (!job) return null;

  const exhausted = job.attempts >= job.max_attempts;
  // Exponential backoff on the attempt number, so a flapping dependency is not hammered.
  const delayMs = policy.retry_backoff_seconds * 1000 * 2 ** (job.attempts - 1);

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: exhausted
      ? {
          status: JobStatus.failed,
          error_code: errorCode,
          error_message: errorMessage,
          completed_at: new Date(),
          dedupe_key: null,
        }
      : {
          status: JobStatus.queued,
          started_at: null,
          run_after: new Date(Date.now() + delayMs),
          error_code: errorCode,
          error_message: errorMessage,
        },
  });
  await runEndHook(updated, exhausted ? 'failed' : 'requeued');
  return updated;
}

export async function updateJobProgress(jobId: string, progress: number) {
  return prisma.job.update({
    where: { id: jobId },
    data: { progress: Math.max(0, Math.min(100, Math.round(progress))) },
  });
}

export async function updateJobStage(jobId:string,stage:string,progress:number,checkpoint?:Prisma.InputJsonValue){
  return prisma.job.update({where:{id:jobId},data:{progress_stage:stage,progress:Math.max(0,Math.min(100,Math.round(progress))),...(checkpoint===undefined?{}:{checkpoint})}});
}

export async function cancelJob(jobId: string) {
  return prisma.job.updateMany({
    // Only non-terminal jobs can be cancelled — cancelling a completed job would
    // discard a real historical result.
    where: { id: jobId, status: { in: [JobStatus.queued, JobStatus.processing] } },
    data: {
      status: JobStatus.cancelled,
      completed_at: new Date(),
      dedupe_key: null,
    },
  });
}

/**
 * Retry a finished job.
 *
 * Deliberately requeues the *same* Job row rather than mutating its result: the previous
 * `JobAttempt` rows stay intact, so the record of what happened before is preserved.
 * A completed job is never retried — docs/09 §3: "never silently overwrite a historical
 * successful result".
 */
export async function retryJob(jobId: string) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  if (job.status === JobStatus.completed || job.status === JobStatus.partial) return job;

  const policy = await getConfig('jobs.policy');
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.queued,
      started_at: null,
      completed_at: null,
      run_after: new Date(),
      error_code: null,
      error_message: null,
      progress: 0,
      // A retry gets a fresh attempt budget on top of what it has already used.
      max_attempts: job.attempts + policy.max_attempts,
    },
  });
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

export interface JobContext {
  job_id: string;
  attempt_no: number;
  payload: Prisma.JsonValue;
  exporter_org_id: string | null;
  target_id: string | null;
  correlation_id: string;
  reportProgress: (percent: number) => Promise<void>;
  reportStage?: (stage:string,percent:number,checkpoint?:Prisma.InputJsonValue) => Promise<void>;
}

export interface JobOutcome {
  status: OutcomeStatus;
  result: Prisma.InputJsonValue;
}

export type JobHandler = (ctx: JobContext) => Promise<JobOutcome>;

const HANDLERS = new Map<JobType, JobHandler>();

export function registerJobHandler(type: JobType, handler: JobHandler) {
  HANDLERS.set(type, handler);
}

export function getJobHandler(type: JobType): JobHandler | undefined {
  return HANDLERS.get(type);
}

/** Execute one claimed job, translating any throw into a recorded failure. */
export async function runClaimedJob(job: {
  id: string;
  type: JobType;
  attempt_no: number;
  payload: Prisma.JsonValue;
  exporter_org_id: string | null;
  target_id: string | null;
  correlation_id: string;
}) {
  const handler = getJobHandler(job.type);
  if (!handler) {
    await failJobAttempt(job.id, job.attempt_no, 'NO_HANDLER', `No handler registered for ${job.type}.`);
    return;
  }

  try {
    const outcome = await handler({
      job_id: job.id,
      attempt_no: job.attempt_no,
      payload: job.payload,
      exporter_org_id: job.exporter_org_id,
      target_id: job.target_id,
      correlation_id: job.correlation_id,
      reportProgress: async (percent) => {
        await updateJobProgress(job.id, percent);
      },
      reportStage: async (stage,percent,checkpoint) => {
        await updateJobStage(job.id,stage,percent,checkpoint);
      },
    });
    await completeJob(job.id, job.attempt_no, outcome.result, outcome.status);
  } catch (error) {
    // Never surface a raw exception to the user (docs/09 §4) — the correlation id on the
    // job is the thread back to the real error in the logs.
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[job ${job.id}] attempt ${job.attempt_no} failed:`, error);
    await failJobAttempt(job.id, job.attempt_no, 'INTERNAL_ERROR', message.slice(0, 500));
  }
}
