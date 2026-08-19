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
import {
  AssignmentStatus, Prisma, StaffAccessGrantStatus, StaffInvitationStatus, UserRole,
  type StaffAccessGrant, type StaffInvitation,
} from '@prisma/client';
import { AUDIT_ACTIONS, writeAuditEvent } from '@/lib/audit';
import { forbidden, notFound, validationError } from '@/lib/errors';
import { OPS_ROLES, isOps } from '@/lib/permissions';
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

  // An existing account is no longer a blanket refusal.
  //
  // It used to be, because the only way to accept was to CREATE a staff account, so an
  // invitation to an existing address could only ever end in a unique-email collision. Now
  // that an invitee can accept by converting the account they already have — explicitly,
  // once, with a sole-owner guard and an audit trail — inviting an existing exporter is the
  // ordinary case rather than a mistake.
  //
  // What stays refused is an existing STAFF account. Changing an Ops or admin role is a
  // provisioning decision that belongs in Ops, not something a mailed link should be able to
  // do, and `convertUserToAgent` refuses those roles for the same reason.
  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });
  if (existingUser && OPS_ROLES.includes(existingUser.role)) {
    throw validationError(
      [{ field: 'email', code: 'taken', message: 'This email belongs to an internal staff account.' }],
      'This person already has an internal ClearTrade account. Change their role through Ops rather than inviting them.',
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

// ---------------------------------------------------------------------------
// Accepting an invitation as an EXISTING ClearTrade user
// ---------------------------------------------------------------------------

/**
 * What the invitation page should render, resolved server-side.
 *
 * A discriminated union rather than a bag of booleans, so the page cannot accidentally render
 * a state it has not handled, and so each state carries exactly the data that state is allowed
 * to reveal — `invitation_email` appears only where the viewer has demonstrably been sent the
 * link AND the token is genuinely live.
 */
export type StaffInvitationView =
  /** No token, or no such invitation. Deliberately says nothing more. */
  | { state: 'unknown' }
  /** The token exists and the holder has it, so naming the reason is not a disclosure. */
  | { state: 'expired' }
  | { state: 'consumed' }
  /** Live invitation, nobody signed in, and no account exists for the invited address yet. */
  | { state: 'ready_new_account'; invitation_email: string }
  /**
   * Live invitation, nobody signed in, but the invited address already has an account.
   * Creating a second User would hit the unique-email constraint, so they sign in and convert.
   */
  | { state: 'ready_needs_signin'; invitation_email: string }
  /** Signed in, email matches, conversion is permitted. */
  | { state: 'ready_convert'; invitation_email: string; current_email: string }
  /** Signed in, email matches, but converting would break a domain invariant. */
  | { state: 'blocked_convert'; invitation_email: string; current_email: string; reason: string }
  /** Signed in as somebody else. Both addresses are shown so the mismatch is actionable. */
  | { state: 'mismatch'; invitation_email: string; current_email: string }
  /** Already the invited role. Nothing to do; not an error. */
  | { state: 'already_agent'; invitation_email: string }
  /** Ops/admin. Fail closed — a staff role is never silently rewritten by a link. */
  | { state: 'already_staff'; invitation_email: string; current_email: string };

/** Emails are compared case-insensitively and trimmed, on both sides, every time. */
const normalizeEmail = (value: string) => value.trim().toLowerCase();

/**
 * Why an exporter account may not become an agent.
 *
 * The invariant is the one the team-management route already enforces in so many words — "An
 * org must always have at least one active owner" — applied to the other direction. Converting
 * the last owner of an org that still has members or business data would leave that tenant with
 * nobody able to administer it, and nothing in the product can repair that afterwards.
 *
 * An org with no other members and no business data is the exception, and deliberately so: a
 * Google sign-up mints an `exporter_owner` and an empty org as a side effect of authenticating.
 * Refusing to convert that account would mean no ordinary user could ever accept an agent
 * invitation, which is the entire point of this flow. An empty org has nothing to orphan — the
 * invariant is vacuous, not violated. The org row is left in place rather than deleted; this
 * flow never destroys business data.
 */
async function exporterConversionBlocker(
  db: Prisma.TransactionClient | typeof prisma,
  user: { id: string; role: UserRole; exporter_org_id: string | null },
): Promise<string | null> {
  if (!user.exporter_org_id) return null;
  if (user.role !== UserRole.exporter_owner) return null;

  const otherActiveOwners = await db.user.count({
    where: {
      exporter_org_id: user.exporter_org_id,
      role: UserRole.exporter_owner,
      is_active: true,
      id: { not: user.id },
    },
  });
  if (otherActiveOwners > 0) return null;

  const otherActiveMembers = await db.user.count({
    where: { exporter_org_id: user.exporter_org_id, is_active: true, id: { not: user.id } },
  });
  if (otherActiveMembers > 0) {
    return 'This account is currently the only owner of an exporter workspace that still has other members. Transfer ownership or invite a different email before converting this account to an Agent.';
  }

  // Business substance, checked across the models an exporter workspace actually owns. Any one
  // of these means the org is a real tenant whose data would be left unadministered.
  const [deals, leads, products, documents] = await Promise.all([
    db.deal.count({ where: { exporter_org_id: user.exporter_org_id } }),
    db.buyerLead.count({ where: { exporter_org_id: user.exporter_org_id } }),
    db.product.count({ where: { exporter_org_id: user.exporter_org_id } }),
    db.document.count({ where: { deal: { exporter_org_id: user.exporter_org_id } } }),
  ]);
  if (deals + leads + products + documents > 0) {
    return 'This account is currently the only owner of an exporter workspace. Transfer ownership or invite a different email before converting this account to an Agent.';
  }

  return null;
}

/**
 * Resolve what the invitation page should show, without mutating anything.
 *
 * Read-only by design: opening a link must never change a role, so this performs no writes at
 * all — not even the expiry sweep, which belongs to the mutation paths that can roll it back
 * coherently.
 */
export async function inspectStaffInvitation(
  token: string | null | undefined,
  principal: Principal | null,
  now: Date = new Date(),
): Promise<StaffInvitationView> {
  if (!token) return { state: 'unknown' };

  const invitation = await prisma.staffInvitation.findUnique({
    where: { token: hashToken(token) },
    select: { email: true, role: true, status: true, expires_at: true },
  });
  // An unrecognised token reveals nothing — not even that it was unrecognised rather than
  // consumed. Everything below has proven possession of a real 32-byte token.
  if (!invitation) return { state: 'unknown' };

  if (invitation.status === StaffInvitationStatus.accepted
      || invitation.status === StaffInvitationStatus.revoked) {
    return { state: 'consumed' };
  }
  if (invitation.status === StaffInvitationStatus.expired
      || invitation.expires_at.getTime() <= now.getTime()) {
    return { state: 'expired' };
  }

  const invitationEmail = normalizeEmail(invitation.email);

  if (!principal) {
    const existing = await prisma.user.findUnique({
      where: { email: invitationEmail },
      select: { id: true },
    });
    return existing
      ? { state: 'ready_needs_signin', invitation_email: invitationEmail }
      : { state: 'ready_new_account', invitation_email: invitationEmail };
  }

  const currentEmail = normalizeEmail(principal.email);
  if (currentEmail !== invitationEmail) {
    return { state: 'mismatch', invitation_email: invitationEmail, current_email: currentEmail };
  }

  if (principal.role === UserRole.agent) {
    return { state: 'already_agent', invitation_email: invitationEmail };
  }
  if (OPS_ROLES.includes(principal.role)) {
    return { state: 'already_staff', invitation_email: invitationEmail, current_email: currentEmail };
  }

  const blocker = await exporterConversionBlocker(prisma, {
    id: principal.id, role: principal.role, exporter_org_id: principal.exporter_org_id,
  });
  return blocker
    ? { state: 'blocked_convert', invitation_email: invitationEmail, current_email: currentEmail, reason: blocker }
    : { state: 'ready_convert', invitation_email: invitationEmail, current_email: currentEmail };
}

export interface ConvertToAgentResult {
  userId: string;
  role: UserRole;
  /** The org the account was detached from, for the audit trail. */
  detachedFromOrgId: string | null;
  /** True when the account was already an agent and nothing needed to change. */
  alreadyAgent: boolean;
}

/**
 * Convert the SIGNED-IN account into the agent the invitation names.
 *
 * Every input that decides the outcome comes from the server: the actor is the session
 * principal, and the email and role come off the invitation row. The browser supplies exactly
 * one thing — the token — and cannot influence which account is converted, to what role, or on
 * whose behalf.
 *
 * The account is updated in place rather than recreated, which is what preserves
 * `password_hash` and every `AuthProviderAccount` link: Google and password sign-in keep
 * working because nothing touches them. It also keeps the user's id stable, so every row that
 * references them — leads they created, deals they owned, audit events they wrote — stays
 * attached instead of being orphaned.
 */
export async function convertUserToAgent(input: {
  actor: Principal;
  token: string;
  correlationId: string;
  now?: Date;
}): Promise<ConvertToAgentResult> {
  const now = input.now ?? new Date();
  const tokenHash = hashToken(input.token ?? '');

  // Same pre-transaction expiry sweep the new-account path uses, and for the same reason:
  // marking a row expired inside a transaction that then throws would roll the marking back.
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
    const unusable = () => validationError(
      [{ field: 'token', code: 'invalid', message: 'This invitation is not valid. Ask Ops to send a new one.' }],
      'This invitation is not valid.',
    );

    const invitation = await tx.staffInvitation.findUnique({ where: { token: tokenHash } });
    if (!invitation) throw unusable();
    if (invitation.status !== StaffInvitationStatus.pending) throw unusable();
    if (invitation.expires_at.getTime() <= now.getTime()) throw unusable();

    // Conversion grants exactly the role the invitation carries, and only `agent` is a role an
    // existing account may be converted into. Ops/admin remain provisioning decisions.
    if (invitation.role !== UserRole.agent) {
      throw validationError(
        [{ field: 'role', code: 'invalid', message: 'This invitation cannot be accepted by converting an existing account.' }],
        'This invitation cannot be accepted by converting an existing account.',
      );
    }

    // The account is re-read inside the transaction rather than trusted from the session
    // snapshot: role and tenant could have changed between page render and confirmation.
    const user = await tx.user.findUnique({
      where: { id: input.actor.id },
      select: { id: true, email: true, role: true, exporter_org_id: true, is_active: true },
    });
    if (!user || !user.is_active) throw forbidden('This account cannot accept an invitation.');

    if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
      throw forbidden('This invitation was sent to a different email address.');
    }

    if (OPS_ROLES.includes(user.role)) {
      throw forbidden('An Ops or administrator account cannot be converted by an invitation.');
    }

    // Already an agent: consume the invitation and report it, rather than erroring. Re-running
    // the same link must not look like a failure, and must not detach anything.
    if (user.role === UserRole.agent) {
      const consumed = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, status: StaffInvitationStatus.pending },
        data: { status: StaffInvitationStatus.accepted, accepted_at: now, accepted_user_id: user.id },
      });
      if (consumed.count === 0) throw unusable();
      return { userId: user.id, role: user.role, detachedFromOrgId: null, alreadyAgent: true };
    }

    const blocker = await exporterConversionBlocker(tx, user);
    if (blocker) {
      throw validationError([{ field: 'account', code: 'sole_owner', message: blocker }], blocker);
    }

    // Compare-and-swap on the invitation BEFORE touching the user. Two confirmations racing
    // each other both read `pending`, but only one `updateMany` matches — the loser sees
    // count 0 and the whole transaction rolls back, so the invitation is consumed exactly once
    // and no role is changed twice.
    const consumed = await tx.staffInvitation.updateMany({
      where: { id: invitation.id, status: StaffInvitationStatus.pending },
      data: { status: StaffInvitationStatus.accepted, accepted_at: now, accepted_user_id: user.id },
    });
    if (consumed.count === 0) throw unusable();

    const detachedFromOrgId = user.exporter_org_id;
    const updated = await tx.user.update({
      where: { id: user.id },
      // Role and tenant move together. `getPrincipal` reads tier as `exporter_org?.tier ??
      // paid`, so an agent that kept a tenant would be governed by that tenant's tier instead
      // of the role matrix — the same defect the staging admin bootstrap hit.
      data: { role: UserRole.agent, exporter_org_id: null },
      select: { id: true, role: true },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.update,
      object_type: 'user',
      object_id: user.id,
      // The org they left, so the change is findable from the tenant's own audit trail.
      exporter_org_id: detachedFromOrgId,
      before_summary: { role: user.role, exporter_org_id: detachedFromOrgId },
      after_summary: {
        role: updated.role,
        exporter_org_id: null,
        via_staff_invitation: invitation.id,
        invited_by: invitation.invited_by_id,
        converted_existing_account: true,
      },
      correlation_id: input.correlationId,
    });

    return { userId: updated.id, role: updated.role, detachedFromOrgId, alreadyAgent: false };
  });
}

