import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import { OrgTier, StaffInvitationStatus, UserRole } from '@prisma/client';
import {
  acceptStaffInvitation, convertUserToAgent, inspectStaffInvitation, inviteStaff,
  revokeStaffInvitation,
} from '../src/lib/staff-provisioning';
import { buildInvitationUrl, invitationPath, ACCEPT_INVITATION_PATH } from '../src/lib/invitation-link';
import { prisma } from '../src/lib/prisma';
import type { Principal } from '../src/types';

/**
 * Accepting a staff invitation as an EXISTING ClearTrade user.
 *
 * The flow exists because the original design only ever created a brand-new staff account, so
 * anyone who already had a ClearTrade login — which, after Google sign-in, is everyone —
 * collided with the unique-email constraint and could never become an agent.
 *
 * The invariant every test here is really defending: the browser supplies a token and nothing
 * else. Which account converts, to what role, and whether it is allowed at all are decided
 * server-side from the session and the invitation row.
 */

afterAll(async () => { await prisma.$disconnect(); });

const corr = () => randomUUID();

const principalFor = (
  user: { id: string; email: string; role: UserRole; exporter_org_id?: string | null },
): Principal => ({
  id: user.id, email: user.email, name: 'Test', role: user.role,
  exporter_org_id: user.exporter_org_id ?? null, tier: OrgTier.paid,
});

async function ops() {
  const s = randomUUID().slice(0, 8);
  const row = await prisma.user.create({
    data: { email: `conv-ops-${s}@t.test`, name: 'Ops', role: UserRole.ops_supervisor },
    select: { id: true, email: true },
  });
  return { suffix: s, principal: principalFor({ ...row, role: UserRole.ops_supervisor }) };
}

/** An exporter owner whose org has no other members and no business data. */
async function soloExporter(suffix: string, email: string) {
  const org = await prisma.exporterOrg.create({
    data: { display_name: `Conv Org ${suffix}`, tier: OrgTier.paid }, select: { id: true },
  });
  const user = await prisma.user.create({
    data: {
      email, name: 'Exporter', role: UserRole.exporter_owner,
      exporter_org_id: org.id, password_hash: 'hashed-password-value',
    },
    select: { id: true, email: true },
  });
  return { orgId: org.id, user, principal: principalFor({ ...user, role: UserRole.exporter_owner, exporter_org_id: org.id }) };
}

// ---------------------------------------------------------------------------

