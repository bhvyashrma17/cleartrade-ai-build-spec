/**
 * Bootstraps the FIRST FeePolicy in a fresh staging database.
 *
 * `getFeePolicy()` throws when no policy is active — fee terms must never fall back to a
 * hardcoded constant — and registration snapshots the commitment fee from it. On an empty
 * staging database that is a deadlock: the only API that creates a policy
 * (`POST /api/v1/fee-policy`) needs an admin, and the first admin has to register first.
 *
 * This breaks the deadlock exactly once. It refuses production, refuses any database that
 * already has a FeePolicy (every later change goes through the admin API, which versions and
 * audits it), and writes version 1 with the same terms `prisma/seed.ts` defines, through the same field set as
 * `POST /api/v1/fee-policy` (policy-level fee status and `effective_from` take schema defaults), plus a
 * `config_change` AuditEvent with no actor (`source: admin`). It creates no users, tenants
 * or business records.
 *
 *   APP_ENV=staging npx tsx --env-file=<staging env> scripts/bootstrap-staging-fee-policy.ts
 */
import { randomUUID } from 'node:crypto';
import { AuditSource } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { validateDatabaseEnvironment } from '@/lib/runtime-config';

async function main() {
  const env = process.env.APP_ENV ?? 'local';
  if (env === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') {
    throw new Error('bootstrap-staging-fee-policy refuses to run against production.');
  }
  if (env !== 'staging') throw new Error(`Expected APP_ENV=staging, found "${env}".`);
  const database = validateDatabaseEnvironment('worker');

  const correlation_id = randomUUID();
  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.feePolicy.count();
    if (existing > 0) return null;

    const row = await tx.feePolicy.create({
      data: {
        version: 1,
        commitment_fee_amount: 15000,
        commitment_fee_currency: 'INR',
        success_fee_rate: 0.025,
        small_shipment_threshold_amount: 500000,
        small_shipment_threshold_currency: 'INR',
        small_shipment_rate: 0.035,
        small_shipment_flat_amount: 20000,
        agent_share_rate: 0.4,
        minimum_shipment_amount: 100000,
        minimum_shipment_currency: 'INR',
        is_active: true,
      },
    });

    await writeAuditEvent({
      db: tx,
      actor: null,
      action: AUDIT_ACTIONS.config_change,
      object_type: 'fee_policy',
      object_id: row.id,
      before_summary: null,
      after_summary: { version: row.version, change_reason: 'Staging bootstrap: first fee policy (prisma/seed.ts terms).' },
      correlation_id,
      source: AuditSource.admin,
    });
    return row;
  });

  console.log(JSON.stringify({
    environment: database.environment,
    database_fingerprint: database.database_fingerprint.slice(0, 12),
    result: created ? 'created' : 'skipped: a FeePolicy already exists',
    fee_policy: created ? { id: created.id, version: created.version } : null,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
