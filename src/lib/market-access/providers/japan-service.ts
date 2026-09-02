import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import {
  activeAuthorityRelease,
  AUTHORITY_RELEASE_IMPORT_PRINCIPALS,
  importAuthorityRelease,
  loadAuthorityReleaseArtifact,
  type AuthorityReleaseSource,
} from '@/lib/market-access/authority-releases';
import { BoundedBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireJapanChapterBytes, type JapanAcquisitionRequest } from './japan-acquisition';
import { JAPAN_BUNDLE_READER_VERSION, JapanBundleError, readJapanAuthorityBundle, type JapanAuthorityBundle } from './japan-bundle';
import { buildJapanMarketAccess, JAPAN_PARSER_VERSION, JAPAN_SOURCE_AUTHORITY } from './japan-parser';

const JAPAN_SOURCE_FAMILY = 'JP_CUSTOMS';
const JAPAN_MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

/**
 * Unlike Canada/TARIC (one bulk archive covering everything) or NZ (one nightly archive), Japan
 * Customs publishes one HTML page per HS chapter per dated schedule — there is no single "whole
 * country" release to import. A release here is therefore scoped to one (date, chapter) pair, and
 * a full country picture is many small releases rather than one large one. This is a genuine
 * source-shape difference, not a design choice — see docs/customs-atlas.
 */
export function japanReleaseSource(chapter: string): AuthorityReleaseSource {
  return Object.freeze({
    source_family: JAPAN_SOURCE_FAMILY,
    authority: `${JAPAN_SOURCE_AUTHORITY} — Chapter ${chapter}`,
    destination_scope: ['JP'],
    source_distribution: `Japan Customs dated tariff schedule, Chapter ${chapter} (English edition)`,
    source_format: 'html',
    content_type: 'text/html',
    max_bundle_bytes: JAPAN_MAX_BUNDLE_BYTES,
    reader_version: JAPAN_BUNDLE_READER_VERSION,
    parser_version: JAPAN_PARSER_VERSION,
  });
}

export interface ImportJapanChapterArgs {
  actor: Principal;
  bytes: Buffer;
  chapter: string;
  effective_date_label: string;
  source_url: string;
  activate?: boolean;
  correlation_id: string;
  retrieved_at?: Date;
}

export async function importJapanChapterRelease(args: ImportJapanChapterArgs) {
  const chapter = args.chapter.trim().padStart(2, '0');
  const releaseIdentifier = `${args.effective_date_label.trim()}-ch${chapter}`;
  return importAuthorityRelease({
    actor: args.actor,
    bytes: args.bytes,
    label: `Japan Customs ${releaseIdentifier}`,
    release_identifier: releaseIdentifier,
    reference_date: (() => {
      const match = /^(\d{4})_(\d{2})_(\d{2})$/.exec(args.effective_date_label.trim());
      if (!match) throw validationError([{ field: 'effective_date_label', code: 'invalid', message: 'Japan Customs effective-date labels must be YYYY_MM_DD, matching the published schedule URL.' }]);
      return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    })(),
    source_url: args.source_url,
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
    source: japanReleaseSource(chapter),
    validate: async (bytes) => {
      let bundle: JapanAuthorityBundle;
      try {
        bundle = readJapanAuthorityBundle({ bytes, chapter, effective_date_label: args.effective_date_label.trim(), source_url: args.source_url });
      } catch (error) {
        if (error instanceof JapanBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      return {
        file_manifest: bundle.files,
        validation: { row_count: bundle.rows.length, column_labels: bundle.column_labels, chapter },
      };
    },
  });
}

export async function acquireAndImportJapanChapterRelease(args: Omit<ImportJapanChapterArgs, 'bytes' | 'source_url'> & {
  acquisition: JapanAcquisitionRequest;
  fetch_impl?: typeof fetch;
}) {
  const bytes = await acquireJapanChapterBytes(args.acquisition, { fetch_impl: args.fetch_impl });
  return importJapanChapterRelease({
    actor: args.actor,
    bytes,
    chapter: args.chapter,
    effective_date_label: args.effective_date_label,
    source_url: args.acquisition.chapter_url,
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
  });
}

export function activeJapanChapterRelease(chapter: string) {
  const padded = chapter.trim().padStart(2, '0');
  return activeAuthorityRelease(JAPAN_SOURCE_FAMILY, `${JAPAN_SOURCE_AUTHORITY} — Chapter ${padded}`);
}

/**
 * Japan scopes a release to one (date, chapter) pair, so a worker serving the full 96-chapter
 * schedule would otherwise retain every decoded chapter — ~9MB each against a 1GB worker. Twelve
 * keeps the realistically hot chapters resident (a query set clusters in a handful of chapters)
 * at a bounded ~110MB ceiling instead of an unbounded ~860MB one.
 */
const bundleCache = new BoundedBundleCache<JapanAuthorityBundle>(12);

async function loadJapanBundle(chapter: string, releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeJapanChapterRelease(chapter);
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: `No official Japan Customs release has been imported and activated for chapter ${chapter}.` }]);
  if (release.source_family !== JAPAN_SOURCE_FAMILY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Japan Customs chapter release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const [effectiveDateLabel, chapterFromId] = release.release_identifier.split('-ch');
  const bundle = readJapanAuthorityBundle({ bytes: loaded.bytes, chapter: chapterFromId ?? chapter, effective_date_label: effectiveDateLabel ?? '', source_url: release.source_url });
  if (bundle.checksum !== release.checksum) {
    throw new Error(`Decoded Japan Customs bundle ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchJapanMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'Japan Market Access requires an exact six-digit HS code.' }]);
  }
  const chapter = hs6.slice(0, 2);
  const loaded = await loadJapanBundle(chapter, options.release_id);
  return buildJapanMarketAccess({
    bundle: loaded.bundle,
    release_id: loaded.release.id,
    release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at,
    hs6,
    at: options.now ?? new Date(),
    origin_country: options.origin_country,
    parser_version: options.parser_version,
  });
}

/** Reparse retained bytes with a newer parser and append a new canonical snapshot. */
export async function reparseJapanAuthorityRelease(args: {
  actor: Principal;
  release_id: string;
  hs6: string;
  parser_version: string;
  now?: Date;
  origin_country?: string;
  correlation_id: string;
}) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role as UserRole)) {
    throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  }
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchJapanMarketAccess(args.hs6, {
    release_id: args.release_id,
    parser_version: args.parser_version,
    now: args.now,
    origin_country: args.origin_country,
  });
  const snapshot = await persistMarketAccessIngest(result, {
    source_run_id: `authority-reparse:${args.release_id}:${args.parser_version}`,
  });
  await writeAuditEvent({
    actor: args.actor,
    action: AUDIT_ACTIONS.generate,
    object_type: 'market_access_authority_reparse',
    object_id: snapshot.id,
    exporter_org_id: null,
    after_summary: { authority_release_id: args.release_id, parser_version: args.parser_version, hs6: args.hs6, snapshot_id: snapshot.id },
    correlation_id: args.correlation_id,
  });
  return snapshot;
}

export const __test__ = { bundleCache };
