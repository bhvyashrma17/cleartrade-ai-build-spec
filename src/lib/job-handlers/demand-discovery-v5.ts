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
    const summary = await writeV5Results({
      run, result, frozen_inputs: loaded.frozen, evidence_origins: loaded.evidence_origins, notes: loaded.notes, status, as_of: asOf,
      config_version: version, policy_snapshot: config.policy, correlation_id: ctx.correlation_id,
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
