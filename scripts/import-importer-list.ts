/**
 * Import an official importer list (D-033, docs/38 §2) from files on the operator's machine.
 *
 *   npx tsx --env-file=<staging operator env> scripts/import-importer-list.ts --source=uk_hmrc_importers --file=<importersYYMM.zip> --source-url=<the file's URL on uktradeinfo.com> --retrieved-at=<YYYY-MM-DD> --actor-email=<ops supervisor or admin> [--expect-sha256=<sha256 of the file>]
 *
 * Prints the release, its period and counts, and whether it was NEW or UNCHANGED. Importing the same
 * bytes again changes nothing; a new file for a month already imported supersedes that month.
 * Refuses production. Prints no personal data beyond counts.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { OrgTier } from '@prisma/client';
import { importImporterList } from '@/lib/buyer-discovery/importer-list-service';
import { fileManifest, IMPORTER_LIST_SOURCES, type ImporterListSourceKey } from '@/lib/buyer-discovery/importer-lists';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const values = (name: string) => process.argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3).trim());
const one = (name: string) => { const found = values(name); if (found.length !== 1) throw new Error(`Give --${name}=... once.`); return found[0]!; };

async function main() {
  const database = validateDatabaseEnvironment('worker');
  if (database.environment === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') throw new Error('import-importer-list refuses production.');
  const sourceKey = one('source') as ImporterListSourceKey;
  if (!IMPORTER_LIST_SOURCES[sourceKey]) throw new Error(`Unknown --source=${sourceKey}. Use ${Object.keys(IMPORTER_LIST_SOURCES).join(', ')}.`);
  const files = values('file').map((path) => ({ name: basename(path), bytes: readFileSync(path) }));
  if (files.length === 0) throw new Error('Give at least one --file=...');
  const expected = values('expect-sha256')[0];
  if (expected && files.length === 1) {
    const actual = fileManifest(files).items[0]!.sha256;
    if (actual !== expected.toLowerCase()) throw new Error(`${files[0]!.name} has SHA-256 ${actual}, not the expected ${expected}.`);
  }
  const retrievedAt = new Date(`${one('retrieved-at')}T00:00:00Z`);
  if (Number.isNaN(retrievedAt.getTime())) throw new Error('--retrieved-at must be YYYY-MM-DD.');
  const email = one('actor-email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No ClearTrade user exists for ${email}.`);
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
  const result = await importImporterList({ actor, source_key: sourceKey, files, source_url: one('source-url'), retrieved_at: retrievedAt, correlation_id: randomUUID() });
  console.log(JSON.stringify({ environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12), source: sourceKey, files: fileManifest(files).items, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
