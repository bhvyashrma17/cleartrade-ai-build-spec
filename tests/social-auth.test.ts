import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { CommitmentFeeStatus, OrgTier, UserRole } from '@prisma/client';
import { isGuestEmail } from '../src/lib/guest';
import { prisma } from '../src/lib/prisma';
import {
  claimsForSocialAccount,
  isSocialProviderEnabled,
  loginErrorMessage,
  normalizeCallbackUrl,
  resolveSocialIdentity,
  socialProviderStates,
} from '../src/lib/social-auth';

afterAll(async () => {
  await prisma.$disconnect();
});

/**
 * Build a partial environment for a provider-state assertion.
 *
 * `NodeJS.ProcessEnv` requires `NODE_ENV`, so a bare object literal cannot be cast to it
 * directly. These helpers deliberately pass *only* the keys under test, which is the point:
 * provider enablement must depend on nothing else in the environment.
 */
const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

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

describe('provider availability and login helpers', () => {
  test('providers are enabled only when both credentials exist', () => {
    expect(
      socialProviderStates(env({
        AUTH_GOOGLE_ID: 'google-id',
        AUTH_GOOGLE_SECRET: 'google-secret',
        AUTH_APPLE_ID: '',
        AUTH_APPLE_SECRET: '',
      })),
    ).toMatchObject([
      { id: 'google', enabled: true },
      { id: 'apple', enabled: false },
    ]);

    expect(isSocialProviderEnabled('apple', env({
      AUTH_APPLE_ID: 'apple-id',
      AUTH_APPLE_SECRET: 'apple-secret',
    }))).toBe(true);
  });

  test('callbackUrl normalization preserves safe local paths only', () => {
    expect(normalizeCallbackUrl('/app/deals?tab=documents')).toBe('/app/deals?tab=documents');
    expect(normalizeCallbackUrl('https://cleartrade.example.com/app/overview', env({
      NEXT_PUBLIC_APP_URL: 'https://cleartrade.example.com',
    }))).toBe('/app/overview');
    expect(normalizeCallbackUrl('https://evil.example.com/phish')).toBe('/');
    expect(normalizeCallbackUrl('//evil.example.com')).toBe('/');
  });

  test('oauth-specific login errors map to explicit operator-facing text', () => {
    expect(loginErrorMessage('OAuthEmailConflict', 'google')).toMatch(/already registered/i);
    expect(loginErrorMessage('OAuthEmailUnavailable', 'apple')).toMatch(/usable verified email/i);
    expect(loginErrorMessage('OAuthProviderDisabled', 'apple')).toMatch(/not configured/i);
  });

  test('credentials provider remains in auth configuration', async () => {
    const authFile = await readFile(path.resolve('src/lib/auth.ts'), 'utf8');
    expect(authFile).toContain("Credentials({");
    expect(authFile).toContain("name: 'Email and password'");
  });
});

