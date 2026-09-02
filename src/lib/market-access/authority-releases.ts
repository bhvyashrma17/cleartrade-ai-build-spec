/**
 * One retained-release lifecycle for every bulk/file customs authority.
 *
 * TARIC was the first implementation. Its physical table is intentionally retained, while
 * Prisma maps the widened record as AuthorityRelease so Canada and future packs reuse the same
 * archive, activation, change-detection and integrity path.
 */
import { createHash } from 'node:crypto';
import {
  AuthorityReleaseChange,
  AuthorityReleaseStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { getDocumentStorage } from '@/lib/document-storage';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { assertCan } from '@/lib/permissions';
import { releaseQualificationVerdict, requiresBulkQualification } from '@/lib/market-access/bulk-release-gate';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export const AUTHORITY_RELEASE_IMPORT_PRINCIPALS: readonly UserRole[] = [
  UserRole.ops_supervisor,
  UserRole.admin,
];

export interface AuthorityReleaseSource {
  source_family: string;
  authority: string;
  destination_scope: readonly string[];
  source_distribution: string;
  source_format: string;
  content_type: string;
  max_bundle_bytes: number;
  reader_version: string;
  parser_version: string;
}

export interface AuthorityReleaseValidation {
  file_manifest: readonly Record<string, unknown>[];
  validation: Record<string, unknown>;
}

export interface ImportAuthorityReleaseArgs {
  actor: Principal;
  source: AuthorityReleaseSource;
  bytes: Buffer;
  label: string;
  release_identifier: string;
  reference_date: Date;
  retrieved_at?: Date;
  source_url: string;
  activate?: boolean;
  /**
   * Deliberate, audited override allowing a bulk-archive family to be activated on import without
   * a real-archive qualification. Exists so an operator can act in an emergency, not so callers can
   * routinely skip the gate — the override is recorded on the activation audit event.
   */
  acknowledge_unqualified?: boolean;
  correlation_id: string;
  validate(bytes: Buffer): Promise<AuthorityReleaseValidation>;
}

function assertImporter(actor: Principal) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(actor.role)) {
    throw forbidden('Only ClearTrade operations staff can import an official authority release.');
  }
  assertCan(actor, 'demand_discovery.run');
}

function cleanIdentity(value: string, field: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw validationError([{ field, code: 'required', message: `${field.replaceAll('_', ' ')} is required.` }]);
  }
  return cleaned;
}

function normalizedDestinations(destinations: readonly string[]) {
  const normalized = [...new Set(destinations.map((code) => code.trim().toUpperCase()))].sort();
  if (!normalized.length || normalized.some((code) => !/^[A-Z]{2}$/.test(code))) {
    throw validationError([{ field: 'destination_scope', code: 'invalid', message: 'Authority release destinations must be ISO alpha-2 codes.' }]);
  }
  return normalized;
}

async function unchangedResult(args: ImportAuthorityReleaseArgs, checksum: string) {
  const sourceFamily = args.source.source_family.trim();
  const authority = args.source.authority.trim();
  const releaseIdentifier = args.release_identifier.trim();
  const existing = await prisma.authorityRelease.findFirst({
    where: {
      source_family: sourceFamily,
      authority,
      release_identifier: releaseIdentifier,
      checksum,
    },
  });
  if (!existing) return null;
  await writeAuditEvent({
    actor: args.actor,
    action: 'acquisition_unchanged',
    object_type: 'authority_release',
    object_id: existing.id,
    exporter_org_id: null,
    after_summary: {
      change_classification: 'UNCHANGED',
      release_identifier: releaseIdentifier,
      checksum,
      compared_to_release_id: existing.id,
    },
    correlation_id: args.correlation_id,
  });
  return { release: existing, created: false, change: 'UNCHANGED' as const };
}

