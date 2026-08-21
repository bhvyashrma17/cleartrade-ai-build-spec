/**
 * Admin operational controls added on top of staff provisioning: revoking invitations,
 * pre-authorizing an email with no token/link (`StaffAccessGrant`), converting an existing
 * account directly, deactivating/reactivating an agent, and transactional reassignment.
 *
 * Each surface is tested the same way the rest of this module already is: the service function
 * directly, with a fresh actor/org fixture per test, asserting both the outcome and — where it
 * matters — that history/attribution survives.
 */

import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { AssignmentStatus, CommitmentFeeStatus, OrgTier, StaffAccessGrantStatus, StaffInvitationStatus, UserRole } from '@prisma/client';
import { readFileSync } from 'node:fs';
import {
  adminConvertUserToAgent,
  assignExporterToAgent,
  claimStaffAccessGrant,
  convertUserToAgent,
  deactivateAgent,
  generateAgentInvitation,
  grantStaffAccess,
  lookupStaffCandidate,
  reactivateAgent,
  reassignExporterToAgent,
  revokeStaffAccessGrant,
  revokeStaffInvitation,
  unassignExporterFromAgent,
} from '../src/lib/staff-provisioning';
import { assignedOrgIds } from '../src/lib/permissions';
import { resolveSocialIdentity } from '../src/lib/social-auth';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

// `resolveSocialIdentity`'s ordinary exporter-signup fallback (used by the "no pending grant"
// and "wrong email" claim tests below) requires an active FeePolicy — same fixture social-auth
// tests use, since a fresh test database has none.
beforeEach(async () => {
  await prisma.feePolicy.deleteMany({});
  await prisma.feePolicy.create({
    data: {
      version: 1,
      commitment_fee_amount: '1000',
      commitment_fee_currency: 'INR',
      commitment_fee_status: CommitmentFeeStatus.not_due,
      success_fee_rate: '0.10',
      small_shipment_threshold_amount: '100000',
      small_shipment_threshold_currency: 'INR',
      small_shipment_rate: '0.12',
      small_shipment_flat_amount: '5000',
      agent_share_rate: '0.40',
      minimum_shipment_amount: '10000',
      minimum_shipment_currency: 'INR',
      is_active: true,
    },
  });
});

const principal = (id: string, email: string, role: UserRole, orgId: string | null = null): Principal => ({
  id, email, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid,
});

