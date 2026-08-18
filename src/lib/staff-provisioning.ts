/**
 * Staff provisioning — inviting internal agents, and managing their exporter assignments.
 *
 * Two rules this module exists to hold:
 *
 *   1. **An agent is never self-declared.** Public registration and social sign-in produce
 *      exporter users only (asserted by tests in social-auth). The single path to
 *      `role = agent` is an invitation issued by authorized Ops and accepted with a token the
 *      recipient could not have guessed. The role travels on the server-side invitation row,
 *      never on the client's payload.
 *
 *   2. **Staff have no tenant.** Accepting a staff invitation must not fabricate exporter
 *      membership; access comes later and only from `AgentAssignment`. A staff user with an
 *      `exporter_org_id` would be inside a tenant while also holding cross-tenant powers.
 */

import { createHash, randomBytes } from 'node:crypto';
import { AssignmentStatus, StaffInvitationStatus, UserRole, type Prisma, type StaffInvitation } from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { isOps } from '@/lib/permissions';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

/** How long a staff invitation stays usable. */
export const STAFF_INVITE_TTL_DAYS = 7;

/**
 * Operational capacity guidance, not a limit.
 *
 * ~10 exporters per agent is a staffing target. It is surfaced so Ops can see workload, and
 * deliberately does not block assignment 11 — no business rule requires that, and a hard cap
 * would turn a planning signal into an outage during a reassignment.
 */
export const AGENT_CAPACITY_TARGET = 10;

/** Roles a staff invitation may grant. Mirrored by a database CHECK. */
export const INVITABLE_STAFF_ROLES: readonly UserRole[] = [
  UserRole.agent, UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin,
];

/**
 * Who may provision staff or move assignments.
 *
 * Ops roles only. An agent must not invite another agent or assign themselves an exporter —
 * self-assignment would let any agent grant themselves access to every tenant, which is the
 * whole boundary `AgentAssignment` exists to draw. Exporters are refused for the same reason
 * they cannot pick their own agent.
 */
export function assertCanProvisionStaff(principal: Principal): void {
  if (!isOps(principal)) {
    throw forbidden('Only Ops or an administrator may provision staff or manage assignments.');
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A staff invitation, plus the one-time token. The token is returned ONCE and never stored raw. */
export interface IssuedStaffInvitation {
  invitation: StaffInvitation;
  /** Show to the operator / send to the invitee. Never audited, never logged, never re-readable. */
  token: string;
}

export async function inviteStaff(
  input: { actor: Principal; email: string; role?: UserRole; correlationId: string },
): Promise<IssuedStaffInvitation> {
  assertCanProvisionStaff(input.actor);

  const email = input.email.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw validationError([{ field: 'email', code: 'invalid', message: 'Enter a valid email address.' }]);
  }
  // Defaulting to `agent` rather than accepting whatever arrives: Phase 4 provisions agents,
  // and a caller-chosen role is exactly the escalation vector this path must not have.
  const role = input.role ?? UserRole.agent;
  if (!INVITABLE_STAFF_ROLES.includes(role)) {
    throw validationError([{ field: 'role', code: 'invalid', message: 'That role cannot be granted by a staff invitation.' }]);
  }

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existingUser) {
    throw validationError(
      [{ field: 'email', code: 'taken', message: 'This email already has an account.' }],
      'This person already has an account. Change their role through Ops rather than inviting them again.',
    );
  }

  const token = randomBytes(32).toString('base64url');

  return prisma.$transaction(async (tx) => {
    const live = await tx.staffInvitation.findFirst({
      where: { email, status: StaffInvitationStatus.pending },
    });
    // Idempotent rather than an error, matching the exporter invite route's behaviour. The
    // original token is NOT re-issuable — only its hash was kept — so re-inviting revokes and
    // replaces rather than resurrecting a token nobody can produce.
    if (live) {
      await tx.staffInvitation.update({
        where: { id: live.id },
        data: { status: StaffInvitationStatus.revoked, revoked_at: new Date(), revoked_by_id: input.actor.id },
      });
    }

    const invitation = await tx.staffInvitation.create({
      data: {
        email,
        role,
        token: hashToken(token),
        invited_by_id: input.actor.id,
        expires_at: new Date(Date.now() + STAFF_INVITE_TTL_DAYS * 86_400_000),
      },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.create,
      object_type: 'staff_invitation',
      object_id: invitation.id,
      // Email and role only. The token is a credential; putting it in an audit payload would
      // make the audit log itself a way to take over the invitation.
      after_summary: { email, role, expires_at: invitation.expires_at.toISOString(), replaced_pending: Boolean(live) },
      correlation_id: input.correlationId,
    });

    return { invitation, token };
  });
}