describe('the invitation link an operator is shown', () => {
  test('is a full, absolute URL built from the trusted browser origin', () => {
    const url = buildInvitationUrl('https://staging.example.com', 'tok-123');
    expect(url).toBe('https://staging.example.com/accept-staff-invitation?token=tok-123');
    expect(url.startsWith('https://')).toBe(true);
    expect(url).toContain(ACCEPT_INVITATION_PATH);
  });

  test('tolerates a trailing slash without producing a double slash', () => {
    expect(buildInvitationUrl('https://staging.example.com/', 'tok-123'))
      .toBe('https://staging.example.com/accept-staff-invitation?token=tok-123');
  });

  test('the relative path is same-origin, so a sign-out round trip cannot be redirected away', () => {
    // This is what the "sign out and continue" flow carries as its post-login callback. It
    // must stay relative: an absolute URL here would be an open-redirect waiting for a crafted
    // token, and `normalizeCallbackUrl` would reject it anyway.
    const path = invitationPath('tok-123');
    expect(path).toBe('/accept-staff-invitation?token=tok-123');
    expect(path.startsWith('/')).toBe(true);
    expect(path.startsWith('//')).toBe(false);
    expect(path).not.toMatch(/^https?:/);
  });

  test('URL-encodes the token so the link survives any token alphabet', () => {
    // base64url happens to be query-safe; encoding makes that a property of this function
    // rather than a lucky property of the generator.
    expect(buildInvitationUrl('https://x.test', 'a+b/c=d')).toContain('token=a%2Bb%2Fc%3Dd');
  });

  test('the invite service still returns the raw token exactly once, and stores only its hash', async () => {
    const o = await ops();
    const email = `invitee-${o.suffix}@t.test`;
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    expect(token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const stored = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(stored.token).not.toBe(token);
    expect(stored.token).toMatch(/^[0-9a-f]{64}$/);

    // Nothing re-reads the raw token later — there is no field that could.
    expect(JSON.stringify(stored)).not.toContain(token);
  });
});

describe('inspecting an invitation never mutates anything', () => {
  test('opening the link does NOT convert a matching signed-in user', async () => {
    const o = await ops();
    const email = `open-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const view = await inspectStaffInvitation(token, exporter.principal);
    expect(view.state).toBe('ready_convert');

    // The whole point: rendering the page changed nothing.
    const after = await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } });
    expect(after.role).toBe(UserRole.exporter_owner);
    expect(after.exporter_org_id).toBe(exporter.orgId);
    const invitation = await prisma.staffInvitation.findFirstOrThrow({ where: { email } });
    expect(invitation.status).toBe(StaffInvitationStatus.pending);
  });

  test('an unknown token reveals nothing at all', async () => {
    expect(await inspectStaffInvitation('not-a-real-token', null)).toEqual({ state: 'unknown' });
    expect(await inspectStaffInvitation(null, null)).toEqual({ state: 'unknown' });
    expect(await inspectStaffInvitation('', null)).toEqual({ state: 'unknown' });
  });

  test('an unauthenticated visitor with a live token is offered account creation', async () => {
    const o = await ops();
    const email = `fresh-${o.suffix}@t.test`;
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const view = await inspectStaffInvitation(token, null);
    expect(view).toMatchObject({ state: 'ready_new_account', invitation_email: email });
  });

  test('an unauthenticated visitor whose address already has an account is sent to sign in', async () => {
    const o = await ops();
    const email = `existing-${o.suffix}@t.test`;
    await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    // Creating a second User here would hit the unique-email constraint, so the page routes
    // them through authentication instead of failing at the database.
    const view = await inspectStaffInvitation(token, null);
    expect(view).toMatchObject({ state: 'ready_needs_signin', invitation_email: email });
  });

  test('an expired token is reported as expired, and never names the invited address', async () => {
    const o = await ops();
    const email = `exp-${o.suffix}@t.test`;
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });
    await prisma.staffInvitation.update({
      where: { id: invitation.id }, data: { expires_at: new Date(Date.now() - 1000) },
    });

    const view = await inspectStaffInvitation(token, null);
    expect(view).toEqual({ state: 'expired' });
    expect(JSON.stringify(view)).not.toContain(email);
  });

  test('a revoked token is reported as consumed, and never names the invited address', async () => {
    const o = await ops();
    const email = `rev-${o.suffix}@t.test`;
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });
    await revokeStaffInvitation({ actor: o.principal, invitationId: invitation.id, correlationId: corr() });

    const view = await inspectStaffInvitation(token, null);
    expect(view).toEqual({ state: 'consumed' });
    expect(JSON.stringify(view)).not.toContain(email);
  });

  test('a signed-in user with a different address sees the mismatch, not a conversion offer', async () => {
    const o = await ops();
    const invited = `wanted-${o.suffix}@t.test`;
    const other = await soloExporter(o.suffix, `other-${o.suffix}@t.test`);
    const { token } = await inviteStaff({ actor: o.principal, email: invited, correlationId: corr() });

    const view = await inspectStaffInvitation(token, other.principal);
    expect(view).toMatchObject({
      state: 'mismatch', invitation_email: invited, current_email: other.user.email,
    });
  });

  test('email matching ignores case and surrounding whitespace on both sides', async () => {
    const o = await ops();
    const email = `MiXeD-${o.suffix}@T.TEST`.toLowerCase();
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email: `  ${email.toUpperCase()}  `, correlationId: corr() });

    const shouted = { ...exporter.principal, email: `  ${email.toUpperCase()} ` };
    expect((await inspectStaffInvitation(token, shouted)).state).toBe('ready_convert');
  });
});

describe('converting an existing account', () => {
  test('the confirmed conversion makes the account an agent with no tenant', async () => {
    const o = await ops();
    const email = `convert-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const result = await convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() });
    expect(result).toMatchObject({ role: UserRole.agent, alreadyAgent: false, detachedFromOrgId: exporter.orgId });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } });
    expect(after.role).toBe(UserRole.agent);
    // Staff hold no tenant — and `getPrincipal` reads tier as `exporter_org?.tier ?? paid`,
    // so an agent that kept an org would be governed by that org's tier, not the role matrix.
    expect(after.exporter_org_id).toBeNull();

    const consumed = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(consumed.status).toBe(StaffInvitationStatus.accepted);
    expect(consumed.accepted_user_id).toBe(exporter.user.id);
    expect(consumed.accepted_at).not.toBeNull();
    // Provenance survives the acceptance.
    expect(consumed.invited_by_id).toBe(o.principal.id);
  });

  test('the same User row is reused — no duplicate account is created', async () => {
    const o = await ops();
    const email = `same-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const result = await convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() });
    expect(result.userId).toBe(exporter.user.id);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  test('password sign-in survives: the password hash is untouched', async () => {
    const o = await ops();
    const email = `pw-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const before = await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } });
    expect(after.password_hash).toBe(before.password_hash);
    expect(after.password_hash).not.toBeNull();
  });

  test('Google sign-in survives: provider account links are untouched', async () => {
    const o = await ops();
    const email = `oauth-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    await prisma.authProviderAccount.create({
      data: {
        user_id: exporter.user.id, provider: 'google',
        provider_account_id: `google-${o.suffix}`, provider_email: email,
      },
    });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() });

    // Updating the user in place — rather than deleting and recreating — is what keeps this
    // link alive, and with it the ability to sign in with Google.
    const links = await prisma.authProviderAccount.findMany({ where: { user_id: exporter.user.id } });
    expect(links).toHaveLength(1);
    expect(links[0]!.provider).toBe('google');
    expect(links[0]!.provider_account_id).toBe(`google-${o.suffix}`);
  });

  test('the conversion is audited against the org the account left', async () => {
    const o = await ops();
    const email = `audit-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() });

    const event = await prisma.auditEvent.findFirstOrThrow({
      where: { object_type: 'user', object_id: exporter.user.id },
      orderBy: { timestamp: 'desc' },
    });
    expect(event.exporter_org_id).toBe(exporter.orgId);
    const payload = JSON.stringify(event.after_summary);
    expect(payload).toContain('agent');
    expect(payload).toContain('converted_existing_account');
    // The token is a credential and never belongs in an audit payload.
    expect(payload).not.toContain(token);
  });
});

