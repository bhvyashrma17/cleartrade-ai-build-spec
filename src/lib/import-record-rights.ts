import type { ImportRecord, Prisma } from '@prisma/client';

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
  return { [flag]: true, OR: [{ retention_limit: null }, { retention_limit: { gt: now } }] };
}
