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
import { acquireAustraliaAuthorityBundle, type AustraliaAcquisitionRequest } from './australia-acquisition';
import { AUSTRALIA_BUNDLE_READER_VERSION, AustraliaBundleError, readAustraliaAuthorityBundle, type AustraliaAuthorityBundle } from './australia-bundle';
import { AUSTRALIA_PARSER_VERSION, AUSTRALIA_SOURCE_AUTHORITY, buildAustraliaMarketAccess } from './australia-parser';

const AUSTRALIA_SOURCE_FAMILY = 'AU_ABF';
const AUSTRALIA_MAX_BUNDLE_BYTES = 16 * 1024 * 1024;

/**
 * Like Japan, Australia publishes its tariff as one page per chapter rather than a single bulk
 * archive, so a release is scoped to a chapter. Unlike Japan, each chapter release is a composite
 * of two documents (Schedule 3 chapter + Schedule 10A India), following the Canada pattern, so the
 * India treatment that was in force when that chapter was read is retained alongside it.
 */
export function australiaReleaseSource(chapter: string): AuthorityReleaseSource {
  return Object.freeze({
    source_family: AUSTRALIA_SOURCE_FAMILY,
    authority: `${AUSTRALIA_SOURCE_AUTHORITY} — Chapter ${chapter}`,
    destination_scope: ['AU'],
    source_distribution: `ABF Working Tariff, Schedule 3 chapter ${chapter} with Schedule 10A (Indian originating goods)`,
    source_format: 'zip+html',
    content_type: 'application/zip',
    max_bundle_bytes: AUSTRALIA_MAX_BUNDLE_BYTES,
    reader_version: AUSTRALIA_BUNDLE_READER_VERSION,
    parser_version: AUSTRALIA_PARSER_VERSION,
  });
}

export interface ImportAustraliaChapterArgs {
  actor: Principal;
  bytes: Buffer;
  chapter: string;
  release_identifier: string;
  reference_date: Date;
  chapter_url: string;
  schedule_10a_url: string;
  activate?: boolean;
  correlation_id: string;
  retrieved_at?: Date;
}

export async function importAustraliaChapterRelease(args: ImportAustraliaChapterArgs) {
  const chapter = args.chapter.trim().padStart(2, '0');
  return importAuthorityRelease({
    actor: args.actor,
    bytes: args.bytes,
    label: `ABF Working Tariff ${args.release_identifier} ch${chapter}`,
    release_identifier: `${args.release_identifier.trim()}-ch${chapter}`,
    reference_date: args.reference_date,
    source_url: args.chapter_url,
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
    source: australiaReleaseSource(chapter),
    validate: async (bytes) => {
      let bundle: AustraliaAuthorityBundle;
      try {
        bundle = await readAustraliaAuthorityBundle({
          bytes,
          release_identifier: args.release_identifier.trim(),
          chapter,
          chapter_url: args.chapter_url,
          schedule_10a_url: args.schedule_10a_url,
        });
      } catch (error) {
        if (error instanceof AustraliaBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      return {
        file_manifest: bundle.files,
        validation: {
          row_count: bundle.rows.length,
          india_exception_count: bundle.india_exceptions.length,
          chapter,
        },
      };
    },
  });
}

export async function acquireAndImportAustraliaChapterRelease(args: Omit<ImportAustraliaChapterArgs, 'bytes' | 'chapter_url' | 'schedule_10a_url'> & {
  acquisition: AustraliaAcquisitionRequest;
  fetch_impl?: typeof fetch;
}) {
  const bytes = await acquireAustraliaAuthorityBundle(args.acquisition, { fetch_impl: args.fetch_impl });
  return importAustraliaChapterRelease({
    actor: args.actor,
    bytes,
    chapter: args.chapter,
    release_identifier: args.release_identifier,
    reference_date: args.reference_date,
    chapter_url: args.acquisition.chapter_url,
    schedule_10a_url: args.acquisition.schedule_10a_url,
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
  });
}

export function activeAustraliaChapterRelease(chapter: string) {
  const padded = chapter.trim().padStart(2, '0');
  return activeAuthorityRelease(AUSTRALIA_SOURCE_FAMILY, `${AUSTRALIA_SOURCE_AUTHORITY} — Chapter ${padded}`);
}

/** Per-chapter releases, so the same bound that protects Japan applies here. */
const bundleCache = new BoundedBundleCache<AustraliaAuthorityBundle>(12);

async function loadAustraliaBundle(chapter: string, releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeAustraliaChapterRelease(chapter);
  if (!release) {
    throw validationError([{ field: 'release', code: 'missing', message: `No official ABF release has been imported and activated for chapter ${chapter}.` }]);
  }
  if (release.source_family !== AUSTRALIA_SOURCE_FAMILY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not an ABF Working Tariff chapter release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const [releaseIdentifier, chapterFromId] = release.release_identifier.split('-ch');
  const bundle = await readAustraliaAuthorityBundle({
    bytes: loaded.bytes,
    release_identifier: releaseIdentifier ?? release.release_identifier,
    chapter: chapterFromId ?? chapter,
    chapter_url: release.source_url,
    schedule_10a_url: release.source_url,
  });
  if (bundle.checksum !== release.checksum) {
    throw new Error(`Decoded ABF bundle ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchAustraliaMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'Australian Market Access requires an exact six-digit HS code.' }]);
  }
  const chapter = hs6.slice(0, 2);
  const loaded = await loadAustraliaBundle(chapter, options.release_id);
  return buildAustraliaMarketAccess({
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
export async function reparseAustraliaAuthorityRelease(args: {
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
  const result = await fetchAustraliaMarketAccess(args.hs6, {
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
