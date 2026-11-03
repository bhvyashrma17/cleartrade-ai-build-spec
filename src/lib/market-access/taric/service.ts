/**
 * Importing an official TARIC release, and reading Market Access evidence from it.
 *
 * The exporter never touches any of this. Authorized ClearTrade staff download the monthly
 * extraction from the Commission's CIRCABC group and upload the ORIGINAL archive; everything
 * downstream is machine-read from those bytes. That is what keeps the resulting evidence
 * `authoritative_public` rather than an operator's transcription.
 */
import { UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { notFound, validationError } from '@/lib/errors';
import { SharedBudgetBundleCache } from '@/lib/market-access/bundle-cache';
import { persistMarketAccessIngest, type MarketAccessIngestResult } from '@/lib/market-access/contract';
import { assertCan } from '@/lib/permissions';
import {
  activateAuthorityRelease,
  activeAuthorityRelease,
  AUTHORITY_RELEASE_IMPORT_PRINCIPALS,
  importAuthorityRelease,
  listAuthorityReleases,
  loadAuthorityReleaseArtifact,
  type AuthorityReleaseSource,
} from '@/lib/market-access/authority-releases';
import type { Principal } from '@/types';
import { readTaricBundle, TaricBundleError, TARIC_BUNDLE_READER_VERSION, type TaricBundle } from './bundle';
import {
  buildTaricIngest, resolveTaric,
  TARIC_PARSER_VERSION, TARIC_SOURCE_AUTHORITY,
} from './parser';

/** Only these roles may import a release. Mirrors the other staff-only evidence surfaces. */
export const TARIC_IMPORT_PRINCIPALS: readonly UserRole[] = AUTHORITY_RELEASE_IMPORT_PRINCIPALS;

const CIRCABC_GROUP = 'CIRCABC "TARIC & Quota Data and Information" (group 0e5f18c2-4b2f-42e9-aed4-dfe50ae1263b)';
/** The extraction is ~27 MB; the ceiling is generous but finite. */
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

/** EU member states, which all apply the EU common customs tariff. */
export const EU_TARIC_MEMBER_DESTINATIONS: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

/**
 * Separate ISO destinations that legally apply the same tariff authority: Åland is inside the EU
 * customs territory, and Monaco is treated as France for customs. Martinique is an outermost
 * region inside the Union customs territory (Regulation (EU) No 952/2013, Art. 4). San Marino
 * applies the Community customs tariff to third countries under its customs union with the EU
 * (Agreement of 16 December 1991, Arts 1 and 6(1); in force 1 April 2002). Their fiscal and
 * regulatory layers — Åland's tax border, Martinique's octroi de mer, San Marino's import tax —
 * remain distinct and are deliberately not claimed by TARIC.
 */
export const EU_TARIC_ASSOCIATED_DESTINATIONS: readonly string[] = ['AX', 'MC', 'MQ', 'SM'];

/**
 * Destinations in a customs union with the EU for part of the tariff only. TARIC serves them for
 * those HS chapters and refuses the rest, where their own national tariff applies.
 */
export const EU_TARIC_PARTIAL_DESTINATIONS: Readonly<Record<string, { from_chapter: number; to_chapter: number; basis: string }>> = Object.freeze({
  AD: {
    from_chapter: 25,
    to_chapter: 97,
    basis: 'EEC–Andorra customs union for HS chapters 25–97 (Council Decision of 26 November 1990, OJ L 374, 31.12.1990)',
  },
});

export const EU_TARIC_DESTINATIONS: readonly string[] = [
  ...EU_TARIC_MEMBER_DESTINATIONS,
  ...EU_TARIC_ASSOCIATED_DESTINATIONS,
  ...Object.keys(EU_TARIC_PARTIAL_DESTINATIONS),
];

export const TARIC_RELEASE_SOURCE: AuthorityReleaseSource = Object.freeze({
  source_family: 'EU_TARIC',
  authority: TARIC_SOURCE_AUTHORITY,
  destination_scope: EU_TARIC_DESTINATIONS,
  source_distribution: CIRCABC_GROUP,
  source_format: 'zip+xlsx',
  content_type: 'application/zip',
  max_bundle_bytes: MAX_BUNDLE_BYTES,
  reader_version: TARIC_BUNDLE_READER_VERSION,
  parser_version: TARIC_PARSER_VERSION,
});

export const isEuTaricDestination = (countryCode: string) =>
  EU_TARIC_DESTINATIONS.includes(countryCode.trim().toUpperCase());

/**
 * The Commission's reference date is the first day of the extraction month, and the label follows
 * it. Derived from the caller's stated month rather than from wall-clock time, so re-importing an
 * older bundle does not silently relabel it as this month's.
 */
function releaseIdentity(referenceMonth: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(referenceMonth.trim());
  if (!match) {
    throw validationError([{ field: 'reference_month', code: 'invalid', message: 'The TARIC reference month must be YYYY-MM, matching the extraction you downloaded.' }]);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw validationError([{ field: 'reference_month', code: 'invalid', message: 'That is not a calendar month.' }]);
  }
  return { label: `TARIC ${match[1]}-${match[2]}`, reference_date: new Date(Date.UTC(year, month - 1, 1)) };
}

export interface ImportTaricReleaseArgs {
  actor: Principal;
  bytes: Buffer;
  /** `YYYY-MM` — the month of the extraction as published by the Commission. */
  reference_month: string;
  /** Activate immediately so new ingests resolve against it. */
  activate?: boolean;
  correlation_id: string;
}

/**
 * Validate and record an official TARIC extraction.
 *
 * Re-uploading byte-identical bytes returns the existing release rather than creating a rival —
 * the checksum IS the release identity, enforced by a unique index rather than a read-then-write.
 */
export async function importTaricRelease(args: ImportTaricReleaseArgs) {
  const identity = releaseIdentity(args.reference_month);
  return importAuthorityRelease({
    actor: args.actor,
    source: TARIC_RELEASE_SOURCE,
    bytes: args.bytes,
    label: identity.label,
    release_identifier: identity.label,
    reference_date: identity.reference_date,
    source_url: CIRCABC_GROUP,
    activate: args.activate,
    correlation_id: args.correlation_id,
    validate: async (bytes) => {
      let bundle: TaricBundle;
      try {
        bundle = await readTaricBundle(bytes);
      } catch (error) {
        if (error instanceof TaricBundleError) {
          throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
        }
        throw error;
      }
      return {
        file_manifest: bundle.files as unknown as Record<string, unknown>[],
        validation: { required_files_present: true, file_count: bundle.files.length, schema_checked: true },
      };
    },
  });
}

/** Promote an imported release to active. */
export async function activateTaricRelease(args: { actor: Principal; release_id: string; correlation_id: string; acknowledge_unqualified?: boolean }) {
  return activateAuthorityRelease(args);
}

export async function activeTaricRelease() {
  return activeAuthorityRelease(TARIC_RELEASE_SOURCE.source_family, TARIC_RELEASE_SOURCE.authority);
}

export async function listTaricReleases() {
  return listAuthorityReleases(TARIC_RELEASE_SOURCE.source_family);
}

/**
 * Cached parsed bundles, keyed by checksum: parsing 146k measure rows is not free.
 *
 * The weight is the measured ~150MB a decoded TARIC bundle retains after the streaming/interning
 * reader (was ~500MB before it). Residency is decided by the shared process-wide budget rather
 * than a per-family capacity, because co-residency across families — not any single family — is
 * what OOM'd a worker.
 */
const bundleCache = new SharedBudgetBundleCache<TaricBundle>('EU_TARIC', 150 * 1024 * 1024);

async function loadTaricBundle(releaseId?: string) {
  const release = releaseId
    ? (await loadAuthorityReleaseArtifact(releaseId)).release
    : await activeTaricRelease();
  if (!release) return null;
  if (release.source_family !== TARIC_RELEASE_SOURCE.source_family || release.authority !== TARIC_RELEASE_SOURCE.authority) {
    throw validationError([{ field: 'release', code: 'wrong_authority', message: 'That release is not an EU TARIC release.' }]);
  }
  const cached = bundleCache.get(release.checksum);
  if (cached) return { release, bundle: cached };
  const { bytes } = await loadAuthorityReleaseArtifact(release.id);
  const bundle = await readTaricBundle(bytes);
  // The stored artifact is re-checksummed on read: a release must never be served from bytes that
  // differ from the ones that were imported and audited.
  if (bundle.bundle_sha256 !== release.checksum) {
    throw new Error(`Stored TARIC artifact for release ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.checksum, bundle);
  return { release, bundle };
}

/**
 * Produce Market Access evidence for an EU destination from the active TARIC release.
 *
 * Every EU member state resolves against the SAME release and the same raw artifact — the EU has
 * one customs tariff — while the returned result keeps the destination as its own country scope so
 * assessments, requirements and any future national measure stay separately attributable.
 */
export async function fetchEuTaricMarketAccess(
  hs6: string,
  options: { now?: Date; destination_country: string; origin_country?: string; release_id?: string; parser_version?: string },
): Promise<MarketAccessIngestResult> {
  const destination = options.destination_country.trim().toUpperCase();
  if (!isEuTaricDestination(destination)) {
    throw validationError([{ field: 'destination_country', code: 'not_eu', message: `${destination} does not apply the EU common customs tariff; TARIC evidence must not be used for it.` }]);
  }
  const partial = EU_TARIC_PARTIAL_DESTINATIONS[destination];
  const chapter = Number(hs6.slice(0, 2));
  if (partial && !(chapter >= partial.from_chapter && chapter <= partial.to_chapter)) {
    throw validationError([{
      field: 'hs6',
      code: 'outside_customs_union',
      message: `${destination} applies the EU common customs tariff only to HS chapters ${partial.from_chapter}–${partial.to_chapter} (${partial.basis}); its own tariff applies to chapter ${hs6.slice(0, 2)}, so TARIC evidence must not be used for it.`,
    }]);
  }
  const loaded = await loadTaricBundle(options.release_id);
  if (!loaded) throw notFound('No official TARIC release has been imported yet.');
  const at = options.now ?? new Date();
  const resolution = resolveTaric(loaded.bundle, { hs6, at, origin_country: options.origin_country ?? 'IN' });
  const result = buildTaricIngest({
    bundle: loaded.bundle,
    resolution,
    destination_country: destination,
    release_label: loaded.release.label,
    release_reference_date: loaded.release.reference_date,
    retrieved_at: loaded.release.retrieved_at,
    origin_country: (options.origin_country ?? 'IN').toUpperCase(),
    parser_version: options.parser_version,
  });
  return {
    ...result,
    source_release_id: loaded.release.id,
    request_identity: `origin=${(options.origin_country ?? 'IN').toUpperCase()};as_of=${at.toISOString().slice(0, 10)}`,
  };
}

/** Reparse retained TARIC bytes without reacquiring or rewriting old evidence. */
export async function reparseTaricAuthorityRelease(args: {
  actor: Principal;
  release_id: string;
  destination_country: string;
  hs6: string;
  parser_version: string;
  now?: Date;
  origin_country?: string;
  correlation_id: string;
}) {
  if (!TARIC_IMPORT_PRINCIPALS.includes(args.actor.role)) {
    const { forbidden } = await import('@/lib/errors');
    throw forbidden('Only ClearTrade operations staff can reparse an official authority release.');
  }
  assertCan(args.actor, 'demand_discovery.run');
  const result = await fetchEuTaricMarketAccess(args.hs6, {
    destination_country: args.destination_country,
    origin_country: args.origin_country,
    now: args.now,
    release_id: args.release_id,
    parser_version: args.parser_version,
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
      destination_country: args.destination_country,
      hs6: args.hs6,
      snapshot_id: snapshot.id,
    },
    correlation_id: args.correlation_id,
  });
  return snapshot;
}

/** Exposed for tests that need a deterministic cache. */
export const __test__ = { bundleCache };
