/**
 * Server-side authorization — the single source of truth for the permission matrix in
 * docs/01-product-contract-and-roles.md §5.
 *
 * Two rules govern everything in this file:
 *
 *   1. "Authorization must be enforced server-side. Hiding a button is not access control."
 *      Nothing here may be imported into a client component to decide what to render
 *      *instead of* a server check. UI may call these to hide affordances, but the route
 *      handler / server action must call them again before touching Prisma.
 *
 *   2. "Exporter users are tenant-scoped by exporter_org_id. They may never query another
 *      exporter organization by changing route parameters." Every exporter query gets its
 *      where-clause from `tenantScope()` — not from a route param.
 *
 *   3. Authorization has TWO independent axes, and both must pass:
 *        role — may this kind of user do this at all?  (MATRIX, from docs/01 §5)
 *        tier — has this tenant paid for it?           (CAPABILITY_MIN_TIER, freemium)
 *      `permits()` is the single place they combine. Nothing below reads `grantFor()`
 *      directly except `permits()` itself and the few predicates that need the Grant
 *      *value* for a restricted-policy decision — and those call `tierAllows()` too.
 *
 *      Tier is NOT a UserRole. A guest is a real ExporterOrg + User with tier='guest',
 *      which is why everything in rule 2 keeps working untouched for guests: a guest org
 *      is scoped exactly like any other org. There is no unauthenticated code path.
 *
 * Search endpoints and file downloads are called out in docs/09 §5 and docs/10 §1 as the
 * two most commonly missed checks, so they get named predicates of their own below.
 */

import { OrgTier, UserRole } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { forbidden, notFound, upgradeRequired } from '@/lib/errors';
import type { Principal } from '@/types';

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const EXPORTER_ROLES: readonly UserRole[] = [
  UserRole.exporter_owner,
  UserRole.exporter_member,
];
export const OPS_ROLES: readonly UserRole[] = [
  UserRole.ops_supervisor,
  UserRole.ops_finance,
  UserRole.admin,
];

export const isExporter = (p: Principal) => EXPORTER_ROLES.includes(p.role);
export const isAgent = (p: Principal) => p.role === UserRole.agent;
export const isOps = (p: Principal) => OPS_ROLES.includes(p.role);
export const isAdmin = (p: Principal) => p.role === UserRole.admin;

// ---------------------------------------------------------------------------
// The matrix (docs/01 §5), expressed as capability -> role -> grant
// ---------------------------------------------------------------------------

/**
 * What a role is allowed to reach for a capability.
 *  - `own_org`     exporter's own tenant only
 *  - `assigned`    agent's assigned exporters/deals only
 *  - `all`         portfolio-wide (ops), still logged and audited
 *  - `restricted`  allowed but gated by an additional policy check at the call site
 *  - `config_only` may change the configuration, not the operational records
 *  - `none`        denied
 */
export type Grant = 'own_org' | 'assigned' | 'all' | 'restricted' | 'config_only' | 'none';

export type Capability =
  | 'exporter_profile.view'
  | 'exporter_master_data.edit'
  | 'demand_discovery.run'
  | 'buyer_discovery.run'
  | 'buyer_lead.create'
  | 'outreach.send'
  | 'internal_note.view'
  | 'internal_note.edit'
  | 'commercial_terms.approve'
  | 'document.generate'
  | 'document.approve'
  | 'document.download'
  | 'document.mark_filed'
  | 'agent.assign'
  | 'dispute.open'
  | 'dispute.resolve'
  | 'payout.view'
  | 'fee_policy.edit'
  | 'audit.search'
  | 'task.transition'
  // Added with the freemium tier. These had no matrix entry because docs/01 §5 predates
  // the tier split, but each is a distinct paywall boundary.
  | 'readiness.run'
  | 'buyer_contact.view'
  | 'deal.create'
  // Save/select on a MarketAssessment (docs/04 EXP-04). Same role gate for both —
  // "building your own pipeline" — so one capability covers them, same as leads.
  | 'market_assessment.save'
  // Cross-deal index views (docs/13 A1): /app/tasks, /app/deals, /app/messages. Reading
  // the list, not acting on a row — task.transition/deal-workspace actions stay their
  // own capabilities.
  | 'task.view'
  | 'deal.view'
  | 'message.view'
  // EXP-14/EXP-15. "Update" is a whitelist of exporter-safe fields at the route layer
  // (pickup confirmation, evidence, exporter-reported payment status) — it is
  // deliberately NOT the same capability that would let anyone edit CHA filing
  // reference fields (EXP-14-AC03), which this app has no capability for at all.
  | 'shipment.update'
  | 'payment.update'
  // EXP-16. Sending is a distinct capability from viewing — a role could conceivably
  // read a thread without being able to post to it (e.g. a future read-only auditor
  // role), so collapsing the two into `message.view` would foreclose that later.
  | 'message.send';