// ---------------------------------------------------------------------------
// Admin: "Add agent" — decide which of the two provisioning paths an email needs
// ---------------------------------------------------------------------------

export type StaffCandidateLookup =
  | { case: 'existing_user'; userId: string; role: UserRole; isActive: boolean; alreadyAgent: boolean; blockedReason: string | null }
  | { case: 'pending_grant' }
  | { case: 'no_account' };

/**
 * Read-only classification the "Add agent" UI uses to decide which confirmation to show:
 * convert an existing account (Case A), or pre-authorize an email with no account yet (Case B).
 * Never mutates anything, so it is safe to call on every keystroke-settled input.
 */
export async function lookupStaffCandidate(principal: Principal, email: string): Promise<StaffCandidateLookup> {
  assertCanProvisionStaff(principal);
  const normalized = normalizeEmail(email ?? '');
  if (!normalized) return { case: 'no_account' };

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, role: true, exporter_org_id: true, is_active: true },
  });
  if (user) {
    const blockedReason = OPS_ROLES.includes(user.role)
      ? 'An Ops or administrator account cannot be converted to Agent.'
      : user.role === UserRole.agent
        ? null
        : await exporterConversionBlocker(prisma, user);
    return {
      case: 'existing_user', userId: user.id, role: user.role, isActive: user.is_active,
      alreadyAgent: user.role === UserRole.agent, blockedReason,
    };
  }

  const pending = await prisma.staffAccessGrant.findFirst({
    where: { email: normalized, status: StaffAccessGrantStatus.pending },
    select: { id: true },
  });
  return pending ? { case: 'pending_grant' } : { case: 'no_account' };
}

