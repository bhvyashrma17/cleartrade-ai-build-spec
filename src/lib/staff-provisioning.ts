/**
 * Staff provisioning — inviting internal agents, and managing their exporter assignments.
 *
 * Three rules this module exists to hold:
 *
 *   1. **An agent is never self-declared.** Public registration and social sign-in produce
 *      exporter users only (asserted by tests in social-auth). Every path to `role = agent`
 *      is authorized server-side — a bearer invitation link, an Admin's direct action, or a
 *      pre-authorized email — never a role the client's payload gets to choose.
 *
 *   2. **Staff have no tenant.** Becoming staff must not fabricate exporter membership; access
 *      comes later and only from `AgentAssignment`. A staff user with an `exporter_org_id`
 *      would be inside a tenant while also holding cross-tenant powers.
 *
 *   3. **Two provisioning mechanisms, never blurred.** A generated `StaffInvitation` is a
 *      bearer credential — possession of the link is the entire authority, and it carries no
 *      email to match a claimant against. `StaffAccessGrant` (below) is the opposite: a
 *      specific, pre-authorized email claimed only by a verified sign-in for that exact
 *      address, with no token or link at all. Mixing the two security models into one
 *      "invitation" concept is exactly what produced the bug this file's stale-provisioning
 *      reconciliation exists to prevent — see `reconcileStaleProvisioning`.
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
import { getConfig } from '@/lib/config';
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

/**
 * Generate a single-use, email-less Agent invitation link.
 *
 * No email in, no email on the row: `StaffInvitation.email` is left null for every invitation
 * created here (see the model doc for why — this is the deliberate bearer-credential design,
 * not an oversight). Possession of the returned token is the entire authorization; whoever
 * holds the link and confirms while authenticated is the accepted recipient, so the security
 * warning is real and belongs in the UI, not just this comment: share the link only with the
 * intended person.
 *
 * Unlike the old email-bound design, generating another link never revokes an earlier one —
 * there is no shared email to make them collide, and an Admin may deliberately want several
 * live invitations out at once for several different people. Each call is independent.
 */
