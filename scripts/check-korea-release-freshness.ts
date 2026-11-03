/**
 * Detects whether a newer official Korea Customs Service tariff release has been published,
 * without downloading it and without any credential — data.go.kr publishes the dataset's own
 * catalogue metadata as a public, unauthenticated JSON endpoint
 * (`https://www.data.go.kr/catalog/15051179/fileData.json`), the same one used during Wave 3A/3B
 * research. This is acquisition-tier B from the refresh hierarchy this task specifies: a
 * documented public dataset-metadata check, not a private/reverse-engineered endpoint, and not
 * dependent on `KCS_DATA_GO_KR_SERVICE_KEY`.
 *
 * ## What signal actually means "new release" — verified, not assumed
 *
 * The catalogue's `dateModified` field is NOT a reliable signal on its own: checked live on
 * 2026-09-04, it reads `"2026-03-20"` — over a month after the 2026-02-11 file this project
 * imported — while the catalogue's `alternateName` field, which embeds the file's own release
 * date suffix ("관세청_품목번호별 관세율표_20260211"), is UNCHANGED. That means data.go.kr touched
 * the catalogue entry (a portal re-index, tag edit, or similar housekeeping) without the
 * underlying file actually changing. `alternateName`'s trailing date is the reliable signal —
 * it is literally the filename KCS assigns to a genuine new release — and this script compares
 * THAT, not `dateModified`, against the currently active AuthorityRelease's `release_identifier`.
 *
 * ## Operational workflow this closes
 *
 *   scheduled run of this script (cron, or any external scheduler — see below)
 *     -> compares catalogue alternateName date vs. active release_identifier
 *     -> exits 0 with "up to date" if they match
 *     -> exits 1 with a clear, actionable message if a newer date is published
 *     -> an operator (there is no unattended download path — see korea-service.ts's module
 *        comment: the download is a JS-driven browser action, not an API) fetches the new XLSX
 *        the same manual way as before, then runs the existing, already-established pipeline:
 *        scripts/import-korea-release.ts -> scripts/qualify-bulk-release.ts --family=KR_KCS ->
 *        scripts/activate-authority-release.ts. The previous release is never deleted —
 *        AuthorityRelease is immutable and activation only supersedes, it never removes.
 *
 * No new alerting subsystem is introduced: every other bulk family in this Atlas (Norway, TARIC,
 * NZ, Canada, Japan, Australia) is refreshed by a human running a script and reading its exit
 * code/output, and this follows the same convention rather than building Korea a parallel one.
 * Wiring this into an actual schedule (Railway cron, GitHub Actions, etc.) is an infrastructure
 * decision for a human operator to make deliberately — this script does not provision one itself.
 *
 *   railway run npx tsx scripts/check-korea-release-freshness.ts
 */
import { activeAuthorityRelease } from '@/lib/market-access/authority-releases';
import { KOREA_SOURCE_AUTHORITY } from '@/lib/market-access/providers/korea-parser';
import { prisma } from '@/lib/prisma';

const CATALOG_URL = 'https://www.data.go.kr/catalog/15051179/fileData.json';
const KOREA_SOURCE_FAMILY = 'KR_KCS';

interface DataGoKrCatalog {
  alternateName?: string;
  dateModified?: string;
}

/** Extracts the trailing `_YYYYMMDD` from `alternateName`, e.g.
 *  "관세청_품목번호별 관세율표_20260211" -> "2026-02-11" (matching AuthorityRelease's own
 *  release_identifier format, as used by scripts/import-korea-release.ts). */
function releaseDateFromAlternateName(alternateName: string): string | null {
  const match = /_(\d{4})(\d{2})(\d{2})$/.exec(alternateName.trim());
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

async function main() {
  const response = await fetch(CATALOG_URL, {
    headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; ClearTrade-Customs-Atlas/1.0)' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`data.go.kr catalogue metadata returned HTTP ${response.status} — cannot determine freshness. Not treated as "no update"; investigate before assuming the current release is still current.`);
  }
  const catalog = await response.json() as DataGoKrCatalog;
  if (!catalog.alternateName) {
    throw new Error('data.go.kr catalogue metadata did not include alternateName — its shape may have changed. Investigate before relying on this check again.');
  }
  const publishedDate = releaseDateFromAlternateName(catalog.alternateName);
  if (!publishedDate) {
    throw new Error(`Could not parse a release date from catalogue alternateName "${catalog.alternateName}" — its naming convention may have changed.`);
  }

  const active = await activeAuthorityRelease(KOREA_SOURCE_FAMILY, KOREA_SOURCE_AUTHORITY);
  if (!active) {
    console.log(JSON.stringify({ status: 'no_active_release', published_date: publishedDate, message: 'No Korea release is currently active — this is not a freshness gap, it is an unconfigured pack.' }, null, 2));
    return;
  }

  if (active.release_identifier === publishedDate) {
    console.log(JSON.stringify({
      status: 'up_to_date',
      active_release_identifier: active.release_identifier,
      published_date: publishedDate,
      catalog_date_modified: catalog.dateModified ?? null,
      checked_at: new Date().toISOString(),
    }, null, 2));
    return;
  }

  console.log(JSON.stringify({
    status: 'newer_release_available',
    active_release_identifier: active.release_identifier,
    published_date: publishedDate,
    catalog_date_modified: catalog.dateModified ?? null,
    action_required: `A KCS release dated ${publishedDate} appears to supersede the active ${active.release_identifier} release. An operator must download the official XLSX from https://www.data.go.kr/data/15051179/fileData.do (a JS-driven browser download; no unattended path exists), then run: scripts/import-korea-release.ts -> scripts/qualify-bulk-release.ts --family=KR_KCS -> scripts/activate-authority-release.ts.`,
    checked_at: new Date().toISOString(),
  }, null, 2));
  process.exitCode = 1;
}

main().finally(() => prisma.$disconnect());
