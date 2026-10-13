/**
 * Imports one reference dataset file (docs/36 §3.2): a World Bank WDI indicator, a UN Comtrade
 * data-availability listing, and later ECGC ratings, CEPII coordinates and India's agreements.
 *
 * The file is downloaded by the operator; its sha256 is stated up front, the database identity
 * guard runs first, and the import runs twice — the second must be UNCHANGED.
 *
 *   npx tsx --env-file=.env.staging scripts/import-reference-dataset.ts \
 *     --dataset=wdi:LP.LPI.OVRL.XQ --file=.artifacts/dd5/wdi-LP.LPI.OVRL.XQ.json --expect-sha256=<64 hex> \
 *     --source-url="https://api.worldbank.org/v2/country/all/indicator/LP.LPI.OVRL.XQ?format=json&per_page=20000&mrnev=1" \
 *     --retrieved-at=2026-10-13 --actor-email=ops@example.com
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OrgTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { importReferenceDataset } from '@/lib/reference-datasets/service';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  const user = await prisma.user.findUnique({ where: { email: required('actor-email').toLowerCase() } });
  if (!user) throw new Error('No ClearTrade user exists for that --actor-email.');
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };

  const bytes = readFileSync(required('file'));
  const expected = required('expect-sha256').toLowerCase();
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`Refusing the file: sha256 ${actual} is not the expected ${expected}.`);
  const retrieved = required('retrieved-at');
  const retrievedAt = new Date(`${retrieved}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrieved) || Number.isNaN(retrievedAt.getTime())) throw new Error('--retrieved-at must be YYYY-MM-DD.');

  const runOnce = () => importReferenceDataset({
    actor, dataset_key: required('dataset'), bytes, source_url: required('source-url'), retrieved_at: retrievedAt, correlation_id: randomUUID(),
  });
  const first = await runOnce();
  const repeat = await runOnce();
  if (repeat.change !== 'UNCHANGED' || repeat.release_id !== first.release_id) throw new Error(`Repeat import was not idempotent (first ${first.release_id}, repeat ${repeat.release_id}).`);
  console.log(JSON.stringify({
    dataset: required('dataset'), environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12),
    file_sha256: actual, release_id: first.release_id, change: first.change, version: first.version, row_count: first.row_count,
    repeat_import: { release_id: repeat.release_id, change: repeat.change },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
