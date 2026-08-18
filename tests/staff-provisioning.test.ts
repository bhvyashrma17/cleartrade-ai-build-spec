import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { AssignmentStatus, OrgTier, StaffInvitationStatus, UserRole } from '@prisma/client';
import {
  acceptStaffInvitation,
  agentDetail,
  agentRoster,
  assignExporterToAgent,
  assertCanProvisionStaff,
  inviteStaff,
  revokeStaffInvitation,
  unassignExporterFromAgent,
} from '../src/lib/staff-provisioning';
import { assignedOrgIds } from '../src/lib/permissions';
import { prisma } from '../src/lib/prisma';
import { createInvitationSchema, registerSchema } from '../src/lib/validators';
import type { Principal } from '../src/types';

afterAll(async () => { await prisma.$disconnect(); });

const principal = (id: string, role: UserRole, orgId: string | null = null): Principal => ({
  id, email: `${id}@t.test`, name: role, role, exporter_org_id: orgId, tier: OrgTier.paid,
});

async function actors() {
  const s = randomUUID().slice(0, 8);
  const org = await prisma.exporterOrg.create({
    data: { display_name: `Prov Org ${s}`, tier: OrgTier.paid }, select: { id: true },
  });
  const [ops, admin, agent, exporterUser] = await Promise.all([
    prisma.user.create({ data: { email: `ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor }, select: { id: true } }),
    prisma.user.create({ data: { email: `adm-${s}@t.test`, name: 'Admin', role: UserRole.admin }, select: { id: true } }),
    prisma.user.create({ data: { email: `agt-${s}@t.test`, name: 'Agent', role: UserRole.agent }, select: { id: true } }),
    prisma.user.create({ data: { email: `exp-${s}@t.test`, name: 'Owner', role: UserRole.exporter_owner, exporter_org_id: org.id }, select: { id: true } }),
  ]);
  return {
    suffix: s, orgId: org.id,
    ops: principal(ops.id, UserRole.ops_supervisor),
    admin: principal(admin.id, UserRole.admin),
    agent: principal(agent.id, UserRole.agent),
    exporter: principal(exporterUser.id, UserRole.exporter_owner, org.id),
  };
}

const corr = () => randomUUID();

describe('who may provision staff', () => {
  test('Ops and admin may; agent and exporter may not', async () => {
    const a = await actors();
    expect(() => assertCanProvisionStaff(a.ops)).not.toThrow();
    expect(() => assertCanProvisionStaff(a.admin)).not.toThrow();
    // An agent inviting an agent, or assigning themselves an exporter, would let any agent
    // reach every tenant — the boundary AgentAssignment exists to draw.
    expect(() => assertCanProvisionStaff(a.agent)).toThrow(/Ops or an administrator/);
    expect(() => assertCanProvisionStaff(a.exporter)).toThrow(/Ops or an administrator/);
  });

  test('an agent cannot issue a staff invitation, and none is written', async () => {
    const a = await actors();
    const email = `new-${a.suffix}@cleartrade.test`;
    await expect(inviteStaff({ actor: a.agent, email, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.staffInvitation.count({ where: { email } })).toBe(0);
  });

  test('an exporter cannot issue a staff invitation', async () => {
    const a = await actors();
    await expect(inviteStaff({ actor: a.exporter, email: `x-${a.suffix}@t.test`, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('staff invitation lifecycle', () => {
  test('Ops issues an invitation; the token is returned once and stored only as a hash', async () => {
    const a = await actors();
    const email = `agent-${a.suffix}@cleartrade.test`;
    const { invitation, token } = await inviteStaff({ actor: a.ops, email, correlationId: corr() });

    expect(invitation.role).toBe(UserRole.agent);
    expect(invitation.status).toBe(StaffInvitationStatus.pending);
    expect(token).toHaveLength(43); // 32 random bytes, base64url
    // The raw token must not be recoverable from the row.
    const stored = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stored.token).not.toBe(token);
    expect(stored.token).toMatch(/^[0-9a-f]{64}$/);
  });

  test('the audit event records the invite but never the token', async () => {
    const a = await actors();
    const email = `audit-${a.suffix}@cleartrade.test`;
    const { invitation, token } = await inviteStaff({ actor: a.ops, email, correlationId: corr() });

    const events = await prisma.auditEvent.findMany({
      where: { object_type: 'staff_invitation', object_id: invitation.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.after_summary).toMatchObject({ email, role: 'agent' });
    // A token in an audit payload would make the audit log a way to steal the invitation.
    expect(JSON.stringify(events[0]!.after_summary)).not.toContain(token);
  });

  test('accepting provisions an agent with NO exporter org', async () => {
    const a = await actors();
    const email = `accept-${a.suffix}@cleartrade.test`;
    const { token } = await inviteStaff({ actor: a.ops, email, correlationId: corr() });

    const result = await acceptStaffInvitation({ token, name: 'New Agent', correlationId: corr() });
    expect(result.role).toBe(UserRole.agent);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.role).toBe(UserRole.agent);
    // Staff hold no tenant; access arrives only through AgentAssignment.
    expect(user.exporter_org_id).toBeNull();
    expect(user.email).toBe(email);
  });

  test('the role comes from the invitation, never from the acceptance payload', async () => {
    const a = await actors();
    const { token } = await inviteStaff({ actor: a.ops, email: `role-${a.suffix}@t.test`, correlationId: corr() });
    // acceptStaffInvitation takes name and password only — there is no role parameter to pass,
    // so a client cannot choose one. The provisioned role matches the stored invitation.
    const result = await acceptStaffInvitation({ token, name: 'Agent', correlationId: corr() });
    const invitation = await prisma.staffInvitation.findFirstOrThrow({ where: { accepted_user_id: result.userId } });
    expect(result.role).toBe(invitation.role);
    expect(result.role).toBe(UserRole.agent);
  });

  test('a token cannot be reused', async () => {
    const a = await actors();
    const { token } = await inviteStaff({ actor: a.ops, email: `once-${a.suffix}@t.test`, correlationId: corr() });
    await acceptStaffInvitation({ token, name: 'First', correlationId: corr() });
    await expect(acceptStaffInvitation({ token, name: 'Second', correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.user.count({ where: { email: `once-${a.suffix}@t.test` } })).toBe(1);
  });

  test('an expired invitation cannot be accepted, and is marked expired', async () => {
    const a = await actors();
    const { invitation, token } = await inviteStaff({ actor: a.ops, email: `lapsed-${a.suffix}@t.test`, correlationId: corr() });
    // Expiry is evaluated against the clock, not trusted from `status` — a row can sit at
    // pending past its expiry until something sweeps it.
    const future = new Date(invitation.expires_at.getTime() + 1000);
    await expect(acceptStaffInvitation({ token, name: 'Late', correlationId: corr() }, future))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status)
      .toBe(StaffInvitationStatus.expired);
    expect(await prisma.user.count({ where: { email: `lapsed-${a.suffix}@t.test` } })).toBe(0);
  });

  test('a revoked invitation cannot be accepted', async () => {
    const a = await actors();
    const { invitation, token } = await inviteStaff({ actor: a.ops, email: `rev-${a.suffix}@t.test`, correlationId: corr() });
    await revokeStaffInvitation({ actor: a.ops, invitationId: invitation.id, correlationId: corr() });
    await expect(acceptStaffInvitation({ token, name: 'Nope', correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('an unknown token is refused identically to a revoked one', async () => {
    // Distinguishing them would let a caller probe which tokens exist.
    await expect(acceptStaffInvitation({ token: 'not-a-real-token', name: 'X', correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('re-inviting the same email replaces the pending invitation rather than stacking', async () => {
    const a = await actors();
    const email = `dup-${a.suffix}@t.test`;
    const first = await inviteStaff({ actor: a.ops, email, correlationId: corr() });
    const second = await inviteStaff({ actor: a.ops, email, correlationId: corr() });

    expect(await prisma.staffInvitation.count({ where: { email, status: StaffInvitationStatus.pending } })).toBe(1);
    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status)
      .toBe(StaffInvitationStatus.revoked);
    // The superseded token stops working immediately.
    await expect(acceptStaffInvitation({ token: first.token, name: 'Old', correlationId: corr() })).rejects.toThrow();
    await expect(acceptStaffInvitation({ token: second.token, name: 'New', correlationId: corr() })).resolves.toMatchObject({ role: UserRole.agent });
  });

  test('a staff invitation cannot be issued for an email that already has an account', async () => {
    const a = await actors();
    // The fixture's exporter user. Inviting them as staff would be a role change wearing the
    // costume of a new account; changing an existing user's role must go through Ops, not here.
    await expect(inviteStaff({ actor: a.ops, email: `exp-${a.suffix}@t.test`, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.staffInvitation.count({ where: { email: `exp-${a.suffix}@t.test` } })).toBe(0);
  });

  test('the database refuses a staff invitation granting an exporter role', async () => {
    const a = await actors();
    // Bypassing the service entirely: the CHECK is the guarantee, because this is the
    // privilege-escalation boundary.
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'exporter_owner',$3,$4, NOW() + interval '1 day', NOW())`,
      randomUUID(), `bad-${a.suffix}@t.test`, randomUUID(), a.ops.id,
    )).rejects.toThrow(/StaffInvitation_role_is_staff/);
  });

  test('the database refuses two pending invitations for one email', async () => {
    const a = await actors();
    const email = `two-${a.suffix}@t.test`;
    await inviteStaff({ actor: a.ops, email, correlationId: corr() });
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'agent',$3,$4, NOW() + interval '1 day', NOW())`,
      randomUUID(), email, randomUUID(), a.ops.id,
      // Postgres reports the partial unique index by key rather than by name.
    )).rejects.toThrow(/already exists/);
  });
});

describe('assignments', () => {
  test('Ops assigns, and the agent immediately gains exactly that org', async () => {
    const a = await actors();
    expect(await assignedOrgIds(a.agent)).toEqual([]);

    await assignExporterToAgent({
      actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr(),
    });
    // Behavioural proof of the grant: the same helper every authorization path uses.
    expect(await assignedOrgIds(a.agent)).toEqual([a.orgId]);
  });

  test('an agent cannot self-assign', async () => {
    const a = await actors();
    await expect(assignExporterToAgent({
      actor: a.agent, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr(),
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await assignedOrgIds(a.agent)).toEqual([]);
  });

  test('an exporter cannot assign an agent', async () => {
    const a = await actors();
    await expect(assignExporterToAgent({
      actor: a.exporter, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr(),
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  test('assigning twice is idempotent, not a duplicate grant', async () => {
    const a = await actors();
    const first = await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    const second = await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    expect(second.id).toBe(first.id);
    expect(await prisma.agentAssignment.count({
      where: { agent_user_id: a.agent.id, exporter_org_id: a.orgId, status: AssignmentStatus.active },
    })).toBe(1);
  });

  test('a non-agent cannot be assigned an exporter', async () => {
    const a = await actors();
    await expect(assignExporterToAgent({
      actor: a.ops, agentUserId: a.exporter.id, exporterOrgId: a.orgId, correlationId: corr(),
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('unassigning removes access but keeps the history', async () => {
    const a = await actors();
    const assignment = await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    expect(await assignedOrgIds(a.agent)).toEqual([a.orgId]);

    await unassignExporterFromAgent({ actor: a.ops, assignmentId: assignment.id, reason: 'Rebalancing', correlationId: corr() });

    // Access gone...
    expect(await assignedOrgIds(a.agent)).toEqual([]);
    // ...but the row survives, so "who was responsible in March" stays answerable.
    const row = await prisma.agentAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    expect(row.status).toBe(AssignmentStatus.ended);
    expect(row.ended_at).toBeInstanceOf(Date);
  });

  test('an agent cannot unassign', async () => {
    const a = await actors();
    const assignment = await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await expect(unassignExporterFromAgent({ actor: a.agent, assignmentId: assignment.id, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await assignedOrgIds(a.agent)).toEqual([a.orgId]);
  });

  test('assignment grants only the intended exporter — no cross-tenant leak', async () => {
    const a = await actors();
    const other = await prisma.exporterOrg.create({
      data: { display_name: `Other ${a.suffix}`, tier: OrgTier.paid }, select: { id: true },
    });
    await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });

    const granted = await assignedOrgIds(a.agent);
    expect(granted).toEqual([a.orgId]);
    expect(granted).not.toContain(other.id);
  });

  test('both directions are audited with actor and subject', async () => {
    const a = await actors();
    const assignment = await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });
    await unassignExporterFromAgent({ actor: a.ops, assignmentId: assignment.id, correlationId: corr() });

    const events = await prisma.auditEvent.findMany({
      where: { object_type: 'agent_assignment', object_id: assignment.id },
      orderBy: { timestamp: 'asc' },
    });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.actor_user_id === a.ops.id)).toBe(true);
    expect(events.every((e) => e.exporter_org_id === a.orgId)).toBe(true);
    expect(events[1]!.after_summary).toMatchObject({ status: 'ended' });
  });
});

describe('Ops read model', () => {
  test('the roster reports workload against the target without capping it', async () => {
    const a = await actors();
    await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: a.orgId, correlationId: corr() });

    const roster = await agentRoster(a.ops);
    const row = roster.find((r) => r.id === a.agent.id)!;
    expect(row.assignedCount).toBe(1);
    expect(row.capacityTarget).toBe(10);
    expect(row.overTarget).toBe(false);
  });

  test('capacity is guidance: an eleventh assignment is allowed and flagged', async () => {
    const a = await actors();
    // 11 orgs, deliberately past the target — no business rule blocks this, and a hard cap
    // would turn a planning signal into an outage during a reassignment.
    for (let i = 0; i < 11; i += 1) {
      const org = await prisma.exporterOrg.create({
        data: { display_name: `Cap ${a.suffix} ${i}`, tier: OrgTier.paid }, select: { id: true },
      });
      await assignExporterToAgent({ actor: a.ops, agentUserId: a.agent.id, exporterOrgId: org.id, correlationId: corr() });
    }
    const detail = await agentDetail(a.ops, a.agent.id);
    expect(detail.activeCount).toBe(11);
    const row = (await agentRoster(a.ops)).find((r) => r.id === a.agent.id)!;
    expect(row.overTarget).toBe(true);
  });

  test('the Ops read model is Ops-only', async () => {
    const a = await actors();
    await expect(agentRoster(a.agent)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(agentDetail(a.exporter, a.agent.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('public registration cannot mint staff', () => {
  test('a role supplied at registration is dropped before it reaches the database', () => {
    const parsed = registerSchema.parse({
      name: 'Mallory', email: 'mallory@t.test', password: 'correct horse',
      organization_name: 'Mallory Exports',
      // A client hoping self-service elevation exists.
      role: UserRole.agent, exporter_org_id: null,
    } as Record<string, unknown>);
    // Zod strips unknown keys, so the route literally cannot read a role off the body — the
    // escalation vector is absent rather than merely unused.
    expect(Object.keys(parsed).sort()).toEqual(['email', 'name', 'organization_name', 'password']);
    expect('role' in parsed).toBe(false);
  });

  test('an exporter owner cannot invite a teammate into a staff role', () => {
    // The other invitation surface. An exporter owner CAN invite, so the role they may name has
    // to be bounded — otherwise team invite is a self-service route to an agent account.
    expect(createInvitationSchema.safeParse({ email: 'x@t.test', role: UserRole.agent }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: 'x@t.test', role: UserRole.ops_supervisor }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: 'x@t.test', role: UserRole.admin }).success).toBe(false);
    expect(createInvitationSchema.safeParse({ email: 'x@t.test', role: UserRole.exporter_member }).success).toBe(true);
  });

  test('the only path to a staff role runs through an Ops-issued invitation', async () => {
    const a = await actors();
    const { token } = await inviteStaff({ actor: a.ops, email: `only-${a.suffix}@t.test`, correlationId: corr() });
    const { role } = await acceptStaffInvitation({
      token, name: 'Invited', correlationId: corr(),
      // The acceptance payload has no role field at all; this is the whole surface.
    });
    expect(role).toBe(UserRole.agent);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `only-${a.suffix}@t.test` } });
    expect(user.exporter_org_id).toBeNull();
  });
});