export async function revokeStaffInvitation(
  input: { actor: Principal; invitationId: string; correlationId: string },
): Promise<StaffInvitation> {
  assertCanProvisionStaff(input.actor);
  return prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({ where: { id: input.invitationId } });
    if (!invitation) throw notFound('That invitation does not exist.');
    if (invitation.status !== StaffInvitationStatus.pending) {
      throw validationError([{ field: 'status', code: 'not_pending', message: 'Only a pending invitation can be revoked.' }]);
    }
    const revoked = await tx.staffInvitation.update({
      where: { id: invitation.id },
      data: { status: StaffInvitationStatus.revoked, revoked_at: new Date(), revoked_by_id: input.actor.id },
    });
    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.cancel,
      object_type: 'staff_invitation', object_id: invitation.id,
      after_summary: { email: invitation.email, status: 'revoked' },
      correlation_id: input.correlationId,
    });
    return revoked;
  });
}

export type AcceptStaffInvitationResult = { userId: string; role: UserRole };

/**
 * Accept a staff invitation and provision the account.
 *
 * The role comes from the invitation row, never from the caller. Expiry is evaluated here
 * rather than trusted from `status`, because a row can sit at `pending` past its expiry until
 * something sweeps it — treating the stored status as authoritative would make an expired token
 * usable for as long as nobody ran the sweep.
 */
export async function acceptStaffInvitation(
  input: { token: string; name: string; passwordHash?: string | null; correlationId: string },
  now: Date = new Date(),
): Promise<AcceptStaffInvitationResult> {
  const tokenHash = hashToken(input.token ?? '');

  // Sweep an expired invitation BEFORE opening the transaction below. Marking it inside that
  // transaction and then throwing would roll the marking back with everything else, leaving the
  // row at `pending` forever — the status would then disagree with the expiry it already has.
  const candidate = await prisma.staffInvitation.findUnique({ where: { token: tokenHash } });
  if (candidate
      && candidate.status === StaffInvitationStatus.pending
      && candidate.expires_at.getTime() <= now.getTime()) {
    await prisma.staffInvitation.update({
      where: { id: candidate.id },
      data: { status: StaffInvitationStatus.expired },
    });
  }

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.findUnique({ where: { token: tokenHash } });
    // One message for unknown, revoked, accepted and expired: distinguishing them would let a
    // caller probe which tokens exist.
    const unusable = () => validationError(
      [{ field: 'token', code: 'invalid', message: 'This invitation is not valid. Ask Ops to send a new one.' }],
      'This invitation is not valid.',
    );
    if (!invitation) throw unusable();
    if (invitation.status !== StaffInvitationStatus.pending) throw unusable();
    // Re-checked rather than trusted from `status`: the sweep above runs on this same clock,
    // but a row could also have been written expired by another path.
    if (invitation.expires_at.getTime() <= now.getTime()) throw unusable();

    const existing = await tx.user.findUnique({ where: { email: invitation.email }, select: { id: true } });
    if (existing) throw unusable();

    const user = await tx.user.create({
      data: {
        email: invitation.email,
        name: input.name?.trim() || invitation.email.split('@')[0],
        role: invitation.role,
        password_hash: input.passwordHash ?? null,
        // Explicitly null: staff hold no tenant. Access arrives later via AgentAssignment.
        exporter_org_id: null,
      },
      select: { id: true, role: true },
    });

    await tx.staffInvitation.update({
      where: { id: invitation.id },
      data: { status: StaffInvitationStatus.accepted, accepted_at: now, accepted_user_id: user.id },
    });

    await writeAuditEvent({
      db: tx,
      // The invitee is the actor: they performed the acceptance.
      actor: { id: user.id, email: invitation.email, name: input.name ?? '', role: user.role, exporter_org_id: null, tier: 'paid' } as Principal,
      action: AUDIT_ACTIONS.create,
      object_type: 'user',
      object_id: user.id,
      after_summary: {
        provisioned_role: user.role,
        via_staff_invitation: invitation.id,
        invited_by: invitation.invited_by_id,
      },
      correlation_id: input.correlationId,
    });

    return { userId: user.id, role: user.role };
  });
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function assignExporterToAgent(
  input: { actor: Principal; agentUserId: string; exporterOrgId: string; reason?: string | null; correlationId: string },
) {
  assertCanProvisionStaff(input.actor);

  return prisma.$transaction(async (tx) => {
    const [agent, org] = await Promise.all([
      tx.user.findUnique({ where: { id: input.agentUserId }, select: { id: true, role: true, is_active: true } }),
      tx.exporterOrg.findUnique({ where: { id: input.exporterOrgId }, select: { id: true } }),
    ]);
    if (!agent) throw notFound('That agent does not exist.');
    if (!org) throw notFound('That exporter does not exist.');
    // Assigning a non-agent would grant tenant access to a role the portal guard never expects.
    if (agent.role !== UserRole.agent) {
      throw validationError([{ field: 'agent_user_id', code: 'not_an_agent', message: 'Only an agent can be assigned an exporter.' }]);
    }
    if (!agent.is_active) {
      throw validationError([{ field: 'agent_user_id', code: 'inactive', message: 'That agent is deactivated.' }]);
    }

    const existing = await tx.agentAssignment.findFirst({
      where: { agent_user_id: agent.id, exporter_org_id: org.id, status: AssignmentStatus.active },
    });
    // Idempotent: re-assigning an existing pair returns it rather than stacking duplicate active
    // rows, which would make "who owns this exporter" ambiguous.
    if (existing) return existing;

    const assignment = await tx.agentAssignment.create({
      data: {
        agent_user_id: agent.id,
        exporter_org_id: org.id,
        assigned_by_id: input.actor.id,
        status: AssignmentStatus.active,
        reason: input.reason ?? null,
      },
    });

    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.reassign,
      object_type: 'agent_assignment', object_id: assignment.id,
      exporter_org_id: org.id,
      after_summary: { agent_user_id: agent.id, exporter_org_id: org.id, status: 'active', reason: input.reason ?? null },
      correlation_id: input.correlationId,
    });
    return assignment;
  });
}

