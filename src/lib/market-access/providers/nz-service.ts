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
import { acquireNzAuthorityBundle, type NzAcquisitionRequest } from './nz-acquisition';
import { NZ_BUNDLE_READER_VERSION, NzBundleError, readNzAuthorityBundle, type NzAuthorityBundle } from './nz-bundle';
import { buildNzMarketAccess, NZ_PARSER_VERSION, NZ_SOURCE_AUTHORITY } from './nz-parser';

const NZ_SOURCE_FAMILY = 'NZ_CUSTOMS';
const NZ_MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

export const NZ_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: NZ_SOURCE_FAMILY,
  authority: NZ_SOURCE_AUTHORITY,
  destination_scope: ['NZ'],
  source_distribution: 'NZ Customs Service nightly CusMod Tariff and Concession Data Files (tariff.tar.gz)',
  source_format: 'tar.gz+csv',
  content_type: 'application/gzip',
  max_bundle_bytes: NZ_MAX_BUNDLE_BYTES,
  reader_version: NZ_BUNDLE_READER_VERSION,
  parser_version: NZ_PARSER_VERSION,
});

export interface ImportNzReleaseArgs {
  actor: Principal;
  bytes: Buffer;
  release_identifier: string;
  reference_date: Date;
  source_url: string;
  activate?: boolean;
  correlation_id: string;
  retrieved_at?: Date;
}

export async function importNzRelease(args: ImportNzReleaseArgs) {
  return importAuthorityRelease({
    ...args,
    source: NZ_RELEASE_SOURCE,
    label: `NZ Customs CusMod ${args.release_identifier.trim()}`,
    validate: async (bytes) => {
      let bundle: NzAuthorityBundle;
      try {
        bundle = readNzAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim(), tariff_archive_url: args.source_url });
      } catch (error) {
        if (error instanceof NzBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      return {
        file_manifest: bundle.files,
        validation: {
          details_row_count: bundle.details.length,
          rates_row_count: bundle.rates.length,
          time_stamp: bundle.time_stamp,
        },
      };
    },
  });
}

/** Official acquisition and release import remain separate from per-HS Market Access queries. */
export async function acquireAndImportNzRelease(args: Omit<ImportNzReleaseArgs, 'bytes' | 'source_url'> & {
  acquisition: NzAcquisitionRequest;
  fetch_impl?: typeof fetch;
}) {
  const bytes = await acquireNzAuthorityBundle(args.acquisition, { fetch_impl: args.fetch_impl });
  return importNzRelease({
    actor: args.actor,
    bytes,
    release_identifier: args.release_identifier,
    reference_date: args.reference_date,
    source_url: args.acquisition.tariff_archive_url,
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
  });
}

export function activeNzRelease() {
  return activeAuthorityRelease(NZ_SOURCE_FAMILY, NZ_SOURCE_AUTHORITY);
}

/**
 * NZ publishes one nightly whole-country archive, so only one release is active at a time; the
 * bound exists so a long-lived worker crossing nightly release boundaries retires the superseded
 * decode instead of accumulating one per night.
 */
const bundleCache = new BoundedBundleCache<NzAuthorityBundle>(2);

async function loadNzBundle(releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeNzRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official NZ Customs authority release has been imported and activated.' }]);
  if (release.source_family !== NZ_SOURCE_FAMILY || release.authority !== NZ_SOURCE_AUTHORITY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not an NZ Customs CusMod release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = readNzAuthorityBundle({ bytes: loaded.bytes, release_identifier: release.release_identifier, tariff_archive_url: release.source_url });
  if (bundle.checksum !== release.checksum) {
    throw new Error(`Decoded NZ Customs bundle ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchNzMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'New Zealand Market Access requires an exact six-digit HS code.' }]);
  }
  const loaded = await loadNzBundle(options.release_id);
  return buildNzMarketAccess({
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
export async function reparseNzAuthorityRelease(args: {
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
  const result = await fetchNzMarketAccess(args.hs6, {
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
    after_summary: {
      authority_release_id: args.release_id,
      parser_version: args.parser_version,
      hs6: args.hs6,
      snapshot_id: snapshot.id,
    },
    correlation_id: args.correlation_id,
  });
  return snapshot;
}

export const __test__ = { bundleCache };