async function actors() {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({
    data: { display_name: `Admin Ctl Org ${s}`, tier: OrgTier.paid }, select: { id: true },
  });
  const emails = {
    admin: `adm-${s}@t.test`, ops: `ops-${s}@t.test`, agent: `agt-${s}@t.test`,
    otherAgent: `agt2-${s}@t.test`, exporterOwner: `exp-${s}@t.test`,
  };
  const [admin, ops, agent, otherAgent, exporterOwner] = await Promise.all([
    prisma.user.create({ data: { email: emails.admin, name: 'Admin', role: UserRole.admin }, select: { id: true } }),
    prisma.user.create({ data: { email: emails.ops, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
    prisma.user.create({ data: { email: emails.agent, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: emails.otherAgent, name: 'Other Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: emails.exporterOwner, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id }, select: { id: true } }),
  ]);
  return {
    suffix: s, orgId: org.id,
    admin: principal(admin.id, emails.admin, UserRole.admin),
    ops: principal(ops.id, emails.ops, UserRole.ops_supervisor),
    agent: principal(agent.id, emails.agent, UserRole.agent),
    otherAgent: principal(otherAgent.id, emails.otherAgent, UserRole.agent),
    exporterOwnerId: exporterOwner.id,
  };
}

const corr = () => randomUUID();

/** A fresh, ordinary account with no org — always eligible to convert, no sole-owner guard to trip. */
async function convertibleAccount(suffix: string) {
  const user = await prisma.user.create({
    data: { email: `conv-${suffix}-${randomUUID().slice(0, 6)}@t.test`, name: 'Convertee', role: UserRole.exporter_owner },
    select: { id: true, email: true },
  });
  return { id: user.id, principal: principal(user.id, user.email, UserRole.exporter_owner) };
}

describe('#14 revoking a pending invitation', () => {
  test('admin can revoke; the token is refused afterwards', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.admin, correlationId: corr() });

    const revoked = await revokeStaffInvitation({ actor: a.admin, invitationId: invitation.id, correlationId: corr() });
    expect(revoked.status).toBe(StaffInvitationStatus.revoked);

    const claimant = await convertibleAccount(a.suffix);
    await expect(convertUserToAgent({ actor: claimant.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a non-admin, non-ops actor cannot revoke', async () => {
    const a = await actors();
    const { invitation } = await generateAgentInvitation({ actor: a.admin, correlationId: corr() });
    await expect(revokeStaffInvitation({ actor: a.agent, invitationId: invitation.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('an already-accepted invitation cannot be revoked as if it were pending', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.admin, correlationId: corr() });
    const claimant = await convertibleAccount(a.suffix);
    await convertUserToAgent({ actor: claimant.principal, token, correlationId: corr() });

    await expect(revokeStaffInvitation({ actor: a.admin, invitationId: invitation.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('#15 Case A — admin converts an existing account directly', () => {
  test('admin converts an existing exporter owner (sole owner of an empty org) to agent', async () => {
    const a = await actors();
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({ data: { display_name: `Empty ${s}`, tier: OrgTier.free }, select: { id: true } });
    const user = await prisma.user.create({
      data: { email: `conv-${s}@t.test`, name: 'Convertee', role: UserRole.exporter_owner, exporter_org_id: org.id, password_hash: 'hashed-pw' },
      select: { id: true },
    });

    const result = await adminConvertUserToAgent({ actor: a.admin, targetEmail: `conv-${s}@t.test`, correlationId: corr() });
    expect(result.role).toBe(UserRole.agent);
    expect(result.alreadyAgent).toBe(false);

    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.role).toBe(UserRole.agent);
    expect(row.exporter_org_id).toBeNull();
    // Password survives — this is an in-place role change, not a recreation.
    expect(row.password_hash).toBe('hashed-pw');
  });

  test('sole-owner guard blocks conversion when the workspace has real business substance', async () => {
    const a = await actors();
    const s = randomUUID().slice(0, 8);
    const org = await prisma.exporterOrg.create({ data: { display_name: `Busy ${s}`, tier: OrgTier.paid }, select: { id: true } });
    await prisma.user.create({ data: { email: `busy-${s}@t.test`, name: 'Sole Owner', role: UserRole.exporter_owner, exporter_org_id: org.id }, select: { id: true } });
    await prisma.product.create({ data: { exporter_org_id: org.id, name: 'Widget', hs_code: '850110' } });

    await expect(adminConvertUserToAgent({ actor: a.admin, targetEmail: `busy-${s}@t.test`, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.user.findUniqueOrThrow({ where: { email: `busy-${s}@t.test` } })).role).toBe(UserRole.exporter_owner);
  });

  test('admin cannot convert an existing admin or ops account into an agent', async () => {
    const a = await actors();
    await expect(adminConvertUserToAgent({ actor: a.admin, targetEmail: a.ops.email, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    const other = await actors();
    await expect(adminConvertUserToAgent({ actor: a.admin, targetEmail: other.admin.email, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('converting an account that is already an agent is idempotent, not an error', async () => {
    const a = await actors();
    const result = await adminConvertUserToAgent({ actor: a.admin, targetEmail: a.agent.email, correlationId: corr() });
    expect(result.alreadyAgent).toBe(true);
    expect(result.role).toBe(UserRole.agent);
  });

  test('an unknown email is refused, pointing at the pre-authorization flow instead', async () => {
    const a = await actors();
    await expect(adminConvertUserToAgent({ actor: a.admin, targetEmail: `nobody-${a.suffix}@t.test`, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('a non-admin, non-ops actor cannot directly convert an account', async () => {
    const a = await actors();
    await expect(adminConvertUserToAgent({ actor: a.agent, targetEmail: a.ops.email, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('lookupStaffCandidate classifies an existing account, an unknown email, and a pending grant', async () => {
    const a = await actors();
    const existing = await lookupStaffCandidate(a.admin, a.agent.email);
    expect(existing).toMatchObject({ case: 'existing_user', alreadyAgent: true });

    const unknown = await lookupStaffCandidate(a.admin, `unknown-${a.suffix}@t.test`);
    expect(unknown).toEqual({ case: 'no_account' });

    const grantEmail = `grantcheck-${a.suffix}@t.test`;
    await grantStaffAccess({ actor: a.admin, email: grantEmail, correlationId: corr() });
    expect(await lookupStaffCandidate(a.admin, grantEmail)).toEqual({ case: 'pending_grant' });
  });
});

describe('#15 Case B — pre-authorizing an email with no account yet', () => {
  test('admin grants a pending pre-authorization; no user or token is created', async () => {
    const a = await actors();
    const email = `pending-${a.suffix}@t.test`;
    const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    expect(grant.status).toBe(StaffAccessGrantStatus.pending);
    expect(grant.role).toBe(UserRole.agent);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  test('an email that already has an account cannot be pre-authorized', async () => {
    const a = await actors();
    await expect(grantStaffAccess({ actor: a.admin, email: a.agent.email, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('granting again for the same email revokes the previous pending grant (single live grant per email)', async () => {
    const a = await actors();
    const email = `regrant-${a.suffix}@t.test`;
    const first = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    const second = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });

    expect(second.id).not.toBe(first.id);
    expect((await prisma.staffAccessGrant.findUniqueOrThrow({ where: { id: first.id } })).status).toBe(StaffAccessGrantStatus.revoked);
    expect((await prisma.staffAccessGrant.findUniqueOrThrow({ where: { id: second.id } })).status).toBe(StaffAccessGrantStatus.pending);
  });

  test('admin can revoke a pending grant before it is claimed', async () => {
    const a = await actors();
    const email = `revgrant-${a.suffix}@t.test`;
    const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    const revoked = await revokeStaffAccessGrant({ actor: a.admin, grantId: grant.id, correlationId: corr() });
    expect(revoked.status).toBe(StaffAccessGrantStatus.revoked);
  });

  test('a non-pending grant cannot be revoked again', async () => {
    const a = await actors();
    const email = `revtwice-${a.suffix}@t.test`;
    const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    await revokeStaffAccessGrant({ actor: a.admin, grantId: grant.id, correlationId: corr() });
    await expect(revokeStaffAccessGrant({ actor: a.admin, grantId: grant.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a non-admin, non-ops actor cannot grant or revoke staff access', async () => {
    const a = await actors();
    const email = `noauth-${a.suffix}@t.test`;
    await expect(grantStaffAccess({ actor: a.agent, email, correlationId: corr() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    await expect(revokeStaffAccessGrant({ actor: a.agent, grantId: grant.id, correlationId: corr() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  describe('claiming a grant at verified sign-in', () => {
    test('the exact, verified email claims the grant and becomes an agent with no tenant', async () => {
      const a = await actors();
      const email = `claim-${a.suffix}@t.test`;
      const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });

      const result = await resolveSocialIdentity({
        provider: 'google', providerAccountId: `g-${randomUUID()}`, email, emailVerified: true, name: 'Claimant', correlationId: corr(),
      });
      expect(result).toMatchObject({ ok: true, role: UserRole.agent, exporterOrgId: null, created: true });

      const row = await prisma.staffAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
      expect(row.status).toBe(StaffAccessGrantStatus.claimed);
      expect(row.claimed_user_id).toBe((result as { userId: string }).userId);

      // The link is durable: a second sign-in with the same provider account finds the user
      // directly rather than re-attempting a claim.
      const again = await resolveSocialIdentity({
        provider: 'google', providerAccountId: (await prisma.authProviderAccount.findFirstOrThrow({ where: { user_id: row.claimed_user_id! } })).provider_account_id,
        email, emailVerified: true, name: 'Claimant', correlationId: corr(),
      });
      expect(again).toMatchObject({ ok: true, userId: (result as { userId: string }).userId, created: false });
    });

    test('a different email cannot claim someone else’s grant', async () => {
      const a = await actors();
      const email = `right-${a.suffix}@t.test`;
      await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });

      const result = await resolveSocialIdentity({
        provider: 'google', providerAccountId: `g-${randomUUID()}`, email: `wrong-${a.suffix}@t.test`, emailVerified: true, name: 'Wrong', correlationId: corr(),
      });
      // Ordinary exporter signup, not a claim.
      expect(result).toMatchObject({ ok: true, role: UserRole.exporter_owner, created: true });
      expect(await prisma.staffAccessGrant.count({ where: { email, status: StaffAccessGrantStatus.claimed } })).toBe(0);
    });

    test('an unverified Google email cannot claim a grant', async () => {
      const a = await actors();
      const email = `unverified-${a.suffix}@t.test`;
      await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });

      const result = await resolveSocialIdentity({
        provider: 'google', providerAccountId: `g-${randomUUID()}`, email, emailVerified: false, name: 'X', correlationId: corr(),
      });
      expect(result).toMatchObject({ ok: false, reason: 'email_not_verified' });
      expect((await prisma.staffAccessGrant.findFirstOrThrow({ where: { email } })).status).toBe(StaffAccessGrantStatus.pending);
    });

    test('claiming is single-use: a second claim attempt finds nothing pending', async () => {
      const a = await actors();
      const email = `single-${a.suffix}@t.test`;
      await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
      await claimStaffAccessGrant({ email, name: 'First', provider: 'google', providerAccountId: `g-${randomUUID()}`, correlationId: corr() });

      const secondAttempt = await claimStaffAccessGrant({ email, name: 'Second', provider: 'google', providerAccountId: `g-${randomUUID()}`, correlationId: corr() });
      expect(secondAttempt).toBeNull();
    });

    test('a revoked grant cannot be claimed', async () => {
      const a = await actors();
      const email = `revokedclaim-${a.suffix}@t.test`;
      const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
      await revokeStaffAccessGrant({ actor: a.admin, grantId: grant.id, correlationId: corr() });

      const result = await resolveSocialIdentity({
        provider: 'google', providerAccountId: `g-${randomUUID()}`, email, emailVerified: true, name: 'Too Late', correlationId: corr(),
      });
      // Falls through to ordinary exporter signup — there is nothing left to claim.
      expect(result).toMatchObject({ ok: true, role: UserRole.exporter_owner });
    });

    test('concurrent claims for the same grant cannot both succeed, and produce no duplicate user', async () => {
      const a = await actors();
      const email = `race-${a.suffix}@t.test`;
      await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });

      const attempts = await Promise.allSettled([
        claimStaffAccessGrant({ email, name: 'A', provider: 'google', providerAccountId: `g-${randomUUID()}`, correlationId: corr() }),
        claimStaffAccessGrant({ email, name: 'B', provider: 'apple', providerAccountId: `a-${randomUUID()}`, correlationId: corr() }),
      ]);
      const winners = attempts.filter((r) => r.status === 'fulfilled' && r.value !== null);
      expect(winners.length).toBe(1);
      expect(await prisma.user.count({ where: { email } })).toBe(1);
      expect(await prisma.staffAccessGrant.count({ where: { email, status: StaffAccessGrantStatus.claimed } })).toBe(1);
    });

    test('no pending grant: resolveSocialIdentity falls straight through to ordinary exporter signup', async () => {
      const a = await actors();
      const email = `noclaim-${a.suffix}@t.test`;
      const result = await resolveSocialIdentity({
        provider: 'google', providerAccountId: `g-${randomUUID()}`, email, emailVerified: true, name: 'Ordinary', correlationId: corr(),
      });
      expect(result).toMatchObject({ ok: true, role: UserRole.exporter_owner, created: true });
      expect(result.ok && result.exporterOrgId).not.toBeNull();
    });
  });
});

describe('#16 deactivating and reactivating an agent', () => {
  test('admin can deactivate an agent with no active assignments', async () => {
    const a = await actors();
    const result = await deactivateAgent({ actor: a.admin, agentUserId: a.agent.id, reason: 'Left the team', correlationId: corr() });
    expect(result.is_active).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.agent.id } })).is_active).toBe(false);
  });

  test('an agent with an active assignment cannot be deactivated until it is resolved', async () => {
    const a = await actors();
    const assignment = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await expect(deactivateAgent({ actor: a.admin, agentUserId: a.agent.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.agent.id } })).is_active).toBe(true);

    // Resolving it (unassign) clears the way.
    const { unassignExporterFromAgent } = await import('../src/lib/staff-provisioning');
    await unassignExporterFromAgent({ actor: a.admin, assignmentId: assignment.id, correlationId: corr() });
    const result = await deactivateAgent({ actor: a.admin, agentUserId: a.agent.id, correlationId: corr() });
    expect(result.is_active).toBe(false);
  });

  test('historical AgentAssignment attribution survives deactivation', async () => {
    const a = await actors();
    const assignment = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    const { unassignExporterFromAgent } = await import('../src/lib/staff-provisioning');
    await unassignExporterFromAgent({ actor: a.admin, assignmentId: assignment.id, correlationId: corr() });
    await deactivateAgent({ actor: a.admin, agentUserId: a.agent.id, correlationId: corr() });

    const row = await prisma.agentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(row.agent_user_id).toBe(a.agent.id);
    expect(row.status).toBe(AssignmentStatus.ended);
  });

  test('reactivating restores access', async () => {
    const a = await actors();
    await deactivateAgent({ actor: a.admin, agentUserId: a.agent.id, correlationId: corr() });
    const result = await reactivateAgent({ actor: a.admin, agentUserId: a.agent.id, correlationId: corr() });
    expect(result.is_active).toBe(true);
  });

  test('a non-admin, non-ops actor cannot deactivate or reactivate', async () => {
    const a = await actors();
    await expect(deactivateAgent({ actor: a.agent, agentUserId: a.otherAgent.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reactivateAgent({ actor: a.agent, agentUserId: a.otherAgent.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('#17 transactional reassignment', () => {
  test('reassigning ends the old assignment and starts a new one atomically', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });

    const { ended, started } = await reassignExporterToAgent({
      actor: a.admin, assignmentId: original.id, newAgentUserId: a.otherAgent.id, reason: 'Rebalance', correlationId: corr(),
    });
    expect(ended.status).toBe(AssignmentStatus.ended);
    expect(started.agent_user_id).toBe(a.otherAgent.id);
    expect(started.status).toBe(AssignmentStatus.active);

    const active = await prisma.agentAssignment.findMany({ where: { exporter_org_id: a.orgId, status: AssignmentStatus.active } });
    expect(active).toHaveLength(1);
    expect(active[0]!.agent_user_id).toBe(a.otherAgent.id);
  });

  test('an inactive agent cannot receive a reassignment', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await deactivateAgent({ actor: a.admin, agentUserId: a.otherAgent.id, correlationId: corr() });

    await expect(reassignExporterToAgent({ actor: a.admin, assignmentId: original.id, newAgentUserId: a.otherAgent.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.agentAssignment.findUniqueOrThrow({ where: { id: original.id } })).status).toBe(AssignmentStatus.active);
  });

  test('reassigning an already-ended assignment is refused', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    const { unassignExporterFromAgent } = await import('../src/lib/staff-provisioning');
    await unassignExporterFromAgent({ actor: a.admin, assignmentId: original.id, correlationId: corr() });

    await expect(reassignExporterToAgent({ actor: a.admin, assignmentId: original.id, newAgentUserId: a.otherAgent.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('assignment history remains intact across a reassignment', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    const { started } = await reassignExporterToAgent({ actor: a.admin, assignmentId: original.id, newAgentUserId: a.otherAgent.id, correlationId: corr() });

    const rows = await prisma.agentAssignment.findMany({ where: { exporter_org_id: a.orgId }, orderBy: { started_at: 'asc' } });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(original.id);
    expect(ids).toContain(started.id);
    expect(rows.find((r) => r.id === original.id)!.status).toBe(AssignmentStatus.ended);
  });

  test('a non-admin, non-ops actor cannot reassign', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await expect(reassignExporterToAgent({ actor: a.agent, assignmentId: original.id, newAgentUserId: a.otherAgent.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('every admin lifecycle mutation is attributed to the acting admin in the audit trail', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    const { started } = await reassignExporterToAgent({ actor: a.admin, assignmentId: original.id, newAgentUserId: a.otherAgent.id, correlationId: corr() });
    const { unassignExporterFromAgent } = await import('../src/lib/staff-provisioning');
    await unassignExporterFromAgent({ actor: a.admin, assignmentId: started.id, correlationId: corr() });
    await deactivateAgent({ actor: a.admin, agentUserId: a.otherAgent.id, correlationId: corr() });

    const reassignEvent = await prisma.auditEvent.findFirstOrThrow({ where: { object_type: 'agent_assignment', object_id: started.id } });
    expect(reassignEvent.actor_user_id).toBe(a.admin.id);

    const deactivateEvent = await prisma.auditEvent.findFirstOrThrow({ where: { object_type: 'user', object_id: a.otherAgent.id, action: 'update' } });
    expect(deactivateEvent.actor_user_id).toBe(a.admin.id);
  });
});

describe('#2 the Unassigned queue tracks live AgentAssignment state', () => {
  // `/ops/assignments`' Unassigned queue and the Ops dashboard both query
  // `ExporterOrg.assigned_agent_id` directly rather than joining `AgentAssignment` — a
  // read-convenience column the assignment service must keep in sync, or the queue never
  // reflects reality even though authorization (`assignedOrgIds`) is already correct.
  test('assigning an exporter clears it from the unassigned set', async () => {
    const a = await actors();
    expect((await prisma.exporterOrg.findUniqueOrThrow({ where: { id: a.orgId } })).assigned_agent_id).toBeNull();
    expect(await prisma.exporterOrg.count({ where: { id: a.orgId, assigned_agent_id: null } })).toBe(1);

    await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });

    const org = await prisma.exporterOrg.findUniqueOrThrow({ where: { id: a.orgId } });
    expect(org.assigned_agent_id).toBe(a.agent.id);
    expect(await prisma.exporterOrg.count({ where: { id: a.orgId, assigned_agent_id: null } })).toBe(0);
  });

  test('unassigning returns the exporter to the unassigned set', async () => {
    const a = await actors();
    const assignment = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await unassignExporterFromAgent({ actor: a.admin, assignmentId: assignment.id, reason: 'Test', correlationId: corr() });

    expect((await prisma.exporterOrg.findUniqueOrThrow({ where: { id: a.orgId } })).assigned_agent_id).toBeNull();
  });

  test('reassigning moves the cache column to the new agent, not just the join row', async () => {
    const a = await actors();
    const original = await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await reassignExporterToAgent({ actor: a.admin, assignmentId: original.id, newAgentUserId: a.otherAgent.id, reason: 'Rebalance', correlationId: corr() });

    expect((await prisma.exporterOrg.findUniqueOrThrow({ where: { id: a.orgId } })).assigned_agent_id).toBe(a.otherAgent.id);
  });
});

describe('#4 pilot UAT scenario — Alpha/Bravo move to one agent, Charlie stays isolated', () => {
  test('Alpha and Bravo end up owned by the same agent; Charlie, untouched, stays with its own agent and is invisible to the other', async () => {
    const a = await actors();
    const [alpha, bravo, charlie] = await Promise.all([
      prisma.exporterOrg.create({ data: { display_name: '[PILOT] Alpha', tier: OrgTier.paid }, select: { id: true } }),
      prisma.exporterOrg.create({ data: { display_name: '[PILOT] Bravo', tier: OrgTier.paid }, select: { id: true } }),
      prisma.exporterOrg.create({ data: { display_name: '[PILOT] Charlie', tier: OrgTier.paid }, select: { id: true } }),
    ]);
    // Charlie is assigned up front to the OTHER agent and must never be touched below.
    await assignExporterToAgent({ actor: a.admin, agentUserId: a.otherAgent.id, exporterOrgId: charlie.id, correlationId: corr() });

    await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: alpha.id, correlationId: corr() });
    await assignExporterToAgent({ actor: a.admin, agentUserId: a.agent.id, exporterOrgId: bravo.id, correlationId: corr() });

    const ownedByAgent = (await assignedOrgIds(a.agent)).sort();
    expect(ownedByAgent).toEqual([alpha.id, bravo.id].sort());
    expect(ownedByAgent).not.toContain(charlie.id);

    const ownedByOtherAgent = await assignedOrgIds(a.otherAgent);
    expect(ownedByOtherAgent).toEqual([charlie.id]);

    expect(await prisma.exporterOrg.count({ where: { id: { in: [alpha.id, bravo.id] } }, })).toBe(2);
    const orgs = await prisma.exporterOrg.findMany({ where: { id: { in: [alpha.id, bravo.id, charlie.id] } } });
    expect(orgs.find((o) => o.id === alpha.id)!.assigned_agent_id).toBe(a.agent.id);
    expect(orgs.find((o) => o.id === bravo.id)!.assigned_agent_id).toBe(a.agent.id);
    expect(orgs.find((o) => o.id === charlie.id)!.assigned_agent_id).toBe(a.otherAgent.id);
  });
});

describe('UI exposes the controls this feature requires', () => {
  // Source-level, in the same spirit as tests/navigation.test.ts: the question here is "does the
  // markup wire the button to the mutation", which grepping the rendered-from-server page module
  // proves directly, without standing up a browser.
  test('/ops/assignments renders an Assign control for the unassigned queue and Reassign/Unassign for current assignments', () => {
    const source = readFileSync('src/app/ops/assignments/page.tsx', 'utf8');
    expect(source).toMatch(/AssignAgentToExporterForm/);
    expect(source).toMatch(/ReassignExporterForm/);
    expect(source).toMatch(/AssignExporterForm/);
    // The Unassigned queue table must offer the control per row, not just import it unused.
    expect(source).toMatch(/exporterOrgId=\{org\.id\}/);
  });

  test('AssignAgentToExporterForm only offers agents it was given, and posts to the canonical assignment route', () => {
    const source = readFileSync('src/components/ops/AssignAgentToExporterForm.tsx', 'utf8');
    expect(source).toMatch(/\/api\/v1\/ops\/agent-assignments/);
    expect(source).not.toMatch(/\/api\/v1\/ops\/agent-assignments-v2|\/api\/v1\/assignments/); // no parallel implementation
  });

  test('the invitation generator has no email input, and the direct-add section still requires one', () => {
    const page = readFileSync('src/app/ops/agents/page.tsx', 'utf8');
    expect(page).toMatch(/GenerateInvitationLinkForm/);
    expect(page).toMatch(/AddAgentForm/);

    const generator = readFileSync('src/components/ops/GenerateInvitationLinkForm.tsx', 'utf8');
    expect(generator).not.toMatch(/type="email"|email:/);

    const addAgent = readFileSync('src/components/ops/AddAgentForm.tsx', 'utf8');
    expect(addAgent).toMatch(/type="email"/);
  });

  test('the pending invitation list renders no email for bearer invitations', () => {
    const page = readFileSync('src/app/ops/agents/page.tsx', 'utf8');
    // The invitations map block must not reference `invite.email` anywhere — bearer invitations
    // carry none, and the whole point of this redesign is that the UI never fabricates one.
    expect(page).not.toMatch(/invite\.email/);
  });

  test('agent roster status is derived from User.role/is_active, never from a provisioning-record join', () => {
    // agentRoster's own where-clause is the guarantee; this pins the source shape down so a
    // future edit that starts deriving "Active" from an invitation/grant table trips a test.
    const source = readFileSync('src/lib/staff-provisioning.ts', 'utf8');
    const rosterFn = source.slice(source.indexOf('export async function agentRoster'), source.indexOf('export async function agentDetail'));
    expect(rosterFn).toMatch(/role:\s*UserRole\.agent/);
    expect(rosterFn).not.toMatch(/staffInvitation|staffAccessGrant/i);
  });
});

describe('#10 stale provisioning reconciliation', () => {
  test('admin direct conversion revokes a pending StaffAccessGrant for the same normalized email', async () => {
    const a = await actors();
    const email = `stale-grant-${a.suffix}@t.test`;
    // Grant first, while there is no account yet — the only order grantStaffAccess allows.
    const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    // Then the account shows up through an unrelated path (e.g. ordinary sign-up), leaving the
    // grant stale — exactly the staging bug: an active-agent-to-be with a pending grant nobody
    // revoked yet.
    await prisma.user.create({ data: { email, name: 'Somebody', role: UserRole.exporter_owner } });

    await adminConvertUserToAgent({ actor: a.admin, targetEmail: email, correlationId: corr() });

    const reconciled = await prisma.staffAccessGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(reconciled.status).toBe(StaffAccessGrantStatus.revoked);
    expect(await prisma.staffAccessGrant.count({ where: { email, status: StaffAccessGrantStatus.pending } })).toBe(0);
  });

  test('admin direct conversion revokes a legacy pending email-bound StaffInvitation for the same email', async () => {
    const a = await actors();
    const email = `stale-invite-${a.suffix}@t.test`;
    const legacyId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'agent',$3,$4, NOW() + interval '7 days', NOW())`,
      legacyId, email, randomUUID(), a.admin.id,
    );
    await prisma.user.create({ data: { email, name: 'Somebody', role: UserRole.exporter_owner } });

    await adminConvertUserToAgent({ actor: a.admin, targetEmail: email, correlationId: corr() });

    const reconciled = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: legacyId } });
    expect(reconciled.status).toBe(StaffInvitationStatus.revoked);
  });

  test('the already-an-agent idempotent path ALSO reconciles — this is the exact shape of the staging bug', async () => {
    const a = await actors();
    // a.agent is already role=agent. A pending grant for their email is exactly the staging
    // observation: "Bhavya Sharma, status = Active" alongside "themechanicboy...@gmail.com,
    // status = pending" for the SAME identity.
    const legacyId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'agent',$3,$4, NOW() + interval '7 days', NOW())`,
      legacyId, a.agent.email, randomUUID(), a.admin.id,
    );

    const result = await adminConvertUserToAgent({ actor: a.admin, targetEmail: a.agent.email, correlationId: corr() });
    expect(result.alreadyAgent).toBe(true);

    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: legacyId } })).status)
      .toBe(StaffInvitationStatus.revoked);
  });

  test('claiming a StaffAccessGrant cleans a conflicting legacy pending StaffInvitation for the same email', async () => {
    const a = await actors();
    const email = `claim-cleanup-${a.suffix}@t.test`;
    const legacyId = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'agent',$3,$4, NOW() + interval '7 days', NOW())`,
      legacyId, email, randomUUID(), a.admin.id,
    );
    await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });

    const result = await resolveSocialIdentity({
      provider: 'google', providerAccountId: `g-${randomUUID()}`, email, emailVerified: true, name: 'Claimant', correlationId: corr(),
    });
    expect(result).toMatchObject({ ok: true, role: UserRole.agent });

    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: legacyId } })).status)
      .toBe(StaffInvitationStatus.revoked);
  });

  test('reconciliation never deletes — revoked/accepted rows remain queryable with their final status', async () => {
    const a = await actors();
    const email = `history-${a.suffix}@t.test`;
    const grant = await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    await prisma.user.create({ data: { email, name: 'Somebody', role: UserRole.exporter_owner } });
    await adminConvertUserToAgent({ actor: a.admin, targetEmail: email, correlationId: corr() });

    // Still there, still findable, just no longer pending.
    const row = await prisma.staffAccessGrant.findUnique({ where: { id: grant.id } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe(StaffAccessGrantStatus.revoked);
    const auditRow = await prisma.auditEvent.findFirst({
      where: { object_type: 'staff_access_grant', object_id: grant.id, after_summary: { path: ['auto_reconciled'], equals: true } },
    });
    expect(auditRow).not.toBeNull();
  });

  test('an unrelated bearer invitation (different email-less link) is never touched by someone else becoming an agent', async () => {
    const a = await actors();
    const { invitation: unrelatedBearer } = await generateAgentInvitation({ actor: a.admin, correlationId: corr() });
    const email = `other-${a.suffix}@t.test`;
    await grantStaffAccess({ actor: a.admin, email, correlationId: corr() });
    await prisma.user.create({ data: { email, name: 'Somebody Else', role: UserRole.exporter_owner } });

    await adminConvertUserToAgent({ actor: a.admin, targetEmail: email, correlationId: corr() });

    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: unrelatedBearer.id } })).status)
      .toBe(StaffInvitationStatus.pending);
  });
});