const MATRIX: Record<Capability, Record<UserRole, Grant>> = {
  // | Object / action | Exporter | Agent | Ops | Admin |
  'exporter_profile.view': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'all',
  },
  'exporter_master_data.edit': {
    exporter_owner: 'own_org',
    // "Permissions limited by org role" — members edit allowed fields only.
    exporter_member: 'restricted',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'all',
  },
  'demand_discovery.run': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'config_only',
  },
  'buyer_discovery.run': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'config_only',
  },
  'buyer_lead.create': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    // "No routine use" — admin is a config role, not an operator.
    admin: 'none',
  },
  'outreach.send': {
    // Exporters request outreach via their agent; they never send it directly.
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'internal_note.view': {
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'all',
  },
  'internal_note.edit': {
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'all',
  },
  'commercial_terms.approve': {
    // "Authorized exporter user". Whether a member may approve is open product
    // decision #2 (docs/11 §7) — gated by config, defaults to owner-only.
    exporter_owner: 'own_org',
    exporter_member: 'restricted',
    // Agent prepares, never approves on the exporter's behalf.
    agent: 'none',
    ops_supervisor: 'restricted',
    ops_finance: 'none',
    admin: 'none',
  },
  'document.generate': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'config_only',
  },
  'document.approve': {
    exporter_owner: 'own_org',
    exporter_member: 'restricted',
    // "Cannot impersonate exporter" — hard no, not a policy toggle.
    agent: 'none',
    ops_supervisor: 'restricted',
    ops_finance: 'none',
    admin: 'none',
  },
  'document.download': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'all',
  },
  'document.mark_filed': {
    // Exporter has view only.
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'agent.assign': {
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'none',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'all',
  },
  'dispute.open': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'none',
  },
  'dispute.resolve': {
    // Exporter accepts a resolution; the agent proposes one. Neither closes the case.
    exporter_owner: 'restricted',
    exporter_member: 'restricted',
    agent: 'restricted',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'none',
  },
  'payout.view': {
    exporter_owner: 'none',
    exporter_member: 'none',
    // Own payout only.
    agent: 'restricted',
    ops_supervisor: 'none',
    ops_finance: 'all',
    admin: 'all',
  },
  'fee_policy.edit': {
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'none',
    ops_supervisor: 'none',
    ops_finance: 'restricted',
    admin: 'all',
  },
  'audit.search': {
    exporter_owner: 'none',
    exporter_member: 'none',
    agent: 'none',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'all',
  },
  'task.transition': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'restricted',
    admin: 'none',
  },
  'readiness.run': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'config_only',
  },
  'buyer_contact.view': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'deal.create': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'market_assessment.save': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'task.view': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'all',
  },
  'deal.view': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'all',
    admin: 'all',
  },
  'message.view': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'all',
  },
  'message.send': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'shipment.update': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    ops_finance: 'none',
    admin: 'none',
  },
  'payment.update': {
    exporter_owner: 'own_org',
    exporter_member: 'own_org',
    agent: 'assigned',
    ops_supervisor: 'all',
    // Finance is who actually reconciles buyer payment against the fee basis.
    ops_finance: 'all',
    admin: 'none',
  },
};

// ---------------------------------------------------------------------------
// The second axis: tier (docs/01 §5 covers role only — tier is the freemium split)
// ---------------------------------------------------------------------------

const TIER_RANK: Record<OrgTier, number> = {
  [OrgTier.guest]: 0,
  [OrgTier.free]: 1,
  [OrgTier.paid]: 2,
};

/**
 * Minimum tier per capability. **Anything absent from this map requires `paid`.**
 *
 * Deny-by-default is deliberate and load-bearing. Modelling guests as a UserRole would
 * have given the same safety via the matrix, but at the cost of a `guest:` entry in all
 * 20 capability blocks — i.e. rewriting every existing permission check. This map buys
 * the same property in one place: a capability added later is paid-only until somebody
 * deliberately opens it, so the failure mode of forgetting is "too strict", never "free".
 */