describe('conversion refuses everything it should', () => {
  test('a replayed token is refused the second time', async () => {
    const o = await ops();
    const email = `replay-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() });
    const asAgent = { ...exporter.principal, role: UserRole.agent, exporter_org_id: null };
    await expect(convertUserToAgent({ actor: asAgent, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('two concurrent confirmations consume the invitation exactly once', async () => {
    const o = await ops();
    const email = `race-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const results = await Promise.allSettled([
      convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }),
      convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }),
    ]);
    // The compare-and-swap on the invitation status means exactly one confirmation wins; the
    // loser's whole transaction rolls back rather than converting a second time.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

    const consumed = await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(consumed.status).toBe(StaffInvitationStatus.accepted);
    expect(await prisma.user.count({ where: { email } })).toBe(1);
  });

  test('an expired token is refused', async () => {
    const o = await ops();
    const email = `conv-exp-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });
    await prisma.staffInvitation.update({
      where: { id: invitation.id }, data: { expires_at: new Date(Date.now() - 1000) },
    });

    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } })).role)
      .toBe(UserRole.exporter_owner);
  });

  test('a revoked token is refused', async () => {
    const o = await ops();
    const email = `conv-rev-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });
    await revokeStaffInvitation({ actor: o.principal, invitationId: invitation.id, correlationId: corr() });

    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  test('a signed-in account whose email does not match is refused', async () => {
    const o = await ops();
    const invited = `target-${o.suffix}@t.test`;
    const other = await soloExporter(o.suffix, `intruder-${o.suffix}@t.test`);
    const { token } = await inviteStaff({ actor: o.principal, email: invited, correlationId: corr() });

    await expect(convertUserToAgent({ actor: other.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.user.id } })).role)
      .toBe(UserRole.exporter_owner);
  });

  test('the browser cannot choose a different account by lying about its identity', async () => {
    const o = await ops();
    const invited = `victim-${o.suffix}@t.test`;
    const victim = await soloExporter(o.suffix, invited);
    const attacker = await soloExporter(o.suffix, `attacker-${o.suffix}@t.test`);
    const { token } = await inviteStaff({ actor: o.principal, email: invited, correlationId: corr() });

    // The attacker claims the victim's email while holding their own session id. The service
    // re-reads the account by id and compares THAT email, so the forged claim is ignored.
    const forged = { ...attacker.principal, email: invited };
    await expect(convertUserToAgent({ actor: forged, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: attacker.user.id } })).role)
      .toBe(UserRole.exporter_owner);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: victim.user.id } })).role)
      .toBe(UserRole.exporter_owner);
  });

  test('the browser cannot choose a role — the invitation decides it', async () => {
    const o = await ops();
    const email = `role-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    // Even if an invitation somehow carried a non-agent staff role, conversion refuses it:
    // elevating an existing account to Ops is a provisioning decision, not a link.
    await prisma.$executeRawUnsafe(
      `UPDATE "StaffInvitation" SET "role" = 'ops_supervisor' WHERE "id" = $1`, invitation.id,
    );
    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } })).role)
      .toBe(UserRole.exporter_owner);
  });

  test('an account that became an admin after being invited is refused', async () => {
    // Invited legitimately as an exporter, then promoted to admin before accepting. The role
    // is re-read inside the mutation, so the stale invitation cannot demote them to agent.
    const o = await ops();
    const email = `becomes-admin-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await prisma.user.update({
      where: { id: exporter.user.id }, data: { role: UserRole.admin, exporter_org_id: null },
    });
    const asAdmin = principalFor({ id: exporter.user.id, email, role: UserRole.admin });

    expect((await inspectStaffInvitation(token, asAdmin)).state).toBe('already_staff');
    await expect(convertUserToAgent({ actor: asAdmin, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } })).role)
      .toBe(UserRole.admin);
  });

  test('an account that became Ops after being invited is refused', async () => {
    const o = await ops();
    const email = `becomes-ops-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await prisma.user.update({
      where: { id: exporter.user.id }, data: { role: UserRole.ops_finance, exporter_org_id: null },
    });
    const asOps = principalFor({ id: exporter.user.id, email, role: UserRole.ops_finance });

    await expect(convertUserToAgent({ actor: asOps, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } })).role)
      .toBe(UserRole.ops_finance);
  });

  test('an existing staff account cannot even be invited', async () => {
    // The other half of the same rule, enforced a step earlier: Ops/admin role changes are a
    // provisioning decision, so the invitation is refused at creation rather than at acceptance.
    const o = await ops();
    const s = randomUUID().slice(0, 8);
    const email = `staff-${s}@t.test`;
    await prisma.user.create({ data: { email, name: 'Ops', role: UserRole.ops_supervisor } });

    await expect(inviteStaff({ actor: o.principal, email, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(await prisma.staffInvitation.count({ where: { email } })).toBe(0);
  });

  test('an inactive account cannot accept', async () => {
    const o = await ops();
    const email = `inactive-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    await prisma.user.update({ where: { id: exporter.user.id }, data: { is_active: false } });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('an account already holding the agent role', () => {
  test('is handled idempotently and is never detached twice', async () => {
    const o = await ops();
    const s = randomUUID().slice(0, 8);
    const email = `already-${s}@t.test`;
    const agent = await prisma.user.create({
      data: { email, name: 'Agent', role: UserRole.agent }, select: { id: true, email: true },
    });
    const actor = principalFor({ ...agent, role: UserRole.agent });
    const { invitation, token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    expect((await inspectStaffInvitation(token, actor)).state).toBe('already_agent');

    const result = await convertUserToAgent({ actor, token, correlationId: corr() });
    expect(result).toMatchObject({ alreadyAgent: true, role: UserRole.agent, detachedFromOrgId: null });

    // The invitation is still consumed, so the link cannot be reused later.
    expect((await prisma.staffInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).status)
      .toBe(StaffInvitationStatus.accepted);
  });
});

describe('exporter tenant safety', () => {
  test('the sole owner of a workspace with other members is refused', async () => {
    const o = await ops();
    const email = `owner-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    // A second, non-owner member. Converting the only owner would leave them with nobody able
    // to administer the workspace.
    await prisma.user.create({
      data: {
        email: `member-${o.suffix}@t.test`, name: 'Member',
        role: UserRole.exporter_member, exporter_org_id: exporter.orgId,
      },
    });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const view = await inspectStaffInvitation(token, exporter.principal);
    expect(view.state).toBe('blocked_convert');
    if (view.state === 'blocked_convert') expect(view.reason).toMatch(/only owner/i);

    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: exporter.user.id } })).exporter_org_id)
      .toBe(exporter.orgId);
  });

  test('the sole owner of a workspace holding business data is refused, and the data is kept', async () => {
    const o = await ops();
    const email = `bizowner-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const product = await prisma.product.create({
      data: { exporter_org_id: exporter.orgId, name: 'Basmati rice' }, select: { id: true },
    });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Fail closed, and destroy nothing on the way.
    expect(await prisma.product.findUnique({ where: { id: product.id } })).not.toBeNull();
    expect((await prisma.exporterOrg.findUnique({ where: { id: exporter.orgId } }))).not.toBeNull();
  });

  test('an owner with a co-owner is allowed — the workspace keeps an owner', async () => {
    const o = await ops();
    const email = `co-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    await prisma.user.create({
      data: {
        email: `coowner-${o.suffix}@t.test`, name: 'Co-owner',
        role: UserRole.exporter_owner, exporter_org_id: exporter.orgId,
      },
    });
    // Business data present, but the invariant holds because another owner remains.
    await prisma.product.create({ data: { exporter_org_id: exporter.orgId, name: 'Rice' } });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    expect((await inspectStaffInvitation(token, exporter.principal)).state).toBe('ready_convert');
    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .resolves.toMatchObject({ role: UserRole.agent });
  });

  test('an exporter member is always safe to convert', async () => {
    const o = await ops();
    const org = await prisma.exporterOrg.create({
      data: { display_name: `Member Org ${o.suffix}`, tier: OrgTier.paid }, select: { id: true },
    });
    await prisma.user.create({
      data: {
        email: `keeps-owner-${o.suffix}@t.test`, name: 'Owner',
        role: UserRole.exporter_owner, exporter_org_id: org.id,
      },
    });
    const email = `member2-${o.suffix}@t.test`;
    const member = await prisma.user.create({
      data: { email, name: 'Member', role: UserRole.exporter_member, exporter_org_id: org.id },
      select: { id: true, email: true },
    });
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const actor = principalFor({ ...member, role: UserRole.exporter_member, exporter_org_id: org.id });
    await expect(convertUserToAgent({ actor, token, correlationId: corr() }))
      .resolves.toMatchObject({ role: UserRole.agent, detachedFromOrgId: org.id });
  });

  test('a brand-new sign-up account converts cleanly — the empty org has nothing to orphan', async () => {
    // This is the ordinary case: Google sign-in mints an exporter_owner and an empty org as a
    // side effect of authenticating. Refusing it would mean no ordinary user could ever accept
    // an agent invitation.
    const o = await ops();
    const email = `signup-${o.suffix}@t.test`;
    const exporter = await soloExporter(o.suffix, email);
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    expect((await inspectStaffInvitation(token, exporter.principal)).state).toBe('ready_convert');
    await expect(convertUserToAgent({ actor: exporter.principal, token, correlationId: corr() }))
      .resolves.toMatchObject({ role: UserRole.agent });

    // The now-empty org is left in place rather than deleted; this flow never destroys data.
    expect(await prisma.exporterOrg.findUnique({ where: { id: exporter.orgId } })).not.toBeNull();
  });
});

describe('the original new-account path still works', () => {
  test('an invitee with no ClearTrade account still gets one', async () => {
    const o = await ops();
    const email = `brandnew-${o.suffix}@t.test`;
    const { token } = await inviteStaff({ actor: o.principal, email, correlationId: corr() });

    const { role } = await acceptStaffInvitation({ token, name: 'Brand New', correlationId: corr() });
    expect(role).toBe(UserRole.agent);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.role).toBe(UserRole.agent);
    expect(user.exporter_org_id).toBeNull();
  });
});
