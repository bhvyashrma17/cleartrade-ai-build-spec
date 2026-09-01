/**
 * Importing an official TARIC release, and reading Market Access evidence from it.
 *
 * The exporter never touches any of this. Authorized ClearTrade staff download the monthly
 * extraction from the Commission's CIRCABC group and upload the ORIGINAL archive; everything
 * downstream is machine-read from those bytes. That is what keeps the resulting evidence
 * `authoritative_public` rather than an operator's transcription.
 */
import { createHash } from 'node:crypto';
import { TaricReleaseStatus, UserRole } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getDocumentStorage } from '@/lib/document-storage';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { MarketAccessIngestResult } from '@/lib/market-access/contract';
import type { Principal } from '@/types';
import { readTaricBundle, TaricBundleError, TARIC_BUNDLE_READER_VERSION, type TaricBundle } from './bundle';
import {
  buildTaricIngest, resolveTaric,
  TARIC_PARSER_VERSION, TARIC_SOURCE_AUTHORITY,
} from './parser';

/** Only these roles may import a release. Mirrors the other staff-only evidence surfaces. */
export const TARIC_IMPORT_PRINCIPALS: readonly UserRole[] = [UserRole.ops_supervisor, UserRole.admin];

const CIRCABC_GROUP = 'CIRCABC "TARIC & Quota Data and Information" (group 0e5f18c2-4b2f-42e9-aed4-dfe50ae1263b)';
/** The extraction is ~27 MB; the ceiling is generous but finite. */
const MAX_BUNDLE_BYTES = 200 * 1024 * 1024;

/** EU member states, which all apply the EU common customs tariff. */
export const EU_TARIC_DESTINATIONS: readonly string[] = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT',
  'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];

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
  const { actor } = args;
  if (!TARIC_IMPORT_PRINCIPALS.includes(actor.role)) {
    throw forbidden('Only ClearTrade operations staff can import an official TARIC release.');
  }
  assertCan(actor, 'demand_discovery.run');

  if (args.bytes.length === 0) throw validationError([{ field: 'bundle', code: 'required', message: 'No file was uploaded.' }]);
  if (args.bytes.length > MAX_BUNDLE_BYTES) {
    throw validationError([{ field: 'bundle', code: 'too_large', message: 'That archive is larger than the accepted maximum for a TARIC extraction.' }]);
  }
  const identity = releaseIdentity(args.reference_month);
  const sha256 = createHash('sha256').update(args.bytes).digest('hex');

  const existing = await prisma.taricRelease.findUnique({ where: { bundle_sha256: sha256 } });
  if (existing) return { release: existing, created: false };

  // Validation happens before anything is stored, so a malformed or non-TARIC archive never
  // becomes a release row at all.
  let bundle: TaricBundle;
  try {
    bundle = await readTaricBundle(args.bytes);
  } catch (error) {
    if (error instanceof TaricBundleError) {
      throw validationError([{ field: 'bundle', code: error.code, message: error.message }]);
    }
    throw error;
  }

  const stored = await getDocumentStorage().put({
    bytes: args.bytes,
    contentType: 'application/zip',
    sha256,
  });

  const release = await prisma.taricRelease.create({
    data: {
      label: identity.label,
      reference_date: identity.reference_date,
      source_authority: TARIC_SOURCE_AUTHORITY,
      source_distribution: CIRCABC_GROUP,
      bundle_sha256: sha256,
      bundle_size_bytes: args.bytes.length,
      artifact_object_key: stored.objectKey,
      file_manifest: bundle.files as unknown as object,
      reader_version: TARIC_BUNDLE_READER_VERSION,
      parser_version: TARIC_PARSER_VERSION,
      status: args.activate ? TaricReleaseStatus.active : TaricReleaseStatus.imported,
      activated_at: args.activate ? new Date() : null,
      validation: {
        required_files_present: true,
        file_count: bundle.files.length,
        schema_checked: true,
      },
      imported_by_id: actor.id,
      correlation_id: args.correlation_id,
    },
  });

  // Exactly one active release: a partial unique index enforces it, so the previous active one is
  // superseded in the same transaction rather than left to race.
  if (args.activate) {
    await prisma.taricRelease.updateMany({
      where: { status: TaricReleaseStatus.active, id: { not: release.id } },
      data: { status: TaricReleaseStatus.superseded, superseded_at: new Date() },
    });
  }

  await writeAuditEvent({
    actor, action: AUDIT_ACTIONS.create, object_type: 'taric_release', object_id: release.id,
    exporter_org_id: null,
    after_summary: {
      label: release.label, reference_date: release.reference_date.toISOString(),
      bundle_sha256: sha256, files: bundle.files.length, status: release.status,
    },
    correlation_id: args.correlation_id,
  });
  return { release, created: true };
}

