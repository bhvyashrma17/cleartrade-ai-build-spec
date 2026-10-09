/**
 * Imports one RETAINED official authority artifact through its family's canonical importer.
 *
 * `ingest-authority-release.ts` acquires live for the families it supports. This command covers
 * the families whose qualified artifact already exists as retained bytes — the EU TARIC extraction
 * (downloaded from CIRCABC, never acquired by code), a New Zealand CusMod archive, and the
 * locally qualified packs whose acquisition is long-running or whose currentness gates would make
 * a fresh acquisition a different subject from the one that was qualified.
 *
 * It adds nothing to the import itself: parsing, retention in object storage, change detection,
 * the bulk-qualification gate and the audit trail are all the family's own `import*Release`. What
 * it adds is the operator discipline around it:
 *
 *  - `--expect-sha256` is mandatory. The bytes on disk must be the exact artifact the qualification
 *    record names; a different file is a different subject and is refused before anything runs.
 *  - The database identity guard runs first, so a mis-pointed environment fails before any write.
 *  - The import runs twice. The second call must resolve to the same release as UNCHANGED —
 *    idempotent re-ingest is part of acceptance, not an assumption.
 *  - A bulk-qualified family (EU_TARIC, NZ) is never activated here. It is imported, then measured
 *    with `qualify-bulk-release.ts`, then activated with `activate-authority-release.ts`.
 *
 *   npx tsx --env-file=.env.staging scripts/import-retained-authority-release.ts \
 *     --family=QA --file=.artifacts/customs-atlas/qatar/qatar-authority-bundle.zip \
 *     --expect-sha256=<64 hex> --release=2026-09-23 \
 *     --source-url=https://www.customs.gov.qa/Arabic/Tariff/Pages/default.aspx \
 *     --actor-email=ops@example.com --activate
 *
 *   npx tsx --env-file=.env.staging scripts/import-retained-authority-release.ts \
 *     --family=EU_TARIC --file=/path/to/extraction.zip --expect-sha256=<64 hex> \
 *     --reference-month=2026-09 --actor-email=ops@example.com
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { OrgTier } from '@prisma/client';
import { requiresBulkQualification } from '@/lib/market-access/bulk-release-gate';
import { importTaricRelease } from '@/lib/market-access/taric/service';
import { importNzRelease } from '@/lib/market-access/providers/nz-service';
import { importIndonesiaRelease } from '@/lib/market-access/providers/indonesia-service';
import { importSaudiRelease } from '@/lib/market-access/providers/saudi-service';
import { importQatarRelease } from '@/lib/market-access/providers/qatar-service';
import { importKuwaitRelease } from '@/lib/market-access/providers/kuwait-service';
import { importUzbekistanRelease } from '@/lib/market-access/providers/uzbekistan-service';
import { importVietnamRelease } from '@/lib/market-access/providers/vietnam-service';
import { importMoroccoRelease } from '@/lib/market-access/providers/morocco-service';
import { importTunisiaRelease } from '@/lib/market-access/providers/tunisia-service';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';
import type { Principal } from '@/types';

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

function required(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

function utcDate(value: string, name: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime())) throw new Error(`--${name} must be YYYY-MM-DD.`);
  return date;
}

interface DatedImport {
  actor: Principal;
  bytes: Buffer;
  release_identifier: string;
  reference_date: Date;
  retrieved_at: Date;
  source_url: string;
  activate: boolean;
  correlation_id: string;
}

type ImportResult = Awaited<ReturnType<typeof importNzRelease>>;

/** Family code -> canonical importer and the source family it writes, for the bulk-gate lookup. */
const DATED_FAMILIES: Record<string, { source_family: string; run: (args: DatedImport) => Promise<ImportResult> }> = {
  NZ: { source_family: 'NZ_CUSTOMS', run: importNzRelease },
  ID: { source_family: 'ID_KEMENKEU_BTKI', run: importIndonesiaRelease },
  SA: { source_family: 'SA_ZATCA_INTEGRATED', run: importSaudiRelease },
  QA: { source_family: 'QA_CUSTOMS_INTEGRATED', run: importQatarRelease },
  KW: { source_family: 'KW_CUSTOMS_INTEGRATED', run: importKuwaitRelease },
  UZ: { source_family: 'UZ_LEX_CUSTOMS_TARIFF', run: importUzbekistanRelease },
  VN: { source_family: 'VN_CONGBAO_CUSTOMS_TARIFF', run: importVietnamRelease },
  MA: { source_family: 'MA_ADII_CUSTOMS_TARIFF', run: importMoroccoRelease },
  TN: { source_family: 'TN_DOUANE_TARIFWEB', run: importTunisiaRelease },
};

