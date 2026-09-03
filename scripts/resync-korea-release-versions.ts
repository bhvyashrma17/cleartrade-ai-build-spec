/**
 * One-off: syncs the retained Korea AuthorityRelease row's recorded reader_version/parser_version
 * and `validation` field to the CURRENT code, without re-importing (the underlying XLSX bytes are
 * unchanged — only the code that decodes them changed, across the semantic-closure pass that added
 * the CLIP rate-program registry, quota/safeguard classification, and the two-sheet superset/
 * correction verification). Query-time behaviour already uses the current code regardless of these
 * DB fields; this exists so the qualification-freshness gate (bulk-release-gate.ts) and audit
 * records are not left pointing at a stale version label or a stale (pre-correction-discovery)
 * validation snapshot for a release that is otherwise correctly served.
 *
 *   railway run npx tsx scripts/resync-korea-release-versions.ts --release-id=<id>
 */
import { getDocumentStorage } from '@/lib/document-storage';
import { KOREA_BUNDLE_READER_VERSION, readKoreaAuthorityBundle, verifyKoreaSnapshotSuperset } from '@/lib/market-access/providers/korea-bundle';
import { KOREA_PARSER_VERSION } from '@/lib/market-access/providers/korea-parser';
import { prisma } from '@/lib/prisma';

const arg = (name: string) => process.argv.find((v) => v.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const releaseId = arg('release-id');
  if (!releaseId) throw new Error('Missing --release-id=...');
  const before = await prisma.authorityRelease.findUniqueOrThrow({ where: { id: releaseId } });
  if (before.source_family !== 'KR_KCS') throw new Error(`Release ${releaseId} is not a KR_KCS release.`);

  const bytes = await getDocumentStorage().get(before.artifact_object_key);
  const [bundle, superset] = await Promise.all([
    readKoreaAuthorityBundle({ bytes, release_identifier: before.release_identifier }),
    verifyKoreaSnapshotSuperset(bytes),
  ]);
  if (bundle.checksum !== before.checksum) throw new Error('Retained artifact no longer matches its recorded checksum — refusing to resync against different bytes.');

  const updated = await prisma.authorityRelease.update({
    where: { id: releaseId },
    data: {
      reader_version: KOREA_BUNDLE_READER_VERSION,
      parser_version: KOREA_PARSER_VERSION,
      validation: {
        item_count: bundle.item_rates.size,
        canonical_sheet: bundle.canonical_sheet,
        canonical_sheet_row_count: bundle.canonical_sheet_row_count,
        distinct_rate_type_code_count: bundle.distinct_rate_type_codes.size,
        cross_check_sheet_row_count: superset.cross_check_sheet_row_count,
        added_since_cross_check_count: superset.added_count,
        added_since_cross_check: superset.added,
        corrected_since_cross_check_count: superset.corrected_count,
        corrected_since_cross_check: superset.corrected,
      },
    },
  });
  console.log(JSON.stringify({
    release_id: updated.id,
    before: { reader_version: before.reader_version, parser_version: before.parser_version },
    after: { reader_version: updated.reader_version, parser_version: updated.parser_version },
    validation: updated.validation,
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
