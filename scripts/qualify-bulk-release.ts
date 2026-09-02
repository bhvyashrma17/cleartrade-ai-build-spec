/**
 * Real-archive operational qualification against RETAINED authority releases.
 *
 * The sibling command `qualify-bulk-adapters.ts` measures a decode by downloading the authority's
 * archive from its public URL. That works for sources distributed as a single file (NZ, Japan) but
 * cannot reach Canada, whose release is a composite assembled at acquisition time from two CBSA
 * endpoints. This command closes that hole by measuring the bytes ClearTrade actually retained and
 * actually serves — which is a strictly more faithful subject than a fresh download, because it is
 * the exact artifact the worker decodes at query time, checksum-verified on load.
 *
 * It also records the result, so qualification stops being something a person has to remember to
 * run: `AuthorityReleaseQualification` rows are what `bulk-release-gate.ts` reads when deciding
 * whether a release is operationally trusted.
 *
 *   railway run npx tsx scripts/qualify-bulk-release.ts --family=CA_CBSA
 *   railway run npx tsx scripts/qualify-bulk-release.ts --all
 *   railway run npx tsx scripts/qualify-bulk-release.ts --all --concurrency=2
 *
 * Requires database and object-storage access, so it runs against staging via `railway run`.
 * Exit code 1 if any measured release FAILS its ceiling.
 */
import {
  formatBulkQualification,
  gradeBulkQualification,
  measureBulkDecode,
  type BulkQualificationResult,
} from '@/lib/market-access/bulk-operational-qualification';
import { loadAuthorityReleaseArtifact } from '@/lib/market-access/authority-releases';
import { readCanadaAuthorityBundle } from '@/lib/market-access/providers/canada-bundle';
import { readJapanAuthorityBundle } from '@/lib/market-access/providers/japan-bundle';
import { readNzAuthorityBundle } from '@/lib/market-access/providers/nz-bundle';
import { recordReleaseQualification } from '@/lib/market-access/bulk-release-gate';
import { prisma } from '@/lib/prisma';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

interface Subject {
  release_id: string;
  family: string;
  release_identifier: string;
  authority: string;
  parser_version: string;
  checksum: string;
  decode: (bytes: Buffer) => Promise<{ rows: number; decompressed: number | null }>;
}

/**
 * Decoders are keyed by source family so a new bulk adapter registers here and nowhere else.
 * Each returns the two figures the gate needs beyond memory: how many rows the reader produced,
 * and how large the materialised source was after any decompression.
 */
const DECODERS: Record<string, (bytes: Buffer, release: { release_identifier: string; source_url: string }) => Promise<{ rows: number; decompressed: number | null }>> = {
  CA_CBSA: async (bytes) => {
    const bundle = await readCanadaAuthorityBundle(bytes);
    // Canada's materialised size is the Access database inside the retained composite, not the
    // compressed bundle: that decompressed .accdb is what actually has to be held to be read.
    const accdb = bundle.files.find((f) => f.role === 'official_access_database');
    return { rows: bundle.rows.length, decompressed: accdb?.size_bytes ?? null };
  },
  NZ_CUSTOMS: async (bytes, release) => {
    const bundle = readNzAuthorityBundle({
      bytes, release_identifier: release.release_identifier, tariff_archive_url: release.source_url,
    });
    return {
      rows: bundle.details.length + bundle.rates.length,
      decompressed: bundle.files.reduce((sum, f) => sum + f.size_bytes, 0),
    };
  },
  JP_CUSTOMS: async (bytes, release) => {
    const [label, chapter] = release.release_identifier.split('-ch');
    const bundle = readJapanAuthorityBundle({
      bytes, chapter: chapter ?? '', effective_date_label: label ?? '', source_url: release.source_url,
    });
    return { rows: bundle.rows.length, decompressed: null };
  },
};