/** Promote an imported release to active. */
export async function activateTaricRelease(args: { actor: Principal; release_id: string; correlation_id: string }) {
  if (!TARIC_IMPORT_PRINCIPALS.includes(args.actor.role)) throw forbidden('Only ClearTrade operations staff can activate a TARIC release.');
  assertCan(args.actor, 'demand_discovery.run');
  const release = await prisma.taricRelease.findUnique({ where: { id: args.release_id } });
  if (!release) throw notFound('That TARIC release does not exist.');
  if (release.status === TaricReleaseStatus.rejected) {
    throw validationError([{ field: 'status', code: 'rejected', message: 'A rejected release cannot become the source of evidence.' }]);
  }
  const now = new Date();
  await prisma.taricRelease.updateMany({
    where: { status: TaricReleaseStatus.active, id: { not: release.id } },
    data: { status: TaricReleaseStatus.superseded, superseded_at: now },
  });
  const updated = await prisma.taricRelease.update({
    where: { id: release.id },
    data: { status: TaricReleaseStatus.active, activated_at: release.activated_at ?? now },
  });
  await writeAuditEvent({
    actor: args.actor, action: AUDIT_ACTIONS.state_change, object_type: 'taric_release', object_id: release.id,
    exporter_org_id: null, before_summary: { status: release.status }, after_summary: { status: updated.status },
    correlation_id: args.correlation_id,
  });
  return updated;
}

export async function activeTaricRelease() {
  return prisma.taricRelease.findFirst({ where: { status: TaricReleaseStatus.active }, orderBy: { reference_date: 'desc' } });
}

export async function listTaricReleases() {
  return prisma.taricRelease.findMany({ orderBy: { imported_at: 'desc' }, take: 25 });
}

/** Cached parsed bundles, keyed by checksum: parsing 146k measure rows is not free. */
const bundleCache = new Map<string, TaricBundle>();

async function loadActiveBundle() {
  const release = await activeTaricRelease();
  if (!release) return null;
  const cached = bundleCache.get(release.bundle_sha256);
  if (cached) return { release, bundle: cached };
  const bytes = await getDocumentStorage().get(release.artifact_object_key);
  const bundle = await readTaricBundle(bytes);
  // The stored artifact is re-checksummed on read: a release must never be served from bytes that
  // differ from the ones that were imported and audited.
  if (bundle.bundle_sha256 !== release.bundle_sha256) {
    throw new Error(`Stored TARIC artifact for release ${release.id} does not match its recorded checksum.`);
  }
  bundleCache.set(release.bundle_sha256, bundle);
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
  options: { now?: Date; destination_country: string; origin_country?: string },
): Promise<MarketAccessIngestResult> {
  const destination = options.destination_country.trim().toUpperCase();
  if (!isEuTaricDestination(destination)) {
    throw validationError([{ field: 'destination_country', code: 'not_eu', message: `${destination} does not apply the EU common customs tariff; TARIC evidence must not be used for it.` }]);
  }
  const loaded = await loadActiveBundle();
  if (!loaded) throw notFound('No official TARIC release has been imported yet.');
  const at = options.now ?? new Date();
  const resolution = resolveTaric(loaded.bundle, { hs6, at, origin_country: options.origin_country ?? 'IN' });
  return buildTaricIngest({
    bundle: loaded.bundle,
    resolution,
    destination_country: destination,
    release_label: loaded.release.label,
    release_reference_date: loaded.release.reference_date,
    retrieved_at: at,
    origin_country: (options.origin_country ?? 'IN').toUpperCase(),
  });
}

/** Exposed for tests that need a deterministic cache. */
export const __test__ = { bundleCache };
