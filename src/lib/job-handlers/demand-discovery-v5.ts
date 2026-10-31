/**
 * `demand_discovery_v5` — every screening market for one confirmed product (docs/36 §7).
 *
 * Reads the run's frozen snapshot, gathers the releases and provider data the run may use
 * (`loadRunInputs`), scores all markets in memory (`assessMarkets`), and writes the result set and
 * the run's closing state in one transaction (`writeV5Results`). A Comtrade step that fails leaves
 * the run `partial` — scored on BACI alone, with the reason — never failed.
 */
import { JobStatus, type Prisma } from '@prisma/client';
import { getConfigWithVersion } from '@/lib/config';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { assessMarkets } from '@/lib/demand-discovery-v5/assess';
import { compareWithIndiaExports, summarizeRunCalibration } from '@/lib/demand-discovery-v5/calibration';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { loadRunInputs, type V5ProductFacts } from '@/lib/demand-discovery-v5/run-inputs';
import { writeV5Results } from '@/lib/demand-discovery-v5/service';
import { requestHandOffRegionalDemand } from '@/lib/regional-demand/service';
import { requestHandOffBuyerDiscovery } from '@/lib/buyer-discovery/service';
import type { DocumentStorage } from '@/lib/document-storage';

let storageOverride: DocumentStorage | null = null;
/** Test seam: partitions read from an in-memory store. */
export function setDemandDiscoveryV5StorageForTesting(storage: DocumentStorage | null) {
  storageOverride = storage;
}

export async function runDemandDiscoveryV5(ctx: JobContext): Promise<JobOutcome> {
  const runId = ctx.target_id;
  if (!runId) throw new Error('demand_discovery_v5 job has no target discovery run.');
  const run = await prisma.discoveryRun.findUnique({ where: { id: runId }, select: { id: true, product_id: true, exporter_org_id: true, input_snapshot: true, as_of_date: true, model_version: true } });
  if (!run) throw new Error(`Discovery run ${runId} no longer exists.`);
  if (run.model_version !== DEMAND_DISCOVERY_V5_MODEL) throw new Error(`Discovery run ${runId} is not a v5 run.`);
  const snapshot = (run.input_snapshot ?? {}) as { hs_code?: string; classification_version?: string | null; v5_product_facts?: V5ProductFacts };
  if (!snapshot.hs_code || !/^\d{6}$/.test(snapshot.hs_code) || !snapshot.v5_product_facts) throw new Error(`Discovery run ${runId} has no frozen HS6 and product facts.`);
  const asOf = run.as_of_date ?? new Date();

  await prisma.discoveryRun.update({ where: { id: runId }, data: { status: JobStatus.processing, started_at: new Date() } });
  try {
    const { value: config, version } = await getConfigWithVersion('demand_discovery.v5');
    await ctx.reportProgress(10);
    const loaded = await loadRunInputs({
      hs6: snapshot.hs_code, as_of: asOf, product: snapshot.v5_product_facts, config, storage: storageOverride ?? undefined,
      exporter_org_id: run.exporter_org_id, hs_revision: (snapshot.classification_version ?? 'unknown').trim().toUpperCase() || 'UNKNOWN',
      job_id: ctx.job_id, correlation_id: ctx.correlation_id,
    });
    await ctx.reportProgress(70);
    const result = assessMarkets(loaded.input);
    await ctx.reportProgress(85);
    const status = loaded.degraded ? JobStatus.partial : JobStatus.completed;
    // E-042: every run records how its top 10 compares with where India already sells (docs/36 §8),
    // from the BACI flows it read, over the years the size measure averages.
    const base = loaded.input.base;
    const calibration = base
      ? summarizeRunCalibration(compareWithIndiaExports({
        hs6: snapshot.hs_code, flows: base.flows, years: base.years.slice(-config.policy.size.average_years),
        markets: result.markets.map((market) => ({ market: market.market, status: market.status, rank: market.rank, overall: market.overall, reasons: market.reasons.map((reason) => reason.text) })),
      }))
      : null;
    const summary = await writeV5Results({
      run, result, frozen_inputs: loaded.frozen, evidence_origins: loaded.evidence_origins, notes: loaded.notes, status, as_of: asOf,
      config_version: version, policy_snapshot: config.policy, correlation_id: ctx.correlation_id, calibration,
    });
    // D-019: the top markets go on to regional and buyer discovery where an official source exists.
    // Never fails the run: a hand-off that cannot start is recorded in the result.
    const handOffFailed = (error: unknown) => ({ requested: [] as string[], refused: [{ country_code: '*', reason: error instanceof Error ? error.message : String(error) }] });
    const regional = await requestHandOffRegionalDemand(runId, ctx.correlation_id).catch(handOffFailed);
    const buyers = await requestHandOffBuyerDiscovery(runId, ctx.correlation_id).catch(handOffFailed);
    return {
      status,
      result: {
        model_version: DEMAND_DISCOVERY_V5_MODEL,
        assessment_count: result.markets.length,
        ranked: summary.ranked,
        ...(calibration ? { calibration: { overlap: calibration.overlap, top: calibration.top, verdict: calibration.verdict } } : {}),
        top_markets: summary.handed_off.slice(0, 3).map((item) => ({ country_code: item.market, overall_score: item.overall })),
        regional_demand: regional,
        buyer_discovery: buyers,
        ...(loaded.notes.length ? { missing: loaded.notes } : {}),
        provenance: { engine: DEMAND_DISCOVERY_V5_MODEL, policy_version: result.policy_version, note: 'Scores are computed from recorded trade data (CEPII BACI, UN Comtrade) and public reference datasets. Duty figures marked "estimated" are not official rates.' },
      } as Prisma.InputJsonValue,
    };
  } catch (error) {
    // A retry sets the run back to processing; until then it does not claim to be running.
    await prisma.discoveryRun.update({ where: { id: runId }, data: { status: JobStatus.failed } }).catch(() => undefined);
    throw error;
  }
}

