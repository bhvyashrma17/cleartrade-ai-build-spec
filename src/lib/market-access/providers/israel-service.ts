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
import { acquireIsraelAuthorityBundle, type IsraelAcquisitionRequest } from './israel-acquisition';
import {
  ISRAEL_BUNDLE_READER_VERSION,
  IsraelBundleError,
  readIsraelAuthorityBundle,
  type IsraelAuthorityBundle,
} from './israel-bundle';
import {
  buildIsraelMarketAccess,
  ISRAEL_PARSER_VERSION,
  ISRAEL_SOURCE_AUTHORITY,
} from './israel-parser';

const SOURCE_FAMILY = 'IL_TAX_AUTHORITY';

export const ISRAEL_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: SOURCE_FAMILY,
  authority: ISRAEL_SOURCE_AUTHORITY,
  destination_scope: ['IL'],
  source_distribution: 'data.gov.il CKAN Customs Tariff and Purchase Tax plus Free Import Order and additional-order requirements',
  source_format: 'zip+json',
  content_type: 'application/zip',
  max_bundle_bytes: 32 * 1024 * 1024,
  reader_version: ISRAEL_BUNDLE_READER_VERSION,
  parser_version: ISRAEL_PARSER_VERSION,
});

export interface ImportIsraelReleaseArgs {
  actor: Principal;
  bytes: Buffer;
  release_identifier: string;
  reference_date: Date;
  source_url: string;
  activate?: boolean;
  correlation_id: string;
  retrieved_at?: Date;
}

export async function importIsraelRelease(args: ImportIsraelReleaseArgs) {
  return importAuthorityRelease({
    ...args,
    source: ISRAEL_RELEASE_SOURCE,
    label: `Israel Customs Book ${args.release_identifier.trim()}`,
    validate: async (bytes) => {
      let bundle: IsraelAuthorityBundle;
      try {
        bundle = await readIsraelAuthorityBundle(bytes);
      } catch (error) {
        if (error instanceof IsraelBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      if (bundle.release_identifier !== args.release_identifier.trim()) {
        throw validationError([{ field: 'release_identifier', code: 'bundle_mismatch', message: 'The release identifier does not match the Israel acquisition manifest.' }]);
      }
      return {
        file_manifest: bundle.files,
        validation: {
          ckan_schemas_checked: true,
          tariff_row_count: bundle.tariff_rows.length,
          requirement_row_count: bundle.requirement_rows.length,
          purchase_tax_kept_separate: true,
          resource_licences: Object.fromEntries(Object.entries(bundle.resources).map(([key, resource]) => [key, resource.license_id])),
        },
      };
    },
  });
}

export async function acquireAndImportIsraelRelease(args: Omit<ImportIsraelReleaseArgs, 'bytes' | 'source_url'> & {
  acquisition: IsraelAcquisitionRequest;
  fetch_impl?: typeof fetch;
}) {
  const bytes = await acquireIsraelAuthorityBundle(args.acquisition, { fetch_impl: args.fetch_impl });
  return importIsraelRelease({
    actor: args.actor,
    bytes,
    release_identifier: args.release_identifier,
    reference_date: args.reference_date,
    source_url: 'https://data.gov.il/datasets/taxes-authority/customsbook',
    activate: args.activate,
    correlation_id: args.correlation_id,
    retrieved_at: args.retrieved_at,
  });
}

export function activeIsraelRelease() {
  return activeAuthorityRelease(SOURCE_FAMILY, ISRAEL_SOURCE_AUTHORITY);
}

const bundleCache = new SharedBudgetBundleCache<IsraelAuthorityBundle>(SOURCE_FAMILY, 96 * 1024 * 1024);

async function loadIsraelBundle(releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeIsraelRelease();
  if (!release) throw validationError([{ field: 'release', code: 'missing', message: 'No official Israel Customs Book release has been imported and activated.' }]);
  if (release.source_family !== SOURCE_FAMILY || release.authority !== ISRAEL_SOURCE_AUTHORITY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not an Israel Tax Authority release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readIsraelAuthorityBundle(loaded.bytes);
  if (bundle.checksum !== release.checksum) throw new Error(`Decoded Israel bundle ${release.id} does not match its recorded checksum.`);
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchIsraelMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'Israel Market Access requires an exact six-digit HS code.' }]);
  }
  const loaded = await loadIsraelBundle(options.release_id);
  return buildIsraelMarketAccess({
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

export async function reparseIsraelAuthorityRelease(args: {
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
  const result = await fetchIsraelMarketAccess(args.hs6, {
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
