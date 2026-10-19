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
import { compareRunWithIndiaExports } from '@/lib/demand-discovery-v5/calibration-report';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();

async function main() {
  const database = validateDatabaseEnvironment('worker');
  const runId = arg('run');
  if (!runId) throw new Error('Missing --run=<discovery run id>.');
  const report = await compareRunWithIndiaExports(runId, Number(arg('top') ?? 10));
  console.log(JSON.stringify({ environment: database.environment, ...report }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