/**
 * The job's end hook (jobs.ts): when the queue ends an attempt (the worker stopped mid-run, or an
 * attempt failed), the run follows its job: `queued` while a retry is due, `failed` or `cancelled` once
 * none is. Idempotent, and never moves a finished run (E-039). True when the run moved.
 */
export async function settleV5Run(job: { id: string; target_id: string | null }): Promise<boolean> {
  if (!job.target_id) return false;
  const current = await prisma.job.findUnique({ where: { id: job.id }, select: { status: true } });
  const next = current?.status === JobStatus.queued || current?.status === JobStatus.failed || current?.status === JobStatus.cancelled ? current.status : null;
  if (!next) return false;
  // A retry may follow a failure the handler recorded; a final failure only closes a run still open.
  const from = next === JobStatus.queued ? [JobStatus.processing, JobStatus.failed] : [JobStatus.queued, JobStatus.processing];
  const moved = await prisma.discoveryRun.updateMany({
    where: { id: job.target_id, job_id: job.id, model_version: DEMAND_DISCOVERY_V5_MODEL, status: { in: from } },
    data: { status: next },
  });
  return moved.count > 0;
}

/** v5 runs still `queued` or `processing` under a job that failed or was cancelled before E-039, settled. Returns how many moved. */
export async function reconcileV5Runs(): Promise<number> {
  const open = await prisma.discoveryRun.findMany({
    where: { model_version: DEMAND_DISCOVERY_V5_MODEL, status: { in: [JobStatus.queued, JobStatus.processing] }, job_id: { not: null } },
    select: { id: true, job_id: true },
  });
  if (!open.length) return 0;
  const ended = await prisma.job.findMany({ where: { id: { in: open.map((run) => run.job_id!) }, status: { in: [JobStatus.failed, JobStatus.cancelled] } }, select: { id: true } });
  let moved = 0;
  for (const job of ended) {
    const run = open.find((candidate) => candidate.job_id === job.id)!;
    if (await settleV5Run({ id: job.id, target_id: run.id })) moved += 1;
  }
  return moved;
}
