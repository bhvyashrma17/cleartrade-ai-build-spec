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
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import type { Principal } from '@/types';
import { acquireNorwayAuthorityBundle, type NorwayAcquisitionRequest } from './norway-acquisition';
import { NORWAY_BUNDLE_READER_VERSION, NorwayBundleError, readNorwayAuthorityBundle, type NorwayAuthorityBundle } from './norway-bundle';
import { buildNorwayMarketAccess, NORWAY_PARSER_VERSION, NORWAY_SOURCE_AUTHORITY } from './norway-parser';

const NORWAY_SOURCE_FAMILY = 'NO_TOLLETATEN';
const NORWAY_MAX_BUNDLE_BYTES = 96 * 1024 * 1024;

export const NORWAY_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: NORWAY_SOURCE_FAMILY,
  authority: NORWAY_SOURCE_AUTHORITY,
  destination_scope: ['NO'],
  source_distribution: 'Tolletaten open data (data.toll.no): tollavgiftssats, varenummer, landgruppe and ratetradeagreements',
  source_format: 'zip+json',
  content_type: 'application/zip',
  max_bundle_bytes: NORWAY_MAX_BUNDLE_BYTES,
  reader_version: NORWAY_BUNDLE_READER_VERSION,
  parser_version: NORWAY_PARSER_VERSION,
});

export interface ImportNorwayReleaseArgs {
  actor: Principal;
  bytes: Buffer;
  release_identifier: string;
  reference_date: Date;
  source_url: string;
  activate?: boolean;
  acknowledge_unqualified?: boolean;
  correlation_id: string;
  retrieved_at?: Date;
}

export async function importNorwayRelease(args: ImportNorwayReleaseArgs) {
  return importAuthorityRelease({
    ...args,
    source: NORWAY_RELEASE_SOURCE,
    label: `Tolletaten ${args.release_identifier.trim()}`,
    validate: async (bytes) => {
      let bundle: NorwayAuthorityBundle;
      try {
        bundle = await readNorwayAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() });
      } catch (error) {
        if (error instanceof NorwayBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      return {
        file_manifest: bundle.files,
        validation: {
          commodity_count: bundle.rates.size,
          goods_count: bundle.goods.size,
          country_group_count: bundle.country_groups.size,
          agreement_commodity_count: bundle.agreements.size,
          rates_version: bundle.rates_version,
        },
      };
    },
  });
}

export async function acquireAndImportNorwayRelease(args: Omit<ImportNorwayReleaseArgs, 'bytes' | 'source_url'> & {
  acquisition: NorwayAcquisitionRequest;
  fetch_impl?: typeof fetch;
}) {
  const bytes = await acquireNorwayAuthorityBundle(args.acquisition, { fetch_impl: args.fetch_impl });
  return importNorwayRelease({
    actor: args.actor,
    bytes,
    release_identifier: args.release_identifier,
    reference_date: args.reference_date,
    source_url: args.acquisition.rates_url,
    activate: args.activate,
    acknowledge_unqualified: args.acknowledge_unqualified,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
  });
}

export function activeNorwayRelease() {
  return activeAuthorityRelease(NORWAY_SOURCE_FAMILY, NORWAY_SOURCE_AUTHORITY);
}

/**
 * One whole-country release at a time. The weight is the measured retained cost of a decoded
 * Norwegian bundle; residency is decided by the shared process-wide budget rather than a
 * per-family capacity, since co-residency across families is what previously OOM'd a worker.
 */
const bundleCache = new SharedBudgetBundleCache<NorwayAuthorityBundle>('NO_TOLLETATEN', 120 * 1024 * 1024);

async function loadNorwayBundle(releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeNorwayRelease();
  if (!release) {
    throw validationError([{ field: 'release', code: 'missing', message: 'No official Tolletaten authority release has been imported and activated.' }]);
  }
  if (release.source_family !== NORWAY_SOURCE_FAMILY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a Tolletaten release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readNorwayAuthorityBundle({ bytes: loaded.bytes, release_identifier: release.release_identifier });
  if (bundle.checksum !== release.checksum) {
    throw new Error(`Decoded Tolletaten bundle ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchNorwayMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'Norwegian Market Access requires an exact six-digit HS code.' }]);
  }
  const loaded = await loadNorwayBundle(options.release_id);
  return buildNorwayMarketAccess({
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
export async function reparseNorwayAuthorityRelease(args: {
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
  const result = await fetchNorwayMarketAccess(args.hs6, {
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
