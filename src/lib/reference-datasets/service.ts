/**
 * Import and read reference dataset releases (docs/36 §3.2).
 *
 * A release holds the publisher's rows exactly as parsed, with the source file's sha256 and a
 * checksum over the rows. Importing a newer source supersedes the active release in the same
 * transaction, so there is always at most one active release per dataset and environment, and the
 * old one stays readable for the runs that froze it.
 */
import { createHash } from 'node:crypto';
import { EvidenceOrigin, ReferenceDatasetReleaseStatus, UserRole, type Prisma } from '@prisma/client';
import type { z } from 'zod';
import { writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { referenceDatasetDefinition } from './registry';

export const REFERENCE_DATASET_IMPORT_PRINCIPALS: readonly UserRole[] = [UserRole.ops_supervisor, UserRole.admin];

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}

export function rowsSha256(rows: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(canonical(rows))).digest('hex');
}

export interface ImportReferenceDatasetArgs {
  actor: Principal;
  dataset_key: string;
  bytes: Buffer;
  source_url: string;
  retrieved_at: Date;
  correlation_id: string;
  evidence_origin?: EvidenceOrigin;
}

export async function importReferenceDataset(args: ImportReferenceDatasetArgs): Promise<{ change: 'NEW' | 'UNCHANGED'; release_id: string; row_count: number; version: string }> {
  if (!REFERENCE_DATASET_IMPORT_PRINCIPALS.includes(args.actor.role)) throw forbidden('Only ClearTrade operations staff can import a reference dataset.');
  const definition = referenceDatasetDefinition(args.dataset_key);
  const environment = appEnvironment();
  const sourceSha256 = createHash('sha256').update(args.bytes).digest('hex');

  const existing = await prisma.referenceDatasetRelease.findFirst({
    where: { dataset_key: definition.key, source_sha256: sourceSha256, parser_version: definition.parser_version, environment },
  });
  if (existing) {
    if (existing.status !== ReferenceDatasetReleaseStatus.active) {
      throw validationError([{ field: 'file', code: 'superseded', message: `These bytes were imported as release ${existing.id}, since superseded. Re-activating an older source is not supported.` }],
        `These bytes were imported as release ${existing.id}, since superseded. Re-activating an older source is not supported.`);
    }
    await writeAuditEvent({
      actor: args.actor, action: 'acquisition_unchanged', object_type: 'reference_dataset_release', object_id: existing.id,
      after_summary: { change_classification: 'UNCHANGED', dataset_key: definition.key, source_sha256: sourceSha256 }, correlation_id: args.correlation_id,
    });
    return { change: 'UNCHANGED', release_id: existing.id, row_count: existing.row_count, version: existing.version };
  }

  const parsed = definition.parse(args.bytes);
  for (const [index, row] of parsed.rows.entries()) {
    const check = definition.row_schema.safeParse(row);
    if (!check.success) throw new Error(`${definition.key} row ${index} fails its schema: ${check.error.issues[0]?.message ?? 'invalid'}.`);
  }
  const rows = parsed.rows as Prisma.InputJsonValue[];
  const created = await prisma.$transaction(async (tx) => {
    const previous = await tx.referenceDatasetRelease.findFirst({ where: { dataset_key: definition.key, environment, status: ReferenceDatasetReleaseStatus.active } });
    if (previous) {
      await tx.referenceDatasetRelease.update({ where: { id: previous.id }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
    }
    const release = await tx.referenceDatasetRelease.create({
      data: {
        dataset_key: definition.key, version: parsed.version, source_url: args.source_url, source_sha256: sourceSha256, source_bytes: args.bytes.length,
        licence: definition.licence, retrieved_at: args.retrieved_at, parser_version: definition.parser_version, row_count: rows.length,
        rows, rows_sha256: rowsSha256(parsed.rows), validation: parsed.validation as Prisma.InputJsonValue, environment,
        evidence_origin: args.evidence_origin ?? EvidenceOrigin.imported_real, imported_by_id: args.actor.id, correlation_id: args.correlation_id,
      },
    });
    await writeAuditEvent({
      actor: args.actor, action: 'reference_dataset_release_imported', object_type: 'reference_dataset_release', object_id: release.id,
      after_summary: { change_classification: 'NEW', dataset_key: definition.key, version: parsed.version, row_count: rows.length, superseded_release_id: previous?.id ?? null },
      correlation_id: args.correlation_id, db: tx,
    });
    return release;
  });
  return { change: 'NEW', release_id: created.id, row_count: created.row_count, version: created.version };
}

export interface ActiveReferenceRows<T> {
  release_id: string;
  version: string;
  rows_sha256: string;
  retrieved_at: Date;
  evidence_origin: EvidenceOrigin;
  rows: T[];
}

/** The active release's rows for a dataset, re-validated against its schema, or null when none is active. */
export async function activeReferenceRows<S extends z.ZodTypeAny>(datasetKey: string, schema: S): Promise<ActiveReferenceRows<z.infer<S>> | null> {
  const release = await prisma.referenceDatasetRelease.findFirst({ where: { dataset_key: datasetKey, environment: appEnvironment(), status: ReferenceDatasetReleaseStatus.active } });
  if (!release) return null;
  const rows = release.rows as unknown[];
  if (rowsSha256(rows) !== release.rows_sha256) throw new Error(`Reference dataset release ${release.id} rows no longer match their checksum.`);
  return { release_id: release.id, version: release.version, rows_sha256: release.rows_sha256, retrieved_at: release.retrieved_at, evidence_origin: release.evidence_origin, rows: rows.map((row) => schema.parse(row)) };
}

/** A specific release's rows, for a run re-reading the release it froze. */
export async function referenceRowsByRelease<S extends z.ZodTypeAny>(releaseId: string, schema: S): Promise<ActiveReferenceRows<z.infer<S>>> {
  const release = await prisma.referenceDatasetRelease.findUnique({ where: { id: releaseId } });
  if (!release) throw notFound('That reference dataset release does not exist.');
  const rows = release.rows as unknown[];
  if (rowsSha256(rows) !== release.rows_sha256) throw new Error(`Reference dataset release ${release.id} rows no longer match their checksum.`);
  return { release_id: release.id, version: release.version, rows_sha256: release.rows_sha256, retrieved_at: release.retrieved_at, evidence_origin: release.evidence_origin, rows: rows.map((row) => schema.parse(row)) };
}
