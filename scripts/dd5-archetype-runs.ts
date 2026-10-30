/**
 * Demand Discovery v5 archetype runs on staging (D-003; docs/36 §10 step 7).
 *
 *   npx tsx --env-file=<staging operator env> scripts/dd5-archetype-runs.ts start --actor-email=<agent, ops supervisor or admin> [--rerun] [--set=archetypes|calibration]
 *   npx tsx --env-file=<staging operator env> scripts/dd5-archetype-runs.ts status [--top=10] [--no-compare] [--set=archetypes|calibration]
 *
 * `start` creates or reuses the paid test exporter "[TEST] DD5 archetypes" (a 90-day manual membership
 * granted by the named account) and one product per code in the set, then confirms each HS code as that
 * account, through the portal's own services: the confirmation is audited and starts v5. Repeating it
 * changes nothing once each code has a run; `--rerun` starts a fresh run for each.
 *
 * Sets: `archetypes` (the default) is the Phase 1 gate's three (rice 100630, brassware 741810, carpets
 * 570110); `calibration` is stage 1, item 6: those three and fifteen more (`calibration-set.ts`).
 *
 * `status` shows each product's newest v5 run and, once it has finished: markets by status, how each
 * market's duty was found (official, a customs union's common tariff, agent-read, published rule,
 * estimate, none), the top 10, and the top 10 compared with India's real export destinations
 * (`scripts/dd5-compare-top10.ts --run=<id>` prints that comparison in full); then, across the set, how
 * many products pass that comparison, the median overlap and each failure.
 *
 * Refuses production. Prints no secrets.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { archetypeRunStatus, PRODUCT_SETS, startArchetypeRuns, type ProductSetKey } from '@/lib/demand-discovery-v5/archetype-runs';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const flag = (name: string) => process.argv.includes(`--${name}`);
const USAGE = 'Usage: dd5-archetype-runs.ts start --actor-email=<agent, ops supervisor or admin> [--rerun] [--set=archetypes|calibration] | status [--top=10] [--no-compare] [--set=archetypes|calibration]';

function productSet(): ProductSetKey {
  const value = arg('set') ?? 'archetypes';
  if (!Object.hasOwn(PRODUCT_SETS, value)) throw new Error(`--set must be one of: ${Object.keys(PRODUCT_SETS).join(', ')}.`);
  return value as ProductSetKey;
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') {
    throw new Error('dd5-archetype-runs refuses production: the archetype runs are staging evidence (D-003).');
  }
  const command = process.argv[2];
  const header = { environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12) };

  if (command === 'start') {
    const email = arg('actor-email')?.toLowerCase();
    if (!email) throw new Error(`Missing --actor-email. ${USAGE}`);
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No ClearTrade user exists for ${email}.`);
    const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
    const set = productSet();
    const result = await startArchetypeRuns({ actor, correlation_id: randomUUID(), rerun: flag('rerun'), set });
    console.log(JSON.stringify({ ...header, set, ...result, next: `Wait for the runs, then: scripts/dd5-archetype-runs.ts status --set=${set}` }, null, 2));
    return;
  }
  if (command === 'status') {
    const top = Number(arg('top') ?? 10);
    if (!Number.isInteger(top) || top < 1 || top > 50) throw new Error('--top must be an integer from 1 to 50.');
    const result = await archetypeRunStatus({ top, compare: !flag('no-compare'), set: productSet() });
    console.log(JSON.stringify({ ...header, ...result }, null, 2));
    return;
  }
  throw new Error(USAGE);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
