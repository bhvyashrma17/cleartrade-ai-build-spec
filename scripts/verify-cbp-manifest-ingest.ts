import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { IngestStatus, JobType, Prisma, TradeDataSource } from '@prisma/client';
import { registerAllJobHandlers } from '@/lib/job-handlers';
import { assertImportRecordUse, ImportRecordRightsError } from '@/lib/import-record-rights';
import { claimNextJob, enqueueJob, runClaimedJob } from '@/lib/jobs';
import { prisma } from '@/lib/prisma';

const ids = ['verify-cbp-001', 'verify-cbp-002', 'verify-cbp-003'];
const file_path = path.resolve('tests/fixtures/cbp-manifest/records.ndjson');
const license_file_path = path.resolve('tests/fixtures/cbp-manifest/license.json');

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

async function execute(payload: Record<string, unknown>) {
  const job = await enqueueJob({ type: JobType.cbp_manifest_ingest, payload: payload as Prisma.InputJsonValue, dedupe_key: `verify-cbp:${crypto.randomUUID()}` });
  const claimed = await claimNextJob([JobType.cbp_manifest_ingest]);
  check(claimed?.id === job.id, 'CBP job is claimed by its registered worker handler');
  await runClaimedJob(claimed);
  return prisma.job.findUniqueOrThrow({ where: { id: job.id } });
}

async function routeFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? routeFiles(path.join(root, entry.name)) : [path.join(root, entry.name)]));
  return nested.flat();
}

async function main() {
  process.env.IMPORT_BUYER_REF_SECRET = 'verification-only-secret';
  registerAllJobHandlers();
  await prisma.importRecord.deleteMany({ where: { source_record_id: { in: ids } } });

  const first = await execute({ file_path, license_file_path, batch_size: 1, record_budget: 1 });
  const firstResult = first.result as { ingest_run_id: string };
  const partial = await prisma.ingestRun.findUniqueOrThrow({ where: { id: firstResult.ingest_run_id } });
  check(partial.status === IngestStatus.partial && partial.records_processed === 1, 'record-budget stop persists an exact resumable offset');

  await execute({ file_path, license_file_path, ingest_run_id: partial.id, batch_size: 1 });
  const resumed = await prisma.ingestRun.findUniqueOrThrow({ where: { id: partial.id } });
  check(resumed.status === IngestStatus.completed && resumed.records_processed === 3, 'interrupted ingest resumes the same IngestRun and completes');
  const rows = await prisma.importRecord.findMany({ where: { source_record_id: { in: ids } }, orderBy: { source_record_id: 'asc' } });
  check(rows.length === 3, 'three real database ImportRecord rows were written');
  check(rows[0].quantity?.toString() === '20' && rows[0].quantity_unit === 'CTN', 'manifest quantity retains its package unit');
  check(rows[1].quantity === null && rows[1].quantity_unit === null, 'zero quantity is stored as unavailable with no orphan unit');
  check(rows[2].quantity === null && rows[2].value?.toString() === '123.45', 'missing quantity remains null without inventing a value');
  check(rows.every((row) => row.source_provider && row.license_type && row.allowed_to_cache && row.personal_data_flag), 'mandatory licensing metadata is present on every row');

  let denied = false;
  try { assertImportRecordUse(rows[0], 'display'); } catch (error) { denied = error instanceof ImportRecordRightsError; }
  check(denied, 'row-level rights prevent unlicensed display');

  await execute({ file_path, license_file_path, batch_size: 2 });
  check(await prisma.importRecord.count({ where: { source_record_id: { in: ids } } }) === 3, 'full replay is idempotent by source_record_id');

  const routeRoot = path.resolve('src/app/api');
  const offenders = [];
  for (const file of await routeFiles(routeRoot)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    if ((await readFile(file, 'utf8')).includes('importRecord')) offenders.push(path.relative(routeRoot, file));
  }
  check(offenders.length === 0, 'no API route references or returns raw ImportRecord rows');
  check(rows.every((row) => row.source === TradeDataSource.cbp_vessel_manifest), 'all records preserve source provenance');
}

main().finally(() => prisma.$disconnect());
