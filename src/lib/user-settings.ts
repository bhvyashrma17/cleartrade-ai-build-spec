import { OrgTier, UserRole } from '@prisma/client';
import { forbidden, unauthenticated } from '@/lib/errors';
import { prisma } from '@/lib/prisma';
import type { Principal } from '@/types';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  exporter_owner: 'Exporter Owner',
  exporter_member: 'Exporter Member',
  agent: 'ClearTrade Agent',
  ops_supervisor: 'Operations Supervisor',
  ops_finance: 'Operations Finance',
  admin: 'Administrator',
};

export const PLAN_LABELS: Record<OrgTier, string> = {
  guest: 'Guest',
  free: 'Free Plan',
  paid: 'Paid Plan',
};

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', apple: 'Apple' };

export interface UserSettingsData {
  account: { email: string; name: string; roleLabel: string };
  signInMethods: string[];
  workspace: { name: string; tier: OrgTier; planLabel: string } | null;
}

/**
 * Reads settings for the authenticated principal only. There is intentionally no user-id
 * argument: callers cannot select another identity, and staff users never enter an org query.
 */
export async function loadUserSettings(
  principal: Principal | null,
  db: typeof prisma = prisma,
): Promise<UserSettingsData> {
  if (!principal) throw unauthenticated();

  const user = await db.user.findUnique({
    where: { id: principal.id },
    select: {
      email: true,
      name: true,
      role: true,
      exporter_org_id: true,
      is_active: true,
      password_hash: true,
      auth_provider_accounts: { select: { provider: true }, orderBy: { provider: 'asc' } },
      exporter_org: { select: { display_name: true, tier: true } },
    },
  });
  if (!user || !user.is_active) throw unauthenticated();

  // The database row, not a possibly stale JWT claim, remains authoritative.
  if (user.role !== principal.role) {
    throw forbidden('Your account permissions changed. Please sign in again.');
  }

  const methods = new Set<string>();
  if (user.password_hash) methods.add('Password');
  for (const account of user.auth_provider_accounts) {
    const label = PROVIDER_LABELS[account.provider];
    if (label) methods.add(label);
  }

  return {
    account: { email: user.email, name: user.name, roleLabel: USER_ROLE_LABELS[user.role] },
    signInMethods: [...methods],
    workspace: user.exporter_org_id && user.exporter_org
      ? {
          name: user.exporter_org.display_name,
          tier: user.exporter_org.tier,
          planLabel: PLAN_LABELS[user.exporter_org.tier],
        }
      : null,
  };
}
