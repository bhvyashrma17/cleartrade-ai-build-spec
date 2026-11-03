/**
 * Imports one reference dataset file (docs/36 §3.2): a World Bank WDI indicator, a UN Comtrade
 * data-availability listing, ECGC's short-term country risk list, CEPII GeoDist capitals, or
 * India's trade agreements.
 *
 * The database identity guard runs first, the file's sha256 must equal the one stated up front,
 * and the import runs twice — the second must be UNCHANGED.
 *
 * Publisher files (WDI, getDa) are downloaded by the operator and need --source-url and
 * --retrieved-at:
 *
 *   npx tsx --env-file=.env.staging scripts/import-reference-dataset.ts \
 *     --dataset=wdi:LP.LPI.OVRL.XQ --file=.artifacts/dd5/wdi-LP.LPI.OVRL.XQ.json --expect-sha256=<64 hex> \
 *     --source-url="https://api.worldbank.org/v2/country/all/indicator/LP.LPI.OVRL.XQ?format=json&per_page=20000&mrnev=1" \
 *     --retrieved-at=2026-10-13 --actor-email=ops@example.com
 *
 * Files checked into data/reference/ are imported from the repository root; their provenance —
 * for ECGC and GeoDist, the publisher's original PDF or Stata file — comes from
 * data/reference/manifest.json, matched on the file's sha256:
 *
 *   npx tsx --env-file=.env.staging scripts/import-reference-dataset.ts \
 *     --dataset=ecgc:country-risk:short-term --file=data/reference/ecgc-country-risk-st-2026-07-01.txt \
 *     --expect-sha256=<64 hex> --actor-email=ops@example.com
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OrgTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { manifestEntryFor, readReferenceManifest } from '@/lib/reference-datasets/manifest';
import { referenceDatasetDefinition } from '@/lib/reference-datasets/registry';
import { importReferenceDataset } from '@/lib/reference-datasets/service';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim() || undefined;

function required(name: string) {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  const database = validateDatabaseEnvironment('worker');
  const datasetKey = required('dataset');
  const definition = referenceDatasetDefinition(datasetKey);
  const bytes = readFileSync(required('file'));
  const expected = required('expect-sha256').toLowerCase();
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) throw new Error(`Refusing the file: sha256 ${actual} is not the expected ${expected}.`);

  // Provenance: a derived text must be listed in the manifest with the original it came from.
  const entry = manifestEntryFor(readReferenceManifest(), bytes);
  if (entry && entry.dataset_key !== definition.key) throw new Error(`The manifest lists this file as ${entry.dataset_key}, not ${definition.key}.`);
  if (definition.source_form === 'derived_from_publisher_file' && !entry?.derived_from) {
    throw new Error(`${definition.key} is read from a text form of the publisher's file. List the file in data/reference/manifest.json with the original it was derived from, then import it from there.`);
  }
  const derivedFrom = definition.source_form === 'derived_from_publisher_file' ? entry!.derived_from : null;
  const sourceUrl = arg('source-url') ?? derivedFrom?.url;
  if (!sourceUrl) throw new Error('Missing --source-url=... (only a derived file listed in the manifest can omit it).');
  const retrieved = arg('retrieved-at') ?? derivedFrom?.retrieved_at.slice(0, 10);
  if (!retrieved) throw new Error('Missing --retrieved-at=YYYY-MM-DD.');
  const retrievedAt = new Date(`${retrieved}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(retrieved) || Number.isNaN(retrievedAt.getTime())) throw new Error('--retrieved-at must be YYYY-MM-DD.');

  const user = await prisma.user.findUnique({ where: { email: required('actor-email').toLowerCase() } });
  if (!user) throw new Error('No ClearTrade user exists for that --actor-email.');
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };

  const runOnce = () => importReferenceDataset({
    actor, dataset_key: definition.key, bytes, source_url: sourceUrl, retrieved_at: retrievedAt, correlation_id: randomUUID(), derived_from: derivedFrom,
  });
  const first = await runOnce();
  const repeat = await runOnce();
  if (repeat.change !== 'UNCHANGED' || repeat.release_id !== first.release_id) throw new Error(`Repeat import was not idempotent (first ${first.release_id}, repeat ${repeat.release_id}).`);
  console.log(JSON.stringify({
    dataset: definition.key, environment: database.environment, database_fingerprint: database.database_fingerprint.slice(0, 12),
    file_sha256: actual, derived_from: derivedFrom ? { url: derivedFrom.url, sha256: derivedFrom.sha256 } : null,
    release_id: first.release_id, change: first.change, version: first.version, row_count: first.row_count,
    repeat_import: { release_id: repeat.release_id, change: repeat.change },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
