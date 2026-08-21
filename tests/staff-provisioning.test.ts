import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { AssignmentStatus, OrgTier, StaffInvitationStatus, UserRole } from '@prisma/client';
import {
  agentDetail,
  agentRoster,
  assignExporterToAgent,
  assertCanProvisionStaff,
  convertUserToAgent,
  generateAgentInvitation,
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

  test('an agent cannot generate an invitation link, and none is written', async () => {
    const a = await actors();
    const before = await prisma.staffInvitation.count({ where: { invited_by_id: a.agent.id } });
    await expect(generateAgentInvitation({ actor: a.agent, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await prisma.staffInvitation.count({ where: { invited_by_id: a.agent.id } })).toBe(before);
  });

  test('an exporter cannot generate an invitation link', async () => {
    const a = await actors();
    await expect(generateAgentInvitation({ actor: a.exporter, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('bearer invitation lifecycle', () => {
  test('Ops generates a link with no email; the token is returned once and stored only as a hash', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });

    expect(invitation.role).toBe(UserRole.agent);
    expect(invitation.status).toBe(StaffInvitationStatus.pending);
    expect(invitation.email).toBeNull();
    expect(token).toHaveLength(43); // 32 random bytes, base64url
    // The raw token must not be recoverable from the row.
    const stored = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stored.token).not.toBe(token);
    expect(stored.token).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.email).toBeNull();
  });

  test('the audit event records the invite but never an email or the token', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });

    const events = await prisma.auditEvent.findMany({
      where: { object_type: 'staff_invitation', object_id: invitation.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.after_summary).toMatchObject({ role: 'agent', bearer: true });
    expect('email' in (events[0]!.after_summary as object)).toBe(false);
    // A token in an audit payload would make the audit log a way to steal the invitation.
    expect(JSON.stringify(events[0]!.after_summary)).not.toContain(token);
  });

  test('confirming as a signed-in, eligible account provisions an agent with NO exporter org', async () => {
    const a = await actors();
    const { token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });

    const result = await convertUserToAgent({ actor: a.exporter, token, correlationId: corr() });
    expect(result.role).toBe(UserRole.agent);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: result.userId } });
    expect(user.role).toBe(UserRole.agent);
    // Staff hold no tenant; access arrives only through AgentAssignment.
    expect(user.exporter_org_id).toBeNull();
    expect(user.id).toBe(a.exporter.id);
  });

  test('a claimed token cannot be reused by a different account', async () => {
    const a = await actors();
    const { token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    await convertUserToAgent({ actor: a.exporter, token, correlationId: corr() });

    const second = await prisma.user.create({
      data: { email: `second-${a.suffix}@t.test`, name: 'Second', role: UserRole.exporter_owner },
      select: { id: true, email: true },
    });
    await expect(convertUserToAgent({
      actor: principal(second.id, UserRole.exporter_owner), token, correlationId: corr(),
    })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: second.id } })).role).toBe(UserRole.exporter_owner);
  });

  test('an expired invitation cannot be accepted, and is marked expired', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    // Expiry is evaluated against the clock, not trusted from `status` — a row can sit at
    // pending past its expiry until something sweeps it.
    const future = new Date(invitation.expires_at.getTime() + 1000);
    await expect(convertUserToAgent({ actor: a.exporter, token, correlationId: corr(), now: future }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status)
      .toBe(StaffInvitationStatus.expired);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.exporter.id } })).role).toBe(UserRole.exporter_owner);
  });

  test('a revoked invitation cannot be accepted', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    await revokeStaffInvitation({ actor: a.ops, invitationId: invitation.id, correlationId: corr() });
    await expect(convertUserToAgent({ actor: a.exporter, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('an unknown token is refused identically to a revoked one', async () => {
    // Distinguishing them would let a caller probe which tokens exist.
    const a = await actors();
    await expect(convertUserToAgent({ actor: a.exporter, token: 'not-a-real-token', correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('generating another link never touches an earlier one — there is no shared email to collide on', async () => {
    // Unlike the old email-bound design, an Admin may deliberately want several live
    // invitations out at once for several different people; each call is independent.
    const a = await actors();
    const first = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    const second = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });

    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: first.invitation.id } })).status)
      .toBe(StaffInvitationStatus.pending);
    expect(await prisma.staffInvitation.count({
      where: { invited_by_id: a.ops.id, status: StaffInvitationStatus.pending },
    })).toBeGreaterThanOrEqual(2);

    const claimantA = await prisma.user.create({ data: { email: `link-a-${a.suffix}@t.test`, name: 'A', role: UserRole.exporter_owner }, select: { id: true } });
    const claimantB = await prisma.user.create({ data: { email: `link-b-${a.suffix}@t.test`, name: 'B', role: UserRole.exporter_owner }, select: { id: true } });
    await expect(convertUserToAgent({ actor: principal(claimantA.id, UserRole.exporter_owner), token: first.token, correlationId: corr() }))
      .resolves.toMatchObject({ role: UserRole.agent });
    await expect(convertUserToAgent({ actor: principal(claimantB.id, UserRole.exporter_owner), token: second.token, correlationId: corr() }))
      .resolves.toMatchObject({ role: UserRole.agent });
  });

  test('the database refuses a non-agent role on a StaffInvitation', async () => {
    const a = await actors();
    // Bypassing the service entirely: the CHECK is the guarantee, because this is the
    // privilege-escalation boundary. A bearer link landing on ops/admin with no confirmation
    // step beyond "click and sign in" would be a materially more dangerous default.
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,NULL,'ops_supervisor',$2,$3, NOW() + interval '1 day', NOW())`,
      randomUUID(), randomUUID(), a.ops.id,
    )).rejects.toThrow(/StaffInvitation_role_is_agent/);
  });

  test('the partial unique index allows any number of concurrently pending bearer (NULL-email) invitations', async () => {
    // The rule it still enforces — "at most one pending invitation per email" — only ever
    // applied to non-null emails. Postgres never treats two NULLs as equal, so this needs no
    // migration change; this test pins that behaviour down directly rather than trusting the
    // reasoning.
    const a = await actors();
    await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    await expect(generateAgentInvitation({ actor: a.ops, correlationId: corr() })).resolves.toBeTruthy();
    expect(await prisma.staffInvitation.count({
      where: { invited_by_id: a.ops.id, status: StaffInvitationStatus.pending, email: null },
    })).toBeGreaterThanOrEqual(2);
  });

  test('the database still refuses two pending LEGACY (non-null-email) invitations for the same email', async () => {
    const a = await actors();
    const email = `legacy-two-${a.suffix}@t.test`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'agent',$3,$4, NOW() + interval '1 day', NOW())`,
      randomUUID(), email, randomUUID(), a.ops.id,
    );
    await expect(prisma.$executeRawUnsafe(
      `INSERT INTO "StaffInvitation" ("id","email","role","token","invited_by_id","expires_at","updated_at")
       VALUES ($1,$2,'agent',$3,$4, NOW() + interval '1 day', NOW())`,
      randomUUID(), email, randomUUID(), a.ops.id,
      // Postgres reports the partial unique index by key rather than by name.
    )).rejects.toThrow(/already exists/);
  });

  /**
   * Item 2's concurrency requirement: two users attempting the same bearer link must result in
   * exactly ONE successful claim. Unlike the old email-bound design (where the race was on
   * creating a second invitation for one email), the load-bearing race here is two different
   * accounts confirming the SAME token at once.
   */
  test('two different accounts racing to confirm the same bearer link produce exactly one agent', async () => {
    const a = await actors();
    const { invitation, token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    const [racerA, racerB] = await Promise.all([
      prisma.user.create({ data: { email: `race-a-${a.suffix}@t.test`, name: 'A', role: UserRole.exporter_owner }, select: { id: true } }),
      prisma.user.create({ data: { email: `race-b-${a.suffix}@t.test`, name: 'B', role: UserRole.exporter_owner }, select: { id: true } }),
    ]);

    const results = await Promise.allSettled([
      convertUserToAgent({ actor: principal(racerA.id, UserRole.exporter_owner), token, correlationId: corr() }),
      convertUserToAgent({ actor: principal(racerB.id, UserRole.exporter_owner), token, correlationId: corr() }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const consumed = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(consumed.status).toBe(StaffInvitationStatus.accepted);
    // Exactly one of the two racers actually became an agent.
    const roles = await prisma.user.findMany({ where: { id: { in: [racerA.id, racerB.id] } }, select: { role: true } });
    expect(roles.filter((r) => r.role === UserRole.agent)).toHaveLength(1);
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

  test('the only path to a staff role runs through an Ops-generated invitation or Admin action', async () => {
    const a = await actors();
    const { token } = await generateAgentInvitation({ actor: a.ops, correlationId: corr() });
    // The confirmation call carries no role field at all — the role always comes from the
    // invitation row (`agent`, enforced by a database CHECK); this is the whole surface.
    const { role } = await convertUserToAgent({ actor: a.exporter, token, correlationId: corr() });
    expect(role).toBe(UserRole.agent);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: a.exporter.id } });
    expect(user.exporter_org_id).toBeNull();
  });
});