// ---------------------------------------------------------------------------
// Admin: converting an existing user directly (no invitation, no token)
// ---------------------------------------------------------------------------

/**
 * Admin picks an email and converts that account to an agent immediately.
 *
 * The counterpart to `convertUserToAgent`: that function converts the account the SIGNED-IN
 * user is holding, confirmed by the invitee themselves; this one is Admin acting on someone
 * else's account by email, confirmed by Admin. Both funnel through the identical
 * `exporterConversionBlocker` guard — the sole-owner invariant does not get weaker just
 * because an administrator is the one asking.
 */
export async function adminConvertUserToAgent(input: {
  actor: Principal;
  targetEmail: string;
  correlationId: string;
}): Promise<ConvertToAgentResult> {
  assertCanProvisionStaff(input.actor);
  const email = normalizeEmail(input.targetEmail ?? '');
  if (!email) throw validationError([{ field: 'email', code: 'required', message: 'Enter an email address.' }]);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { email }, select: { id: true, email: true, role: true, exporter_org_id: true, is_active: true },
    });
    if (!user) {
      throw notFound('No ClearTrade account exists for that email. Use "Provision agent" to pre-authorize it instead.');
    }
    if (!user.is_active) throw forbidden('This account is deactivated and cannot be converted.');
    if (OPS_ROLES.includes(user.role)) {
      throw forbidden('An Ops or administrator account cannot be converted to Agent.');
    }
    if (user.role === UserRole.agent) {
      return { userId: user.id, role: user.role, detachedFromOrgId: null, alreadyAgent: true };
    }

    const blocker = await exporterConversionBlocker(tx, user);
    if (blocker) throw validationError([{ field: 'account', code: 'sole_owner', message: blocker }], blocker);

    const detachedFromOrgId = user.exporter_org_id;
    const updated = await tx.user.update({
      where: { id: user.id },
      data: { role: UserRole.agent, exporter_org_id: null },
      select: { id: true, role: true },
    });

    await writeAuditEvent({
      db: tx,
      actor: input.actor,
      action: AUDIT_ACTIONS.update,
      object_type: 'user',
      object_id: user.id,
      exporter_org_id: detachedFromOrgId,
      before_summary: { role: user.role, exporter_org_id: detachedFromOrgId },
      after_summary: {
        role: updated.role, exporter_org_id: null,
        converted_existing_account: true, converted_by_admin: input.actor.id,
      },
      correlation_id: input.correlationId,
    });

    return { userId: updated.id, role: updated.role, detachedFromOrgId, alreadyAgent: false };
  });
}

