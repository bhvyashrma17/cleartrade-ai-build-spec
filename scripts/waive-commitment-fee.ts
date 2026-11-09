/**
 * Waive one exporter's commitment fee — the Ops waiver docs/01 §2 always allowed, which
 * grants `paid` tier without a payment (docs/14 §3a). There is no screen for it yet; this
 * is the audited way to do it, and the way the owner's own test account becomes a member
 * (owner decision 9 Nov 2026, ledger E-052).
 *
 *   railway run --environment production --service cleartrade-ai-build-spec -- \
 *     npx tsx scripts/waive-commitment-fee.ts --email=<account email> \
 *       --reason="<why, in words>" --actor-email=<ClearTrade admin> \
 *       --confirm-production=<12-character production fingerprint prefix>
 *
 * Add `--dry-run` to see what would change without writing anything.
 *
 * What it refuses, before writing:
 *   - production without `--confirm-production` naming this database (docs/39 §2), and the
 *     flag anywhere else, so a copied command cannot run against the wrong database;
 *   - an actor who is not an active ClearTrade admin (the waiver is an Ops override);
 *   - an account that is not an active exporter with an organisation;
 *   - a reason shorter than 10 characters (the state machine requires one; the audit row
 *     keeps it);
 *   - any move the commitment-fee state machine does not allow. Only `due → waived` is
 *     legal, so a paid, refunded or not-yet-registered organisation is left alone. Running
 *     it again on an organisation that is already waived changes nothing and says so.
 *
 * The update and its audit event (`commitment_fee_waived`, with the reason, the actor and
 * the before/after state) commit together or not at all.
 */
import { randomUUID } from 'node:crypto';
import { AuditSource, CommitmentFeeStatus, OrgTier, UserRole } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { productionConfirmationProblem } from '../src/lib/production-confirmation';
import { validateDatabaseEnvironment } from '../src/lib/runtime-config';
import { assertCommitmentFeeTransition } from '../src/lib/state-machines/commitment-fee';

const SCRIPT = 'waive-commitment-fee';
const EXPORTER_ROLES: readonly UserRole[] = [UserRole.exporter_owner, UserRole.exporter_member];

export interface WaiverRequest {
  email: string;
  reason: string;
  actor_email: string;
  dry_run: boolean;
}

export type WaiverOutcome =
  | { outcome: 'waived'; exporter_org_id: string; before: { commitment_fee_status: CommitmentFeeStatus; tier: OrgTier }; dry_run: boolean }
  | { outcome: 'already_waived'; exporter_org_id: string };

/** One value per flag, exactly once — a repeated flag is a typo waiting to waive the wrong account. */
function single(argv: readonly string[], flag: string): string | null {
  const values = argv.filter((value) => value.startsWith(`${flag}=`)).map((value) => value.slice(flag.length + 1).trim());
  if (values.length > 1) throw new Error(`${SCRIPT}: ${flag} was given more than once.`);
  return values[0] || null;
}

export function parseWaiverArgs(argv: readonly string[]): WaiverRequest {
  const email = single(argv, '--email')?.toLowerCase() ?? null;
  const reason = single(argv, '--reason');
  const actor = single(argv, '--actor-email')?.toLowerCase() ?? null;
  const missing = [!email && '--email', !reason && '--reason', !actor && '--actor-email'].filter(Boolean);
  if (missing.length > 0) throw new Error(`${SCRIPT}: needs ${missing.join(', ')}.`);
  if (reason!.length < 10) throw new Error(`${SCRIPT}: --reason must say why in at least 10 characters.`);
  return { email: email!, reason: reason!, actor_email: actor!, dry_run: argv.includes('--dry-run') };
}

export async function waiveCommitmentFee(request: WaiverRequest): Promise<WaiverOutcome> {
  const actor = await prisma.user.findUnique({ where: { email: request.actor_email }, select: { id: true, email: true, name: true, role: true, is_active: true } });
  if (!actor || actor.role !== UserRole.admin || !actor.is_active) throw new Error(`${SCRIPT}: ${request.actor_email} is not an active ClearTrade admin.`);

  const account = await prisma.user.findUnique({ where: { email: request.email }, select: { role: true, is_active: true, exporter_org_id: true } });
  if (!account || !account.is_active || !EXPORTER_ROLES.includes(account.role) || !account.exporter_org_id) {
    throw new Error(`${SCRIPT}: ${request.email} is not an active exporter account with an organisation.`);
  }
  const orgId = account.exporter_org_id;
  const org = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: orgId }, select: { commitment_fee_status: true, tier: true } });
  if (org.commitment_fee_status === CommitmentFeeStatus.waived) return { outcome: 'already_waived', exporter_org_id: orgId };

  // The state machine is the only judge of what is legal; it also insists on the reason.
  const effects = assertCommitmentFeeTransition(org.commitment_fee_status, CommitmentFeeStatus.waived, { waive_reason: request.reason });
  if (request.dry_run) return { outcome: 'waived', exporter_org_id: orgId, before: org, dry_run: true };

  await prisma.$transaction(async (tx) => {
    // Conditional on the state just read, so a concurrent payment or waiver is not overwritten.
    const updated = await tx.exporterOrg.updateMany({
      where: { id: orgId, commitment_fee_status: org.commitment_fee_status },
      data: { commitment_fee_status: CommitmentFeeStatus.waived, ...(effects.unlocks_paid_tier ? { tier: OrgTier.paid } : {}) },
    });
    if (updated.count !== 1) throw new Error(`${SCRIPT}: the organisation changed while this ran; nothing was written. Run it again.`);
    await tx.auditEvent.create({
      data: {
        actor_user_id: actor.id,
        role: actor.role,
        action: 'commitment_fee_waived',
        object_type: 'exporter_org',
        object_id: orgId,
        exporter_org_id: orgId,
        before_summary: { commitment_fee_status: org.commitment_fee_status, tier: org.tier },
        after_summary: { commitment_fee_status: CommitmentFeeStatus.waived, tier: effects.unlocks_paid_tier ? OrgTier.paid : org.tier, waive_reason: request.reason },
        correlation_id: randomUUID(),
        source: AuditSource.admin,
      },
    });
  });
  return { outcome: 'waived', exporter_org_id: orgId, before: org, dry_run: false };
}

async function main() {
  const problem = productionConfirmationProblem(validateDatabaseEnvironment('worker'), process.argv, SCRIPT);
  if (problem) throw new Error(problem);
  const request = parseWaiverArgs(process.argv.slice(2));
  const result = await waiveCommitmentFee(request);
  if (result.outcome === 'already_waived') {
    console.log(`${request.email}: the commitment fee is already waived; nothing changed.`);
    return;
  }
  const verb = result.dry_run ? 'would be' : 'is now';
  console.log(`${request.email}: fee ${result.before.commitment_fee_status} → waived, tier ${result.before.tier} → paid; the account ${verb} a member.`);
  if (!result.dry_run) console.log('audit event recorded commitment_fee_waived');
}

if (process.argv[1]?.endsWith('waive-commitment-fee.ts')) {
  main()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
