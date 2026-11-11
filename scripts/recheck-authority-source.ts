/**
 * E-069 — the yearly re-check of a tariff source with no publishing rhythm (GCC, the UEMOA edition
 * of the ECOWAS tariff, and the other sources docs/37 lists as "re-checked yearly").
 *
 * Fetch the source's official files as they are published today (the URLs are in the release's
 * manifest, printed by --list), then:
 *
 *   npx tsx --env-file=<env> scripts/recheck-authority-source.ts --source-family=GCC_UNIFIED_TARIFF --list
 *   npx tsx --env-file=<env> scripts/recheck-authority-source.ts --source-family=GCC_UNIFIED_TARIFF \
 *     --file=IntegratedCustomsTariff.pdf --file=Schedule-of-UAE.pdf --actor-email=<ops supervisor or admin> \
 *     [--checked-on=YYYY-MM-DD] [--release-id=<id>]
 *
 * Every file is compared with the active release's own, byte for byte (SHA-256). All the same: the
 * re-check is recorded on the release (an audit event) and its next re-check falls a year later.
 * Any different, or any official file not supplied: nothing is recorded, the files are named, and
 * the new edition is imported the usual way. Checks the database identity first; prints no secrets.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { AuthorityReleaseStatus, OrgTier } from '@prisma/client';
import { compareWithRelease, officialFiles, recordSourceRecheck } from '@/lib/market-access/source-recheck';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3)?.trim();
const args = (name: string) => process.argv.filter((value) => value.startsWith(`--${name}=`)).map((value) => value.slice(name.length + 3).trim()).filter(Boolean);
const flag = (name: string) => process.argv.includes(`--${name}`);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function required(name: string) {
  const value = arg(name);
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  validateDatabaseEnvironment('worker');
  const sourceFamily = required('source-family');
  const releaseId = arg('release-id');
  const active = await prisma.authorityRelease.findMany({
    where: { source_family: sourceFamily, status: AuthorityReleaseStatus.active, ...(releaseId ? { id: releaseId } : {}) },
    select: { id: true, authority: true, release_identifier: true, reference_date: true, file_manifest: true },
  });
  if (!active.length) throw new Error(`No active ${sourceFamily} release${releaseId ? ` ${releaseId}` : ''}.`);
  if (active.length > 1) throw new Error(`${active.length} active ${sourceFamily} releases (one per authority); pass --release-id=<id>: ${active.map((release) => `${release.id} (${release.authority})`).join(', ')}.`);
  const release = active[0]!;
  const official = officialFiles(release.file_manifest);

  if (flag('list')) {
    print({ release_id: release.id, release_identifier: release.release_identifier, edition_date: release.reference_date.toISOString().slice(0, 10), fetch_these: official.map((file) => ({ name: file.name, url: file.url ?? null, sha256: file.sha256 })) });
    return;
  }

  const files = args('file');
  if (!files.length) throw new Error('Pass each official file fetched today with --file=<path> (see --list).');
  const fetched = files.map((path) => ({ file: basename(path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }));
  const outcome = compareWithRelease(official, fetched);
  if (outcome.status === 'changed') {
    print({ release_identifier: release.release_identifier, outcome: 'changed or incomplete — nothing recorded', differing: outcome.differing, not_supplied: outcome.not_supplied });
    process.exitCode = 1;
    return;
  }

  const actorEmail = required('actor-email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = { id: user.id, email: user.email, name: user.name ?? '', role: user.role, exporter_org_id: user.exporter_org_id, tier: OrgTier.paid };
  const checkedOn = arg('checked-on') ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(checkedOn)) throw new Error('--checked-on must be YYYY-MM-DD.');
  await recordSourceRecheck({ actor, release_id: release.id, checked_on: new Date(`${checkedOn}T00:00:00.000Z`), files: outcome.files, correlation_id: randomUUID() });
  print({ release_identifier: release.release_identifier, outcome: 'unchanged — re-check recorded', checked_on: checkedOn, files: outcome.files });
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