// ---------------------------------------------------------------------------
// Admin: pre-authorizing an email with no token and no link
// ---------------------------------------------------------------------------

export interface StaffAccessGrantRow {
  id: string; email: string; role: UserRole; status: StaffAccessGrantStatus;
  granted_at: Date; granted_by: { id: string; name: string } | null;
}

/**
 * Pre-authorize an email for the agent role, with no token and nothing to send.
 *
 * The grant is claimed automatically — see `claimStaffAccessGrant` — the moment the holder of
 * that exact, verified email signs in. Refuses an email that already has a ClearTrade account:
 * that case is `adminConvertUserToAgent`, a different action with a different (immediate)
 * effect, and offering both for the same email would make "what does this do" ambiguous.
 */
export async function grantStaffAccess(input: {
  actor: Principal; email: string; correlationId: string;
}): Promise<StaffAccessGrant> {
  assertCanProvisionStaff(input.actor);
  const email = normalizeEmail(input.email ?? '');
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw validationError([{ field: 'email', code: 'invalid', message: 'Enter a valid email address.' }]);
  }

  const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existingUser) {
    throw validationError(
      [{ field: 'email', code: 'has_account', message: 'This email already has a ClearTrade account. Convert it directly instead of pre-authorizing it.' }],
      'This email already has an account — convert it directly instead.',
    );
  }

  return prisma.$transaction(async (tx) => {
    const live = await tx.staffAccessGrant.findFirst({ where: { email, status: StaffAccessGrantStatus.pending } });
    if (live) {
      await tx.staffAccessGrant.update({
        where: { id: live.id },
        data: { status: StaffAccessGrantStatus.revoked, revoked_at: new Date(), revoked_by_id: input.actor.id },
      });
    }

    const grant = await tx.staffAccessGrant.create({
      data: { email, role: UserRole.agent, granted_by_id: input.actor.id },
    });

    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.create,
      object_type: 'staff_access_grant', object_id: grant.id,
      after_summary: { email, role: grant.role, replaced_pending: Boolean(live) },
      correlation_id: input.correlationId,
    });

    return grant;
  });
}