const CAPABILITY_MIN_TIER: Partial<Record<Capability, OrgTier>> = {
  // Guest — the acquisition surface. Runs are additionally IP-capped at the route.
  'demand_discovery.run': OrgTier.guest,
  'buyer_discovery.run': OrgTier.guest,
  'exporter_profile.view': OrgTier.guest,

  // Free — unlocked by registering. Saved history, readiness, own pipeline, no agent.
  'readiness.run': OrgTier.free,
  'buyer_contact.view': OrgTier.free,
  'buyer_lead.create': OrgTier.free,
  'exporter_master_data.edit': OrgTier.free,
  'market_assessment.save': OrgTier.free,

  // Everything else falls through to paid: the agent-assisted workflow — deals,
  // documents, shipment, payment, outreach, disputes, payout, assignment, audit.
};

export function minTierFor(capability: Capability): OrgTier {
  return CAPABILITY_MIN_TIER[capability] ?? OrgTier.paid;
}

export function tierAllows(principal: Principal, capability: Capability): boolean {
  return TIER_RANK[principal.tier] >= TIER_RANK[minTierFor(capability)];
}

/**
 * The single choke point for "may this principal do this?".
 *
 * Role and tier are independent axes and BOTH must pass: role answers "may this kind of
 * user do this at all?", tier answers "has this tenant paid for it?". Every predicate
 * below routes through here rather than reading `grantFor()` directly, so no capability
 * can pick up a role check without also picking up its tier check.
 */
export function permits(principal: Principal, capability: Capability): boolean {
  if (grantFor(principal.role, capability) === 'none') return false;
  return tierAllows(principal, capability);
}

export function grantFor(role: UserRole, capability: Capability): Grant {
  return MATRIX[capability][role];
}

/** Capability check with no resource attached (e.g. "may this principal open the screen at all?"). */
export function can(principal: Principal, capability: Capability): boolean {
  return permits(principal, capability);
}

/**
 * Throws when the capability is denied — with the two denials kept distinct:
 *
 *   role denied  -> FORBIDDEN         ("your role will never allow this")
 *   tier denied  -> UPGRADE_REQUIRED  ("buy this and it works")
 *
 * Role is checked first so a tier upsell is never shown for something the user could
 * not do at any price.
 */
export function assertCan(principal: Principal, capability: Capability): Grant {
  const grant = grantFor(principal.role, capability);
  if (grant === 'none') {
    throw forbidden('Your role does not allow this action.');
  }
  if (!tierAllows(principal, capability)) {
    throw upgradeRequired(minTierFor(capability));
  }
  return grant;
}

// ---------------------------------------------------------------------------
// Tenant scoping — the helper every exporter query must go through
// ---------------------------------------------------------------------------

/** A Prisma `where` fragment keyed on exporter_org_id. */
export type TenantScope =
  | { exporter_org_id: string }
  | { exporter_org_id: { in: string[] } }
  | Record<string, never>;

/** Org ids an agent is currently assigned to (active assignments only). */
export async function assignedOrgIds(principal: Principal): Promise<string[]> {
  if (!isAgent(principal)) return [];
  const assignments = await prisma.agentAssignment.findMany({
    where: { agent_user_id: principal.id, status: 'active' },
    select: { exporter_org_id: true },
  });
  return assignments.map((a) => a.exporter_org_id);
}

/**
 * The tenant-scoping helper. Constrains any org-owned collection to what the principal
 * may see:
 *
 *   exporter -> exactly their own org
 *   agent    -> their assigned orgs (an empty assignment list yields a scope that
 *               matches nothing, never an unscoped read)
 *   ops      -> unconstrained, by role, not by omission
 *
 * Spread it into the `where` of EVERY list/search query over an org-owned model:
 *
 *   const scope = await tenantScope(principal);
 *   prisma.buyerLead.findMany({ where: { ...scope, stage: 'new' } });
 */
export async function tenantScope(principal: Principal): Promise<TenantScope> {
  if (isExporter(principal)) {
    if (!principal.exporter_org_id) {
      // Fail closed: an exporter with no tenant key must never produce an open query.
      throw forbidden('Your account is not linked to an exporter organization.');
    }
    return { exporter_org_id: principal.exporter_org_id };
  }

  if (isAgent(principal)) {
    const orgIds = await assignedOrgIds(principal);
    // `in: []` matches nothing — the correct answer for an agent with no assignments.
    return { exporter_org_id: { in: orgIds } };
  }

  if (isOps(principal)) return {};

  throw forbidden('Your role does not allow this action.');
}