describe('social sign-in identity resolution', () => {
  test('new Google identity creates a safe exporter-owner account and tenant', async () => {
    const result = await resolveSocialIdentity({
      provider: 'google',
      providerAccountId: `google-${randomUUID()}`,
      email: `new-google-${randomUUID()}@example.invalid`,
      emailVerified: true,
      name: 'Google New User',
      correlationId: randomUUID(),
    });

    expect(result).toMatchObject({
      ok: true,
      role: UserRole.exporter_owner,
      created: true,
    });
    if (!result.ok) return;

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      select: { role: true, exporter_org_id: true, password_hash: true },
    });
    const org = await prisma.exporterOrg.findUniqueOrThrow({
      where: { id: user.exporter_org_id! },
      select: { tier: true, commitment_fee_status: true },
    });
    expect(user.role).toBe(UserRole.exporter_owner);
    expect(user.password_hash).toBeNull();
    expect([UserRole.agent, UserRole.admin, UserRole.ops_finance, UserRole.ops_supervisor]).not.toContain(user.role);
    expect(org.tier).toBe(OrgTier.free);
    expect(org.commitment_fee_status).toBe(CommitmentFeeStatus.due);
  });

  test('existing linked provider account signs into the same user', async () => {
    const suffix = randomUUID();
    const org = await prisma.exporterOrg.create({
      data: { display_name: `Org ${suffix}`, tier: OrgTier.free },
      select: { id: true },
    });
    const user = await prisma.user.create({
      data: {
        email: `linked-${suffix}@example.invalid`,
        name: 'Linked User',
        password_hash: null,
        role: UserRole.exporter_owner,
        exporter_org_id: org.id,
      },
      select: { id: true },
    });
    await prisma.authProviderAccount.create({
      data: {
        user_id: user.id,
        provider: 'google',
        provider_account_id: `acct-${suffix}`,
        provider_email: `linked-${suffix}@example.invalid`,
      },
    });

    const result = await resolveSocialIdentity({
      provider: 'google',
      providerAccountId: `acct-${suffix}`,
      email: `other-${suffix}@example.invalid`,
      emailVerified: true,
      name: 'Other Name',
      correlationId: randomUUID(),
    });

    expect(result).toMatchObject({ ok: true, userId: user.id, created: false });
    const claims = await claimsForSocialAccount('google', `acct-${suffix}`);
    expect(claims).toMatchObject({ id: user.id, role: UserRole.exporter_owner });
  });

  test('credentials account with same email is not auto-linked', async () => {
    const suffix = randomUUID();
    const org = await prisma.exporterOrg.create({
      data: { display_name: `Org ${suffix}`, tier: OrgTier.free },
      select: { id: true },
    });
    await prisma.user.create({
      data: {
        email: `existing-${suffix}@example.invalid`,
        name: 'Credential User',
        password_hash: 'hashed-password',
        role: UserRole.exporter_owner,
        exporter_org_id: org.id,
      },
    });

    const result = await resolveSocialIdentity({
      provider: 'google',
      providerAccountId: `new-${suffix}`,
      email: `existing-${suffix}@example.invalid`,
      emailVerified: true,
      name: 'Credential User',
      correlationId: randomUUID(),
    });

    expect(result).toMatchObject({ ok: false, reason: 'email_conflict' });
  });

  test('missing provider email is rejected safely', async () => {
    const result = await resolveSocialIdentity({
      provider: 'apple',
      providerAccountId: `apple-${randomUUID()}`,
      email: null,
      emailVerified: null,
      name: 'Apple User',
      correlationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'missing_email' });
  });

  test('unverified Google email is rejected', async () => {
    const result = await resolveSocialIdentity({
      provider: 'google',
      providerAccountId: `google-${randomUUID()}`,
      email: `unverified-${randomUUID()}@example.invalid`,
      emailVerified: false,
      name: 'Unverified User',
      correlationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: false, reason: 'email_not_verified' });
  });

  test('Apple private relay email creates a normal exporter account', async () => {
    const result = await resolveSocialIdentity({
      provider: 'apple',
      providerAccountId: `apple-${randomUUID()}`,
      email: `${randomUUID()}@privaterelay.appleid.com`,
      emailVerified: null,
      name: 'Relay User',
      correlationId: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, role: UserRole.exporter_owner, created: true });
  });
});