/** Validate, retain and optionally activate one official source release. */
export async function importAuthorityRelease(args: ImportAuthorityReleaseArgs) {
  assertImporter(args.actor);
  const sourceFamily = cleanIdentity(args.source.source_family, 'source_family');
  const authority = cleanIdentity(args.source.authority, 'authority');
  const label = cleanIdentity(args.label, 'label');
  const releaseIdentifier = cleanIdentity(args.release_identifier, 'release_identifier');
  const sourceUrl = cleanIdentity(args.source_url, 'source_url');
  const destinations = normalizedDestinations(args.source.destination_scope);
  if (args.bytes.length === 0) {
    throw validationError([{ field: 'bundle', code: 'required', message: 'No authority release was supplied.' }]);
  }
  if (args.bytes.length > args.source.max_bundle_bytes) {
    throw validationError([{ field: 'bundle', code: 'too_large', message: 'That authority release is larger than the configured maximum.' }]);
  }
  if (Number.isNaN(args.reference_date.getTime())) {
    throw validationError([{ field: 'reference_date', code: 'invalid', message: 'The authority release reference date is invalid.' }]);
  }

  // A bulk-archive family may not go straight from import to active. Qualification measures the
  // retained artifact, which only exists once the import has stored it, so the safe order is
  // import -> qualify -> activate. Refusing here (before any bytes are stored) keeps that ordering
  // enforceable without leaving a half-created release behind when it is violated.
  if (args.activate && requiresBulkQualification(sourceFamily) && !args.acknowledge_unqualified) {
    throw validationError([{
      field: 'activate',
      code: 'qualification_required',
      message: `${sourceFamily} is a bulk-archive family: import it first, run scripts/qualify-bulk-release.ts against the retained artifact, then activate. Activating on import would make an unmeasured archive live on a 1GB worker.`,
    }]);
  }

  const checksum = createHash('sha256').update(args.bytes).digest('hex');
  const unchanged = await unchangedResult(args, checksum);
  if (unchanged) return unchanged;

  // Parse before storage: malformed or schema-shifted bytes never become an accepted release.
  const checked = await args.validate(args.bytes);
  const previous = await prisma.authorityRelease.findFirst({
    where: { source_family: sourceFamily, authority },
    orderBy: [{ reference_date: 'desc' }, { imported_at: 'desc' }],
  });
  const change = previous?.release_identifier === releaseIdentifier
    ? AuthorityReleaseChange.CHANGED
    : AuthorityReleaseChange.NEW_RELEASE;
  const stored = await getDocumentStorage().put({
    bytes: args.bytes,
    contentType: args.source.content_type,
    sha256: checksum,
  });
  const retrievedAt = args.retrieved_at ?? new Date();

  let release;
  try {
    release = await prisma.$transaction(async (tx) => {
      if (args.activate) {
        await tx.authorityRelease.updateMany({
          where: { source_family: sourceFamily, authority, status: AuthorityReleaseStatus.active },
          data: { status: AuthorityReleaseStatus.superseded, superseded_at: retrievedAt },
        });
      }
      return tx.authorityRelease.create({
        data: {
          label,
          source_family: sourceFamily,
          authority,
          destination_scope: destinations,
          source_url: sourceUrl,
          release_identifier: releaseIdentifier,
          reference_date: args.reference_date,
          source_distribution: args.source.source_distribution,
          retrieved_at: retrievedAt,
          source_format: args.source.source_format,
          checksum,
          size_bytes: args.bytes.length,
          artifact_object_key: stored.objectKey,
          file_manifest: checked.file_manifest as unknown as Prisma.InputJsonValue,
          reader_version: args.source.reader_version,
          parser_version: args.source.parser_version,
          status: args.activate ? AuthorityReleaseStatus.active : AuthorityReleaseStatus.imported,
          activated_at: args.activate ? retrievedAt : null,
          validation: checked.validation as Prisma.InputJsonValue,
          change_classification: change,
          change_basis: {
            compared_to_release_id: previous?.id ?? null,
            previous_release_identifier: previous?.release_identifier ?? null,
            previous_checksum: previous?.checksum ?? null,
            current_release_identifier: releaseIdentifier,
            current_checksum: checksum,
          },
          previous_release_id: previous?.id ?? null,
          imported_by_id: args.actor.id,
          correlation_id: args.correlation_id,
        },
      });
    });
  } catch (error) {
    // Two workers may validate/store the same bytes concurrently. The database identity wins;
    // the loser resolves to the existing immutable release rather than creating a rival.
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const raced = await unchangedResult(args, checksum);
    if (!raced) throw error;
    return raced;
  }

  await writeAuditEvent({
    actor: args.actor,
    action: AUDIT_ACTIONS.create,
    object_type: 'authority_release',
    object_id: release.id,
    exporter_org_id: null,
    after_summary: {
      source_family: sourceFamily,
      authority,
      destinations,
      release_identifier: releaseIdentifier,
      reference_date: args.reference_date.toISOString(),
      checksum,
      change_classification: change,
      previous_release_id: previous?.id ?? null,
      status: release.status,
    },
    correlation_id: args.correlation_id,
  });
  return { release, created: true, change };
}