/**
 * Same scoping decision for models that reach the tenant through a relation
 * (e.g. Document -> Deal -> exporter_org_id).
 */
export async function tenantScopeVia(
  principal: Principal,
  relation: string,
): Promise<Record<string, unknown>> {
  const scope = await tenantScope(principal);
  if (Object.keys(scope).length === 0) return {};
  return { [relation]: scope };
}

/** Whether the principal may reach a specific org at all. */
export async function canAccessOrg(principal: Principal, orgId: string): Promise<boolean> {
  if (isOps(principal)) return true;
  if (isExporter(principal)) return principal.exporter_org_id === orgId;
  if (isAgent(principal)) return (await assignedOrgIds(principal)).includes(orgId);
  return false;
}

/**
 * Assert org access for a record fetched by id.
 *
 * Throws NOT_FOUND rather than FORBIDDEN: docs/09 §4 — "do not leak an inaccessible
 * record". A 403 here would confirm that someone else's record exists.
 */
export async function assertOrgAccess(principal: Principal, orgId: string): Promise<void> {
  if (!(await canAccessOrg(principal, orgId))) throw notFound();
}

// ---------------------------------------------------------------------------
// Resource-level predicates
//
// Route handlers call these BEFORE querying Prisma for a mutation, and pass the
// tenantScope() fragment into the query itself for reads.
//
// CONVENTION — a mutation route makes TWO checks, in this order:
//
//   assertCan(principal, 'the.capability');          // role + tier
//   await assertPermitted(canDoThing(principal, …)); // tenant scope
//
// Both are required, and the order matters. These predicates return a plain boolean, so
// they cannot say WHY they denied — a caller that relies on the predicate alone turns a
// tier denial into a bare FORBIDDEN, and the client can never tell "upgrade and this
// works" apart from "your role will never allow this". `assertCan()` is the only thing
// that raises UPGRADE_REQUIRED, so skipping it silently disables every upsell.
// ---------------------------------------------------------------------------

interface OrgOwned {
  exporter_org_id: string;
}

interface DealLike extends OrgOwned {
  owner_agent_id?: string | null;
}

interface LeadLike extends OrgOwned {
  assigned_agent_id?: string | null;
}

export async function canReadDeal(principal: Principal, deal: DealLike): Promise<boolean> {
  return canAccessOrg(principal, deal.exporter_org_id);
}

export async function canReadBuyerLead(principal: Principal, lead: LeadLike): Promise<boolean> {
  return canAccessOrg(principal, lead.exporter_org_id);
}

/**
 * Buyer search. Buyers are a global entity, so the check is on the capability and on the
 * product/org context the search runs against — not on the Buyer rows themselves.
 * (docs/09 §5: search endpoints must enforce scope.)
 */
export async function canSearchBuyers(
  principal: Principal,
  context: { exporter_org_id: string },
): Promise<boolean> {
  if (!permits(principal, 'buyer_discovery.run')) return false;
  return canAccessOrg(principal, context.exporter_org_id);
}

export async function canCreateBuyerLead(
  principal: Principal,
  context: { exporter_org_id: string },
): Promise<boolean> {
  if (!permits(principal, 'buyer_lead.create')) return false;
  return canAccessOrg(principal, context.exporter_org_id);
}

/**
 * File download. Called out in docs/10 §1 as one of the two most commonly missed checks —
 * every signed-URL mint goes through here first.
 */
export async function canDownloadDocument(
  principal: Principal,
  document: { deal?: DealLike | null },
): Promise<boolean> {
  if (!permits(principal, 'document.download')) return false;
  if (!document.deal) return isOps(principal);
  return canAccessOrg(principal, document.deal.exporter_org_id);
}

/**
 * Document approval is an exporter act. An agent can never approve on the exporter's
 * behalf, and Ops only where an override policy explicitly allows it.
 */
export async function canApproveDocument(
  principal: Principal,
  document: { deal?: DealLike | null },
  policy: { member_can_approve: boolean; ops_override_allowed: boolean },
): Promise<boolean> {
  const grant = grantFor(principal.role, 'document.approve');
  if (grant === 'none' || !tierAllows(principal, 'document.approve')) return false;
  if (principal.role === UserRole.exporter_member && !policy.member_can_approve) return false;
  if (isOps(principal) && !policy.ops_override_allowed) return false;
  if (!document.deal) return false;
  return canAccessOrg(principal, document.deal.exporter_org_id);
}