export async function unassignExporterFromAgent(
  input: { actor: Principal; assignmentId: string; reason?: string | null; correlationId: string },
) {
  assertCanProvisionStaff(input.actor);

  return prisma.$transaction(async (tx) => {
    const assignment = await tx.agentAssignment.findUnique({ where: { id: input.assignmentId } });
    if (!assignment) throw notFound('That assignment does not exist.');
    if (assignment.status !== AssignmentStatus.active) {
      throw validationError([{ field: 'status', code: 'not_active', message: 'That assignment is already ended.' }]);
    }

    // Ended, never deleted: assignment history is how "who was responsible in March" stays
    // answerable, and `assignedOrgIds` filters on status rather than existence.
    const ended = await tx.agentAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.ended, ended_at: new Date(), reason: input.reason ?? assignment.reason },
    });

    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.reassign,
      object_type: 'agent_assignment', object_id: assignment.id,
      exporter_org_id: assignment.exporter_org_id,
      before_summary: { status: 'active' },
      after_summary: { status: 'ended', agent_user_id: assignment.agent_user_id, reason: input.reason ?? null },
      correlation_id: input.correlationId,
    });
    return ended;
  });
}

// ---------------------------------------------------------------------------
// Ops read model
// ---------------------------------------------------------------------------

export async function agentRoster(principal: Principal, db: Prisma.TransactionClient | typeof prisma = prisma) {
  assertCanProvisionStaff(principal);
  const agents = await db.user.findMany({
    where: { role: UserRole.agent },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, email: true, is_active: true, created_at: true,
      agent_assignments: {
        where: { status: AssignmentStatus.active },
        select: { id: true, exporter_org_id: true, started_at: true, exporter_org: { select: { display_name: true } } },
      },
    },
  });
  return agents.map((agent) => ({
    ...agent,
    assignedCount: agent.agent_assignments.length,
    capacityTarget: AGENT_CAPACITY_TARGET,
    // Guidance, not a gate — see AGENT_CAPACITY_TARGET.
    overTarget: agent.agent_assignments.length > AGENT_CAPACITY_TARGET,
  }));
}

export async function agentDetail(principal: Principal, agentUserId: string) {
  assertCanProvisionStaff(principal);
  const agent = await prisma.user.findUnique({
    where: { id: agentUserId },
    select: {
      id: true, name: true, email: true, is_active: true, role: true, created_at: true,
      agent_assignments: {
        orderBy: [{ status: 'asc' }, { started_at: 'desc' }],
        select: {
          id: true, status: true, started_at: true, ended_at: true, reason: true,
          exporter_org: { select: { id: true, display_name: true, tier: true } },
          assigned_by: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!agent || agent.role !== UserRole.agent) throw notFound('That agent does not exist.');
  const active = agent.agent_assignments.filter((a) => a.status === AssignmentStatus.active);
  return { ...agent, activeCount: active.length, capacityTarget: AGENT_CAPACITY_TARGET };
}

export async function pendingStaffInvitations(principal: Principal) {
  assertCanProvisionStaff(principal);
  return prisma.staffInvitation.findMany({
    where: { status: StaffInvitationStatus.pending },
    orderBy: { created_at: 'desc' },
    // `token` is deliberately absent from the selection — it is a credential, and an Ops list
    // has no reason to carry one.
    select: {
      id: true, email: true, role: true, expires_at: true, created_at: true,
      invited_by: { select: { id: true, name: true } },
    },
  });
}
