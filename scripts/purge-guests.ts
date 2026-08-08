/**
 * Guest retention sweep. Run on a schedule (daily is ample for a 30-day window).
 *
 *   npm run purge:guests -- --dry-run
 */
import { purgeExpiredGuests } from '../src/lib/guest-purge';
import { prisma } from '../src/lib/prisma';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const result = await purgeExpiredGuests({ dryRun });
  console.log(dryRun ? 'DRY RUN — nothing deleted' : 'Purge complete');
  console.log(`  guest orgs ${dryRun ? 'eligible' : 'deleted'}: ${result.orgs_deleted}`);
  console.log(`  quota rows ${dryRun ? 'eligible' : 'deleted'}: ${result.quota_rows_deleted}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
