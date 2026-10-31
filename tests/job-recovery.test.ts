import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { JobStatus, JobType } from '@prisma/client';
import { reconcileV5Runs } from '@/lib/job-handlers/demand-discovery-v5';
import { registerAllJobHandlers } from '@/lib/job-handlers';
import { closeOrphanedAttempts, failJobAttempt, reclaimStaleJobs } from '@/lib/jobs';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { V5_RESULTS_WRITE_TIMEOUT_MS, writeV5Results } from '@/lib/demand-discovery-v5/service';
import { prisma } from '@/lib/prisma';

/**
 * E-039: on staging a v5 write timed out twice, then a redeploy stopped the worker during the third
 * attempt. The stale reclaim failed the job but left its attempt and its run `processing` for good.
 */
async function v5RunWithJob(args: { job: JobStatus; run: JobStatus; attempts: number; attemptOpen?: boolean; startedMinutesAgo?: number }) {
  const org = await prisma.exporterOrg.create({ data: { display_name: `[TEST] recovery ${randomUUID().slice(0, 8)}`, country: 'IN' }, select: { id: true } });
  const run = await prisma.discoveryRun.create({ data: { exporter_org_id: org.id, model_version: DEMAND_DISCOVERY_V5_MODEL, status: args.run, input_snapshot: { hs_code: '741810' } }, select: { id: true } });
  const job = await prisma.job.create({
    data: {
      type: JobType.demand_discovery_v5, status: args.job, target_type: 'discovery_run', target_id: run.id, exporter_org_id: org.id, attempts: args.attempts, max_attempts: 3,
      started_at: new Date(Date.now() - (args.startedMinutesAgo ?? 180) * 60_000), correlation_id: randomUUID(),
    },
    select: { id: true },
  });
  await prisma.discoveryRun.update({ where: { id: run.id }, data: { job_id: job.id } });
  if (args.attemptOpen !== false) await prisma.jobAttempt.create({ data: { job_id: job.id, attempt_no: args.attempts, status: JobStatus.processing } });
  return { run_id: run.id, job_id: job.id };
}

const state = async (ids: { run_id: string; job_id: string }) => ({
  job: (await prisma.job.findUniqueOrThrow({ where: { id: ids.job_id }, select: { status: true } })).status,
  run: (await prisma.discoveryRun.findUniqueOrThrow({ where: { id: ids.run_id }, select: { status: true } })).status,
  attempts: await prisma.jobAttempt.findMany({ where: { job_id: ids.job_id }, select: { status: true, error_code: true, finished_at: true } }),
});

describe('jobs the worker never finished (E-039)', () => {
  beforeAll(() => registerAllJobHandlers());

  test('a stale job with attempts left goes back to the queue: its attempt closes and its run waits as queued', async () => {
    const ids = await v5RunWithJob({ job: JobStatus.processing, run: JobStatus.processing, attempts: 2 });
    await reclaimStaleJobs();
    const after = await state(ids);
    expect(after).toMatchObject({ job: JobStatus.queued, run: JobStatus.queued });
    expect(after.attempts).toEqual([{ status: JobStatus.failed, error_code: 'WORKER_TIMEOUT', finished_at: expect.any(Date) }]);
  });

  test('a stale job past its last attempt fails: its attempt closes and its run fails', async () => {
    const ids = await v5RunWithJob({ job: JobStatus.processing, run: JobStatus.processing, attempts: 3 });
    await reclaimStaleJobs();
    const after = await state(ids);
    expect(after).toMatchObject({ job: JobStatus.failed, run: JobStatus.failed });
    expect(after.attempts).toEqual([{ status: JobStatus.failed, error_code: 'WORKER_TIMEOUT', finished_at: expect.any(Date) }]);
  });

  test('a job still inside its time is left alone', async () => {
    const ids = await v5RunWithJob({ job: JobStatus.processing, run: JobStatus.processing, attempts: 1, startedMinutesAgo: 0 });
    await reclaimStaleJobs();
    expect(await state(ids)).toMatchObject({ job: JobStatus.processing, run: JobStatus.processing, attempts: [{ status: JobStatus.processing }] });
  });

  test('a failed attempt: with a retry due the run waits as queued; after the last one it stays failed', async () => {
    // The handler marks the run failed before it rethrows; the queue then decides.
    const ids = await v5RunWithJob({ job: JobStatus.processing, run: JobStatus.failed, attempts: 1 });
    await failJobAttempt(ids.job_id, 1, 'INTERNAL_ERROR', 'Transaction already closed.');
    expect(await state(ids)).toMatchObject({ job: JobStatus.queued, run: JobStatus.queued });

    await prisma.job.update({ where: { id: ids.job_id }, data: { status: JobStatus.processing, attempts: 3 } });
    await prisma.discoveryRun.update({ where: { id: ids.run_id }, data: { status: JobStatus.failed } });
    await prisma.jobAttempt.create({ data: { job_id: ids.job_id, attempt_no: 3, status: JobStatus.processing } });
    await failJobAttempt(ids.job_id, 3, 'INTERNAL_ERROR', 'Transaction already closed.');
    expect(await state(ids)).toMatchObject({ job: JobStatus.failed, run: JobStatus.failed });
  });

  test('records stuck before the fix: the sweep closes the attempt and fails the run; finished and waiting runs are untouched', async () => {
    const stuck = await v5RunWithJob({ job: JobStatus.failed, run: JobStatus.processing, attempts: 3 });
    const finished = await v5RunWithJob({ job: JobStatus.failed, run: JobStatus.completed, attempts: 3, attemptOpen: false });
    const waiting = await v5RunWithJob({ job: JobStatus.queued, run: JobStatus.queued, attempts: 0, attemptOpen: false });
    expect(await closeOrphanedAttempts()).toBeGreaterThanOrEqual(1);
    expect(await reconcileV5Runs()).toBeGreaterThanOrEqual(1);
    const after = await state(stuck);
    expect(after).toMatchObject({ job: JobStatus.failed, run: JobStatus.failed });
    expect(after.attempts).toEqual([{ status: JobStatus.failed, error_code: 'WORKER_TIMEOUT', finished_at: expect.any(Date) }]);
    expect(await state(finished)).toMatchObject({ run: JobStatus.completed });
    expect(await state(waiting)).toMatchObject({ job: JobStatus.queued, run: JobStatus.queued });
    // Settled once: the next sweep finds nothing of these.
    expect(await reconcileV5Runs()).toBe(0);
  });

  test("the results write holds its transaction for up to two minutes, not Prisma's five seconds", async () => {
    const transaction = vi.spyOn(prisma, '$transaction').mockImplementationOnce((async () => undefined) as never);
    await writeV5Results({
      run: { id: 'run', product_id: null, exporter_org_id: 'org', input_snapshot: {} },
      result: { policy_hash: 'hash', policy_version: 'v8', summary: { ranked: 0, handed_off: [] }, base_years: [], short_history: false, india_unit_values: [], markets: [] } as never,
      frozen_inputs: {}, evidence_origins: [], notes: [], status: JobStatus.completed, as_of: new Date(), config_version: 1, policy_snapshot: {}, correlation_id: 'correlation',
    });
    expect(transaction.mock.calls[0]![1]).toEqual({ timeout: V5_RESULTS_WRITE_TIMEOUT_MS, maxWait: 10_000 });
    expect(V5_RESULTS_WRITE_TIMEOUT_MS).toBe(120_000);
    transaction.mockRestore();
  });
});
