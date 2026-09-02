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
import { acquireCanadaAuthorityBundle, type CanadaAcquisitionRequest } from './canada-acquisition';
import {
  CANADA_BUNDLE_READER_VERSION,
  CanadaBundleError,
  readCanadaAuthorityBundle,
  type CanadaAuthorityBundle,
} from './canada-bundle';
import {
  buildCanadaMarketAccess,
  CANADA_PARSER_VERSION,
  CANADA_SOURCE_AUTHORITY,
} from './canada-parser';

const CANADA_SOURCE_FAMILY = 'CA_CBSA';
const CANADA_MAX_BUNDLE_BYTES = 80 * 1024 * 1024;

export const CANADA_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: CANADA_SOURCE_FAMILY,
  authority: CANADA_SOURCE_AUTHORITY,
  destination_scope: ['CA'],
  source_distribution: 'CBSA Customs Tariff complete release plus List of Countries and Applicable Tariff Treatments',
  source_format: 'zip+accdb+html',
  content_type: 'application/zip',
  max_bundle_bytes: CANADA_MAX_BUNDLE_BYTES,
  reader_version: CANADA_BUNDLE_READER_VERSION,
  parser_version: CANADA_PARSER_VERSION,
});

export interface ImportCanadaReleaseArgs {
  actor: Principal;
  bytes: Buffer;
  release_identifier: string;
  reference_date: Date;
  source_url: string;
  activate?: boolean;
  correlation_id: string;
  retrieved_at?: Date;
}

export async function importCanadaRelease(args: ImportCanadaReleaseArgs) {
  return importAuthorityRelease({
    ...args,
    source: CANADA_RELEASE_SOURCE,
    label: `CBSA ${args.release_identifier.trim()}`,
    validate: async (bytes) => {
      let bundle: CanadaAuthorityBundle;
      try {
        bundle = await readCanadaAuthorityBundle(bytes);
      } catch (error) {
        if (error instanceof CanadaBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      if (bundle.release_identifier !== args.release_identifier.trim()) {
        throw validationError([{ field: 'release_identifier', code: 'bundle_mismatch', message: 'The supplied release identifier does not match the retained acquisition manifest.' }]);
      }
      return {
        file_manifest: bundle.files,
        validation: {
          tphs_schema_checked: true,
          tariff_row_count: bundle.rows.length,
          india_treatment_checked: true,
          india_treatment: bundle.india_treatment,
        },
      };
    },
  });
}

/** Official acquisition and release import remain separate from per-HS Market Access queries. */
export async function acquireAndImportCanadaRelease(args: Omit<ImportCanadaReleaseArgs, 'bytes' | 'source_url'> & {
  acquisition: CanadaAcquisitionRequest;
  fetch_impl?: typeof fetch;
}) {
  const bytes = await acquireCanadaAuthorityBundle(args.acquisition, { fetch_impl: args.fetch_impl });
  return importCanadaRelease({
    actor: args.actor,
    bytes,
    release_identifier: args.release_identifier,
    reference_date: args.reference_date,
    source_url: args.acquisition.tariff_url,
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
  });
}

export function activeCanadaRelease() {
  return activeAuthorityRelease(CANADA_SOURCE_FAMILY, CANADA_SOURCE_AUTHORITY);
}

/**
 * Canada publishes one whole-country bundle per release, so only one is active at a time; the
 * bound retires a superseded decode when a new release is activated rather than keeping every
 * release a long-lived worker has ever served.
 */
const bundleCache = new BoundedBundleCache<CanadaAuthorityBundle>(2);

async function loadCanadaBundle(releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeCanadaRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official CBSA authority release has been imported and activated.' }]);
  if (release.source_family !== CANADA_SOURCE_FAMILY || release.authority !== CANADA_SOURCE_AUTHORITY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a CBSA Customs Tariff release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readCanadaAuthorityBundle(loaded.bytes);
  if (bundle.checksum !== release.checksum) {
    throw new Error(`Decoded CBSA bundle ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchCanadaMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'Canada Market Access requires an exact six-digit HS code.' }]);
  }
  const loaded = await loadCanadaBundle(options.release_id);
  return buildCanadaMarketAccess({
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
export async function reparseCanadaAuthorityRelease(args: {
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
  const result = await fetchCanadaMarketAccess(args.hs6, {
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
