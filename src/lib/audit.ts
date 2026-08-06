/**
 * AuditEvent write helper — docs/08 §2, docs/01 §4.
 *
 * Called on EVERY material permission-sensitive mutation. Append-only: this module
 * exposes no update or delete. A correction is a new event.
 *
 * `source` matters more than it looks: docs/13 E8 wants the north-star metric "deals
 * progressing without manual ops intervention", which needs ops-initiated transitions
 * distinguishable from self-service ones. That distinction is `source` + `role`, so
 * always pass them honestly.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { AuditSource } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/** Works inside or outside a transaction. */
type Db = PrismaClient | Prisma.TransactionClient;

export const AUDIT_ACTIONS = {
  create: 'create',
  update: 'update',
  approve: 'approve',
  reject: 'reject',
  request_changes: 'request_changes',
  reassign: 'reassign',
  stage_change: 'stage_change',
  state_change: 'state_change',
  lock: 'lock',
  cancel: 'cancel',
  disqualify: 'disqualify',
  convert: 'convert',
  generate: 'generate',
  file: 'file',
  escalate: 'escalate',
  login: 'login',
  config_change: 'config_change',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface WriteAuditArgs {
  actor: Principal | null;
  action: AuditAction | string;
  object_type: string;
  object_id: string;
  /**
   * Tenant key for org-scoped audit reads. Pass it whenever the object belongs to an
   * exporter org, even if the actor is an agent or ops user.
   */
  exporter_org_id?: string | null;
  before_summary?: Prisma.InputJsonValue | null;
  after_summary?: Prisma.InputJsonValue | null;
  correlation_id: string;
  source?: AuditSource;
  /** Pass the transaction client so the audit row commits or rolls back with the mutation. */
  db?: Db;
}

/**
 * Write one audit event.
 *
 * Deliberately takes the same transaction client as the mutation: an audited action that
 * commits without its audit row (or vice versa) is worse than either failing.
 */
export async function writeAuditEvent(args: WriteAuditArgs): Promise<void> {
  const db = args.db ?? prisma;
  await db.auditEvent.create({
    data: {
      actor_user_id: args.actor?.id ?? null,
      role: args.actor?.role ?? null,
      action: args.action,
      object_type: args.object_type,
      object_id: args.object_id,
      exporter_org_id: args.exporter_org_id ?? args.actor?.exporter_org_id ?? null,
      before_summary: args.before_summary ?? undefined,
      after_summary: args.after_summary ?? undefined,
      correlation_id: args.correlation_id,
      source: args.source ?? AuditSource.web,
    },
  });
}

/**
 * Reduce a record to the fields worth auditing.
 *
 * docs/02: "avoid unnecessary secret data". Never hand a whole row to the audit log —
 * pick the fields whose change is the point of the event.
 */
export function summarize<T extends Record<string, unknown>>(
  record: T | null | undefined,
  fields: (keyof T)[],
): Prisma.InputJsonValue | null {
  if (!record) return null;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = record[field];
    if (value === undefined) continue;
    out[field as string] =
      value instanceof Date
        ? value.toISOString()
        : typeof value === 'object' && value !== null && 'toString' in value
          ? String(value)
          : (value as unknown);
  }
  return out as Prisma.InputJsonValue;
}

export { AuditSource };
