/**
 * E-069 — the yearly re-check of a tariff source that has no publishing rhythm.
 *
 * Such a source (the GCC tariff from Dubai Customs, the UEMOA edition of the ECOWAS tariff, and
 * others, docs/37) is due for a re-check a year after its edition's date. Until now, finding the
 * same edition still in force changed nothing, so the source stayed "Overdue" on the ops page for
 * good. A re-check now compares the official files fetched today with the release's own, byte for
 * byte (SHA-256): when every one matches, it is recorded (an audit event on the release) and the
 * next re-check falls due a year later; when any differs, there is a new edition to import.
 */
import { AuditSource } from '@prisma/client';
import { writeAuditEvent } from '@/lib/audit';
import { forbidden } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';
import { AUTHORITY_RELEASE_IMPORT_PRINCIPALS } from './authority-releases';

export const SOURCE_RECHECK_ACTION = 'authority_source_rechecked' as const;
/** The audit object type every other tariff-release event uses (import, activation, unchanged acquisition). */
const RELEASE_OBJECT = 'authority_release' as const;

export interface ReleaseFile { name: string; role?: string; url?: string; sha256?: string; size_bytes?: number }

/** The official files a release was read from: its manifest without what ClearTrade derived from them. */
export function officialFiles(manifest: unknown): ReleaseFile[] {
  if (!Array.isArray(manifest)) return [];
  return manifest
    .filter((file): file is ReleaseFile => !!file && typeof file === 'object' && typeof (file as ReleaseFile).name === 'string' && typeof (file as ReleaseFile).sha256 === 'string')
    .filter((file) => !/normali[sz]ed|canonical|lines_read/i.test(`${file.name} ${file.role ?? ''}`) && !/^(?:acquisition|manifest)\.json$/i.test(file.name));
}

export type RecheckOutcome =
  | { status: 'unchanged'; files: { name: string; sha256: string }[] }
  | { status: 'changed'; differing: { file: string; sha256: string }[]; not_supplied: string[] };

/**
 * Today's files against the release's own. Unchanged only when every file supplied is one of the
 * release's official files and every official file was supplied.
 */
export function compareWithRelease(official: readonly ReleaseFile[], fetched: readonly { file: string; sha256: string }[]): RecheckOutcome {
  const differing = fetched.filter((item) => !official.some((file) => file.sha256 === item.sha256));
  const notSupplied = official.filter((file) => !fetched.some((item) => item.sha256 === file.sha256)).map((file) => file.name);
  if (!official.length || differing.length || notSupplied.length) return { status: 'changed', differing, not_supplied: notSupplied };
  return { status: 'unchanged', files: official.map((file) => ({ name: file.name, sha256: file.sha256! })) };
}

/** Records an unchanged re-check of an active release. Operations staff only, like an import. */
export async function recordSourceRecheck(args: { actor: Principal; release_id: string; checked_on: Date; files: readonly { name: string; sha256: string }[]; correlation_id: string }) {
  if (!AUTHORITY_RELEASE_IMPORT_PRINCIPALS.includes(args.actor.role)) throw forbidden('Only ClearTrade operations staff can record a tariff source re-check.');
  if (Number.isNaN(args.checked_on.getTime())) throw new Error('A re-check needs a valid date.');
  await writeAuditEvent({
    actor: args.actor, action: SOURCE_RECHECK_ACTION, object_type: RELEASE_OBJECT, object_id: args.release_id,
    after_summary: { checked_on: args.checked_on.toISOString().slice(0, 10), outcome: 'unchanged', files: args.files.map((file) => ({ ...file })) },
    correlation_id: args.correlation_id, source: AuditSource.admin,
  });
}

/** The newest recorded re-check of each release, by release id. */
export async function latestSourceRechecks(releaseIds: readonly string[]): Promise<Map<string, Date>> {
  const latest = new Map<string, Date>();
  if (!releaseIds.length) return latest;
  const events = await prisma.auditEvent.findMany({
    where: { action: SOURCE_RECHECK_ACTION, object_type: RELEASE_OBJECT, object_id: { in: [...releaseIds] } },
    select: { object_id: true, after_summary: true },
  });
  for (const event of events) {
    const value = event.after_summary && typeof event.after_summary === 'object' ? (event.after_summary as { checked_on?: unknown }).checked_on : null;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    const date = new Date(`${value}T00:00:00.000Z`);
    const prior = latest.get(event.object_id);
    if (!prior || date > prior) latest.set(event.object_id, date);
  }
  return latest;
}