export async function revokeStaffAccessGrant(input: {
  actor: Principal; grantId: string; correlationId: string;
}): Promise<StaffAccessGrant> {
  assertCanProvisionStaff(input.actor);
  return prisma.$transaction(async (tx) => {
    const grant = await tx.staffAccessGrant.findUnique({ where: { id: input.grantId } });
    if (!grant) throw notFound('That provisioning grant does not exist.');
    if (grant.status !== StaffAccessGrantStatus.pending) {
      throw validationError([{ field: 'status', code: 'not_pending', message: 'Only a pending grant can be revoked.' }]);
    }
    const revoked = await tx.staffAccessGrant.update({
      where: { id: grant.id },
      data: { status: StaffAccessGrantStatus.revoked, revoked_at: new Date(), revoked_by_id: input.actor.id },
    });
    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.cancel,
      object_type: 'staff_access_grant', object_id: grant.id,
      after_summary: { email: grant.email, status: 'revoked' },
      correlation_id: input.correlationId,
    });
    return revoked;
  });
}

export async function pendingStaffAccessGrants(principal: Principal): Promise<StaffAccessGrantRow[]> {
  assertCanProvisionStaff(principal);
  return prisma.staffAccessGrant.findMany({
    where: { status: StaffAccessGrantStatus.pending },
    orderBy: { created_at: 'desc' },
    select: {
      id: true, email: true, role: true, status: true, granted_at: true,
      granted_by: { select: { id: true, name: true } },
    },
  });
}

/**
 * Claim a pending grant at sign-in time, or report that there is none.
 *
 * Called from EXACTLY one place — `resolveSocialIdentity`'s new-user branch, itself reached
 * only after that function's own provider-verification gate has already passed. This function
 * does not re-verify anything about the email; it trusts the caller to have already established
 * that the signer demonstrably owns it, which is the entire reason a grant can be claimed with
 * no token and no link.
 *
 * Atomic by compare-and-swap, but the swap point is the `User.email` unique constraint rather
 * than the grant's own status: the grant's `claimed` shape requires `claimed_user_id` to be set
 * in the same row-write as the status flip (see the `StaffAccessGrant_claimed_shape` CHECK), so
 * the status cannot be flipped before a user exists to point at. Two callers racing the same
 * email both pass the initial `pending`/no-existing-user reads, but only one `user.create`
 * commits — the loser hits the email unique constraint and the whole transaction rolls back,
 * so exactly one account is ever created per grant.
 *
 * Returns `null` — never throws — when no pending grant exists (or the race was lost), so the
 * caller can fall straight through to ordinary exporter account creation without treating
 * "nothing to claim" as an error.
 *
 * Creates the `AuthProviderAccount` link in the same transaction as the user, exactly like the
 * ordinary exporter-signup path in `resolveSocialIdentity` does. Skipping that would strand the
 * new agent: the next sign-in's provider-id lookup would miss, fall back to email, find the
 * user that now exists, and refuse with `email_conflict` — permanently locking them out after
 * the one successful login that claimed the grant.
 */