export async function canApproveCommercialTerms(
  principal: Principal,
  deal: DealLike,
  policy: { member_can_approve: boolean; ops_override_allowed: boolean },
): Promise<boolean> {
  const grant = grantFor(principal.role, 'commercial_terms.approve');
  if (grant === 'none' || !tierAllows(principal, 'commercial_terms.approve')) return false;
  if (principal.role === UserRole.exporter_member && !policy.member_can_approve) return false;
  if (isOps(principal) && !policy.ops_override_allowed) return false;
  return canAccessOrg(principal, deal.exporter_org_id);
}

/**
 * EXP-16 "Accept resolution | Authorized exporter". `dispute.resolve` grants exporters
 * only `restricted` in the matrix precisely so this second check — mirroring
 * `canApproveCommercialTerms` exactly — decides who within the org counts as authorized,
 * the same "owner by default, member only if policy allows" shape as accepting
 * commercial terms. Ops never accepts on the exporter's behalf; `ops_override_allowed`
 * exists in the policy shape for symmetry with the document/commercial policies but
 * defaults closed, same reasoning as `DOCUMENT_APPROVAL_POLICY`.
 */
export async function canAcceptDisputeResolution(
  principal: Principal,
  deal: DealLike,
  policy: { member_can_accept: boolean; ops_override_allowed: boolean },
): Promise<boolean> {
  const grant = grantFor(principal.role, 'dispute.resolve');
  if (grant === 'none' || !tierAllows(principal, 'dispute.resolve')) return false;
  if (principal.role === UserRole.exporter_member && !policy.member_can_accept) return false;
  if (isOps(principal) && !policy.ops_override_allowed) return false;
  if (isAgent(principal)) return false;
  return canAccessOrg(principal, deal.exporter_org_id);
}

/**
 * Internal notes. Exporters are denied structurally (the notes live in a separate table),
 * and this predicate is the second line of that defence.
 */
export async function canViewInternalNote(
  principal: Principal,
  note: { deal?: DealLike | null; buyer_lead?: LeadLike | null },
): Promise<boolean> {
  if (!permits(principal, 'internal_note.view')) return false;
  const orgId = note.deal?.exporter_org_id ?? note.buyer_lead?.exporter_org_id;
  if (!orgId) return isOps(principal);
  return canAccessOrg(principal, orgId);
}

export async function canSendOutreach(principal: Principal, lead: LeadLike): Promise<boolean> {
  if (!permits(principal, 'outreach.send')) return false;
  return canAccessOrg(principal, lead.exporter_org_id);
}

/**
 * Task transition. Ownership matters as well as scope: docs/07 §7.6 requires the actor to
 * own the task or hold permission over it.
 */
export async function canTransitionTask(
  principal: Principal,
  task: { exporter_org_id?: string | null; owner_user_id?: string | null; owner_role: UserRole },
): Promise<boolean> {
  if (!permits(principal, 'task.transition')) return false;
  if (isOps(principal)) return true;
  if (task.owner_user_id === principal.id) return true;
  if (!task.exporter_org_id) return false;
  if (!(await canAccessOrg(principal, task.exporter_org_id))) return false;
  // Exporters may act on exporter-owned tasks in their org; agents on agent-owned ones.
  if (isExporter(principal)) return EXPORTER_ROLES.includes(task.owner_role);
  if (isAgent(principal)) return task.owner_role === UserRole.agent;
  return false;
}

export function canAssignAgent(principal: Principal): boolean {
  return permits(principal, 'agent.assign');
}

export function canSearchAudit(principal: Principal): boolean {
  return permits(principal, 'audit.search');
}

export function canEditFeePolicy(principal: Principal): boolean {
  return permits(principal, 'fee_policy.edit');
}

/** Agents see their own payout only; finance and admin see all. */
export function canViewPayout(principal: Principal, payout: { agent_user_id: string }): boolean {
  const grant = grantFor(principal.role, 'payout.view');
  if (grant === 'none' || !tierAllows(principal, 'payout.view')) return false;
  if (grant === 'restricted') return payout.agent_user_id === principal.id;
  return true;
}

/** Convenience wrapper: run a predicate and throw FORBIDDEN when it fails. */
export async function assertPermitted(
  check: boolean | Promise<boolean>,
  message?: string,
): Promise<void> {
  if (!(await check)) throw forbidden(message);
}
