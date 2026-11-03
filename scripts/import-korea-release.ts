/**
 * Imports one Korea Customs Service tariff release as a manual authoritative AuthorityRelease.
 *
 * Unlike Norway (data.toll.no CKAN API) or NZ/Canada (fetched bulk archives), this acquisition
 * route is a manual upload: the data.go.kr/odcloud REST API for dataset 15051179 is documented and
 * rights-cleared (KOGL Type 1) but requires a service key (`KCS_DATA_GO_KR_SERVICE_KEY`) that has
 * not been provisioned. Rather than block on that credential, this script imports the SAME
 * dataset's official XLSX download, retrieved by hand from data.go.kr and passed in by local path.
 * When the API credential is later provisioned, it becomes an additional, automatable acquisition
 * route for this same source family — see korea-acquisition.ts and korea-service.ts's module
 * comment.
 *
 * Korea is a bulk-archive family (BULK_QUALIFICATION_REQUIRED.KR_KCS = true), so this deliberately
 * imports WITHOUT activating: import -> `scripts/qualify-bulk-release.ts --family=KR_KCS` ->
 * activate.
 *
 *   npx tsx scripts/import-korea-release.ts --actor-email=ops@example.com \
 *     --file="/path/to/관세청_품목번호별 관세율표_20260211.xlsx" --release=2026-02-11
 *   npx tsx scripts/import-korea-release.ts --actor-email=... --file=... --release=... --activate
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OrgTier } from '@prisma/client';
import { importKoreaRelease } from '@/lib/market-access/providers/korea-service';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

async function main() {
  const actorEmail = required('actor-email').toLowerCase();
  const filePath = required('file');
  const releaseIdentifier = required('release');
  const referenceDate = new Date(`${arg('reference-date') ?? releaseIdentifier}T00:00:00.000Z`);
  if (Number.isNaN(referenceDate.getTime())) throw new Error('--reference-date must be YYYY-MM-DD.');

  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id, email: user.email, name: user.name ?? '', role: user.role,
    exporter_org_id: user.exporter_org_id, tier: OrgTier.paid,
  };

  const bytes = readFileSync(filePath);
  console.log(`Read ${filePath}: ${bytes.length} bytes.`);

  const imported = await importKoreaRelease({
    actor,
    bytes,
    release_identifier: releaseIdentifier,
    reference_date: referenceDate,
    source_url: 'https://www.data.go.kr/data/15051179/fileData.do',
    activate: flag('activate'),
    acknowledge_unqualified: flag('acknowledge-unqualified'),
    correlation_id: randomUUID(),
  });

  console.log(JSON.stringify({
    release_id: imported.release.id,
    release_identifier: imported.release.release_identifier,
    checksum: imported.release.checksum,
    size_bytes: imported.release.size_bytes,
    status: imported.release.status,
    created: imported.created,
    change: imported.change,
    validation: imported.release.validation,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
