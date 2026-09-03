/**
 * Korea Customs Service tariff-schedule release lifecycle.
 *
 * Acquisition today is a manual authoritative-release upload of the official XLSX from
 * data.go.kr dataset 15051179 (관세청_품목번호별 관세율표), not an automated fetch: the
 * data.go.kr/odcloud API is documented and rights-cleared (KOGL Type 1, see
 * unconfigured-sources.ts KR_DATA_GO_KR and korea-acquisition.ts), but ClearTrade has not yet
 * provisioned `KCS_DATA_GO_KR_SERVICE_KEY`. Rather than block a genuinely available, rights-
 * cleared official release on that credential, the same dataset's own XLSX download — published
 * under the same KOGL Type 1 licence, from the same data.go.kr listing — is imported through the
 * existing generic AuthorityRelease lifecycle. When the API credential is provisioned, it becomes
 * an additional, potentially higher-frequency acquisition route for this same source family; it
 * does not require a different bundle/parser, since both routes describe the same underlying KCS
 * dataset.
 */
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
import { KOREA_BUNDLE_READER_VERSION, KoreaBundleError, readKoreaAuthorityBundle, type KoreaAuthorityBundle } from './korea-bundle';
import { buildKoreaMarketAccess, KOREA_PARSER_VERSION, KOREA_SOURCE_AUTHORITY } from './korea-parser';

const KOREA_SOURCE_FAMILY = 'KR_KCS';
/** The 2026-02-11 release is ~22.4MB; headroom above that for a larger future release. */
const KOREA_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export const KOREA_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: KOREA_SOURCE_FAMILY,
  authority: KOREA_SOURCE_AUTHORITY,
  destination_scope: ['KR'],
  source_distribution: 'data.go.kr dataset 15051179 (관세청_품목번호별 관세율표) — official XLSX download, manually retrieved pending KCS_DATA_GO_KR_SERVICE_KEY provisioning',
  source_format: 'xlsx',
  content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  max_bundle_bytes: KOREA_MAX_BUNDLE_BYTES,
  reader_version: KOREA_BUNDLE_READER_VERSION,
  parser_version: KOREA_PARSER_VERSION,
});

export interface ImportKoreaReleaseArgs {
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

export async function importKoreaRelease(args: ImportKoreaReleaseArgs) {
  return importAuthorityRelease({
    ...args,
    source: KOREA_RELEASE_SOURCE,
    label: `KCS 품목번호별 관세율표 ${args.release_identifier.trim()}`,
    validate: async (bytes) => {
      let bundle: KoreaAuthorityBundle;
      try {
        bundle = await readKoreaAuthorityBundle({ bytes, release_identifier: args.release_identifier.trim() });
      } catch (error) {
        if (error instanceof KoreaBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      return {
        file_manifest: [{
          name: `관세청_품목번호별_관세율표_${args.release_identifier.trim()}.xlsx`,
          sha256: bundle.checksum,
          size_bytes: bundle.size_bytes,
          role: 'official_duty_rates',
        }],
        validation: {
          item_count: bundle.item_rates.size,
          canonical_sheet: bundle.canonical_sheet,
          canonical_sheet_row_count: bundle.canonical_sheet_row_count,
          cross_check_sheet: bundle.cross_check_sheet,
          cross_check_sheet_row_count: bundle.cross_check_sheet_row_count,
          distinct_rate_type_code_count: bundle.distinct_rate_type_codes.size,
        },
      };
    },
  });
}

export function activeKoreaRelease() {
  return activeAuthorityRelease(KOREA_SOURCE_FAMILY, KOREA_SOURCE_AUTHORITY);
}

/**
 * One release at a time. Weight (156MB) is declared from a real, forced-GC measurement of this
 * exact reader against the 2026-02-11 archive (RSS retained after decode, post-GC, minus
 * baseline: ~155MB — see scripts/qualify-bulk-release.ts output for this family for the full
 * qualification record). A process-wide budget, not an independent Korea cache, for the same
 * reason every other bulk family shares one: co-residency across families, not any single family
 * alone, is what previously OOM'd a worker.
 *
 * Disclosed architecture pressure: the shared budget (`GLOBAL_BUNDLE_CACHE_BUDGET_BYTES`,
 * bundle-cache.ts) is 160MB. Korea's real 156MB weight leaves only ~4MB of headroom in that
 * budget, so Korea and Norway (120MB) can no longer both stay cache-resident — inserting one now
 * evicts the other, where before Korea's addition every existing family fit together. This is not
 * a memory-safety problem (eviction just means a re-decode next query, not a crash), but it is a
 * real scaling signal: the 160MB budget was sized for the families that existed at the time, and
 * this pack alone leaves it functionally single-tenant. Left as a documented finding rather than
 * silently raising the shared constant, per the instruction not to change thresholds in this task.
 */
const bundleCache = new SharedBudgetBundleCache<KoreaAuthorityBundle>('KR_KCS', 156 * 1024 * 1024);

async function loadKoreaBundle(releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeKoreaRelease();
  if (!release) {
    throw validationError([{ field: 'release', code: 'missing', message: 'No official KCS authority release has been imported and activated.' }]);
  }
  if (release.source_family !== KOREA_SOURCE_FAMILY) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not a KCS release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const loaded = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readKoreaAuthorityBundle({ bytes: loaded.bytes, release_identifier: release.release_identifier });
  if (bundle.checksum !== release.checksum) {
    throw new Error(`Decoded KCS bundle ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

export async function fetchKoreaMarketAccess(
  hs6: string,
  options: { now?: Date; origin_country?: string; parser_version?: string; release_id?: string } = {},
) {
  if (!/^\d{6}$/.test(hs6)) {
    throw validationError([{ field: 'hs6', code: 'invalid', message: 'Korean Market Access requires an exact six-digit HS code.' }]);
  }
  const loaded = await loadKoreaBundle(options.release_id);
  return buildKoreaMarketAccess({
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
export async function reparseKoreaAuthorityRelease(args: {
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
  const result = await fetchKoreaMarketAccess(args.hs6, {
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