/** Internal signal only: the grant was revoked between our read and the claim write. Never escapes this module. */
class GrantNoLongerPendingError extends Error {}

export async function claimStaffAccessGrant(input: {
  email: string; name: string | null; provider: 'google' | 'apple'; providerAccountId: string;
  correlationId: string; now?: Date;
}): Promise<{ userId: string; role: UserRole } | null> {
  const email = normalizeEmail(input.email ?? '');
  if (!email) return null;

  try {
    return await prisma.$transaction(async (tx) => {
      const grant = await tx.staffAccessGrant.findFirst({ where: { email, status: StaffAccessGrantStatus.pending } });
      if (!grant) return null;

      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) return null; // Raced by a normal signup; nothing safe to claim onto.

      const displayName = input.name?.trim() || email.split('@')[0]!;
      const user = await tx.user.create({
        data: { email, name: displayName, role: grant.role, password_hash: null, exporter_org_id: null },
        select: { id: true, role: true },
      });
      await tx.authProviderAccount.create({
        data: {
          user_id: user.id,
          provider: input.provider,
          provider_account_id: input.providerAccountId,
          provider_email: email,
        },
      });

      // Status and claimed_user_id flip together — the shape the CHECK constraint requires.
      // A concurrent revoke between our read above and here is the only way this misses, and
      // rolling back the whole transaction (including the user just created) is correct: there
      // is no live grant left to attach them to.
      const consumed = await tx.staffAccessGrant.updateMany({
        where: { id: grant.id, status: StaffAccessGrantStatus.pending },
        data: { status: StaffAccessGrantStatus.claimed, claimed_at: input.now ?? new Date(), claimed_user_id: user.id },
      });
      if (consumed.count === 0) throw new GrantNoLongerPendingError();

      await writeAuditEvent({
        db: tx,
        actor: { id: user.id, email, name: displayName, role: user.role, exporter_org_id: null, tier: 'paid' } as Principal,
        action: AUDIT_ACTIONS.create,
        object_type: 'user',
        object_id: user.id,
        after_summary: {
          provisioned_role: user.role, via_staff_access_grant: grant.id, granted_by: grant.granted_by_id,
          auth_provider: input.provider, via_oauth: true,
        },
        correlation_id: input.correlationId,
      });

      return { userId: user.id, role: user.role };
    });
  } catch (error) {
    if (error instanceof GrantNoLongerPendingError) return null;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Admin: agent lifecycle — deactivate, reactivate
// ---------------------------------------------------------------------------

/**
 * Deactivate an agent, ending their portal access immediately.
 *
 * Refuses while any active assignment remains, rather than silently sweeping them away: an
 * exporter losing their agent without anyone deciding what happens next is exactly the
 * "invisible ownership gap" `/ops/assignments` exists to prevent. The admin resolves each
 * assignment first — reassign or unassign — through the ordinary assignment controls, which
 * keeps "who decided this exporter's new agent" answerable per exporter instead of buried in
 * a bulk side effect of deactivation.
 */
export async function deactivateAgent(input: {
  actor: Principal; agentUserId: string; reason?: string | null; correlationId: string;
}): Promise<{ id: string; is_active: boolean }> {
  assertCanProvisionStaff(input.actor);
  return prisma.$transaction(async (tx) => {
    const agent = await tx.user.findUnique({
      where: { id: input.agentUserId }, select: { id: true, role: true, is_active: true },
    });
    if (!agent || agent.role !== UserRole.agent) throw notFound('That agent does not exist.');
    if (!agent.is_active) return { id: agent.id, is_active: false };

    const activeCount = await tx.agentAssignment.count({
      where: { agent_user_id: agent.id, status: AssignmentStatus.active },
    });
    if (activeCount > 0) {
      throw validationError(
        [{ field: 'agent_user_id', code: 'has_active_assignments', message: `This agent has ${activeCount} active exporter assignment(s). Reassign or unassign them first.` }],
        'Resolve this agent’s active assignments before deactivating them.',
      );
    }

    const updated = await tx.user.update({ where: { id: agent.id }, data: { is_active: false } });
    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.update,
      object_type: 'user', object_id: agent.id,
      before_summary: { is_active: true },
      after_summary: { is_active: false, reason: input.reason ?? null },
      correlation_id: input.correlationId,
    });
    return { id: updated.id, is_active: updated.is_active };
  });
}