export async function generateAgentInvitation(
  input: { actor: Principal; correlationId: string },
): Promise<IssuedStaffInvitation> {
  assertCanProvisionStaff(input.actor);

  const token = randomBytes(32).toString('base64url');

  return prisma.$transaction(async (tx) => {
    const invitation = await tx.staffInvitation.create({
      data: {
        email: null,
        role: UserRole.agent,
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
      // No email to record. The token is a credential; putting it in an audit payload would
      // make the audit log itself a way to take over the invitation.
      after_summary: { role: UserRole.agent, expires_at: invitation.expires_at.toISOString(), bearer: true },
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
    // `ExporterOrg.assigned_agent_id` is a read-convenience cache of "which agent currently has
    // an active assignment" — kept in sync here rather than left to drift, since the Unassigned
    // queue and the Ops dashboard both query it directly instead of joining `AgentAssignment`.
    // `AgentAssignment` (status=active) remains the actual source of truth everywhere access is
    // decided (`assignedOrgIds`, `canAccessOrg`) — this column is never read for authorization.
    await tx.exporterOrg.update({ where: { id: org.id }, data: { assigned_agent_id: agent.id } });

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
    // Clear the cache column only if it still points at the agent losing access — an org with a
    // newer active assignment (from a concurrent assign) must not have its live agent erased by
    // an unassign call that targeted the older, already-superseded row.
    await tx.exporterOrg.updateMany({
      where: { id: assignment.exporter_org_id, assigned_agent_id: assignment.agent_user_id },
      data: { assigned_agent_id: null },
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
  const [agents, capacityPolicy] = await Promise.all([db.user.findMany({
    where: { role: UserRole.agent },
    orderBy: { name: 'asc' },
    select: {
      id: true, name: true, email: true, is_active: true, created_at: true,
      agent_assignments: {
        where: { status: AssignmentStatus.active },
        select: { id: true, exporter_org_id: true, started_at: true, exporter_org: { select: { display_name: true } } },
      },
    },
  }), getConfig('agent.capacity')]);
  const capacityTarget = capacityPolicy.target_exporters_per_agent;
  return agents.map((agent) => ({
    ...agent,
    assignedCount: agent.agent_assignments.length,
    capacityTarget,
    // Guidance, not a gate: assignment mutations do not consult this value.
    overTarget: agent.agent_assignments.length > capacityTarget,
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
  const capacityPolicy = await getConfig('agent.capacity');
  return { ...agent, activeCount: active.length, capacityTarget: capacityPolicy.target_exporters_per_agent };
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
 * a state it has not handled. There is no `invitation_email` field anywhere in this union —
 * bearer invitations carry no invited address to reveal, and legacy rows that happen to have
 * one are deliberately treated the same way (see the `StaffInvitation` model doc): a claimant
 * is decided by who confirms while authenticated, not by an email comparison.
 */
export type StaffInvitationView =
  /** No token, or no such invitation. Deliberately says nothing more. */
  | { state: 'unknown' }
  /** The token exists and the holder has it, so naming the reason is not a disclosure. */
  | { state: 'expired' }
  | { state: 'consumed' }
  /** Live invitation, nobody signed in. Sign in or create an account, then return here. */
  | { state: 'unauthenticated' }
  /** Signed in, eligible, conversion is permitted. */
  | { state: 'ready_convert'; current_email: string }
  /** Signed in, eligible, but converting would break a domain invariant. */
  | { state: 'blocked_convert'; current_email: string; reason: string }
  /** Already an agent. Nothing to do; not an error. */
  | { state: 'already_agent' }
  /** Ops/admin. Fail closed — a staff role is never silently rewritten by a link. */
  | { state: 'already_staff'; current_email: string };

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
 * Whenever a user becomes `role = agent` through ANY provisioning path, clean up now-stale
 * pending records for the same normalized email — revoking rather than deleting, so an active
 * agent never simultaneously shows as an actionable pending grant or invitation anywhere in Ops.
 *
 * This is the fix for the staging bug that motivated it: an account converted to Agent while a
 * pending `StaffAccessGrant` or a legacy email-bound `StaffInvitation` for the same address was
 * still sitting there unrevoked, reading as a live request nobody had actually made anymore.
 * Called unconditionally on every path that confirms an email now belongs to an agent —
 * including the already-agent idempotent branches — so an account that became an agent BEFORE
 * this reconciliation existed still gets cleaned up the next time any provisioning path touches
 * it, rather than only on the moment of a fresh role change.
 *
 * Runs inside the same transaction as the role check/change it is called from, so it can never
 * observably commit only one side.
 *
 * A bearer `StaffInvitation` (email IS NULL) can never match here — this only ever queries by a
 * specific normalized email, so an unrelated bearer link is structurally untouched, never merely
 * "not selected".
 *
 * Exported (not just used internally) so `scripts/reconcile-stale-provisioning.ts` — the
 * one-time staging cleanup for accounts that became agents before this reconciliation existed —
 * calls this exact function rather than a second, hand-rolled copy of the same logic.
 */
export async function reconcileStaleProvisioning(
  tx: Prisma.TransactionClient,
  input: { email: string; actor: Principal; correlationId: string },
): Promise<void> {
  const email = normalizeEmail(input.email ?? '');
  if (!email) return;

  const staleGrants = await tx.staffAccessGrant.findMany({
    where: { email, status: StaffAccessGrantStatus.pending },
  });
  for (const grant of staleGrants) {
    await tx.staffAccessGrant.update({
      where: { id: grant.id },
      data: { status: StaffAccessGrantStatus.revoked, revoked_at: new Date(), revoked_by_id: input.actor.id },
    });
    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.cancel,
      object_type: 'staff_access_grant', object_id: grant.id,
      after_summary: { email, status: 'revoked', auto_reconciled: true, reason: 'account already holds the agent role' },
      correlation_id: input.correlationId,
    });
  }

  const staleInvitations = await tx.staffInvitation.findMany({
    where: { email, status: StaffInvitationStatus.pending },
  });
  for (const invitation of staleInvitations) {
    await tx.staffInvitation.update({
      where: { id: invitation.id },
      data: { status: StaffInvitationStatus.revoked, revoked_at: new Date(), revoked_by_id: input.actor.id },
    });
    await writeAuditEvent({
      db: tx, actor: input.actor, action: AUDIT_ACTIONS.cancel,
      object_type: 'staff_invitation', object_id: invitation.id,
      after_summary: { status: 'revoked', auto_reconciled: true, reason: 'account already holds the agent role' },
      correlation_id: input.correlationId,
    });
  }
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
    select: { role: true, status: true, expires_at: true },
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

  // Bearer semantics: there is no invited address to compare against. Whoever is authenticated
  // (or becomes authenticated and returns) when they confirm is the accepted recipient.
  if (!principal) return { state: 'unauthenticated' };

  const currentEmail = normalizeEmail(principal.email);

  if (principal.role === UserRole.agent) return { state: 'already_agent' };
  if (OPS_ROLES.includes(principal.role)) return { state: 'already_staff', current_email: currentEmail };

  const blocker = await exporterConversionBlocker(prisma, {
    id: principal.id, role: principal.role, exporter_org_id: principal.exporter_org_id,
  });
  return blocker
    ? { state: 'blocked_convert', current_email: currentEmail, reason: blocker }
    : { state: 'ready_convert', current_email: currentEmail };
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
 * Convert the SIGNED-IN account into the agent this bearer invitation grants.
 *
 * Every input that decides the outcome comes from the server: the actor is the session
 * principal, the role comes off the invitation row (always `agent`, enforced by a database
 * CHECK), and which account converts is exactly whoever is authenticated when they confirm.
 * The browser supplies exactly one thing — the token — and cannot influence which account is
 * converted, to what role, or on whose behalf.
 *
 * There is deliberately no email-match check. A bearer invitation carries no invited address at
 * all; possession of the token plus an explicit, authenticated confirmation IS the
 * authorization. (A handful of legacy rows created under the old, email-bound design still have
 * a non-null `email` — it is never read here, on old rows or new ones, so the two designs do
 * not end up on two different acceptance code paths.)
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

    if (OPS_ROLES.includes(user.role)) {
      throw forbidden('An Ops or administrator account cannot be converted by an invitation.');
    }

    // Already an agent: consume the invitation and report it, rather than erroring. Re-running
    // the same link must not look like a failure, and must not detach anything. Reconciliation
    // still runs — this is exactly the idempotent path the staging bug fell through: an account
    // already an agent, with a stale pending record nobody had cleaned up.
    if (user.role === UserRole.agent) {
      const consumed = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, status: StaffInvitationStatus.pending },
        data: { status: StaffInvitationStatus.accepted, accepted_at: now, accepted_user_id: user.id },
      });
      if (consumed.count === 0) throw unusable();
      await reconcileStaleProvisioning(tx, { email: user.email, actor: input.actor, correlationId: input.correlationId });
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
    await reconcileStaleProvisioning(tx, { email: user.email, actor: input.actor, correlationId: input.correlationId });

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
      // Idempotent, and still reconciled — this is exactly the shape of the staging bug: an
      // account already an agent, with a stale pending grant/invitation nobody had cleaned up.
      await reconcileStaleProvisioning(tx, { email: user.email, actor: input.actor, correlationId: input.correlationId });
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
    await reconcileStaleProvisioning(tx, { email: user.email, actor: input.actor, correlationId: input.correlationId });

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

      const claimant = { id: user.id, email, name: displayName, role: user.role, exporter_org_id: null, tier: 'paid' } as Principal;
      await writeAuditEvent({
        db: tx,
        actor: claimant,
        action: AUDIT_ACTIONS.create,
        object_type: 'user',
        object_id: user.id,
        after_summary: {
          provisioned_role: user.role, via_staff_access_grant: grant.id, granted_by: grant.granted_by_id,
          auth_provider: input.provider, via_oauth: true,
        },
        correlation_id: input.correlationId,
      });
      // Cleans up any stale LEGACY email-bound StaffInvitation for this same address. The grant
      // just claimed is already `claimed`, not `pending`, so it is never revoked by its own
      // reconciliation call.
      await reconcileStaleProvisioning(tx, { email, actor: claimant, correlationId: input.correlationId });

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
    // Same read-convenience cache column `assignExporterToAgent`/`unassignExporterFromAgent`
    // maintain — moved in the same transaction so it is never observably stale.
    await tx.exporterOrg.update({ where: { id: current.exporter_org_id }, data: { assigned_agent_id: newAgent.id } });

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
