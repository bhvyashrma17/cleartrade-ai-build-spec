/**
 * Import official importer lists (D-033, docs/38 §2) and read the active ones.
 *
 * A release is one file set for one period, identified by the sha256 of its file manifest. The same
 * bytes again are UNCHANGED. A new file set for a period that already has an active release
 * supersedes it in the same transaction (HMRC revises and re-publishes); other periods stay active,
 * because each month's list is a separate observation.
 */
import { EvidenceOrigin, ReferenceDatasetReleaseStatus, UserRole, type Prisma } from '@prisma/client';
import { writeAuditEvent } from '@/lib/audit';
import { forbidden, validationError } from '@/lib/errors';
import { appEnvironment } from '@/lib/evidence-environment';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { fileManifest, IMPORTER_LIST_SOURCES, parseHmrcImporterFile, type ImporterListSourceKey, type ParsedImporterList, type SourceFile } from './importer-lists';

export const IMPORTER_LIST_IMPORT_PRINCIPALS: readonly UserRole[] = [UserRole.ops_supervisor, UserRole.admin];
const CHUNK = 2_000;

async function parse(sourceKey: ImporterListSourceKey, files: SourceFile[]): Promise<ParsedImporterList> {
  if (sourceKey === 'uk_hmrc_importers') {
    if (files.length !== 1) throw validationError([{ field: 'file', code: 'one_file', message: 'An HMRC importer list is one monthly file.' }], 'An HMRC importer list is one monthly file.');
    return parseHmrcImporterFile(files[0]!);
  }
  // ISED's site was down for maintenance on 22 Oct 2026, so its file layout has not been read yet.
  const message = 'The Canadian Importers Database reader is not built yet: its files could not be read when this was written.';
  throw validationError([{ field: 'source', code: 'reader_pending', message }], message);
}

export async function importImporterList(args: {
  actor: Principal;
  source_key: ImporterListSourceKey;
  files: SourceFile[];
  source_url: string;
  retrieved_at: Date;
  correlation_id: string;
  evidence_origin?: EvidenceOrigin;
}): Promise<{ change: 'NEW' | 'UNCHANGED'; release_id: string; period: string; row_count: number; superseded_release_id: string | null; validation: Record<string, unknown> }> {
  if (!IMPORTER_LIST_IMPORT_PRINCIPALS.includes(args.actor.role)) throw forbidden('Only ClearTrade operations staff can import an importer list.');
  const source = IMPORTER_LIST_SOURCES[args.source_key];
  if (!source) throw validationError([{ field: 'source', code: 'unknown', message: `Unknown importer list ${args.source_key}.` }], `Unknown importer list ${args.source_key}.`);
  const environment = appEnvironment();
  const manifest = fileManifest(args.files);

  const existing = await prisma.importerListRelease.findFirst({
    where: { source_key: source.key, source_sha256: manifest.sha256, parser_version: source.parser_version, environment },
  });
  if (existing) {
    if (existing.status !== ReferenceDatasetReleaseStatus.active) {
      const message = `These files were imported as release ${existing.id}, since superseded. Re-activating an older list is not supported.`;
      throw validationError([{ field: 'file', code: 'superseded', message }], message);
    }
    return { change: 'UNCHANGED', release_id: existing.id, period: existing.period, row_count: existing.row_count, superseded_release_id: null, validation: existing.validation as Record<string, unknown> };
  }

  const parsed = await parse(source.key, args.files);
  if (parsed.entries.length === 0) throw validationError([{ field: 'file', code: 'empty', message: 'The list has no importers.' }], 'The list has no importers.');
  const result = await prisma.$transaction(async (tx) => {
    const previous = await tx.importerListRelease.findFirst({ where: { source_key: source.key, environment, period: parsed.period, status: ReferenceDatasetReleaseStatus.active } });
    if (previous) {
      await tx.importerListRelease.update({ where: { id: previous.id }, data: { status: ReferenceDatasetReleaseStatus.superseded, superseded_at: new Date() } });
    }
    const release = await tx.importerListRelease.create({
      data: {
        source_key: source.key, country_code: source.country_code, period: parsed.period, file_manifest: manifest.items as unknown as Prisma.InputJsonValue,
        source_url: args.source_url, source_sha256: manifest.sha256, source_bytes: manifest.bytes, licence: source.licence, parser_version: source.parser_version,
        row_count: parsed.entries.length, validation: parsed.validation as Prisma.InputJsonValue, retrieved_at: args.retrieved_at, environment,
        evidence_origin: args.evidence_origin ?? EvidenceOrigin.public_real, imported_by_id: args.actor.id, correlation_id: args.correlation_id,
      },
    });
    for (let start = 0; start < parsed.entries.length; start += CHUNK) {
      await tx.importerListEntry.createMany({
        data: parsed.entries.slice(start, start + CHUNK).map((entry) => ({ release_id: release.id, ...entry, notes: entry.notes as unknown as Prisma.InputJsonValue })),
      });
    }
    await writeAuditEvent({
      actor: args.actor, action: 'importer_list_release_imported', object_type: 'importer_list_release', object_id: release.id,
      after_summary: { change_classification: 'NEW', source_key: source.key, period: parsed.period, row_count: parsed.entries.length, source_sha256: manifest.sha256, superseded_release_id: previous?.id ?? null },
      correlation_id: args.correlation_id, db: tx,
    });
    return { release, previous };
  }, { timeout: 600_000, maxWait: 20_000 });
  return { change: 'NEW', release_id: result.release.id, period: parsed.period, row_count: parsed.entries.length, superseded_release_id: result.previous?.id ?? null, validation: parsed.validation };
}

export interface ActiveImporterList {
  id: string;
  period: string;
  retrieved_at: Date;
  evidence_origin: EvidenceOrigin;
  source_url: string;
}

/** Active releases of one source in this environment, newest period first; for monthly lists, only the 12 months up to the newest. */
export async function activeImporterLists(sourceKey: ImporterListSourceKey, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<ActiveImporterList[]> {
  const releases = await db.importerListRelease.findMany({
    where: { source_key: sourceKey, environment: appEnvironment(), status: ReferenceDatasetReleaseStatus.active },
    orderBy: { period: 'desc' },
    select: { id: true, period: true, retrieved_at: true, evidence_origin: true, source_url: true },
  });
  if (IMPORTER_LIST_SOURCES[sourceKey].period_kind !== 'month' || releases.length === 0) return releases;
  const [year, month] = releases[0]!.period.split('-').map(Number) as [number, number];
  const oldest = new Date(Date.UTC(year, month - 12, 1));
  const floor = `${oldest.getUTCFullYear()}-${String(oldest.getUTCMonth() + 1).padStart(2, '0')}`;
  return releases.filter((release) => release.period >= floor);
}
