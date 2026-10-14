/**
 * The docs/36 §8 calibration check for one finished v5 run: the run's top 10 against India's own
 * largest export destinations for the product in the BACI release the run used, over the years the
 * market-size metric averages. Read-only: it changes nothing.
 *
 *   npx tsx --env-file=<staging operator env> scripts/dd5-compare-top10.ts --run=<discovery run id> [--top=10]
 *
 * Prints the comparison as JSON. `verdict: calibration_failure` means the run's top leaves out more
 * than half of India's top destinations; `missed` says what the run concluded about each one.
 */
import { prisma } from '@/lib/prisma';
import { baciFlowsToTradeFlows } from '@/lib/demand-discovery-v5/baci-flows';
import { compareWithIndiaExports } from '@/lib/demand-discovery-v5/calibration';
import { DEMAND_DISCOVERY_V5_MODEL } from '@/lib/demand-discovery-v5/policy';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import { readProductFlows } from '@/lib/trade-datasets/service';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();

async function main() {
  const database = validateDatabaseEnvironment('worker');
  const runId = arg('run');
  if (!runId) throw new Error('Missing --run=<discovery run id>.');
  const top = Number(arg('top') ?? 10);
  if (!Number.isInteger(top) || top < 1 || top > 50) throw new Error('--top must be an integer from 1 to 50.');

  const run = await prisma.discoveryRun.findUnique({ where: { id: runId }, select: { id: true, model_version: true, status: true, input_snapshot: true, frozen_inputs: true, scoring_policy_snapshot: true } });
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
    readProductFlows({ release_id: releaseId, hs6, years }),
    prisma.tradeDatasetCountry.findMany({ where: { release_id: releaseId }, select: { provider_code: true, iso2: true } }),
    prisma.marketAssessment.findMany({ where: { run_id: run.id }, select: { country_code: true, market_status: true, rank: true, overall_score: true, reasons: true } }),
  ]);
  const flows = baciFlowsToTradeFlows(read.flows, countries).flows;
  const result = compareWithIndiaExports({
    hs6, flows, years, top,
    markets: assessments.map((row) => ({
      market: row.country_code, status: row.market_status ?? 'unknown', rank: row.rank, overall: row.overall_score,
      reasons: ((row.reasons ?? []) as { text?: string }[]).map((reason) => reason.text ?? '').filter(Boolean),
    })),
  });
  console.log(JSON.stringify({ environment: database.environment, run_id: run.id, run_status: run.status, baci_release_id: releaseId, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
