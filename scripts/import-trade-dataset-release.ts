/**
 * Imports one retained bulk trade dataset archive (docs/36 §3.1). Today: CEPII BACI.
 *
 * The archive is downloaded by the operator (the agent session cannot reach cepii.fr), and its
 * sha256 is stated up front. The database identity guard runs first, so a mis-pointed environment
 * fails before any write. The import runs twice; the second run must resolve to UNCHANGED.
 *
 *   npx tsx --env-file=.env.staging scripts/import-trade-dataset-release.ts \
 *     --file=.artifacts/dd5/BACI_HS17_V202601.zip --expect-sha256=<64 hex> \
 *     --version=V202601 --hs-revision=HS17 \
 *     --source-url=https://www.cepii.fr/DATA_DOWNLOAD/baci/data/BACI_HS17_V202601.zip \
 *     --retrieved-at=2026-10-13 --actor-email=ops@example.com
 *
 * To clear an import that died mid-way: `--abandon=<release id> --reason="..." --actor-email=...`.
 */
import { randomUUID } from 'node:crypto';
import { OrgTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import { BACI_HS_REVISIONS, BACI_PROVIDER, type BaciHsRevision } from '@/lib/trade-datasets/baci';
import { abandonTradeDatasetImport, importTradeDatasetRelease } from '@/lib/trade-datasets/service';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function actorFor(email: string): Promise<Principal> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) throw new Error(`No ClearTrade user exists for ${email}.`);
  return { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  const actor = await actorFor(required('actor-email'));

  const abandon = arg('abandon');
  if (abandon) {
    await abandonTradeDatasetImport({ actor, release_id: abandon, reason: required('reason'), correlation_id: randomUUID() });
    console.log(JSON.stringify({ abandoned: abandon, environment: database.environment }));
    return;
  }

  const revision = required('hs-revision').toUpperCase();
  if (!(BACI_HS_REVISIONS as readonly string[]).includes(revision)) throw new Error(`--hs-revision must be one of ${BACI_HS_REVISIONS.join(', ')}.`);
  const retrieved = required('retrieved-at');
  const retrievedAt = new Date(`${retrieved}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrieved) || Number.isNaN(retrievedAt.getTime())) throw new Error('--retrieved-at must be YYYY-MM-DD.');

  const runOnce = () => importTradeDatasetRelease({
    actor,
    file_path: required('file'),
    expect_sha256: required('expect-sha256'),
    provider: BACI_PROVIDER,
    dataset_version: required('version'),
    hs_revision: revision as BaciHsRevision,
    source_url: required('source-url'),
    retrieved_at: retrievedAt,
    correlation_id: randomUUID(),
    log: (message) => console.error(message),
  });

  const started = Date.now();
  const first = await runOnce();
  const repeat = await runOnce();
  if (repeat.change !== 'UNCHANGED' || repeat.release_id !== first.release_id) {
    throw new Error(`Repeat import was not idempotent (first ${first.release_id}, repeat ${repeat.release_id}, change ${repeat.change}).`);
  }
  console.log(JSON.stringify({
    provider: BACI_PROVIDER,
    hs_revision: revision,
    environment: database.environment,
    database_fingerprint: database.database_fingerprint.slice(0, 12),
    release_id: first.release_id,
    change: first.change,
    row_count: first.row_count,
    partition_count: first.partition_count,
    repeat_import: { release_id: repeat.release_id, change: repeat.change },
    seconds: Math.round((Date.now() - started) / 1000),
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