async function main() {
  const database = validateDatabaseEnvironment('worker');
  const family = required('family').toUpperCase();
  if (family !== 'EU_TARIC' && !DATED_FAMILIES[family]) {
    throw new Error(`Unsupported --family=${family}. Supported: EU_TARIC, ${Object.keys(DATED_FAMILIES).join(', ')}.`);
  }

  const filePath = required('file');
  const expected = required('expect-sha256').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('--expect-sha256 must be a full SHA-256 hex digest.');
  const bytes = readFileSync(filePath);
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expected) {
    throw new Error(`Refusing ${filePath}: SHA-256 ${actual} is not the qualified artifact ${expected}.`);
  }

  const actorEmail = required('actor-email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!user) throw new Error(`No ClearTrade user exists for ${actorEmail}.`);
  const actor: Principal = {
    id: user.id, email: user.email, name: user.name ?? '', role: user.role,
    exporter_org_id: user.exporter_org_id, tier: OrgTier.paid,
  };

  const sourceFamily = family === 'EU_TARIC' ? 'EU_TARIC' : DATED_FAMILIES[family]!.source_family;
  const gated = requiresBulkQualification(sourceFamily);
  const activate = flag('activate');
  if (activate && gated) {
    throw new Error(`${sourceFamily} requires a real-archive qualification before activation. Import without --activate, run qualify-bulk-release.ts, then activate-authority-release.ts.`);
  }

  const runOnce = () => {
    const correlation_id = randomUUID();
    if (family === 'EU_TARIC') {
      return importTaricRelease({ actor, bytes, reference_month: required('reference-month'), activate, correlation_id });
    }
    const release = required('release');
    return DATED_FAMILIES[family]!.run({
      actor, bytes, activate, correlation_id,
      release_identifier: release,
      reference_date: utcDate(arg('reference-date') ?? release, 'reference-date'),
      // A retained artifact was retrieved when it was acquired, not when it is imported.
      retrieved_at: utcDate(arg('retrieved-at') ?? release, 'retrieved-at'),
      source_url: required('source-url'),
    });
  };

  const first = await runOnce();
  const repeat = await runOnce();
  if (repeat.release.id !== first.release.id || repeat.created || repeat.change !== 'UNCHANGED') {
    throw new Error(`${family} repeat import was not idempotent (first ${first.release.id}, repeat ${repeat.release.id}, change ${repeat.change}).`);
  }

  console.log(JSON.stringify({
    family,
    source_family: sourceFamily,
    environment: database.environment,
    database_fingerprint: database.database_fingerprint.slice(0, 12),
    file_sha256: actual,
    release_id: first.release.id,
    release_identifier: first.release.release_identifier,
    status: first.release.status,
    created: first.created,
    change: first.change,
    repeat_import: { release_id: repeat.release.id, created: repeat.created, change: repeat.change },
    artifact_object_key: first.release.artifact_object_key,
    bulk_qualification_required: gated,
    next_step: gated && first.release.status !== 'active'
      ? `npx tsx scripts/qualify-bulk-release.ts --family=${sourceFamily} --release-id=${first.release.id}, then activate-authority-release.ts --release-id=${first.release.id}`
      : null,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
