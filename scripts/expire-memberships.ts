/**
 * Downgrade tenants whose membership clock has run out.
 *
 *   npm run memberships:expire            (local, reads .env.local)
 *   npm run memberships:expire:platform   (Railway, reads platform Variables)
 *
 * The worker runs this same sweep on a cadence (`scripts/worker.ts`), so this script is
 * the manual/ops handle rather than the primary schedule — for a one-off reconciliation,
 * or for an environment running the web service without a worker.
 *
 * Idempotent and safe to run concurrently with the worker's own sweep: an org already at
 * `free` is not selected, and each downgrade is a single transaction.
 */

import { expireLapsedMemberships } from '../src/lib/billing/subscription-service';
import { prisma } from '../src/lib/prisma';

async function main() {
  const result = await expireLapsedMemberships({ correlationId: `expire-memberships:${Date.now()}` });
  if (result.downgraded.length === 0) {
    console.log('No memberships have lapsed.');
    return;
  }
  console.log(`Downgraded ${result.downgraded.length} lapsed membership(s) to free tier.`);
  // Ids only — this runs in deployment logs, and there is nothing here worth printing
  // beyond what an operator needs to look a tenant up.
  for (const id of result.downgraded) console.log(`  ${id}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