export async function reactivateAgent(input: {
  actor: Principal; agentUserId: string; correlationId: string;
}): Promise<{ id: string; is_active: boolean }> {
  assertCanProvisionStaff(input.actor);
  return prisma.$transaction(async (tx) => {
    const agent = await tx.user.findUnique({
      where: { id: input.agentUserId }, select: { id: true, role: true, is_active: true },
    });
    if (!agent || agent.role !== UserRole.agent) throw notFound('That agent does not exist.');
    if (agent.is_active) return { id: agent.id, is_active: true };

    const updated = await tx.user.update({ where: { id: agent.id }, data: { is_active: true } });
    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.update,
      object_type: 'user', object_id: agent.id,
      before_summary: { is_active: false },
      after_summary: { is_active: true },
      correlation_id: input.correlationId,
    });
    return { id: updated.id, is_active: updated.is_active };
  });
}

// ---------------------------------------------------------------------------
// Admin: atomic reassignment
// ---------------------------------------------------------------------------

/**
 * Move one exporter from its current agent to a different one, atomically.
 *
 * `assignExporterToAgent` and `unassignExporterFromAgent` already exist and are each correct in
 * isolation, but calling them back-to-back from a route is two transactions — an admin's second
 * request could fail (a crashed tab, a dropped connection) between them and leave the exporter
 * with no active agent at all, the exact gap `/ops/assignments` exists to prevent. This does
 * both writes in one transaction: the old assignment ends and the new one starts together, or
 * neither happens.
 */
export async function reassignExporterToAgent(input: {
  actor: Principal; assignmentId: string; newAgentUserId: string; reason?: string | null; correlationId: string;
}) {
  assertCanProvisionStaff(input.actor);

  return prisma.$transaction(async (tx) => {
    const current = await tx.agentAssignment.findUnique({ where: { id: input.assignmentId } });
    if (!current) throw notFound('That assignment does not exist.');
    if (current.status !== AssignmentStatus.active) {
      throw validationError([{ field: 'assignment_id', code: 'not_active', message: 'That assignment is already ended.' }]);
    }

    const newAgent = await tx.user.findUnique({
      where: { id: input.newAgentUserId }, select: { id: true, role: true, is_active: true },
    });
    if (!newAgent) throw notFound('That agent does not exist.');
    if (newAgent.role !== UserRole.agent) {
      throw validationError([{ field: 'new_agent_user_id', code: 'not_an_agent', message: 'Only an agent can be assigned an exporter.' }]);
    }
    if (!newAgent.is_active) {
      throw validationError([{ field: 'new_agent_user_id', code: 'inactive', message: 'That agent is deactivated.' }]);
    }
    if (newAgent.id === current.agent_user_id) {
      throw validationError([{ field: 'new_agent_user_id', code: 'same_agent', message: 'That exporter is already assigned to this agent.' }]);
    }

    const ended = await tx.agentAssignment.update({
      where: { id: current.id },
      data: { status: AssignmentStatus.ended, ended_at: new Date(), reason: input.reason ?? current.reason },
    });

    const existingForNew = await tx.agentAssignment.findFirst({
      where: { agent_user_id: newAgent.id, exporter_org_id: current.exporter_org_id, status: AssignmentStatus.active },
    });
    const started = existingForNew ?? await tx.agentAssignment.create({
      data: {
        agent_user_id: newAgent.id, exporter_org_id: current.exporter_org_id,
        assigned_by_id: input.actor.id, status: AssignmentStatus.active, reason: input.reason ?? null,
      },
    });

    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.reassign,
      object_type: 'agent_assignment', object_id: started.id,
      exporter_org_id: current.exporter_org_id,
      before_summary: { agent_user_id: current.agent_user_id, assignment_id: current.id },
      after_summary: { agent_user_id: newAgent.id, assignment_id: started.id, reason: input.reason ?? null },
      correlation_id: input.correlationId,
    });

    return { ended, started };
  });
}
