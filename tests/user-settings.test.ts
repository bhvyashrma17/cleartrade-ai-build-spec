import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { OrgTier, UserRole } from '@prisma/client';
import { describe, expect, test } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { loadUserSettings } from '../src/lib/user-settings';
import type { Principal } from '../src/types';

function principal(id: string, email: string, role: UserRole, orgId: string | null, tier = OrgTier.paid): Principal {
  return { id, email, name: 'Session name', role, exporter_org_id: orgId, tier };
}

describe('normal-user settings', () => {
  test('uses the authenticated user and canonical tenant tier without leaking another tenant', async () => {
    const suffix = randomUUID();
    const [ownOrg, otherOrg] = await Promise.all([
      prisma.exporterOrg.create({ data: { display_name: `Own workspace ${suffix}`, tier: OrgTier.free } }),
      prisma.exporterOrg.create({ data: { display_name: `Other workspace ${suffix}`, tier: OrgTier.paid } }),
    ]);
    const [owner, other] = await Promise.all([
      prisma.user.create({ data: { email: `owner-${suffix}@test.local`, name: 'Own User', role: UserRole.exporter_owner, exporter_org_id: ownOrg.id, password_hash: 'not-returned' } }),
      prisma.user.create({ data: { email: `other-${suffix}@test.local`, name: 'Other User', role: UserRole.exporter_owner, exporter_org_id: otherOrg.id, password_hash: 'secret-that-must-not-leak' } }),
    ]);

    const result = await loadUserSettings(principal(owner.id, other.email, owner.role, ownOrg.id, OrgTier.paid));

    expect(result).toEqual({
      account: { email: owner.email, name: owner.name, roleLabel: 'Exporter Owner' },
      signInMethods: ['Password'],
      workspace: { name: ownOrg.display_name, tier: OrgTier.free, planLabel: 'Free Plan' },
    });
    expect(JSON.stringify(result)).not.toContain(other.email);
    expect(JSON.stringify(result)).not.toContain('secret-that-must-not-leak');
    expect(result).not.toHaveProperty('password_hash');
  });

  test.each([UserRole.agent, UserRole.ops_supervisor, UserRole.ops_finance, UserRole.admin])(
    '%s settings do not assume exporter_org_id',
    async (role) => {
      const suffix = randomUUID();
      const user = await prisma.user.create({ data: { email: `${role}-${suffix}@test.local`, name: 'Staff User', role } });
      const result = await loadUserSettings(principal(user.id, user.email, role, null));
      expect(result.account.email).toBe(user.email);
      expect(result.workspace).toBeNull();
    },
  );

  test('exposes only safe sign-in labels, never provider identifiers or credentials', async () => {
    const suffix = randomUUID();
    const user = await prisma.user.create({ data: { email: `social-${suffix}@test.local`, name: 'Social User', role: UserRole.agent } });
    await prisma.authProviderAccount.create({ data: { user_id: user.id, provider: 'google', provider_account_id: `provider-secret-${suffix}`, provider_email: user.email } });

    const result = await loadUserSettings(principal(user.id, user.email, user.role, null));
    expect(result.signInMethods).toEqual(['Google']);
    expect(JSON.stringify(result)).not.toContain('provider-secret');
    expect(JSON.stringify(result)).not.toMatch(/token|oauth.*secret/i);
  });

  test('refuses an unauthenticated request and offers no identity selector', async () => {
    await expect(loadUserSettings(null)).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
    expect(loadUserSettings).toHaveLength(1);
  });

  test('settings navigation and Auth.js sign-out use their intended routes', async () => {
    const [menuRoutes, page, action] = await Promise.all([
      readFile(path.resolve('src/components/shell/profile-menu.ts'), 'utf8'),
      readFile(path.resolve('src/app/app/settings/page.tsx'), 'utf8'),
      readFile(path.resolve('src/app/app/settings/actions.ts'), 'utf8'),
    ]);
    expect(menuRoutes).toContain("'/app/settings'");
    expect(page).toContain("redirect('/login?callbackUrl=/app/settings')");
    expect(action).toContain("signOut({ redirectTo: '/login' })");
    expect(action).not.toMatch(/cookie|document\.cookie/i);
    expect(page).not.toMatch(/password_hash|provider_account_id|access_token|refresh_token|client_secret/i);
    // Approved legal copy is absent, so those rows are hidden; authenticated support is real.
    expect(page).not.toMatch(/Privacy policy|Terms of service|Not available yet/);
    expect(page).toContain('AboutSettingsSection');
  });
});
