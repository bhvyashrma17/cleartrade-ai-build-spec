import { JobType } from '@prisma/client';
import { enqueueJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';
import { validateRuntimeEnvironment } from '@/lib/runtime-config';

async function main() {
  validateRuntimeEnvironment('scheduler');
  const dryRun = process.argv.includes('--dry-run');
  const day = new Date().toISOString().slice(0, 10);
  const job = await enqueueJob({ type: JobType.import_record_retention, payload: { dry_run: dryRun }, dedupe_key: `import-retention:${day}:${dryRun ? 'dry' : 'apply'}` });
  console.log(JSON.stringify({ job_id: job.id, dry_run: dryRun }));
}
main().finally(() => prisma.$disconnect());
