import { DerivedDataPolicy, type ImportRecord, Prisma, RawRetentionPolicy, type SourceRightsGrant } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { isRealWorkflowEnvironment } from '@/lib/evidence-environment';

export type ImportRecordUse = 'display' | 'export' | 'cache';

export class ImportRecordRightsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportRecordRightsError';
  }
}

/** Enforce rights at the row boundary; callers must not rely on a provider-wide contract. */
export function assertImportRecordUse(
  record: Pick<ImportRecord, 'allowed_to_display' | 'allowed_to_export' | 'allowed_to_cache' | 'retention_limit'>,
  use: ImportRecordUse,
  now = new Date(),
) {
  if (record.retention_limit && record.retention_limit <= now) {
    throw new ImportRecordRightsError('Import record retention period has expired.');
  }
  const allowed = use === 'display'
    ? record.allowed_to_display
    : use === 'export'
      ? record.allowed_to_export
      : record.allowed_to_cache;
  if (!allowed) throw new ImportRecordRightsError(`Import record is not licensed for ${use}.`);
}

/** Mandatory predicate for any future aggregate/query path using licensed import rows. */
export function importRecordUseWhere(use: ImportRecordUse, now = new Date()): Prisma.ImportRecordWhereInput {
  const flag = use === 'display' ? 'allowed_to_display' : use === 'export' ? 'allowed_to_export' : 'allowed_to_cache';
  const activeGrant: Prisma.ImportRecordWhereInput = { rights_grant: { derived_data_policy: { in: [DerivedDataPolicy.retain_aggregates, DerivedDataPolicy.retain_pseudonymous, DerivedDataPolicy.retain_derived] }, AND: [{ OR: [{ effective_at: null }, { effective_at: { lte: now } }] }, { OR: [{ expires_at: null }, { expires_at: { gt: now } }] }] } };
  return { [flag]: true, AND: [{ OR: [{ retention_limit: null }, { retention_limit: { gt: now } }] }, isRealWorkflowEnvironment() ? activeGrant : { OR: [{ rights_grant_id: null }, activeGrant] }] };
}

export function assertRightsGrantValid(grant: Pick<SourceRightsGrant, 'effective_at' | 'expires_at' | 'allowed_to_cache' | 'raw_retention_policy' | 'derived_data_policy'>, now = new Date()) {
  if (grant.effective_at && grant.effective_at > now) throw new ImportRecordRightsError('Source rights are not effective yet.');
  if (grant.expires_at && grant.expires_at <= now) throw new ImportRecordRightsError('Source rights have expired.');
  if (!grant.allowed_to_cache) throw new ImportRecordRightsError('Source rights do not permit cache/ingest.');
  if (!Object.values(RawRetentionPolicy).includes(grant.raw_retention_policy)) throw new ImportRecordRightsError('Raw retention policy is invalid.');
  if (grant.derived_data_policy === DerivedDataPolicy.unspecified) throw new ImportRecordRightsError('Derived-data policy must be explicit before real ingest.');
}

export async function enforceImportRecordRetention(args: { now?: Date; dryRun: boolean }) {
  const now = args.now ?? new Date();
  const rows = await prisma.importRecord.findMany({ where: { OR: [{ retention_limit: { lte: now } }, { rights_grant: { expires_at: { lte: now } } }] }, include: { rights_grant: true, raw_identity: { select: { id: true } } } });
  let rawDeleted = 0, recordsDeleted = 0;
  for (const row of rows) {
    const grant = row.rights_grant;
    const rawPolicy = grant?.raw_retention_policy ?? RawRetentionPolicy.delete_at_expiry;
    const derivedPolicy = grant?.derived_data_policy ?? DerivedDataPolicy.unspecified;
    const deleteRecord = derivedPolicy === DerivedDataPolicy.prohibited;
    const deleteRaw = Boolean(row.raw_identity) && rawPolicy !== RawRetentionPolicy.retain_until_expiry;
    await prisma.$transaction(async (tx) => {
      await tx.importRetentionEvent.create({ data: { import_record_id: row.id, source_record_id: row.source_record_id, action: deleteRecord ? 'delete_record' : deleteRaw ? 'delete_raw_preserve_derived' : 'disable_use', dry_run: args.dryRun, raw_identity_deleted: !args.dryRun && deleteRaw, record_deleted: !args.dryRun && deleteRecord, derived_preserved: !deleteRecord, policy_snapshot: { raw_retention_policy: rawPolicy, derived_data_policy: derivedPolicy, rights_grant_id: row.rights_grant_id } } });
      if (args.dryRun) return;
      if (deleteRecord) await tx.importRecord.delete({ where: { id: row.id } });
      else {
        if (deleteRaw) await tx.rawImportIdentity.deleteMany({ where: { import_record_id: row.id } });
        await tx.importRecord.update({ where: { id: row.id }, data: { allowed_to_display: false, allowed_to_export: false, allowed_to_cache: false, raw_consignee_string: null } });
      }
    });
    if (!args.dryRun && deleteRaw) rawDeleted++;
    if (!args.dryRun && deleteRecord) recordsDeleted++;
  }
  return { considered: rows.length, raw_deleted: rawDeleted, records_deleted: recordsDeleted, dry_run: args.dryRun };
}