describe('account-linking edge cases', () => {
  test('a provider account already linked to one user cannot be claimed by another', async () => {
    const suffix = randomUUID();
    const org = await prisma.exporterOrg.create({
      data: { display_name: `Org ${suffix}`, tier: OrgTier.free },
      select: { id: true },
    });
    const [first, second] = await Promise.all([
      prisma.user.create({
        data: { email: `first-${suffix}@example.invalid`, name: 'First', password_hash: null, role: UserRole.exporter_owner, exporter_org_id: org.id },
        select: { id: true },
      }),
      prisma.user.create({
        data: { email: `second-${suffix}@example.invalid`, name: 'Second', password_hash: null, role: UserRole.exporter_owner, exporter_org_id: org.id },
        select: { id: true },
      }),
    ]);
    await prisma.authProviderAccount.create({
      data: { user_id: first.id, provider: 'google', provider_account_id: `dup-${suffix}`, provider_email: `first-${suffix}@example.invalid` },
    });

    // The (provider, provider_account_id) uniqueness is the linkage invariant: one external
    // identity resolves to exactly one local user, forever. Re-pointing it at a second user
    // is what an account-takeover attempt would look like at the database level.
    await expect(
      prisma.authProviderAccount.create({
        data: { user_id: second.id, provider: 'google', provider_account_id: `dup-${suffix}`, provider_email: `second-${suffix}@example.invalid` },
      }),
    ).rejects.toThrow();

    // Re-presenting the same external identity still resolves to the original user.
    await expect(resolveSocialIdentity({
      provider: 'google', providerAccountId: `dup-${suffix}`,
      email: `second-${suffix}@example.invalid`, emailVerified: true, name: 'Second', correlationId: randomUUID(),
    })).resolves.toMatchObject({ ok: true, userId: first.id, created: false });
  });

  test('a second distinct provider identity cannot take over an existing social account by email', async () => {
    const suffix = randomUUID();
    const email = `owner-${suffix}@example.invalid`;
    const first = await resolveSocialIdentity({
      provider: 'google', providerAccountId: `orig-${suffix}`,
      email, emailVerified: true, name: 'Original Owner', correlationId: randomUUID(),
    });
    expect(first).toMatchObject({ ok: true, created: true });

    // Same verified email, different Google account id — must NOT silently attach.
    await expect(resolveSocialIdentity({
      provider: 'google', providerAccountId: `attacker-${suffix}`,
      email, emailVerified: true, name: 'Someone Else', correlationId: randomUUID(),
    })).resolves.toMatchObject({ ok: false, reason: 'email_conflict' });
  });

  test('a deactivated user cannot sign in through a linked provider account', async () => {
    const suffix = randomUUID();
    const created = await resolveSocialIdentity({
      provider: 'google', providerAccountId: `inactive-${suffix}`,
      email: `inactive-${suffix}@example.invalid`, emailVerified: true, name: 'Inactive', correlationId: randomUUID(),
    });
    if (!created.ok) throw new Error('fixture failed');
    await prisma.user.update({ where: { id: created.userId }, data: { is_active: false } });

    await expect(resolveSocialIdentity({
      provider: 'google', providerAccountId: `inactive-${suffix}`,
      email: `inactive-${suffix}@example.invalid`, emailVerified: true, name: 'Inactive', correlationId: randomUUID(),
    })).resolves.toMatchObject({ ok: false, reason: 'inactive_account' });
    // And the JWT claim path must refuse it too, not just the sign-in gate.
    expect(await claimsForSocialAccount('google', `inactive-${suffix}`)).toBeNull();
  });

  test('Apple returning no name on a later sign-in does not erase the stored name', async () => {
    const suffix = randomUUID();
    const created = await resolveSocialIdentity({
      provider: 'apple', providerAccountId: `apple-${suffix}`,
      email: `apple-${suffix}@privaterelay.appleid.com`, emailVerified: true, name: 'Apple First Name', correlationId: randomUUID(),
    });
    if (!created.ok) throw new Error('fixture failed');

    // Apple sends the display name only on the first authorization; every later sign-in
    // arrives with name = null. Resolution must be a lookup, never an overwrite.
    await resolveSocialIdentity({
      provider: 'apple', providerAccountId: `apple-${suffix}`,
      email: null, emailVerified: null, name: null, correlationId: randomUUID(),
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: created.userId }, select: { name: true } });
    expect(user.name).toBe('Apple First Name');
  });
});

