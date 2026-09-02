/**
 * Real-archive operational qualification for bulk authority adapters.
 *
 * Deliberately NOT part of `npm test`. This command downloads real government archives (tens of
 * megabytes) and is run explicitly — before shipping a bulk adapter, and when an authority's
 * archive grows — rather than on every unit-test run. The thresholds it enforces, and why they
 * are what they are, live in `src/lib/market-access/bulk-operational-qualification.ts`.
 *
 *   npx tsx scripts/qualify-bulk-adapters.ts --adapter=nz
 *   npx tsx scripts/qualify-bulk-adapters.ts --adapter=jp --chapter=84
 *   npx tsx scripts/qualify-bulk-adapters.ts --all
 *
 * Exit code is 1 if any adapter FAILS its memory ceiling, so this is usable as a release gate.
 * A WARN does not fail the command but is reported.
 *
 * Archives are cached under --cache-dir so repeat runs do not re-hit the authority; the point of
 * the gate is memory behaviour, not repeatedly exercising someone's government web server.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatBulkQualification,
  gradeBulkQualification,
  measureBulkDecode,
  type BulkQualificationResult,
} from '@/lib/market-access/bulk-operational-qualification';
import { readJapanAuthorityBundle } from '@/lib/market-access/providers/japan-bundle';
import { readNzAuthorityBundle } from '@/lib/market-access/providers/nz-bundle';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

const NZ_ARCHIVE_URL = 'https://www.customs.govt.nz/media/0nmaamqd/tariff.tar.gz';
const JP_SCHEDULE_DATE = arg('jp-date') ?? '2026_08_08';

async function cachedFetch(url: string, cacheDir: string, name: string): Promise<Buffer> {
  const path = join(cacheDir, name);
  if (existsSync(path)) {
    console.log(`  using cached ${name}`);
    return readFileSync(path);
  }
  console.log(`  downloading ${url}`);
  const response = await fetch(url, { headers: { 'user-agent': 'ClearTrade-Customs-Atlas/1.0 (operational qualification)' } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  writeFileSync(path, bytes);
  return bytes;
}

async function qualifyNz(cacheDir: string): Promise<BulkQualificationResult> {
  const bytes = await cachedFetch(NZ_ARCHIVE_URL, cacheDir, 'nz-tariff.tar.gz');
  const { measurement } = await measureBulkDecode(
    'nz_customs_cusmod',
    () => readNzAuthorityBundle({ bytes, release_identifier: 'qualification', tariff_archive_url: NZ_ARCHIVE_URL }),
    {
      describe: (bundle) => ({
        row_count: bundle.details.length + bundle.rates.length,
        source_bytes: bytes.length,
        decompressed_bytes: bundle.files.reduce((sum, file) => sum + file.size_bytes, 0),
      }),
    },
  );
  return gradeBulkQualification('nz_customs_cusmod', measurement);
}

/**
 * Japan's largest chapter is the worst case for a per-chapter release, so qualifying chapter 84
 * (~2.25MB, the biggest in the 2026 schedule) bounds every other chapter. `--chapter` overrides.
 */
async function qualifyJapan(cacheDir: string): Promise<BulkQualificationResult> {
  const chapter = (arg('chapter') ?? '84').padStart(2, '0');
  const url = `https://www.customs.go.jp/english/tariff/${JP_SCHEDULE_DATE}/data/e_${chapter}.htm`;
  const bytes = await cachedFetch(url, cacheDir, `jp-${JP_SCHEDULE_DATE}-ch${chapter}.htm`);
  const { measurement } = await measureBulkDecode(
    `japan_customs_tariff_schedule (ch${chapter})`,
    () => readJapanAuthorityBundle({ bytes, chapter, effective_date_label: JP_SCHEDULE_DATE, source_url: url }),
    { describe: (bundle) => ({ row_count: bundle.rows.length, source_bytes: bytes.length, decompressed_bytes: null }) },
  );
  return gradeBulkQualification(`japan_customs_tariff_schedule (ch${chapter})`, measurement);
}

/**
 * Canada is intentionally not wired to a live download here: its bundle is a composite archive
 * assembled by `acquireCanadaAuthorityBundle` from two CBSA endpoints, so a faithful measurement
 * has to go through that acquisition path rather than a single URL. Registering it as an explicit
 * unsupported case is better than silently omitting a bulk adapter from a gate whose whole purpose
 * is to leave no bulk adapter unmeasured.
 */
function canadaNotice() {
  console.log('\ncanada_cbsa_customs_tariff: not measured by this command.');
  console.log('  Canada\'s release is a composite of two CBSA endpoints assembled at acquisition time.');
  console.log('  Qualify it via a staging reparse against a retained release artifact, not a single URL fetch.');
}

async function main() {
  const cacheDir = arg('cache-dir') ?? '/tmp/cleartrade-bulk-qualification';
  mkdirSync(cacheDir, { recursive: true });

  const adapter = arg('adapter');
  const all = flag('all') || !adapter;
  const results: BulkQualificationResult[] = [];

  if (all || adapter === 'nz') {
    console.log('\nqualifying nz_customs_cusmod');
    results.push(await qualifyNz(cacheDir));
  }
  if (all || adapter === 'jp') {
    console.log('\nqualifying japan_customs_tariff_schedule');
    results.push(await qualifyJapan(cacheDir));
  }

  console.log('\n=== real-archive operational qualification ===');
  for (const result of results) console.log(formatBulkQualification(result));

  if (results.length > 1) {
    // Peak RSS is process-wide, so the second and later adapters in a single run are measured with
    // earlier decodes still resident: their absolute peak is inflated. This can only ever produce a
    // false FAIL, never a false PASS, so it is safe as a gate — but the number is misleading, and
    // `attributed RSS` is the figure to read here. Enforce a per-adapter ceiling with --adapter=.
    console.log(
      '\nNote: absolute peak RSS above is cumulative across adapters measured in this one process.\n'
      + '      Read `attributed RSS` for per-adapter cost, or re-run a single --adapter=<name> for a\n'
      + '      clean absolute peak. Contamination inflates peaks, so it cannot mask a real breach.',
    );
  }
  if (all) canadaNotice();

  const failed = results.filter((r) => r.status === 'failed');
  console.log(`\n${results.length} adapter(s) measured, ${failed.length} failed.`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