async function subjectsFor(families: string[]): Promise<Subject[]> {
  const subjects: Subject[] = [];
  for (const family of families) {
    if (!DECODERS[family]) throw new Error(`No bulk decoder registered for source family ${family}.`);
    // Largest active release per family is the worst case, which is what a ceiling should be set by.
    const releases = await prisma.authorityRelease.findMany({
      where: { source_family: family, status: 'active' },
      orderBy: { size_bytes: 'desc' },
      take: 1,
    });
    for (const release of releases) {
      subjects.push({
        release_id: release.id,
        family,
        release_identifier: release.release_identifier,
        authority: release.authority,
        parser_version: release.parser_version,
        checksum: release.checksum,
        decode: (bytes) => DECODERS[family]!(bytes, { release_identifier: release.release_identifier, source_url: release.source_url }),
      });
    }
  }
  return subjects;
}

async function qualifyOne(subject: Subject): Promise<BulkQualificationResult> {
  const loaded = await loadAuthorityReleaseArtifact(subject.release_id);
  const label = `${subject.family} ${subject.release_identifier}`;
  const { measurement } = await measureBulkDecode(
    label,
    () => subject.decode(loaded.bytes),
    {
      describe: (value) => ({
        row_count: value.rows,
        source_bytes: loaded.bytes.length,
        decompressed_bytes: value.decompressed,
      }),
    },
  );
  return gradeBulkQualification(label, measurement);
}

async function main() {
  const families = flag('all')
    ? Object.keys(DECODERS)
    : (arg('family') ?? '').split(',').map((f) => f.trim()).filter(Boolean);
  if (!families.length) throw new Error('Pass --family=CA_CBSA[,NZ_CUSTOMS,...] or --all.');

  const concurrency = Math.max(1, Number(arg('concurrency') ?? 1));
  const repeat = Math.max(1, Number(arg('repeat') ?? 1));
  // `--repeat` duplicates each subject so N decodes of the SAME adapter overlap. Mixing different
  // adapters understates the worst case: their decode durations differ by an order of magnitude
  // (NZ ~835ms, Japan ~25ms), so a mixed batch rarely has two decodes at peak simultaneously.
  // Concurrent copies of the largest adapter is the shape that actually threatens the worker.
  const subjects = (await subjectsFor(families)).flatMap((s) => Array.from({ length: repeat }, () => s));
  console.log(`Qualifying ${subjects.length} retained release(s) at concurrency ${concurrency}.`);

  const results: Array<{ subject: Subject; result: BulkQualificationResult }> = [];
  for (let index = 0; index < subjects.length; index += concurrency) {
    const batch = subjects.slice(index, index + concurrency);
    const graded = await Promise.all(batch.map(async (subject) => ({ subject, result: await qualifyOne(subject) })));
    results.push(...graded);
  }

  console.log('\n=== retained-release operational qualification ===');
  for (const { result } of results) console.log(formatBulkQualification(result));

  if (concurrency > 1) {
    console.log(
      `\nNote: measured at concurrency ${concurrency}. Absolute peak RSS is process-wide and therefore\n`
      + '      shared across the batch; that is the point of a concurrency run, but per-adapter\n'
      + '      ceilings should be read from a concurrency=1 run.',
    );
  }

  if (!flag('no-record') && repeat === 1) {
    for (const { subject, result } of results) {
      await recordReleaseQualification({
        release_id: subject.release_id,
        source_family: subject.family,
        release_identifier: subject.release_identifier,
        parser_version: subject.parser_version,
        archive_checksum: subject.checksum,
        peak_rss_bytes: result.peak_rss_bytes,
        row_count: result.row_count,
        status: result.status,
        ceiling_bytes: result.ceiling_bytes,
        concurrency,
      });
    }
    console.log(`\nRecorded ${results.length} qualification result(s).`);
  }

  const failed = results.filter((r) => r.result.status === 'failed');
  console.log(`${results.length} measured, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
