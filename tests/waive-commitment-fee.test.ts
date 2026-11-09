import { randomUUID } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { CommitmentFeeStatus, OrgTier, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { resolveTier } from '@/lib/billing/subscription-service';
import { parseWaiverArgs, waiveCommitmentFee } from '../scripts/waive-commitment-fee';

/** E-052: the audited Ops waiver that makes the owner's test account a member. */
describe('waive-commitment-fee', () => {
  async function setup(status: CommitmentFeeStatus = CommitmentFeeStatus.due) {
    const suffix = randomUUID().slice(0, 8);
    const admin = await prisma.user.create({ data: { email: `waiver-admin-${suffix}@test.local`, name: 'Admin', role: UserRole.admin } });
    const org = await prisma.exporterOrg.create({ data: { display_name: `Waiver Org ${suffix}`, tier: status === CommitmentFeeStatus.paid ? OrgTier.paid : OrgTier.free, commitment_fee_status: status } });
    const exporter = await prisma.user.create({ data: { email: `waiver-qa-${suffix}@test.local`, name: 'QA', role: UserRole.exporter_owner, exporter_org_id: org.id } });
    const request = { email: exporter.email, reason: 'Owner QA account for production checks', actor_email: admin.email, dry_run: false };
    return { admin, org, exporter, request };
  }

  test('due → waived makes the organisation paid, with one audit event that keeps the reason; a second run changes nothing', async () => {
    const { admin, org, request } = await setup();
    expect(await waiveCommitmentFee(request)).toMatchObject({ outcome: 'waived', exporter_org_id: org.id, before: { commitment_fee_status: 'due', tier: 'free' } });

    const after = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: org.id } });
    expect(after).toMatchObject({ commitment_fee_status: 'waived', tier: 'paid' });
    expect(resolveTier(after, null, new Date())).toBe(OrgTier.paid);

    const audits = await prisma.auditEvent.findMany({ where: { object_id: org.id, action: 'commitment_fee_waived' } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_user_id: admin.id, role: 'admin', exporter_org_id: org.id, source: 'admin' });
    expect(audits[0]!.after_summary).toMatchObject({ commitment_fee_status: 'waived', tier: 'paid', waive_reason: request.reason });

    expect(await waiveCommitmentFee(request)).toEqual({ outcome: 'already_waived', exporter_org_id: org.id });
    expect(await prisma.auditEvent.count({ where: { object_id: org.id, action: 'commitment_fee_waived' } })).toBe(1);
  });

  test('a dry run writes nothing', async () => {
    const { org, request } = await setup();
    expect(await waiveCommitmentFee({ ...request, dry_run: true })).toMatchObject({ outcome: 'waived', dry_run: true });
    expect(await prisma.exporterOrg.findUniqueOrThrow({ where: { id: org.id }, select: { commitment_fee_status: true, tier: true } })).toEqual({ commitment_fee_status: 'due', tier: 'free' });
    expect(await prisma.auditEvent.count({ where: { object_id: org.id } })).toBe(0);
  });

  test('refuses a non-admin actor, a non-exporter account, and any move the state machine forbids', async () => {
    const { exporter, org, request } = await setup();
    await expect(waiveCommitmentFee({ ...request, actor_email: exporter.email })).rejects.toThrow(/not an active ClearTrade admin/);
    await expect(waiveCommitmentFee({ ...request, email: request.actor_email })).rejects.toThrow(/not an active exporter account/);
    await prisma.user.update({ where: { id: exporter.id }, data: { is_active: false } });
    await expect(waiveCommitmentFee(request)).rejects.toThrow(/not an active exporter account/);
    expect(await prisma.exporterOrg.findUniqueOrThrow({ where: { id: org.id }, select: { commitment_fee_status: true } })).toEqual({ commitment_fee_status: 'due' });

    for (const status of [CommitmentFeeStatus.paid, CommitmentFeeStatus.refunded, CommitmentFeeStatus.not_due]) {
      const other = await setup(status);
      await expect(waiveCommitmentFee(other.request), status).rejects.toThrow();
      expect(await prisma.exporterOrg.findUniqueOrThrow({ where: { id: other.org.id }, select: { commitment_fee_status: true } }), status).toEqual({ commitment_fee_status: status });
    }
  });

  test('arguments: each flag once, a reason of at least 10 characters, emails lower-cased', () => {
    expect(parseWaiverArgs(['--email=QA@Example.in', '--reason=Owner QA account', '--actor-email=Admin@X.in', '--dry-run'])).toEqual({ email: 'qa@example.in', reason: 'Owner QA account', actor_email: 'admin@x.in', dry_run: true });
    expect(() => parseWaiverArgs(['--email=a@b.in', '--actor-email=c@d.in'])).toThrow(/needs --reason/);
    expect(() => parseWaiverArgs(['--email=a@b.in', '--reason=short', '--actor-email=c@d.in'])).toThrow(/at least 10/);
    expect(() => parseWaiverArgs(['--email=a@b.in', '--email=e@f.in', '--reason=Owner QA account', '--actor-email=c@d.in'])).toThrow(/more than once/);
  });

  test('the script checks the production confirmation before anything else', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('scripts/waive-commitment-fee.ts', 'utf8');
    expect(source).toContain("productionConfirmationProblem(validateDatabaseEnvironment('worker'), process.argv, SCRIPT)");
    expect(source.indexOf('productionConfirmationProblem(validate')).toBeLessThan(source.indexOf('parseWaiverArgs(process.argv'));
  });
});
