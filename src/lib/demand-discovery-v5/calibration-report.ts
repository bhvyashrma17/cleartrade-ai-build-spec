/**
 * The docs/36 §8 calibration check for one finished v5 run, shared by `scripts/dd5-compare-top10.ts`
 * and `scripts/dd5-archetype-runs.ts`: the run's top N against India's own largest export
 * destinations for the product in the BACI release the run used, over the years the market-size
 * metric averages. Read-only: it changes nothing.
 */
import type { Prisma } from '@prisma/client';
import type { DocumentStorage } from '@/lib/document-storage';
import { prisma } from '@/lib/prisma';
import { baciFlowsToTradeFlows } from '@/lib/demand-discovery-v5/baci-flows';
import { compareWithIndiaExports, riskExplanation, type CalibrationResult } from '@/lib/demand-discovery-v5/calibration';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { readProductFlows } from '@/lib/trade-datasets/service';

export type RunCalibrationReport = { run_id: string; run_status: string; baci_release_id: string } & CalibrationResult;

type CalibrationDb = Pick<Prisma.TransactionClient, 'discoveryRun' | 'marketAssessment' | 'tradeDatasetCountry' | 'tradeDatasetRelease' | 'tradeDatasetPartition'>;

/** `db` reads everything inside the caller's transaction (the Phase 1 gate's read-only snapshot); `storage` is where BACI partitions live. */
export async function compareRunWithIndiaExports(runId: string, top = 10, options: { db?: CalibrationDb; storage?: DocumentStorage } = {}): Promise<RunCalibrationReport> {
  if (!Number.isInteger(top) || top < 1 || top > 50) throw new Error('--top must be an integer from 1 to 50.');
  const db = options.db ?? prisma;
  const run = await db.discoveryRun.findUnique({ where: { id: runId }, select: { id: true, model_version: true, status: true, input_snapshot: true, frozen_inputs: true, scoring_policy_snapshot: true } });
  if (!run) throw new Error(`No discovery run ${runId}.`);
  if (run.model_version !== DEMAND_DISCOVERY_V5_MODEL) throw new Error(`Run ${runId} is not a v5 run.`);
  const hs6 = (run.input_snapshot as { hs_code?: string } | null)?.hs_code;
  const frozen = run.frozen_inputs as { baci?: { chosen_release_id?: string; base_years?: number[] } } | null;
  const releaseId = frozen?.baci?.chosen_release_id;
  const baseYears = frozen?.baci?.base_years ?? [];
  if (!hs6 || !releaseId || !baseYears.length) throw new Error(`Run ${runId} has not finished: no frozen BACI release or HS6.`);
  const averageYears = (run.scoring_policy_snapshot as { size?: { average_years?: number } } | null)?.size?.average_years ?? 3;
  const years = baseYears.slice(-averageYears);

  const [read, countries, assessments] = await Promise.all([
    readProductFlows({ release_id: releaseId, hs6, years, db, storage: options.storage }),
    db.tradeDatasetCountry.findMany({ where: { release_id: releaseId }, select: { provider_code: true, iso2: true } }),
    db.marketAssessment.findMany({ where: { run_id: run.id }, select: { country_code: true, market_status: true, rank: true, overall_score: true, reasons: true, score_breakdown: true, flag_reasons: true } }),
  ]);
  const flows = baciFlowsToTradeFlows(read.flows, countries).flows;
  const result = compareWithIndiaExports({
    hs6, flows, years, top,
    markets: assessments.map((row) => ({
      market: row.country_code, status: row.market_status ?? 'unknown', rank: row.rank, overall: row.overall_score,
      reasons: ((row.reasons ?? []) as { text?: string }[]).map((reason) => reason.text ?? '').filter(Boolean),
      explained_by: riskExplanation({ metrics: (row.score_breakdown as { metrics?: { key: string; inputs?: Record<string, unknown> }[] } | null)?.metrics, flag_reasons: (row.flag_reasons ?? []) as string[] }),
    })),
  });
  return { run_id: run.id, run_status: run.status, baci_release_id: releaseId, ...result };
}
