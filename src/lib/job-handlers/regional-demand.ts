/**
 * `regional_demand_discovery` — the regional view of one v5 market (D-033, docs/38).
 *
 * Reads the official source for the run's market and HS6 and writes the result once. A missing or
 * refused API key, or a source with no figures for the product, leaves the run `unavailable` with the
 * reason and completes the job (retrying would not change the answer). Anything else — the source
 * unreachable, an unexpected answer — marks the run failed and rethrows so the job queue retries it.
 */
import { RegionalDemandStatus, type Prisma } from '@prisma/client';
import type { JobContext, JobOutcome } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { IMPORTER_LIST_SOURCES, type ImporterListSourceKey } from '@/lib/buyer-discovery/importer-lists';
import { CensusKeyError, readUsRegionalDemand, US_REGIONAL_SOURCE, type CensusFetch, type RegionalDemandResultV1 } from '@/lib/regional-demand/census';
import { readImporterRegions } from '@/lib/regional-demand/importer-regions';

let fetchOverride: CensusFetch | null = null;
/** Test seam: the default suite never reaches the network. */
export function setRegionalDemandFetchForTesting(fetchImpl: CensusFetch | null) {
  fetchOverride = fetchImpl;
}

const defaultFetch: CensusFetch = (url) => fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(45_000) });

async function finishUnavailable(runId: string, reason: string): Promise<JobOutcome> {
  await prisma.regionalDemandRun.update({ where: { id: runId }, data: { status: RegionalDemandStatus.unavailable, reason, completed_at: new Date() } });
  return { status: 'completed', result: { regional_demand_run_id: runId, outcome: 'unavailable', reason } };
}

export async function runRegionalDemand(ctx: JobContext): Promise<JobOutcome> {
  const runId = ctx.target_id;
  if (!runId) throw new Error('regional_demand_discovery job has no target run.');
  const run = await prisma.regionalDemandRun.findUnique({ where: { id: runId } });
  if (!run) throw new Error(`Regional demand run ${runId} no longer exists.`);
  await prisma.regionalDemandRun.update({ where: { id: runId }, data: { status: RegionalDemandStatus.running, reason: null } });

  try {
    const now = new Date();
    let result: RegionalDemandResultV1 | null;
    if (run.source_key in IMPORTER_LIST_SOURCES) {
      const read = await readImporterRegions({ source_key: run.source_key as ImporterListSourceKey, hs6: run.hs6_code, now });
      if (!read.result) return await finishUnavailable(runId, read.reason ?? 'No importer list is available.');
      result = read.result;
    } else if (run.source_key === US_REGIONAL_SOURCE.key) {
      const key = process.env.CENSUS_API_KEY?.trim();
      if (!key) return await finishUnavailable(runId, 'The Census Bureau API key (CENSUS_API_KEY) is not configured on this environment.');
      await ctx.reportProgress(10);
      result = (await readUsRegionalDemand({ hs6: run.hs6_code, key, now, fetchImpl: fetchOverride ?? defaultFetch })).result;
      if (!result) return await finishUnavailable(runId, `The Census Bureau has no recorded US imports of HS ${run.hs6_code} in the last 15 months.`);
    } else {
      return await finishUnavailable(runId, `No reader is configured for the regional source ${run.source_key}.`);
    }
    await ctx.reportProgress(90);
    await prisma.regionalDemandRun.update({
      where: { id: runId },
      data: { status: RegionalDemandStatus.completed, result: result as unknown as Prisma.InputJsonValue, retrieved_at: now, completed_at: new Date(), reason: null },
    });
    return {
      status: 'completed',
      result: {
        regional_demand_run_id: runId, outcome: 'completed', country_code: run.country_code, hs6_code: run.hs6_code, period: result.period.label,
        india_value_usd: result.totals.india_value_usd, importer_count: result.totals.importer_count ?? null,
        top_area: result.views[0]?.areas[0]?.code ?? null, second_view_top: result.views[1]?.areas[0]?.name ?? null,
      },
    };
  } catch (error) {
    if (error instanceof CensusKeyError) return await finishUnavailable(runId, error.message);
    const reason = error instanceof Error ? error.message : String(error);
    await prisma.regionalDemandRun.update({ where: { id: runId }, data: { status: RegionalDemandStatus.failed, reason, completed_at: new Date() } }).catch(() => undefined);
    throw error;
  }
}
