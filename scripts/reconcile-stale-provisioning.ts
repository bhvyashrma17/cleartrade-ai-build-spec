/**
 * One-time cleanup for the staging UAT finding: an account already `role = agent` while a
 * pending `StaffAccessGrant` or a legacy email-bound `StaffInvitation` for the same normalized
 * email is still sitting there, unrevoked, reading as an actionable pending request nobody had
 * actually made anymore.
 *
 * `reconcileStaleProvisioning` (src/lib/staff-provisioning.ts) now runs this cleanup live, on
 * every path that confirms an email belongs to an agent — but only going forward. Any account
 * that became an agent BEFORE that existed, and hasn't been touched by any provisioning path
 * since, is still stuck in the state UAT observed. This script finds and fixes exactly those,
 * reusing the identical `reconcileStaleProvisioning` function rather than a second copy of the
 * same logic.
 *
 * Revokes, never deletes: a `StaffAccessGrant`/`StaffInvitation` this touches ends up
 * `status = revoked`, fully intact and auditable, exactly as the live path leaves it.
 *
 * ENVIRONMENT GATE: refuses to run unless APP_ENV is `staging` or `local`. Production is
 * rejected explicitly rather than merely not matched, so a mis-set variable cannot make this
 * runnable there.
 *
 * Dry-run by default — reports what it WOULD change and writes nothing. Apply mode requires
 * both an explicit `apply` command AND `--actor-email=<an active admin's email>`, so every
 * revocation this makes is attributed to a real, named administrator rather than a bare script:
 *
 *   railway run -- npx tsx scripts/reconcile-stale-provisioning.ts dry-run
 *   railway run -- npx tsx scripts/reconcile-stale-provisioning.ts apply --actor-email=you@example.com
 */

import { randomUUID } from 'node:crypto';
import { OrgTier, PrismaClient, StaffAccessGrantStatus, StaffInvitationStatus, UserRole } from '@prisma/client';
import { reconcileStaleProvisioning } from '../src/lib/staff-provisioning';
import type { Principal } from '../src/types';

const prisma = new PrismaClient();

function assertSafeEnvironment() {
  const env = process.env.APP_ENV ?? 'local';
  if (env === 'production' || process.env.DATABASE_ENVIRONMENT === 'production') {
    throw new Error('reconcile-stale-provisioning refuses to run against production.');
  }
  if (env !== 'staging' && env !== 'local') {
    throw new Error(`reconcile-stale-provisioning expects APP_ENV=staging or local, found "${env}".`);
  }
  return env;
}

interface StaleReport {
  agentId: string;
  agentEmail: string;
  agentName: string;
  staleGrantIds: string[];
  staleInvitationIds: string[];
}

/** Read-only: find every active agent with a pending grant or legacy invitation for their own email. */
async function findStale(): Promise<StaleReport[]> {
  const agents = await prisma.user.findMany({
    where: { role: UserRole.agent, is_active: true },
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
  });

  const reports: StaleReport[] = [];
  for (const agent of agents) {
    const email = agent.email.trim().toLowerCase();
    const [staleGrants, staleInvitations] = await Promise.all([
      prisma.staffAccessGrant.findMany({
        where: { email, status: StaffAccessGrantStatus.pending },
        select: { id: true },
      }),
      // Bearer invitations (email IS NULL) can never match a specific email lookup — only
      // legacy, email-bound rows are ever found here, exactly as intended.
      prisma.staffInvitation.findMany({
        where: { email, status: StaffInvitationStatus.pending },
        select: { id: true },
      }),
    ]);
    if (staleGrants.length === 0 && staleInvitations.length === 0) continue;
    reports.push({
      agentId: agent.id, agentEmail: agent.email, agentName: agent.name,
      staleGrantIds: staleGrants.map((g) => g.id), staleInvitationIds: staleInvitations.map((i) => i.id),
    });
  }
  return reports;
}

function printReport(reports: StaleReport[], mode: 'dry-run' | 'apply') {
  if (reports.length === 0) {
    console.log('No stale pending provisioning records found. Nothing to do.');
    return;
  }
  console.log(`${mode === 'dry-run' ? 'Would revoke' : 'Revoking'} stale pending records for ${reports.length} active agent(s):\n`);
  for (const r of reports) {
    console.log(`  ${r.agentEmail} (${r.agentName}, user ${r.agentId})`);
    if (r.staleGrantIds.length) console.log(`    StaffAccessGrant: ${r.staleGrantIds.join(', ')}`);
    if (r.staleInvitationIds.length) console.log(`    StaffInvitation (legacy, email-bound): ${r.staleInvitationIds.join(', ')}`);
  }
  console.log('');
}

async function dryRun() {
  const env = assertSafeEnvironment();
  const reports = await findStale();
  console.log(`environment: ${env}\n`);
  printReport(reports, 'dry-run');
  console.log(`Re-run with:\n  npx tsx scripts/reconcile-stale-provisioning.ts apply --actor-email=<your admin email>\nto apply. Nothing has been changed.`);
}

async function apply(actorEmail: string) {
  const env = assertSafeEnvironment();
  if (!actorEmail) {
    throw new Error('apply requires --actor-email=<an active admin or ops email>, so every revocation is attributed to a real operator.');
  }
  const actorRow = await prisma.user.findUnique({
    where: { email: actorEmail.trim().toLowerCase() },
    select: { id: true, email: true, name: true, role: true, is_active: true },
  });
  if (!actorRow || !actorRow.is_active || !['admin', 'ops_supervisor', 'ops_finance'].includes(actorRow.role)) {
    throw new Error(`--actor-email must name an active Ops or admin account. Found: ${actorRow ? actorRow.role : 'no such user'}.`);
  }
  const actor: Principal = {
    id: actorRow.id, email: actorRow.email, name: actorRow.name, role: actorRow.role,
    exporter_org_id: null, tier: OrgTier.paid,
  };

  const reports = await findStale();
  console.log(`environment: ${env}\n`);
  printReport(reports, 'apply');
  if (reports.length === 0) return;

  const correlationId = `reconcile_${randomUUID()}`;
  for (const r of reports) {
    await prisma.$transaction(async (tx) => {
      await reconcileStaleProvisioning(tx, { email: r.agentEmail, actor, correlationId });
    });
  }
  console.log(`Done. ${reports.length} agent(s) reconciled by ${actor.email}. correlation_id=${correlationId}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const actorArg = rest.find((a) => a.startsWith('--actor-email='));
  const actorEmail = actorArg ? actorArg.slice('--actor-email='.length) : '';

  switch (command) {
    case 'dry-run': return dryRun();
    case 'apply': return apply(actorEmail);
    default:
      console.log('Usage: reconcile-stale-provisioning.ts <dry-run|apply --actor-email=you@example.com>');
      process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