/** Promote one release while preserving one-active-per-source atomically. */
export async function activateAuthorityRelease(args: {
  actor: Principal;
  release_id: string;
  correlation_id: string;
  /** Deliberate, audited override when a bulk release must be activated without qualification. */
  acknowledge_unqualified?: boolean;
}) {
  assertImporter(args.actor);
  const release = await prisma.authorityRelease.findUnique({ where: { id: args.release_id } });
  if (!release) throw notFound('That authority release does not exist.');
  if (release.status === AuthorityReleaseStatus.rejected) {
    throw validationError([{ field: 'status', code: 'rejected', message: 'A rejected release cannot become the source of evidence.' }]);
  }
  // Operational qualification is enforced here rather than in CI: activation is the moment a
  // release becomes the one a 1GB worker actually decodes, so it is the point where an unmeasured
  // bulk archive stops being a theoretical risk. Non-bulk families are exempt by declaration, and
  // `--force-unqualified` exists for a deliberate, audited operator override.
  const verdict = await releaseQualificationVerdict(release);
  if (!verdict.trusted && !args.acknowledge_unqualified) {
    throw validationError([{
      field: 'operational_qualification',
      code: verdict.reason,
      message: `${verdict.detail} Activation is blocked until a passing real-archive qualification exists, or an operator explicitly acknowledges the gap.`,
    }]);
  }
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    await tx.authorityRelease.updateMany({
      where: {
        source_family: release.source_family,
        authority: release.authority,
        status: AuthorityReleaseStatus.active,
        id: { not: release.id },
      },
      data: { status: AuthorityReleaseStatus.superseded, superseded_at: now },
    });
    return tx.authorityRelease.update({
      where: { id: release.id },
      data: { status: AuthorityReleaseStatus.active, activated_at: release.activated_at ?? now },
    });
  });
  await writeAuditEvent({
    actor: args.actor,
    action: AUDIT_ACTIONS.state_change,
    object_type: 'authority_release',
    object_id: release.id,
    exporter_org_id: null,
    before_summary: { status: release.status },
    after_summary: {
      status: updated.status,
      operational_qualification: verdict.reason,
      qualification_acknowledged_unqualified: !verdict.trusted,
    },
    correlation_id: args.correlation_id,
  });
  return updated;
}

export function activeAuthorityRelease(sourceFamily: string, authority: string) {
  return prisma.authorityRelease.findFirst({
    where: {
      source_family: sourceFamily,
      authority,
      status: AuthorityReleaseStatus.active,
    },
    orderBy: { reference_date: 'desc' },
  });
}

export function listAuthorityReleases(sourceFamily?: string) {
  return prisma.authorityRelease.findMany({
    where: sourceFamily ? { source_family: sourceFamily } : undefined,
    orderBy: { imported_at: 'desc' },
    take: 50,
  });
}

/** Read retained bytes and fail closed if storage no longer matches the audited fingerprint. */
export async function loadAuthorityReleaseArtifact(releaseId: string) {
  const release = await prisma.authorityRelease.findUnique({ where: { id: releaseId } });
  if (!release) throw notFound('That authority release does not exist.');
  const bytes = await getDocumentStorage().get(release.artifact_object_key);
  const checksum = createHash('sha256').update(bytes).digest('hex');
  if (checksum !== release.checksum) {
    throw new Error(`Stored authority artifact for release ${release.id} does not match its recorded checksum.`);
  }
  return { release, bytes };
}