describe('social sign-in never escalates privilege', () => {
  test('no privileged role or staff tenant is reachable through social provisioning', async () => {
    const suffix = randomUUID();
    const result = await resolveSocialIdentity({
      provider: 'google', providerAccountId: `role-${suffix}`,
      email: `role-${suffix}@example.invalid`, emailVerified: true, name: 'Role Probe', correlationId: randomUUID(),
    });
    if (!result.ok) throw new Error('fixture failed');

    expect(result.role).toBe(UserRole.exporter_owner);
    expect(result.exporterOrgId).toBeTruthy();

    // The provisioning path must contain no branch that can assign a privileged role. This
    // is asserted against the source because it is a policy invariant, not a data value:
    // a future edit that adds an `agent`/`admin` branch should fail here loudly.
    const source = await readFile(path.resolve('src/lib/social-auth.ts'), 'utf8');
    for (const forbidden of ['UserRole.agent', 'UserRole.admin', 'UserRole.ops_supervisor', 'UserRole.ops_finance']) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).toContain('role: UserRole.exporter_owner');
  });

  test('a social user is never mistakable for a guest', async () => {
    const suffix = randomUUID();
    const result = await resolveSocialIdentity({
      provider: 'google', providerAccountId: `guestlike-${suffix}`,
      email: `guestlike-${suffix}@example.invalid`, emailVerified: true, name: 'Guest Like', correlationId: randomUUID(),
    });
    if (!result.ok) throw new Error('fixture failed');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: result.userId },
      select: { email: true, password_hash: true, exporter_org: { select: { tier: true } } },
    });

    // A social user shares the guest sentinel `password_hash === null`, so the guest
    // credentials provider's SECOND check — org tier must be `guest` — is the only thing
    // standing between a valid mint proof and impersonating a real social account.
    expect(user.password_hash).toBeNull();
    expect(user.exporter_org?.tier).toBe(OrgTier.free);
    expect(isGuestEmail(user.email)).toBe(false);

    const authSource = await readFile(path.resolve('src/lib/auth.ts'), 'utf8');
    expect(authSource).toContain('user.exporter_org?.tier !== OrgTier.guest');
  });
});

describe('login page composition', () => {
  test('both provider buttons render with official-looking inline marks and no remote assets', async () => {
    const buttons = await readFile(path.resolve('src/app/(auth)/login/SocialSignInButtons.tsx'), 'utf8');
    expect(buttons).toContain('Continue with Google');
    expect(buttons).toContain('Continue with Apple');
    // Marks must be inline SVG. A remote logo URL would leak the visitor's IP to the
    // provider before they have chosen to sign in, and would break under a strict CSP.
    expect(buttons).toMatch(/<svg/);
    expect(buttons).not.toMatch(/https?:\/\/[^"'\s]*\.(png|svg|jpe?g|gif)/i);
    // Disabled rather than redirecting into a guaranteed OAuth failure.
    expect(buttons).toContain('disabled={!provider.enabled || pending}');
    expect(buttons).toContain('aria-disabled');
    expect(buttons).toContain('Redirecting…');
  });

  test('the login page keeps credentials sign-in and preserves the intended destination', async () => {
    const form = await readFile(path.resolve('src/app/(auth)/login/LoginForm.tsx'), 'utf8');
    expect(form).toContain('name="callbackUrl"');
    expect(form).toContain('autoComplete="current-password"');
    expect(form).toContain('SocialSignInButtons');
    expect(form).toContain('role="alert"');

    const page = await readFile(path.resolve('src/app/(auth)/login/page.tsx'), 'utf8');
    expect(page).toContain('normalizeCallbackUrl');
    expect(page).toContain('socialProviderStates()');
    // One login page only — the social buttons live on the existing surface.
    expect(page).toContain('LoginForm');
  });

  test('the social sign-in action re-checks enablement server-side', async () => {
    const actions = await readFile(path.resolve('src/app/(auth)/login/actions.ts'), 'utf8');
    // The button being disabled in the UI is not a control; a hand-crafted POST must be
    // rejected by the server action too.
    expect(actions).toContain('isSocialProviderEnabled(provider)');
    expect(actions).toContain('normalizeCallbackUrl');
    // Secrets must never cross into the client bundle.
    expect(actions).not.toContain('NEXT_PUBLIC_AUTH');
  });
});
